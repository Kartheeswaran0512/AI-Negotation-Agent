/**
 * The MySQL implementation of the repository contract.
 *
 * The only place in the project where SQL lives. Money crosses this boundary as
 * integer minor units and is converted to and from DECIMAL(12,2) strings here -
 * mysql2 hands DECIMAL back as a string precisely so nobody has to trust a
 * float with a price.
 */

import { DUE_STATES, INBOUND_AUTHORS } from './types.js';
import { toMinor, fromMinor } from '../domain/money.js';

const toMoney = (minor) => (minor === null || minor === undefined ? null : fromMinor(minor));
const fromMoney = (value) => (value === null || value === undefined ? null : toMinor(value));
const toJson = (value) => (value === null || value === undefined ? null : JSON.stringify(value));

const parseJson = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

/**
 * @param {import('mysql2/promise').Pool} pool
 * @returns {import('./types.js').Repositories}
 */
export function createMysqlRepositories(pool) {
  const users = {
    async create(user) {
      const [result] = await pool.execute(
        'INSERT INTO users (role, name, email, company) VALUES (?, ?, ?, ?)',
        [user.role, user.name, user.email, user.company ?? null],
      );
      return users.findById(result.insertId);
    },
    async findById(id) {
      const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [id]);
      return rows.length ? mapUser(rows[0]) : null;
    },
    async findByEmail(email) {
      const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
      return rows.length ? mapUser(rows[0]) : null;
    },
  };

  const requirements = {
    async create(requirement) {
      const [result] = await pool.execute(
        `INSERT INTO requirements
           (buyer_id, product, quantity, unit, currency, target_price, max_price, price_basis, status, source_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          requirement.buyerId,
          requirement.product,
          requirement.quantity ?? 0,
          requirement.unit ?? null,
          requirement.currency ?? 'INR',
          toMoney(requirement.targetPriceMinor),
          toMoney(requirement.maxPriceMinor),
          requirement.priceBasis,
          requirement.status ?? 'active',
          requirement.sourceText ?? null,
        ],
      );
      return requirements.findById(result.insertId);
    },
    async findById(id) {
      const [rows] = await pool.execute('SELECT * FROM requirements WHERE id = ?', [id]);
      return rows.length ? mapRequirement(rows[0]) : null;
    },
    async listByBuyer(buyerId) {
      const [rows] = await pool.execute(
        'SELECT * FROM requirements WHERE buyer_id = ? ORDER BY id DESC',
        [buyerId],
      );
      return rows.map(mapRequirement);
    },
    async setStatus(id, status) {
      await pool.execute('UPDATE requirements SET status = ? WHERE id = ?', [status, id]);
      return requirements.findById(id);
    },
  };

  const negotiations = {
    async create(negotiation) {
      const [result] = await pool.execute(
        `INSERT INTO negotiations (requirement_id, seller_id, state, round, max_rounds)
         VALUES (?, ?, ?, ?, ?)`,
        [
          negotiation.requirementId,
          negotiation.sellerId,
          negotiation.state ?? 'DRAFT',
          negotiation.round ?? 0,
          negotiation.maxRounds ?? 6,
        ],
      );
      return negotiations.findById(result.insertId);
    },
    async findById(id) {
      const [rows] = await pool.execute('SELECT * FROM negotiations WHERE id = ?', [id]);
      return rows.length ? mapNegotiation(rows[0]) : null;
    },
    async listByRequirement(requirementId) {
      const [rows] = await pool.execute(
        'SELECT * FROM negotiations WHERE requirement_id = ? ORDER BY id',
        [requirementId],
      );
      return rows.map(mapNegotiation);
    },
    async findDue(limit = 50) {
      const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 500);
      const placeholders = DUE_STATES.map(() => '?').join(', ');
      const [rows] = await pool.execute(
        `SELECT * FROM negotiations
          WHERE state IN (${placeholders})
            AND (
                  state = 'DRAFT'
                  OR (
                       last_inbound_message_id IS NOT NULL
                       AND (answered_message_id IS NULL OR answered_message_id <> last_inbound_message_id)
                     )
                )
          ORDER BY id
          LIMIT ${safeLimit}`,
        [...DUE_STATES],
      );
      return rows.map(mapNegotiation);
    },
    /**
     * Optimistically locked. Returns null when somebody else moved first, which
     * the caller treats as "skip this tick" rather than "retry immediately".
     */
    async update(id, patch, expectedVersion) {
      const assignments = [];
      const values = [];

      for (const [key, value] of Object.entries(patch)) {
        const column = NEGOTIATION_COLUMNS[key];
        if (!column) continue;
        assignments.push(`${column} = ?`);
        values.push(NEGOTIATION_ENCODERS[key] ? NEGOTIATION_ENCODERS[key](value) : value);
      }

      if (assignments.length === 0) return negotiations.findById(id);

      assignments.push('version = version + 1');
      const where =
        expectedVersion === undefined ? 'WHERE id = ?' : 'WHERE id = ? AND version = ?';
      const params = expectedVersion === undefined ? [...values, id] : [...values, id, expectedVersion];

      const [result] = await pool.execute(
        `UPDATE negotiations SET ${assignments.join(', ')} ${where}`,
        params,
      );
      if (result.affectedRows === 0) return null;
      return negotiations.findById(id);
    },
  };

  const messages = {
    async append(message) {
      const [result] = await pool.execute(
        `INSERT INTO messages
           (negotiation_id, author, kind, body, price, quantity, in_reply_to, generated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          message.negotiationId,
          message.author,
          message.kind ?? 'text',
          message.body,
          toMoney(message.priceMinor),
          message.quantity ?? null,
          message.inReplyTo ?? null,
          message.generatedBy ?? null,
        ],
      );
      const [rows] = await pool.execute('SELECT * FROM messages WHERE id = ?', [result.insertId]);
      return mapMessage(rows[0]);
    },
    async listByNegotiation(negotiationId) {
      const [rows] = await pool.execute(
        'SELECT * FROM messages WHERE negotiation_id = ? ORDER BY id',
        [negotiationId],
      );
      return rows.map(mapMessage);
    },
    async lastInbound(negotiationId) {
      const placeholders = INBOUND_AUTHORS.map(() => '?').join(', ');
      const [rows] = await pool.execute(
        `SELECT * FROM messages
          WHERE negotiation_id = ? AND author IN (${placeholders})
          ORDER BY id DESC
          LIMIT 1`,
        [negotiationId, ...INBOUND_AUTHORS],
      );
      return rows.length ? mapMessage(rows[0]) : null;
    },
    async countAgentSince(since) {
      const [rows] = await pool.execute(
        'SELECT COUNT(*) AS total FROM messages WHERE author = ? AND created_at >= ?',
        ['agent', since],
      );
      return Number(rows[0].total);
    },
  };

  const offers = {
    async record(offer) {
      const [result] = await pool.execute(
        `INSERT INTO offers (negotiation_id, actor, unit_price, quantity, currency, terms, source_message_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          offer.negotiationId,
          offer.actor,
          toMoney(offer.unitPriceMinor),
          offer.quantity ?? null,
          offer.currency ?? 'INR',
          toJson(offer.terms),
          offer.sourceMessageId ?? null,
        ],
      );
      const [rows] = await pool.execute('SELECT * FROM offers WHERE id = ?', [result.insertId]);
      return mapOffer(rows[0]);
    },
    async listByNegotiation(negotiationId) {
      const [rows] = await pool.execute(
        'SELECT * FROM offers WHERE negotiation_id = ? ORDER BY id',
        [negotiationId],
      );
      return rows.map(mapOffer);
    },
  };

  const agentRuns = {
    async record(run) {
      const [result] = await pool.execute(
        `INSERT INTO agent_runs
           (negotiation_id, trigger_source, action, reason, state_before, state_after, counter_price,
            llm_provider, llm_model, input_tokens, output_tokens, latency_ms, grounded, fell_back,
            correlation_id, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          run.negotiationId,
          run.triggerSource ?? 'worker',
          run.action,
          run.reason,
          run.stateBefore,
          run.stateAfter,
          toMoney(run.counterPriceMinor),
          run.llmProvider ?? null,
          run.llmModel ?? null,
          run.inputTokens ?? null,
          run.outputTokens ?? null,
          run.latencyMs ?? null,
          run.grounded === null || run.grounded === undefined ? null : Number(Boolean(run.grounded)),
          Number(Boolean(run.fellBack)),
          run.correlationId ?? null,
          toJson(run.detail),
        ],
      );
      const [rows] = await pool.execute('SELECT * FROM agent_runs WHERE id = ?', [result.insertId]);
      return mapAgentRun(rows[0]);
    },
    async listByNegotiation(negotiationId) {
      const [rows] = await pool.execute(
        'SELECT * FROM agent_runs WHERE negotiation_id = ? ORDER BY id',
        [negotiationId],
      );
      return rows.map(mapAgentRun);
    },
  };

  const recommendations = {
    async create(recommendation) {
      const [result] = await pool.execute(
        `INSERT INTO recommendations (requirement_id, negotiation_id, decision, rationale, price, summary)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          recommendation.requirementId,
          recommendation.negotiationId ?? null,
          recommendation.decision,
          recommendation.rationale,
          toMoney(recommendation.priceMinor),
          recommendation.summary ?? null,
        ],
      );
      const [rows] = await pool.execute('SELECT * FROM recommendations WHERE id = ?', [
        result.insertId,
      ]);
      return mapRecommendation(rows[0]);
    },
    async latestForRequirement(requirementId) {
      const [rows] = await pool.execute(
        'SELECT * FROM recommendations WHERE requirement_id = ? ORDER BY id DESC LIMIT 1',
        [requirementId],
      );
      return rows.length ? mapRecommendation(rows[0]) : null;
    },
  };

  const outbox = {
    /**
     * The UNIQUE index on `idempotency_key` is the actual duplicate-send
     * prevention. A losing racer gets ER_DUP_ENTRY, which is a refusal, not an
     * error to retry.
     */
    async claim(entry) {
      try {
        const [result] = await pool.execute(
          'INSERT INTO outbox (negotiation_id, idempotency_key, payload) VALUES (?, ?, ?)',
          [entry.negotiationId, entry.idempotencyKey, toJson(entry.payload)],
        );
        const [rows] = await pool.execute('SELECT * FROM outbox WHERE id = ?', [result.insertId]);
        return { claimed: true, entry: mapOutbox(rows[0]) };
      } catch (error) {
        if (error && error.code === 'ER_DUP_ENTRY') {
          const existing = await outbox.findByKey(entry.idempotencyKey);
          return { claimed: false, entry: existing };
        }
        throw error;
      }
    },
    async markSent(id, messageId) {
      await pool.execute(
        `UPDATE outbox
            SET status = 'sent', message_id = ?, attempts = attempts + 1, sent_at = CURRENT_TIMESTAMP(3)
          WHERE id = ?`,
        [messageId, id],
      );
    },
    async markFailed(id, error) {
      await pool.execute(
        `UPDATE outbox SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?`,
        [String(error).slice(0, 255), id],
      );
    },
    async findByKey(key) {
      const [rows] = await pool.execute('SELECT * FROM outbox WHERE idempotency_key = ?', [key]);
      return rows.length ? mapOutbox(rows[0]) : null;
    },
  };

  return {
    users,
    requirements,
    negotiations,
    messages,
    offers,
    agentRuns,
    recommendations,
    outbox,
    async close() {
      await pool.end();
    },
  };
}

const NEGOTIATION_COLUMNS = Object.freeze({
  state: 'state',
  round: 'round',
  maxRounds: 'max_rounds',
  currentSellerPriceMinor: 'current_seller_price',
  lastInboundMessageId: 'last_inbound_message_id',
  answeredMessageId: 'answered_message_id',
  sellerDeclined: 'seller_declined',
  outcome: 'outcome',
  openedAt: 'opened_at',
  closedAt: 'closed_at',
});

const NEGOTIATION_ENCODERS = Object.freeze({
  currentSellerPriceMinor: toMoney,
  sellerDeclined: (value) => Number(Boolean(value)),
});

function mapUser(row) {
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    email: row.email,
    company: row.company,
    createdAt: row.created_at,
  };
}

function mapRequirement(row) {
  return {
    id: row.id,
    buyerId: row.buyer_id,
    product: row.product,
    quantity: Number(row.quantity),
    unit: row.unit,
    currency: row.currency,
    targetPriceMinor: fromMoney(row.target_price),
    maxPriceMinor: fromMoney(row.max_price),
    priceBasis: row.price_basis,
    status: row.status,
    sourceText: row.source_text,
    createdAt: row.created_at,
  };
}

function mapNegotiation(row) {
  return {
    id: row.id,
    requirementId: row.requirement_id,
    sellerId: row.seller_id,
    state: row.state,
    round: Number(row.round),
    maxRounds: Number(row.max_rounds),
    currentSellerPriceMinor: fromMoney(row.current_seller_price),
    lastInboundMessageId: row.last_inbound_message_id,
    answeredMessageId: row.answered_message_id,
    sellerDeclined: Boolean(row.seller_declined),
    outcome: row.outcome,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    version: Number(row.version),
    createdAt: row.created_at,
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    negotiationId: row.negotiation_id,
    author: row.author,
    kind: row.kind,
    body: row.body,
    priceMinor: fromMoney(row.price),
    quantity: row.quantity === null ? null : Number(row.quantity),
    inReplyTo: row.in_reply_to,
    generatedBy: row.generated_by,
    createdAt: row.created_at,
  };
}

function mapOffer(row) {
  return {
    id: row.id,
    negotiationId: row.negotiation_id,
    actor: row.actor,
    unitPriceMinor: fromMoney(row.unit_price),
    quantity: row.quantity === null ? null : Number(row.quantity),
    currency: row.currency,
    terms: parseJson(row.terms),
    sourceMessageId: row.source_message_id,
    createdAt: row.created_at,
  };
}

function mapAgentRun(row) {
  return {
    id: row.id,
    negotiationId: row.negotiation_id,
    triggerSource: row.trigger_source,
    action: row.action,
    reason: row.reason,
    stateBefore: row.state_before,
    stateAfter: row.state_after,
    counterPriceMinor: fromMoney(row.counter_price),
    llmProvider: row.llm_provider,
    llmModel: row.llm_model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    latencyMs: row.latency_ms,
    grounded: row.grounded === null ? null : Boolean(row.grounded),
    fellBack: Boolean(row.fell_back),
    correlationId: row.correlation_id,
    detail: parseJson(row.detail),
    createdAt: row.created_at,
  };
}

function mapRecommendation(row) {
  return {
    id: row.id,
    requirementId: row.requirement_id,
    negotiationId: row.negotiation_id,
    decision: row.decision,
    rationale: row.rationale,
    priceMinor: fromMoney(row.price),
    summary: row.summary,
    createdAt: row.created_at,
  };
}

function mapOutbox(row) {
  return {
    id: row.id,
    negotiationId: row.negotiation_id,
    idempotencyKey: row.idempotency_key,
    payload: parseJson(row.payload),
    status: row.status,
    attempts: Number(row.attempts),
    messageId: row.message_id,
    lastError: row.last_error,
    createdAt: row.created_at,
    sentAt: row.sent_at,
  };
}
