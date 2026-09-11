/**
 * Test helpers: render a screen with the real providers and a stubbed network.
 *
 * The point of rendering through SettingsProvider and QueryClientProvider
 * rather than mocking the hooks is that the tests then exercise the actual
 * request path - headers, error translation, query keys - instead of a
 * simplified imitation of it.
 */

import React, { type ReactElement, type ReactNode } from 'react';
import { cleanup, render, type RenderOptions } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SettingsProvider } from '@/config/settings';

export const TEST_BASE_URL = 'http://localhost:3000';

/**
 * A client with retries and background chatter off, so tests are determinate.
 *
 * `gcTime: 0` on MUTATIONS is load-bearing, not tidiness. React Query defaults
 * mutation garbage collection to five minutes and arms a real timer for it, so
 * any test that fires a mutation leaves a five-minute timer holding the Node
 * event loop open and Jest never exits.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false, gcTime: 0 },
    },
  });
}

/**
 * Query clients created during a test, torn down afterwards.
 *
 * Several screens poll, so their observers hold interval timers. Unmounting
 * the tree is not enough on its own - the client itself stays subscribed to
 * the focus and online managers - and a leaked timer makes Jest force-exit the
 * worker, which is the difference between a clean CI run and an intermittent
 * hang.
 */
const liveClients: QueryClient[] = [];

afterEach(async () => {
  // ORDER MATTERS. Jest runs afterEach hooks in reverse registration order, so
  // this one fires before the library's own cleanup. Unmount the tree first -
  // clearing a client while its components are still mounted lets the polling
  // observers re-subscribe and re-arm their intervals. cleanup() is
  // idempotent, so the library's later call is harmless.
  cleanup();

  // A tick invalidates four queries, and those refetches are deliberately not
  // awaited by the mutation. Cancelling them here is what makes teardown
  // deterministic: without it the in-flight work outlives the test, re-arms a
  // poll timer, and Jest never exits.
  for (const client of liveClients) {
    await client.cancelQueries();
    client.getMutationCache().clear();
    client.clear();
    client.unmount();
  }
  liveClients.length = 0;
});

/**
 * Fixed safe-area metrics.
 *
 * Screens that pin controls to the bottom read `useSafeAreaInsets`, which
 * throws without a provider. Supplying `initialMetrics` also makes the insets
 * resolve synchronously - the real provider measures natively and would report
 * zeroes on the first render under Jest.
 */
const TEST_SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

export function Providers({ children }: { children: ReactNode }) {
  const [client] = React.useState(() => {
    const created = createTestQueryClient();
    liveClients.push(created);
    return created;
  });

  return (
    <SafeAreaProvider initialMetrics={TEST_SAFE_AREA_METRICS}>
      <QueryClientProvider client={client}>
        <SettingsProvider>{children}</SettingsProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, { wrapper: Providers, ...options });
}

/* -------------------------------------------------------------------------- */
/* Network stubbing                                                           */
/* -------------------------------------------------------------------------- */

export interface RouteStub {
  /** Matched with String.includes against the request URL. */
  match: string;
  status?: number;
  body: unknown;
  method?: string;
}

/**
 * Install a fetch double that answers from a small routing table.
 *
 * MOST SPECIFIC WINS. Matching is by substring, and the API's paths nest -
 * "/api/negotiations/1" is a substring of "/api/negotiations/1/tick" - so a
 * first-match-wins lookup would silently answer a tick with a negotiation row
 * and the test would fail somewhere far away. Candidates are therefore ranked
 * by match length, and a route that names a method beats one that does not.
 *
 * Unmatched requests fail loudly rather than hanging, so a missing stub shows
 * up as a clear failure instead of a timeout.
 */
export function stubFetch(routes: RouteStub[]): jest.Mock {
  const mock = jest.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();

    const route = routes
      .filter(
        (candidate) =>
          url.includes(candidate.match) &&
          (candidate.method === undefined || candidate.method.toUpperCase() === method),
      )
      .sort((a, b) => {
        const byMethod = Number(b.method !== undefined) - Number(a.method !== undefined);
        return byMethod !== 0 ? byMethod : b.match.length - a.match.length;
      })[0];

    if (!route) {
      return {
        ok: false,
        status: 404,
        text: async () =>
          JSON.stringify({ ok: false, error: { message: `no stub for ${method} ${url}`, details: null } }),
      } as unknown as Response;
    }

    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(route.body),
    } as unknown as Response;
  });

  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

/* -------------------------------------------------------------------------- */
/* Fixtures shaped exactly like the backend's presenters                      */
/* -------------------------------------------------------------------------- */

export const money = (minor: number, symbol = '₹') => ({
  minor,
  amount: (minor / 100).toFixed(2),
  display: `${symbol}${(minor / 100).toFixed(2)}`,
});

export const requirementFixture = {
  id: 1,
  buyer_id: 1,
  product: 'wireless earbuds',
  quantity: 100,
  unit: 'pieces',
  currency: 'INR',
  price_basis: 'per_unit' as const,
  target_price: money(60000),
  max_price: money(70000),
  status: 'active' as const,
  created_at: '2026-01-01T10:00:00.000Z',
};

export const negotiationFixture = {
  id: 1,
  requirement_id: 1,
  seller_id: 2,
  state: 'COUNTERED' as const,
  round: 2,
  max_rounds: 6,
  supplier_price: money(85000),
  seller_declined: false,
  outcome: null,
  created_at: '2026-01-01T10:00:00.000Z',
};

export const messagesFixture = [
  {
    id: 1,
    negotiation_id: 1,
    author: 'agent' as const,
    kind: 'text' as const,
    body: 'Hello - we are sourcing 100 pieces of wireless earbuds and would like your best price.',
    price: null,
    in_reply_to: null,
    generated_by: 'template' as const,
    created_at: '2026-01-01T10:00:00.000Z',
  },
  {
    id: 2,
    negotiation_id: 1,
    author: 'seller' as const,
    kind: 'offer' as const,
    body: 'Our price is Rs 850 per unit.',
    price: money(85000),
    in_reply_to: null,
    generated_by: null,
    created_at: '2026-01-01T10:05:00.000Z',
  },
  {
    id: 3,
    negotiation_id: 1,
    author: 'agent' as const,
    kind: 'offer' as const,
    body: 'Thank you for the quote. We can proceed at ₹650.00 per piece for the full 100 pieces.',
    price: money(65000),
    in_reply_to: 2,
    generated_by: 'template' as const,
    created_at: '2026-01-01T10:06:00.000Z',
  },
];

export const healthFixture = {
  ok: true,
  service: 'ai-negotiation-agent',
  env: 'development',
  llm: { provider: 'rules', model: null, model_backed: false },
  agent: { enabled: true, dry_run: false, max_rounds: 6 },
};
