/**
 * Server state, via React Query.
 *
 * Two things drive the design here.
 *
 * POLLING, NOT PUSH. The backend has no websocket or SSE channel, so a live
 * negotiation is followed by polling. The interval is a function rather than a
 * constant: once a negotiation reaches a terminal state nothing can change
 * again, so polling stops instead of burning battery on a settled row.
 *
 * INVALIDATION AFTER A TICK. One tick can change the thread, the negotiation,
 * the audit trail and the requirement's recommendation at once, so the tick
 * mutation invalidates all four rather than trying to patch caches by hand.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { useCredentials } from '@/config/settings';
import { ApiError, type ApiCredentials } from './client';
import * as api from './endpoints';
import { isTerminalState } from './types';
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

/**
 * Every failure that reaches a component is an ApiError - the client throws
 * nothing else. Registering it here types `query.error` and `mutation.error`
 * across the whole app, so screens can read `.isConflict` or `.fieldErrors()`
 * without a cast at each call site.
 *
 * The augmentation targets `@tanstack/query-core`, not `@tanstack/react-query`:
 * `Register` is declared and exported there, and the React package does not
 * re-export it, so augmenting the React package would silently declare a second
 * unrelated interface and change nothing.
 */
declare module '@tanstack/query-core' {
  interface Register {
    defaultError: ApiError;
  }
}

type Id = number | string;

/** How often to re-read a live negotiation. */
export const LIVE_POLL_MS = 4000;

/**
 * Query keys are namespaced by base URL so that pointing the app at a
 * different server cannot serve one server's rows from another's cache.
 */
export const queryKeys = {
  health: (base: string) => [base, 'health'] as const,
  requirement: (base: string, id: Id) => [base, 'requirement', String(id)] as const,
  negotiations: (base: string, requirementId: Id) =>
    [base, 'requirement', String(requirementId), 'negotiations'] as const,
  recommendation: (base: string, requirementId: Id) =>
    [base, 'requirement', String(requirementId), 'recommendation'] as const,
  negotiation: (base: string, id: Id) => [base, 'negotiation', String(id)] as const,
  messages: (base: string, negotiationId: Id) =>
    [base, 'negotiation', String(negotiationId), 'messages'] as const,
  runs: (base: string, negotiationId: Id) =>
    [base, 'negotiation', String(negotiationId), 'runs'] as const,
  tools: (base: string) => [base, 'tools'] as const,
};

/**
 * Retrying a 4xx just repeats a refusal the server already explained, so only
 * transport failures and 5xx are worth a second attempt.
 *
 * The error parameter is typed as ApiError rather than unknown on purpose: it
 * sits in an inference position, and widening it here would widen TError for
 * every query that uses this policy back to unknown. The instanceof guard
 * still holds if something else ever throws.
 */
function retryPolicy(failureCount: number, error: ApiError): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

const baseOf = (credentials: ApiCredentials): string => credentials.baseUrl;

export function useHealth(enabled = true): UseQueryResult<Health, ApiError> {
  const credentials = useCredentials();
  return useQuery({
    queryKey: queryKeys.health(baseOf(credentials)),
    queryFn: ({ signal }) => api.getHealth(credentials, signal),
    enabled: enabled && Boolean(credentials.baseUrl),
    retry: false,
    staleTime: 10_000,
  });
}

export function useRequirement(id: Id | null): UseQueryResult<Requirement, ApiError> {
  const credentials = useCredentials();
  return useQuery({
    queryKey: queryKeys.requirement(baseOf(credentials), id ?? 'none'),
    queryFn: ({ signal }) => api.getRequirement(credentials, id as Id, signal),
    enabled: Boolean(credentials.baseUrl) && id !== null,
    retry: retryPolicy,
  });
}

export function useNegotiations(requirementId: Id | null): UseQueryResult<Negotiation[], ApiError> {
  const credentials = useCredentials();
  return useQuery({
    queryKey: queryKeys.negotiations(baseOf(credentials), requirementId ?? 'none'),
    queryFn: ({ signal }) => api.listNegotiations(credentials, requirementId as Id, signal),
    enabled: Boolean(credentials.baseUrl) && requirementId !== null,
    retry: retryPolicy,
    // A board with a live negotiation on it should move without a pull.
    refetchInterval: (query) => {
      const rows = query.state.data;
      if (!rows || rows.length === 0) return false;
      return rows.some((row) => !isTerminalState(row.state)) ? LIVE_POLL_MS * 2 : false;
    },
  });
}

export function useRecommendation(
  requirementId: Id | null,
): UseQueryResult<Recommendation | null, ApiError> {
  const credentials = useCredentials();
  return useQuery({
    queryKey: queryKeys.recommendation(baseOf(credentials), requirementId ?? 'none'),
    queryFn: ({ signal }) => api.getRecommendation(credentials, requirementId as Id, signal),
    enabled: Boolean(credentials.baseUrl) && requirementId !== null,
    retry: retryPolicy,
  });
}

/**
 * One negotiation, polled while it can still change.
 *
 * `live` lets a screen that is not visible stop polling entirely.
 */
export function useNegotiation(id: Id | null, live = true): UseQueryResult<Negotiation, ApiError> {
  const credentials = useCredentials();
  return useQuery({
    queryKey: queryKeys.negotiation(baseOf(credentials), id ?? 'none'),
    queryFn: ({ signal }) => api.getNegotiation(credentials, id as Id, signal),
    enabled: Boolean(credentials.baseUrl) && id !== null,
    retry: retryPolicy,
    refetchInterval: (query) => {
      if (!live) return false;
      const row = query.state.data;
      if (!row) return false;
      return isTerminalState(row.state) ? false : LIVE_POLL_MS;
    },
  });
}

