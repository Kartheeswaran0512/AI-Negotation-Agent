/**
 * An in-memory implementation of the repository contract.
 *
 * Not a test double bolted on afterwards - it is a first-class store, and it is
 * the reason `npm run demo` and the whole scenario suite run with no database,
 * no Docker and no API key. The same contract test runs against this and against
 * MySQL.
 *
 * It enforces the same invariants the schema does, because an invariant that
 * only one of two stores keeps is not an invariant:
 *   - messages are append-only (there is no update or delete method at all);
 *   - one negotiation per (requirement, seller);
 *   - outbox idempotency keys are unique;
 *   - negotiation updates are optimistically locked on `version`.
 */

import { DUE_STATES, INBOUND_AUTHORS } from './types.js';
import { isTerminal } from '../domain/machine.js';

export class DuplicateKeyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DuplicateKeyError';
  }
}

/**
 * @returns {import('./types.js').Repositories}
 */
export function createMemoryRepositories() {
  const state = {
    users: new Map(),
    requirements: new Map(),
    negotiations: new Map(),
    messages: new Map(),
    offers: new Map(),
    agentRuns: new Map(),
    recommendations: new Map(),
    outbox: new Map(),
    payments: new Map(),
  };

  const sequences = {
    users: 0,
    requirements: 0,
    negotiations: 0,
    messages: 0,
    offers: 0,
    agentRuns: 0,
    recommendations: 0,
    outbox: 0,
    payments: 0,
  };

  const nextId = (table) => (sequences[table] += 1);
  const clone = (value) => (value === null || value === undefined ? value : { ...value });
  const all = (table) => [...state[table].values()].map(clone);

  const users = {
    async create(user) {
      for (const existing of state.users.values()) {
        if (existing.email === user.email) {
          throw new DuplicateKeyError(`user email already exists: ${user.email}`);
        }
      }
      const row = {
        id: nextId('users'),
        role: user.role,
        name: user.name,
        email: user.email,
        company: user.company ?? null,
        createdAt: new Date(),
      };
      state.users.set(row.id, row);
      return clone(row);
    },
    async findById(id) {
      return clone(state.users.get(Number(id))) ?? null;
    },
    async findByEmail(email) {
      for (const row of state.users.values()) {
        if (row.email === email) return clone(row);
      }
      return null;
    },
  };

  const requirements = {
    async create(requirement) {
      const row = {
        id: nextId('requirements'),
        buyerId: requirement.buyerId,
        product: requirement.product,
        quantity: requirement.quantity ?? 0,
        unit: requirement.unit ?? null,
        currency: requirement.currency ?? 'INR',
        targetPriceMinor: requirement.targetPriceMinor,
        maxPriceMinor: requirement.maxPriceMinor,
        priceBasis: requirement.priceBasis,
        status: requirement.status ?? 'active',
        sourceText: requirement.sourceText ?? null,
        createdAt: new Date(),
      };
      state.requirements.set(row.id, row);
      return clone(row);
    },
    async findById(id) {
      return clone(state.requirements.get(Number(id))) ?? null;
    },
    async listByBuyer(buyerId) {
      return all('requirements').filter((row) => String(row.buyerId) === String(buyerId));
    },
    async setStatus(id, status) {
      const row = state.requirements.get(Number(id));
      if (!row) return null;
      row.status = status;
      return clone(row);
    },
  };

  const negotiations = {
    async create(negotiation) {
      for (const existing of state.negotiations.values()) {
        if (
          String(existing.requirementId) === String(negotiation.requirementId) &&
          String(existing.sellerId) === String(negotiation.sellerId)
        ) {
          throw new DuplicateKeyError('a negotiation already exists for this requirement and seller');
        }
      }
      const row = {
        id: nextId('negotiations'),
        requirementId: negotiation.requirementId,
        sellerId: negotiation.sellerId,
        state: negotiation.state ?? 'DRAFT',
        round: negotiation.round ?? 0,
        maxRounds: negotiation.maxRounds ?? 6,
        currentSellerPriceMinor: negotiation.currentSellerPriceMinor ?? null,
        lastInboundMessageId: null,
        answeredMessageId: null,
        sellerDeclined: false,
        outcome: null,
        openedAt: null,
        closedAt: null,
        version: 0,
        createdAt: new Date(),
      };
      state.negotiations.set(row.id, row);
      return clone(row);
    },
    async findById(id) {
      return clone(state.negotiations.get(Number(id))) ?? null;
    },
    async listByRequirement(requirementId) {
      return all('negotiations')
        .filter((row) => String(row.requirementId) === String(requirementId))
        .sort((a, b) => a.id - b.id);
    },
    async findDue(limit = 50) {
      return all('negotiations')
        .filter((row) => DUE_STATES.includes(row.state) && !isTerminal(row.state))
        .filter(
          (row) =>
            row.state === 'DRAFT' ||
            (row.lastInboundMessageId !== null &&
              String(row.lastInboundMessageId) !== String(row.answeredMessageId)),
        )
        .sort((a, b) => a.id - b.id)
        .slice(0, limit);
    },
    async update(id, patch, expectedVersion) {
      const row = state.negotiations.get(Number(id));
      if (!row) return null;
      if (expectedVersion !== undefined && row.version !== expectedVersion) return null;

      Object.assign(row, patch, { version: row.version + 1 });
      return clone(row);
    },
  };

  const messages = {
    // Append only. There is intentionally no update or delete.
    async append(message) {
      const row = {
        id: nextId('messages'),
        negotiationId: message.negotiationId,
        author: message.author,
        kind: message.kind ?? 'text',
        body: message.body,
        priceMinor: message.priceMinor ?? null,
        quantity: message.quantity ?? null,
        inReplyTo: message.inReplyTo ?? null,
        generatedBy: message.generatedBy ?? null,
        createdAt: new Date(),
      };
      state.messages.set(row.id, row);
      return clone(row);
    },
    async listByNegotiation(negotiationId) {
      return all('messages')
        .filter((row) => String(row.negotiationId) === String(negotiationId))
        .sort((a, b) => a.id - b.id);
    },
    async lastInbound(negotiationId) {
      const thread = await messages.listByNegotiation(negotiationId);
      const inbound = thread.filter((row) => INBOUND_AUTHORS.includes(row.author));
      return inbound.length ? inbound[inbound.length - 1] : null;
    },
    async countAgentSince(since) {
      return all('messages').filter((row) => row.author === 'agent' && row.createdAt >= since)
        .length;
    },
  };

  const offers = {
    async record(offer) {
      const row = {
        id: nextId('offers'),
        negotiationId: offer.negotiationId,
        actor: offer.actor,
        unitPriceMinor: offer.unitPriceMinor,
        quantity: offer.quantity ?? null,
        currency: offer.currency ?? 'INR',
        terms: offer.terms ?? null,
        sourceMessageId: offer.sourceMessageId ?? null,
        createdAt: new Date(),
      };
      state.offers.set(row.id, row);
      return clone(row);
    },
    async listByNegotiation(negotiationId) {
      return all('offers')
        .filter((row) => String(row.negotiationId) === String(negotiationId))
        .sort((a, b) => a.id - b.id);
    },
  };

  const agentRuns = {
    async record(run) {
      const row = {
        id: nextId('agentRuns'),
        negotiationId: run.negotiationId,
        triggerSource: run.triggerSource ?? 'worker',
        action: run.action,
        reason: run.reason,
        stateBefore: run.stateBefore,
        stateAfter: run.stateAfter,
        counterPriceMinor: run.counterPriceMinor ?? null,
        llmProvider: run.llmProvider ?? null,
        llmModel: run.llmModel ?? null,
        inputTokens: run.inputTokens ?? null,
        outputTokens: run.outputTokens ?? null,
        latencyMs: run.latencyMs ?? null,
        grounded: run.grounded ?? null,
        fellBack: Boolean(run.fellBack ?? false),
        correlationId: run.correlationId ?? null,
        detail: run.detail ?? null,
        createdAt: new Date(),
      };
      state.agentRuns.set(row.id, row);
      return clone(row);
    },
    async listByNegotiation(negotiationId) {
      return all('agentRuns')
        .filter((row) => String(row.negotiationId) === String(negotiationId))
        .sort((a, b) => a.id - b.id);
    },
  };

  const recommendations = {
    async create(recommendation) {
      const row = {
        id: nextId('recommendations'),
        requirementId: recommendation.requirementId,
        negotiationId: recommendation.negotiationId ?? null,
        decision: recommendation.decision,
        rationale: recommendation.rationale,
        priceMinor: recommendation.priceMinor ?? null,
        summary: recommendation.summary ?? null,
        createdAt: new Date(),
      };
      state.recommendations.set(row.id, row);
      return clone(row);
    },
    async latestForRequirement(requirementId) {
      const rows = all('recommendations')
        .filter((row) => String(row.requirementId) === String(requirementId))
        .sort((a, b) => a.id - b.id);
      return rows.length ? rows[rows.length - 1] : null;
    },
  };

  const outbox = {
    /**
     * The duplicate-send prevention. Returns `claimed: false` when the key is
     * already taken, which is the same answer MySQL's UNIQUE index gives.
     */
    async claim(entry) {
      const existing = [...state.outbox.values()].find(
        (row) => row.idempotencyKey === entry.idempotencyKey,
      );
      if (existing) return { claimed: false, entry: clone(existing) };

      const row = {
        id: nextId('outbox'),
        negotiationId: entry.negotiationId,
        idempotencyKey: entry.idempotencyKey,
        payload: entry.payload,
        status: 'pending',
        attempts: 0,
        messageId: null,
        lastError: null,
        createdAt: new Date(),
        sentAt: null,
      };
      state.outbox.set(row.id, row);
      return { claimed: true, entry: clone(row) };
    },
    async markSent(id, messageId) {
      const row = state.outbox.get(Number(id));
      if (!row) return;
      row.status = 'sent';
      row.messageId = messageId;
      row.attempts += 1;
      row.sentAt = new Date();
    },
    async markFailed(id, error) {
      const row = state.outbox.get(Number(id));
      if (!row) return;
      row.status = 'failed';
      row.attempts += 1;
      row.lastError = String(error).slice(0, 255);
    },
    async findByKey(key) {
      for (const row of state.outbox.values()) {
        if (row.idempotencyKey === key) return clone(row);
      }
      return null;
    },
  };

  const payments = {
    /** The same answer MySQL's two UNIQUE keys give: the existing row, not a second one. */
    async create(payment) {
      const existing = [...state.payments.values()].find(
        (row) =>
          String(row.negotiationId) === String(payment.negotiationId) ||
          row.providerOrderId === payment.providerOrderId,
      );
      if (existing) return { created: false, payment: clone(existing) };

      const row = {
        id: nextId('payments'),
        negotiationId: payment.negotiationId,
        provider: payment.provider ?? 'paypal',
        providerOrderId: payment.providerOrderId,
        createdVia: payment.createdVia ?? 'rest',
        status: payment.status ?? 'CREATED',
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        dealAmountMinor: payment.dealAmountMinor,
        dealCurrency: payment.dealCurrency,
        approveUrl: payment.approveUrl ?? null,
        captureId: null,
        invoiceId: null,
        invoiceStatus: null,
        invoiceVia: null,
        invoiceError: null,
        invoiceAttemptedAt: null,
        createdAt: new Date(),
        paidAt: null,
      };
      state.payments.set(row.id, row);
      return { created: true, payment: clone(row) };
    },
    async findById(id) {
      return clone(state.payments.get(Number(id))) ?? null;
    },
    async findByNegotiation(negotiationId) {
      for (const row of state.payments.values()) {
        if (String(row.negotiationId) === String(negotiationId)) return clone(row);
      }
      return null;
    },
    async findByOrderId(orderId) {
      for (const row of state.payments.values()) {
        if (row.providerOrderId === orderId) return clone(row);
      }
      return null;
    },
    async recordCapture(id, { status, captureId = null, paidAt = null }) {
      const row = state.payments.get(Number(id));
      if (!row) return null;
      if (row.status === 'CREATED') Object.assign(row, { status, captureId, paidAt });
      return clone(row);
    },
    async recordInvoice(id, { invoiceId, invoiceStatus = null, invoiceVia = null }) {
      const row = state.payments.get(Number(id));
      if (!row) return null;
      if (row.invoiceId === null) {
        Object.assign(row, { invoiceId, invoiceStatus, invoiceVia, invoiceError: null, invoiceAttemptedAt: new Date() });
      }
      return clone(row);
    },
    async recordInvoiceError(id, { message, at = new Date() }) {
      const row = state.payments.get(Number(id));
      if (!row) return null;
      if (row.invoiceId === null) {
        Object.assign(row, { invoiceError: String(message).slice(0, 500), invoiceAttemptedAt: at });
      }
      return clone(row);
    },
  };

  return {
    kind: 'memory',
    users,
    requirements,
    negotiations,
    messages,
    offers,
    agentRuns,
    recommendations,
    outbox,
    payments,
    async close() {
      for (const table of Object.keys(state)) state[table].clear();
    },
  };
}
