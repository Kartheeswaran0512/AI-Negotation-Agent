/**
 * One contract, two stores.
 *
 * The in-memory store is not a convenience stub - the agent, the demo and the
 * scenario suite all run on it - so it has to keep the same promises MySQL
 * does. This suite runs against memory always, and against a real MySQL when
 * RUN_DB_TESTS=1, which is what stops the two implementations drifting apart.
 *
 *   RUN_DB_TESTS=1 TEST_DB_NAME=negotiation_agent_test npm run test:integration
 *
 * The MySQL half creates and drops tables. Point it at a throwaway database.
 */

import mysql from 'mysql2/promise';

import { loadConfig } from '../../src/config/env.js';
import { createMemoryRepositories } from '../../src/repositories/memoryRepositories.js';
import { createMysqlRepositories } from '../../src/repositories/mysqlRepositories.js';
import { createPool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';
import { toMinor } from '../../src/domain/money.js';

const config = loadConfig(process.env);
const runDbTests = config.test.runDbTests;

/** @param {() => Promise<import('../../src/repositories/types.js').Repositories>} makeStore */
function contractSuite(label, makeStore, teardown = async () => {}) {
  describe(`repository contract: ${label}`, () => {
    let repositories;

    beforeEach(async () => {
      repositories = await makeStore();
    });

    afterAll(async () => {
      await teardown();
    });

    async function fixture() {
      const buyer = await repositories.users.create({
        role: 'buyer',
        name: 'Buyer',
        email: `buyer-${Math.random().toString(36).slice(2)}@example.test`,
      });
      const seller = await repositories.users.create({
        role: 'seller',
        name: 'Seller',
        email: `seller-${Math.random().toString(36).slice(2)}@example.test`,
      });
      const requirement = await repositories.requirements.create({
        buyerId: buyer.id,
        product: 'wireless earbuds',
        quantity: 100,
        unit: 'pieces',
        currency: 'INR',
        targetPriceMinor: toMinor('600'),
        maxPriceMinor: toMinor('700'),
        priceBasis: 'per_unit',
      });
      const negotiation = await repositories.negotiations.create({
        requirementId: requirement.id,
        sellerId: seller.id,
        maxRounds: 6,
      });
      return { buyer, seller, requirement, negotiation };
    }

    test('money survives the round trip as exact minor units', async () => {
      const { requirement } = await fixture();
      const loaded = await repositories.requirements.findById(requirement.id);
      expect(loaded.targetPriceMinor).toBe(60000);
      expect(loaded.maxPriceMinor).toBe(70000);
    });

    test('a fractional price is not rounded away', async () => {
      const { negotiation } = await fixture();
      await repositories.offers.record({
        negotiationId: negotiation.id,
        actor: 'seller',
        unitPriceMinor: toMinor('649.99'),
        currency: 'INR',
      });
      const [offer] = await repositories.offers.listByNegotiation(negotiation.id);
      expect(offer.unitPriceMinor).toBe(64999);
    });

    test('messages come back in order and carry their price', async () => {
      const { negotiation } = await fixture();
      await repositories.messages.append({
        negotiationId: negotiation.id,
        author: 'agent',
        kind: 'text',
        body: 'opening',
      });
      await repositories.messages.append({
        negotiationId: negotiation.id,
        author: 'seller',
        kind: 'offer',
        body: 'Rs 850 per unit',
        priceMinor: toMinor('850'),
      });

      const thread = await repositories.messages.listByNegotiation(negotiation.id);
      expect(thread.map((m) => m.author)).toEqual(['agent', 'seller']);
      expect(thread[1].priceMinor).toBe(85000);
    });

    test('lastInbound finds the newest supplier message and ignores our own', async () => {
      const { negotiation } = await fixture();
      await repositories.messages.append({
        negotiationId: negotiation.id,
        author: 'seller',
        body: 'first',
      });
      const second = await repositories.messages.append({
        negotiationId: negotiation.id,
        author: 'seller',
        body: 'second',
      });
      await repositories.messages.append({
        negotiationId: negotiation.id,
        author: 'agent',
        body: 'ours',
      });

      const inbound = await repositories.messages.lastInbound(negotiation.id);
      expect(String(inbound.id)).toBe(String(second.id));
      expect(inbound.body).toBe('second');
    });

    test('THE OUTBOX REFUSES A DUPLICATE IDEMPOTENCY KEY', async () => {
      const { negotiation } = await fixture();
      const entry = {
        negotiationId: negotiation.id,
        idempotencyKey: `neg:${negotiation.id}:reply:42`,
        payload: { kind: 'counter' },
      };

      const first = await repositories.outbox.claim(entry);
      const second = await repositories.outbox.claim(entry);

      expect(first.claimed).toBe(true);
      expect(second.claimed).toBe(false);
      expect(String(second.entry.id)).toBe(String(first.entry.id));
    });

    test('concurrent claims of the same key yield exactly one winner', async () => {
      const { negotiation } = await fixture();
      const entry = {
        negotiationId: negotiation.id,
        idempotencyKey: `neg:${negotiation.id}:reply:race`,
        payload: {},
      };

      const results = await Promise.all([
        repositories.outbox.claim(entry),
        repositories.outbox.claim(entry),
        repositories.outbox.claim(entry),
      ]);

      expect(results.filter((result) => result.claimed)).toHaveLength(1);
    });

    test('outbox entries can be marked sent and failed', async () => {
      const { negotiation } = await fixture();
      const { entry } = await repositories.outbox.claim({
        negotiationId: negotiation.id,
        idempotencyKey: `neg:${negotiation.id}:reply:mark`,
        payload: {},
      });

      await repositories.outbox.markSent(entry.id, 999);
      const sent = await repositories.outbox.findByKey(entry.idempotencyKey);
      expect(sent.status).toBe('sent');
      expect(String(sent.messageId)).toBe('999');
    });

    test('one negotiation per requirement and seller', async () => {
      const { requirement, seller } = await fixture();
      await expect(
        repositories.negotiations.create({ requirementId: requirement.id, sellerId: seller.id }),
      ).rejects.toThrow();
    });

    test('optimistic locking rejects a stale write', async () => {
      const { negotiation } = await fixture();

      const first = await repositories.negotiations.update(
        negotiation.id,
        { round: 1 },
        negotiation.version,
      );
      expect(first.round).toBe(1);

      const stale = await repositories.negotiations.update(
        negotiation.id,
        { round: 2 },
        negotiation.version,
      );
      expect(stale).toBeNull();

      const current = await repositories.negotiations.findById(negotiation.id);
      expect(current.round).toBe(1);
    });

    test('findDue picks up drafts and unanswered inbound, and skips finished work', async () => {
      const { negotiation } = await fixture();

      expect((await repositories.negotiations.findDue()).map((n) => String(n.id))).toContain(
        String(negotiation.id),
      );

      await repositories.negotiations.update(negotiation.id, { state: 'AWAITING_REPLY' }, undefined);
      expect((await repositories.negotiations.findDue()).map((n) => String(n.id))).not.toContain(
        String(negotiation.id),
      );

      const inbound = await repositories.messages.append({
        negotiationId: negotiation.id,
        author: 'seller',
        body: 'Rs 850',
      });
      await repositories.negotiations.update(
        negotiation.id,
        { lastInboundMessageId: inbound.id },
        undefined,
      );
      expect((await repositories.negotiations.findDue()).map((n) => String(n.id))).toContain(
        String(negotiation.id),
      );

      await repositories.negotiations.update(
        negotiation.id,
        { answeredMessageId: inbound.id },
        undefined,
      );
      expect((await repositories.negotiations.findDue()).map((n) => String(n.id))).not.toContain(
        String(negotiation.id),
      );

      await repositories.negotiations.update(
        negotiation.id,
        { state: 'DECLINED', lastInboundMessageId: inbound.id, answeredMessageId: null },
        undefined,
      );
      expect((await repositories.negotiations.findDue()).map((n) => String(n.id))).not.toContain(
        String(negotiation.id),
      );
    });

    test('agent runs and recommendations are stored and read back', async () => {
      const { negotiation, requirement } = await fixture();

      await repositories.agentRuns.record({
        negotiationId: negotiation.id,
        action: 'counter',
        reason: 'improve_price',
        stateBefore: 'EVALUATING',
        stateAfter: 'COUNTERED',
        counterPriceMinor: toMinor('650'),
        grounded: true,
        fellBack: false,
        detail: { verdict: 'over_budget' },
      });

      const [run] = await repositories.agentRuns.listByNegotiation(negotiation.id);
      expect(run.counterPriceMinor).toBe(65000);
      expect(run.grounded).toBe(true);
      expect(run.detail.verdict).toBe('over_budget');

      await repositories.recommendations.create({
        requirementId: requirement.id,
        negotiationId: negotiation.id,
        decision: 'continue',
        rationale: 'still_negotiating',
        priceMinor: toMinor('650'),
        summary: 'keep going',
      });
      const latest = await repositories.recommendations.latestForRequirement(requirement.id);
      expect(latest.decision).toBe('continue');
      expect(latest.priceMinor).toBe(65000);
    });

    test('countAgentSince counts only what the agent sent', async () => {
      const { negotiation } = await fixture();
      await repositories.messages.append({ negotiationId: negotiation.id, author: 'agent', body: 'a' });
      await repositories.messages.append({ negotiationId: negotiation.id, author: 'seller', body: 'b' });

      const since = new Date(Date.now() - 60_000);
      expect(await repositories.messages.countAgentSince(since)).toBe(1);
    });

    const paymentFor = (negotiation, overrides = {}) => ({
      negotiationId: negotiation.id,
      provider: 'paypal',
      providerOrderId: `ORDER-${negotiation.id}-${Math.random().toString(36).slice(2, 8)}`,
      amountMinor: 67059,
      currency: 'USD',
      dealAmountMinor: 5_700_000,
      dealCurrency: 'INR',
      approveUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=X',
      ...overrides,
    });

    test('payments keep exact amounts and are found by negotiation and by order', async () => {
      const { negotiation } = await fixture();
      const { created, payment } = await repositories.payments.create(paymentFor(negotiation));

      expect(created).toBe(true);
      expect(payment.status).toBe('CREATED');
      expect(payment.amountMinor).toBe(67059);
      expect(payment.dealAmountMinor).toBe(5_700_000);

      const byNegotiation = await repositories.payments.findByNegotiation(negotiation.id);
      const byOrder = await repositories.payments.findByOrderId(payment.providerOrderId);
      expect(String(byNegotiation.id)).toBe(String(payment.id));
      expect(String(byOrder.id)).toBe(String(payment.id));
      expect(await repositories.payments.findByOrderId('NO-SUCH-ORDER')).toBeNull();
    });

    test('ONE PAYMENT PER NEGOTIATION - a second create returns the first', async () => {
      const { negotiation } = await fixture();
      const results = await Promise.all([
        repositories.payments.create(paymentFor(negotiation)),
        repositories.payments.create(paymentFor(negotiation)),
        repositories.payments.create(paymentFor(negotiation)),
      ]);

      expect(results.filter((result) => result.created)).toHaveLength(1);
      const ids = new Set(results.map((result) => String(result.payment.id)));
      expect(ids.size).toBe(1);
    });

    test('a capture is recorded once, and only from CREATED', async () => {
      const { negotiation } = await fixture();
      const { payment } = await repositories.payments.create(paymentFor(negotiation));
      const paidAt = new Date('2026-11-10T10:00:00.000Z');

      const paid = await repositories.payments.recordCapture(payment.id, {
        status: 'PAID',
        captureId: 'CAP-1',
        paidAt,
      });
      expect(paid.status).toBe('PAID');
      expect(paid.captureId).toBe('CAP-1');
      expect(new Date(paid.paidAt).getTime()).toBe(paidAt.getTime());

      const again = await repositories.payments.recordCapture(payment.id, {
        status: 'FAILED',
        captureId: 'CAP-2',
      });
      expect(again.status).toBe('PAID');
      expect(again.captureId).toBe('CAP-1');
    });

    test('a payment remembers which PayPal path created it', async () => {
      const { negotiation } = await fixture();
      const { payment } = await repositories.payments.create(paymentFor(negotiation, { createdVia: 'toolkit' }));
      expect(payment.createdVia).toBe('toolkit');
      expect(payment.invoiceId).toBeNull();

      const other = await fixture();
      const plain = await repositories.payments.create(paymentFor(other.negotiation));
      expect(plain.payment.createdVia).toBe('rest');
    });

    test('an invoice is recorded once, and a second one never replaces it', async () => {
      const { negotiation } = await fixture();
      const { payment } = await repositories.payments.create(paymentFor(negotiation));

      const first = await repositories.payments.recordInvoice(payment.id, {
        invoiceId: `INV2-${negotiation.id}-A`,
        invoiceStatus: 'DRAFT',
        invoiceVia: 'toolkit',
      });
      expect(first).toMatchObject({ invoiceId: `INV2-${negotiation.id}-A`, invoiceStatus: 'DRAFT', invoiceVia: 'toolkit' });

      const second = await repositories.payments.recordInvoice(payment.id, {
        invoiceId: `INV2-${negotiation.id}-B`,
        invoiceStatus: 'SENT',
        invoiceVia: 'rest',
      });
      expect(second.invoiceId).toBe(`INV2-${negotiation.id}-A`);
      expect(second.invoiceVia).toBe('toolkit');
    });

    test('an invoice failure is kept until an invoice exists, and then cleared for good', async () => {
      const { negotiation } = await fixture();
      const { payment } = await repositories.payments.create(paymentFor(negotiation));
      const at = new Date('2026-11-10T07:45:28.000Z');

      const failed = await repositories.payments.recordInvoiceError(payment.id, { message: '403 NOT_AUTHORIZED', at });
      expect(failed.invoiceError).toBe('403 NOT_AUTHORIZED');
      expect(new Date(failed.invoiceAttemptedAt).getTime()).toBe(at.getTime());

      const invoiced = await repositories.payments.recordInvoice(payment.id, {
        invoiceId: `INV2-${negotiation.id}-OK`,
        invoiceStatus: 'DRAFT',
        invoiceVia: 'rest',
      });
      expect(invoiced.invoiceError).toBeNull();

      const late = await repositories.payments.recordInvoiceError(payment.id, { message: 'late failure' });
      expect(late.invoiceError).toBeNull();
      expect(late.invoiceId).toBe(`INV2-${negotiation.id}-OK`);
    });

    test('says which store it is', () => {
      expect(repositories.kind).toBe(label);
    });

    test('MESSAGES ARE APPEND ONLY - there is no update or delete method', () => {
      expect(repositories.messages.update).toBeUndefined();
      expect(repositories.messages.delete).toBeUndefined();
      expect(repositories.messages.remove).toBeUndefined();
    });
  });
}

contractSuite('memory', async () => createMemoryRepositories());

if (runDbTests) {
  let pool;
  const dbName = config.test.dbName;

  contractSuite(
    'mysql',
    async () => {
      if (!pool) {
        const bootstrap = await mysql.createConnection({
          host: config.db.host,
          port: config.db.port,
          user: config.db.user,
          password: config.db.password,
        });
        await bootstrap.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
        await bootstrap.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4`);
        await bootstrap.changeUser({ database: dbName });
        await runMigrations(bootstrap, { logger: { info: () => {} } });
        await bootstrap.end();

        pool = createPool({ ...config.db, database: dbName });
      }

      // Clean between tests without fighting the foreign keys.
      const connection = await pool.getConnection();
      try {
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');
        for (const table of [
          'payments',
          'outbox',
          'recommendations',
          'agent_runs',
          'offers',
          'messages',
          'negotiations',
          'requirements',
          'users',
        ]) {
          await connection.query(`TRUNCATE TABLE \`${table}\``);
        }
        await connection.query('SET FOREIGN_KEY_CHECKS = 1');
      } finally {
        connection.release();
      }

      return createMysqlRepositories(pool);
    },
    async () => {
      if (pool) await pool.end();
    },
  );
} else {
  describe('repository contract: mysql', () => {
    test.skip('set RUN_DB_TESTS=1 to run the MySQL half of the contract', () => {});
  });
}