export function useMessages(
  negotiationId: Id | null,
  live = true,
): UseQueryResult<Message[], ApiError> {
  const credentials = useCredentials();
  const negotiation = useNegotiation(negotiationId, false);
  const settled = negotiation.data ? isTerminalState(negotiation.data.state) : false;

  return useQuery({
    queryKey: queryKeys.messages(baseOf(credentials), negotiationId ?? 'none'),
    queryFn: ({ signal }) => api.listMessages(credentials, negotiationId as Id, signal),
    enabled: Boolean(credentials.baseUrl) && negotiationId !== null,
    retry: retryPolicy,
    refetchInterval: live && !settled ? LIVE_POLL_MS : false,
  });
}

export function useRuns(negotiationId: Id | null): UseQueryResult<AgentRun[], ApiError> {
  const credentials = useCredentials();
  return useQuery({
    queryKey: queryKeys.runs(baseOf(credentials), negotiationId ?? 'none'),
    queryFn: ({ signal }) => api.listRuns(credentials, negotiationId as Id, signal),
    enabled: Boolean(credentials.baseUrl) && negotiationId !== null,
    retry: retryPolicy,
  });
}

export function useTools(): UseQueryResult<ToolListResult, ApiError> {
  const credentials = useCredentials();
  return useQuery({
    queryKey: queryKeys.tools(baseOf(credentials)),
    queryFn: ({ signal }) => api.listTools(credentials, signal),
    enabled: Boolean(credentials.baseUrl),
    retry: retryPolicy,
    staleTime: 5 * 60_000,
  });
}

/** Everything a single tick could have changed. */
function useInvalidateNegotiation() {
  const client = useQueryClient();
  const credentials = useCredentials();
  const base = baseOf(credentials);

  return (negotiationId: Id, requirementId?: Id | null) => {
    void client.invalidateQueries({ queryKey: queryKeys.negotiation(base, negotiationId) });
    void client.invalidateQueries({ queryKey: queryKeys.messages(base, negotiationId) });
    void client.invalidateQueries({ queryKey: queryKeys.runs(base, negotiationId) });
    if (requirementId !== null && requirementId !== undefined) {
      void client.invalidateQueries({ queryKey: queryKeys.negotiations(base, requirementId) });
      void client.invalidateQueries({ queryKey: queryKeys.recommendation(base, requirementId) });
    }
  };
}

export function useReadRequirementText(): UseMutationResult<
  ReadRequirementResult,
  ApiError,
  string
> {
  const credentials = useCredentials();
  return useMutation({
    mutationFn: (text: string) => api.readRequirementText(credentials, text),
  });
}

export function useCreateRequirement(): UseMutationResult<
  Requirement,
  ApiError,
  CreateRequirementInput
> {
  const credentials = useCredentials();
  return useMutation({
    mutationFn: (input: CreateRequirementInput) => api.createRequirement(credentials, input),
  });
}

export function useOpenNegotiation(
  requirementId: Id,
): UseMutationResult<Negotiation, ApiError, OpenNegotiationInput> {
  const credentials = useCredentials();
  const client = useQueryClient();
  const base = baseOf(credentials);

  return useMutation({
    mutationFn: (input: OpenNegotiationInput) =>
      api.openNegotiation(credentials, requirementId, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.negotiations(base, requirementId) });
    },
  });
}

/** Run one agent step. The result drives what the thread screen announces. */
export function useTick(
  negotiationId: Id,
  requirementId?: Id | null,
): UseMutationResult<TickResult, ApiError, void> {
  const credentials = useCredentials();
  const invalidate = useInvalidateNegotiation();

  return useMutation({
    mutationFn: () => api.tickNegotiation(credentials, negotiationId),
    onSuccess: () => invalidate(negotiationId, requirementId),
  });
}

export function useSendSellerMessage(
  negotiationId: Id,
  requirementId?: Id | null,
): UseMutationResult<Message, ApiError, SellerMessageInput> {
  const credentials = useCredentials();
  const invalidate = useInvalidateNegotiation();

  return useMutation({
    mutationFn: (input: SellerMessageInput) =>
      api.sendSellerMessage(credentials, negotiationId, input),
    onSuccess: () => invalidate(negotiationId, requirementId),
  });
}

export function useRefreshRecommendation(
  requirementId: Id,
): UseMutationResult<Recommendation | null, ApiError, void> {
  const credentials = useCredentials();
  const client = useQueryClient();
  const base = baseOf(credentials);

  return useMutation({
    mutationFn: () => api.refreshRecommendation(credentials, requirementId),
    onSuccess: (recommendation) => {
      client.setQueryData(queryKeys.recommendation(base, requirementId), recommendation);
    },
  });
}

/** The buyer's decision. Deliberately its own hook with no agent path to it. */
export function useAcceptNegotiation(
  negotiationId: Id,
  requirementId?: Id | null,
): UseMutationResult<Message, ApiError, void> {
  const credentials = useCredentials();
  const invalidate = useInvalidateNegotiation();
  const client = useQueryClient();
  const base = baseOf(credentials);

  return useMutation({
    mutationFn: () => api.acceptNegotiation(credentials, negotiationId),
    onSuccess: () => {
      invalidate(negotiationId, requirementId);
      if (requirementId !== null && requirementId !== undefined) {
        void client.invalidateQueries({ queryKey: queryKeys.requirement(base, requirementId) });
      }
    },
  });
}
