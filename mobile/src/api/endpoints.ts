/**
 * Every backend route, as one typed function each.
 *
 * This is the complete surface the app uses. If a screen needs data that is not
 * here, the backend does not expose it - which is the case for listing a
 * buyer's requirements and for a seller directory, both of which are handled
 * locally (see src/storage). Nothing here invents an endpoint.
 */

import { request, type ApiCredentials } from './client';
import type {
  AgentRun,
  CreateRequirementInput,
  Health,
  Message,
  Negotiation,
  OpenNegotiationInput,
  ReadRequirementResult,
  Recommendation,
  Requirement,
  SellerMessageInput,
  TickResult,
  ToolListResult,
} from './types';

type Id = number | string;

/** GET /health - outside /api, needs no key. Use it as the reachability probe. */
export function getHealth(credentials: ApiCredentials, signal?: AbortSignal): Promise<Health> {
  return request<Health>(credentials, '/health', { signal, timeoutMs: 8000 });
}

/** POST /api/requirements */
export async function createRequirement(
  credentials: ApiCredentials,
  input: CreateRequirementInput,
): Promise<Requirement> {
  const result = await request<{ ok: true; requirement: Requirement }>(
    credentials,
    '/api/requirements',
    { method: 'POST', body: input },
  );
  return result.requirement;
}

/**
 * POST /api/requirements/read
 *
 * Reads free text into a PROPOSED requirement and creates nothing. This is the
 * one route that may call the language model, so it is also the slowest.
 */
export function readRequirementText(
  credentials: ApiCredentials,
  text: string,
): Promise<ReadRequirementResult> {
  return request<ReadRequirementResult>(credentials, '/api/requirements/read', {
    method: 'POST',
    body: { text },
    timeoutMs: 25000,
  });
}

/** GET /api/requirements/:id */
export async function getRequirement(
  credentials: ApiCredentials,
  id: Id,
  signal?: AbortSignal,
): Promise<Requirement> {
  const result = await request<{ ok: true; requirement: Requirement }>(
    credentials,
    `/api/requirements/${encodeURIComponent(String(id))}`,
    { signal },
  );
  return result.requirement;
}

/** GET /api/requirements/:id/negotiations */
export async function listNegotiations(
  credentials: ApiCredentials,
  requirementId: Id,
  signal?: AbortSignal,
): Promise<Negotiation[]> {
  const result = await request<{ ok: true; negotiations: Negotiation[] }>(
    credentials,
    `/api/requirements/${encodeURIComponent(String(requirementId))}/negotiations`,
    { signal },
  );
  return result.negotiations;
}

/** POST /api/requirements/:id/negotiations */
export async function openNegotiation(
  credentials: ApiCredentials,
  requirementId: Id,
  input: OpenNegotiationInput,
): Promise<Negotiation> {
  const result = await request<{ ok: true; negotiation: Negotiation }>(
    credentials,
    `/api/requirements/${encodeURIComponent(String(requirementId))}/negotiations`,
    { method: 'POST', body: input },
  );
  return result.negotiation;
}

/** GET /api/requirements/:id/recommendation - may legitimately be null. */
export async function getRecommendation(
  credentials: ApiCredentials,
  requirementId: Id,
  signal?: AbortSignal,
): Promise<Recommendation | null> {
  const result = await request<{ ok: true; recommendation: Recommendation | null }>(
    credentials,
    `/api/requirements/${encodeURIComponent(String(requirementId))}/recommendation`,
    { signal },
  );
  return result.recommendation;
}

/** POST /api/requirements/:id/recommendation - recomputes and stores a new row. */
export async function refreshRecommendation(
  credentials: ApiCredentials,
  requirementId: Id,
): Promise<Recommendation | null> {
  const result = await request<{ ok: true; recommendation: Recommendation | null }>(
    credentials,
    `/api/requirements/${encodeURIComponent(String(requirementId))}/recommendation`,
    { method: 'POST', timeoutMs: 25000 },
  );
  return result.recommendation;
}

/** GET /api/negotiations/:id */
export async function getNegotiation(
  credentials: ApiCredentials,
  id: Id,
  signal?: AbortSignal,
): Promise<Negotiation> {
  const result = await request<{ ok: true; negotiation: Negotiation }>(
    credentials,
    `/api/negotiations/${encodeURIComponent(String(id))}`,
    { signal },
  );
  return result.negotiation;
}

/** GET /api/negotiations/:id/messages */
export async function listMessages(
  credentials: ApiCredentials,
  negotiationId: Id,
  signal?: AbortSignal,
): Promise<Message[]> {
  const result = await request<{ ok: true; messages: Message[] }>(
    credentials,
    `/api/negotiations/${encodeURIComponent(String(negotiationId))}/messages`,
    { signal },
  );
  return result.messages;
}

/**
 * POST /api/negotiations/:id/seller-messages
 *
 * The supplier's side of the wire. In a deployed system this would be fed by
 * email or a portal; in this app it is the simulator that lets you drive a
 * negotiation by hand.
 */
export async function sendSellerMessage(
  credentials: ApiCredentials,
  negotiationId: Id,
  input: SellerMessageInput,
): Promise<Message> {
  const result = await request<{ ok: true; message: Message }>(
    credentials,
    `/api/negotiations/${encodeURIComponent(String(negotiationId))}/seller-messages`,
    { method: 'POST', body: input },
  );
  return result.message;
}

/**
 * POST /api/negotiations/:id/tick
 *
 * Run one agent step now. Safe to call repeatedly - the server's guard and
 * idempotency key make a duplicate tick a no-op rather than a second message.
 */
export function tickNegotiation(
  credentials: ApiCredentials,
  negotiationId: Id,
): Promise<TickResult> {
  return request<TickResult>(
    credentials,
    `/api/negotiations/${encodeURIComponent(String(negotiationId))}/tick`,
    { method: 'POST', timeoutMs: 30000 },
  );
}

/** GET /api/negotiations/:id/runs - the audit trail. */
export async function listRuns(
  credentials: ApiCredentials,
  negotiationId: Id,
  signal?: AbortSignal,
): Promise<AgentRun[]> {
  const result = await request<{ ok: true; runs: AgentRun[] }>(
    credentials,
    `/api/negotiations/${encodeURIComponent(String(negotiationId))}/runs`,
    { signal },
  );
  return result.runs;
}

/**
 * POST /api/negotiations/:id/accept
 *
 * The buyer's decision, and the only irreversible action in the product. The
 * server requires x-user-id and checks it against the requirement's owner.
 */
export async function acceptNegotiation(
  credentials: ApiCredentials,
  negotiationId: Id,
): Promise<Message> {
  const result = await request<{ ok: true; accepted: true; message: Message }>(
    credentials,
    `/api/negotiations/${encodeURIComponent(String(negotiationId))}/accept`,
    { method: 'POST' },
  );
  return result.message;
}

/** GET /api/tools - the agent's capability surface. */
export function listTools(
  credentials: ApiCredentials,
  signal?: AbortSignal,
): Promise<ToolListResult> {
  return request<ToolListResult>(credentials, '/api/tools', { signal });
}
