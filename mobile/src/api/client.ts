/**
 * The HTTP client.
 *
 * One place that knows how to talk to the backend: how the base URL is shaped,
 * which headers carry identity, how long to wait, and how the server's single
 * error envelope becomes a thrown ApiError. Screens never call fetch.
 *
 * `x-api-key` authenticates the application; `x-user-id` carries the buyer's
 * identity and is what the accept route checks ownership against. Both are sent
 * on every /api request when configured - the server ignores the ones a route
 * does not need.
 */

import type { ApiErrorBody } from './types';

export const DEFAULT_TIMEOUT_MS = 15000;

/** Thrown for every non-2xx response and every transport failure. */
export class ApiError extends Error {
  readonly status: number;
  readonly details: Array<{ field: string; message: string }> | null;

  constructor(
    message: string,
    status: number,
    details: Array<{ field: string; message: string }> | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }

  /** 0 means the request never reached the server (offline, bad host, timeout). */
  get isNetworkError(): boolean {
    return this.status === 0;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** A conflict is a rule the server enforces, not a bug - show it verbatim. */
  get isConflict(): boolean {
    return this.status === 409;
  }

  get isValidationError(): boolean {
    return this.status === 422;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** Field-level messages for a form, keyed by field name. */
  fieldErrors(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const detail of this.details ?? []) {
      if (!(detail.field in result)) result[detail.field] = detail.message;
    }
    return result;
  }
}

export interface ApiCredentials {
  /** e.g. "http://192.168.1.10:3000" - trailing slashes are tolerated. */
  baseUrl: string;
  apiKey?: string | null;
  /** The buyer's user id. Required only by the accept route. */
  userId?: string | number | null;
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Strip trailing slashes so `${base}${path}` never produces a double slash.
 * An empty or whitespace-only base is a configuration error, not a request one.
 */
export function normaliseBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new ApiError('No server address configured', 0);
  return trimmed.replace(/\/+$/, '');
}

function buildHeaders(credentials: ApiCredentials, hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (hasBody) headers['content-type'] = 'application/json';
  if (credentials.apiKey) headers['x-api-key'] = credentials.apiKey;
  if (credentials.userId !== null && credentials.userId !== undefined && credentials.userId !== '') {
    headers['x-user-id'] = String(credentials.userId);
  }
  return headers;
}

/**
 * The server always answers with `{ok, ...}` or `{ok:false, error:{...}}`. A
 * body that is neither (an HTML error page from a proxy, say) is reported as a
 * transport-level failure rather than parsed hopefully.
 */
async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { __raw: text };
  }
}

function errorFrom(response: Response, body: unknown): ApiError {
  const envelope = body as Partial<ApiErrorBody> | null;
  const message = envelope?.error?.message;
  const details = envelope?.error?.details ?? null;
  return new ApiError(
    message ?? `Request failed with status ${response.status}`,
    response.status,
    details,
  );
}

/**
 * Perform one request. Times out rather than hanging: a phone on a flaky
 * network otherwise leaves a spinner running for ever.
 */
export async function request<T>(
  credentials: ApiCredentials,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const base = normaliseBaseUrl(credentials.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Honour a caller's cancellation (screen unmounted) as well as our timeout.
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: buildHeaders(credentials, body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (signal?.aborted) throw new ApiError('Request cancelled', 0);
    const reason = controller.signal.aborted
      ? `The server did not respond within ${Math.round(timeoutMs / 1000)}s`
      : 'Could not reach the server. Check the address and that it is running.';
    throw new ApiError(reason, 0);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  const parsed = await parseBody(response);
  if (!response.ok) throw errorFrom(response, parsed);
  return parsed as T;
}
