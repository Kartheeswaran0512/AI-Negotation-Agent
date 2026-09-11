/**
 * The repository contract.
 *
 * Two implementations satisfy it - `memoryRepositories` and
 * `mysqlRepositories` - and one shared contract test
 * (test/integration/repositories.contract.test.js) runs against both, so they
 * cannot drift apart silently. The in-memory store is what lets the agent, the
 * scenario suite and `npm run demo` run with no database at all.
 *
 * MONEY CROSSES THIS BOUNDARY AS MINOR UNITS. Repositories take integers and
 * return integers; converting to and from the DECIMAL(12,2) columns is their
 * job and nobody else's.
 *
 * This file is documentation with no runtime behaviour beyond the helpers at
 * the bottom, which both implementations use.
 *
 * @typedef {object} Repositories
 * @property {UserRepo} users
 * @property {RequirementRepo} requirements
 * @property {NegotiationRepo} negotiations
 * @property {MessageRepo} messages
 * @property {OfferRepo} offers
 * @property {AgentRunRepo} agentRuns
 * @property {RecommendationRepo} recommendations
 * @property {OutboxRepo} outbox
 * @property {() => Promise<void>} close
 *
 * @typedef {object} UserRepo
 * @property {(user: object) => Promise<object>} create
 * @property {(id: number|string) => Promise<object|null>} findById
 * @property {(email: string) => Promise<object|null>} findByEmail
 *
 * @typedef {object} RequirementRepo
 * @property {(requirement: object) => Promise<object>} create
 * @property {(id: number|string) => Promise<object|null>} findById
 * @property {(buyerId: number|string) => Promise<object[]>} listByBuyer
 * @property {(id: number|string, status: string) => Promise<object|null>} setStatus
 *
 * @typedef {object} NegotiationRepo
 * @property {(negotiation: object) => Promise<object>} create
 * @property {(id: number|string) => Promise<object|null>} findById
 * @property {(requirementId: number|string) => Promise<object[]>} listByRequirement
 * @property {(limit?: number) => Promise<object[]>} findDue
 * @property {(id: number|string, patch: object, expectedVersion: number) => Promise<object|null>} update
 *
 * @typedef {object} MessageRepo
 * @property {(message: object) => Promise<object>} append
 * @property {(negotiationId: number|string) => Promise<object[]>} listByNegotiation
 * @property {(negotiationId: number|string) => Promise<object|null>} lastInbound
 * @property {(since: Date) => Promise<number>} countAgentSince
 *
 * @typedef {object} OfferRepo
 * @property {(offer: object) => Promise<object>} record
 * @property {(negotiationId: number|string) => Promise<object[]>} listByNegotiation
 *
 * @typedef {object} AgentRunRepo
 * @property {(run: object) => Promise<object>} record
 * @property {(negotiationId: number|string) => Promise<object[]>} listByNegotiation
 *
 * @typedef {object} RecommendationRepo
 * @property {(recommendation: object) => Promise<object>} create
 * @property {(requirementId: number|string) => Promise<object|null>} latestForRequirement
 *
 * @typedef {object} OutboxRepo
 * @property {(entry: object) => Promise<{claimed: boolean, entry: object}>} claim
 * @property {(id: number|string, messageId: number|string) => Promise<void>} markSent
 * @property {(id: number|string, error: string) => Promise<void>} markFailed
 * @property {(key: string) => Promise<object|null>} findByKey
 */

/** The states in which the worker should look at a negotiation again. */
export const DUE_STATES = Object.freeze(['DRAFT', 'AWAITING_REPLY', 'EVALUATING', 'COUNTERED']);

/** Message authors that count as "the other side speaking to us". */
export const INBOUND_AUTHORS = Object.freeze(['seller']);

/**
 * Both implementations return plain objects in this shape, so services never
 * have to know which store they are talking to.
 */
export function shapeNegotiation(row) {
  return {
    id: row.id,
    requirementId: row.requirementId ?? row.requirement_id,
    sellerId: row.sellerId ?? row.seller_id,
    state: row.state,
    round: Number(row.round ?? 0),
    maxRounds: Number(row.maxRounds ?? row.max_rounds ?? 6),
    currentSellerPriceMinor: row.currentSellerPriceMinor ?? null,
    lastInboundMessageId: row.lastInboundMessageId ?? row.last_inbound_message_id ?? null,
    answeredMessageId: row.answeredMessageId ?? row.answered_message_id ?? null,
    sellerDeclined: Boolean(row.sellerDeclined ?? row.seller_declined ?? false),
    outcome: row.outcome ?? null,
    version: Number(row.version ?? 0),
    createdAt: row.createdAt ?? row.created_at ?? null,
  };
}
