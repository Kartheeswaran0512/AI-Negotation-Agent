/**
 * Screen-level tests, against a stubbed network but the real query layer.
 *
 * Navigation is mocked at the hook level - these tests are about what a screen
 * fetches and renders, not about the navigator.
 */

import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { AuditTrailScreen } from '@/screens/AuditTrailScreen';
import { NegotiationScreen } from '@/screens/NegotiationScreen';
import { RequirementScreen } from '@/screens/RequirementScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import {
  healthFixture,
  messagesFixture,
  money,
  negotiationFixture,
  renderWithProviders,
  requirementFixture,
  stubFetch,
} from './helpers';

const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: Record<string, unknown> = {};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    replace: mockReplace,
    goBack: mockGoBack,
  }),
  useRoute: () => ({ params: mockRouteParams }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react') as typeof import('react');
    React.useEffect(() => callback(), []);
  },
}));

// The Settings provider reads storage on mount; give it a server address.
jest.mock('@/config/settings', () => {
  const actual = jest.requireActual('@/config/settings') as Record<string, unknown>;
  return {
    ...actual,
    useSettings: () => ({
      baseUrl: 'http://localhost:3000',
      apiKey: 'test-key',
      userId: '1',
      loaded: true,
      configured: true,
      credentials: { baseUrl: 'http://localhost:3000', apiKey: 'test-key', userId: '1' },
      save: jest.fn(),
      clear: jest.fn(),
    }),
    useCredentials: () => ({
      baseUrl: 'http://localhost:3000',
      apiKey: 'test-key',
      userId: '1',
    }),
  };
});

beforeEach(() => {
  mockNavigate.mockReset();
  mockReplace.mockReset();
  mockGoBack.mockReset();
  mockRouteParams = {};
});

/* -------------------------------------------------------------------------- */

describe('RequirementScreen', () => {
  beforeEach(() => {
    mockRouteParams = { requirementId: '1' };
  });

  test('shows the buyer figures and labels the maximum as private', async () => {
    stubFetch([
      { match: '/api/requirements/1/negotiations', body: { ok: true, negotiations: [negotiationFixture] } },
      { match: '/api/requirements/1/recommendation', body: { ok: true, recommendation: null } },
      { match: '/api/requirements/1', body: { ok: true, requirement: requirementFixture } },
    ]);

    renderWithProviders(<RequirementScreen />);

    await waitFor(() => expect(screen.getByText('wireless earbuds')).toBeTruthy());
    expect(screen.getByText('Your target')).toBeTruthy();
    expect(screen.getByText('Never shown to suppliers')).toBeTruthy();
  });

  test('renders one card per supplier', async () => {
    stubFetch([
      {
        match: '/api/requirements/1/negotiations',
        body: {
          ok: true,
          negotiations: [
            negotiationFixture,
            { ...negotiationFixture, id: 2, seller_id: 3, supplier_price: money(64000) },
          ],
        },
      },
      { match: '/api/requirements/1/recommendation', body: { ok: true, recommendation: null } },
      { match: '/api/requirements/1', body: { ok: true, requirement: requirementFixture } },
    ]);

    renderWithProviders(<RequirementScreen />);

    await waitFor(() => expect(screen.getByText('Suppliers (2)')).toBeTruthy());
    expect(screen.getByText('₹850.00')).toBeTruthy();
    expect(screen.getByText('₹640.00')).toBeTruthy();
  });

  test('offers an accept route only when the recommendation says accept', async () => {
    stubFetch([
      { match: '/api/requirements/1/negotiations', body: { ok: true, negotiations: [negotiationFixture] } },
      {
        match: '/api/requirements/1/recommendation',
        body: {
          ok: true,
          recommendation: {
            id: 1,
            requirement_id: 1,
            negotiation_id: 1,
            decision: 'accept',
            rationale: 'target_met',
            price: money(60000),
            summary: 'Recommended: accept at ₹600.00.',
            created_at: '2026-01-01T10:00:00.000Z',
            note: 'A recommendation only. Accepting is a buyer action.',
          },
        },
      },
      { match: '/api/requirements/1', body: { ok: true, requirement: requirementFixture } },
    ]);

    renderWithProviders(<RequirementScreen />);

    const button = await screen.findByRole('button', { name: /Accept at ₹600.00/ });
    fireEvent.press(button);
    expect(mockNavigate).toHaveBeenCalledWith('Accept', { negotiationId: '1', requirementId: '1' });
  });

  test('an empty board invites adding a supplier', async () => {
    stubFetch([
      { match: '/api/requirements/1/negotiations', body: { ok: true, negotiations: [] } },
      { match: '/api/requirements/1/recommendation', body: { ok: true, recommendation: null } },
      { match: '/api/requirements/1', body: { ok: true, requirement: requirementFixture } },
    ]);

    renderWithProviders(<RequirementScreen />);
    await waitFor(() => expect(screen.getByText('No suppliers yet')).toBeTruthy());
  });

  test('a failed load offers a retry rather than a blank screen', async () => {
    stubFetch([
      {
        match: '/api/requirements/1',
        status: 404,
        body: { ok: false, error: { message: 'requirement not found', details: null } },
      },
    ]);

    renderWithProviders(<RequirementScreen />);
    await waitFor(() => expect(screen.getByText('Could not load this requirement')).toBeTruthy());
    expect(screen.getByText('requirement not found')).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */

describe('NegotiationScreen', () => {
  beforeEach(() => {
    mockRouteParams = { negotiationId: '1', requirementId: '1' };
  });

  const baseRoutes = [
    { match: '/api/negotiations/1/messages', body: { ok: true, messages: messagesFixture } },
    { match: '/api/negotiations/1/runs', body: { ok: true, runs: [] } },
    { match: '/api/negotiations/1', body: { ok: true, negotiation: negotiationFixture } },
    { match: '/api/requirements/1', body: { ok: true, requirement: requirementFixture } },
    { match: '/health', body: healthFixture },
  ];

  test('renders the thread with both sides', async () => {
    stubFetch(baseRoutes);
    renderWithProviders(<NegotiationScreen />);

    await waitFor(() => expect(screen.getByText('Our price is Rs 850 per unit.')).toBeTruthy());
    expect(screen.getByText(/Hello - we are sourcing 100 pieces/)).toBeTruthy();
    expect(screen.getByText('Counter-offer sent')).toBeTruthy();
  });

  test('A HOLD IS EXPLAINED, NOT REPORTED AS A FAILURE', async () => {
    stubFetch([
      ...baseRoutes,
      {
        match: '/api/negotiations/1/tick',
        method: 'POST',
        body: {
          ok: true,
          action: 'hold',
          reason: 'awaiting_reply',
          state: 'AWAITING_REPLY',
          message: null,
          generated_by: null,
          recommendation: null,
        },
      },
    ]);

    renderWithProviders(<NegotiationScreen />);

    const button = await screen.findByRole('button', { name: 'Run agent step' });
    fireEvent.press(button);

    await waitFor(() =>
      expect(screen.getByText('The agent decided not to send anything')).toBeTruthy(),
    );
    expect(screen.getByText(/waiting for the supplier to reply/i)).toBeTruthy();
  });

  test('a counter reports the price and who worded it', async () => {
    stubFetch([
      ...baseRoutes,
      {
        match: '/api/negotiations/1/tick',
        method: 'POST',
        body: {
          ok: true,
          action: 'counter',
          reason: 'improve_price',
          state: 'COUNTERED',
          message: {
            id: 4,
            negotiation_id: 1,
            author: 'agent',
            kind: 'offer',
            body: 'We can proceed at ₹650.00 per piece.',
            price: money(65000),
            in_reply_to: 2,
            generated_by: 'template',
            created_at: '2026-01-01T10:10:00.000Z',
          },
          generated_by: 'template',
          recommendation: null,
        },
      },
    ]);

    renderWithProviders(<NegotiationScreen />);

    fireEvent.press(await screen.findByRole('button', { name: 'Run agent step' }));

    // Anchor the wait on text unique to the outcome card. "Counter-offer sent"
    // is also the COUNTERED state chip, which is on screen from the first
    // render, so waiting on it would return before the tick had resolved.
    expect(await screen.findByText('Offered')).toBeTruthy();
    expect(screen.getByText('Template')).toBeTruthy();
    // Now both the chip and the outcome card say it.
    expect(screen.getAllByText('Counter-offer sent')).toHaveLength(2);
  });

  test('a terminal negotiation disables the controls', async () => {
    stubFetch([
      ...baseRoutes.filter((route) => route.match !== '/api/negotiations/1'),
      {
        match: '/api/negotiations/1',
        body: { ok: true, negotiation: { ...negotiationFixture, state: 'TARGET_MET' } },
      },
    ]);

    renderWithProviders(<NegotiationScreen />);

    const button = await screen.findByRole('button', { name: 'Negotiation finished' });
    expect(button.props.accessibilityState.disabled).toBe(true);
  });

  test('an escalated negotiation says the injected claim was not believed', async () => {
    stubFetch([
      ...baseRoutes.filter((route) => route.match !== '/api/negotiations/1'),
      {
        match: '/api/negotiations/1',
        body: { ok: true, negotiation: { ...negotiationFixture, state: 'ESCALATED' } },
      },
    ]);

    renderWithProviders(<NegotiationScreen />);

    await waitFor(() => expect(screen.getByText('This negotiation needs you')).toBeTruthy());
    expect(screen.getByText(/Nothing that message claimed was treated as a fact/)).toBeTruthy();
  });

  test('the supplier simulator posts a reply', async () => {
    const fetchMock = stubFetch([
      ...baseRoutes,
      {
        match: '/api/negotiations/1/seller-messages',
        method: 'POST',
        status: 201,
        body: {
          ok: true,
          message: {
            id: 5,
            negotiation_id: 1,
            author: 'seller',
            kind: 'text',
            body: 'We can do Rs 700.',
            price: null,
            in_reply_to: null,
            generated_by: null,
            created_at: '2026-01-01T10:20:00.000Z',
          },
        },
      },
    ]);

    renderWithProviders(<NegotiationScreen />);

    fireEvent.press(await screen.findByRole('button', { name: 'Reply as supplier' }));
    fireEvent.changeText(screen.getByTestId('simulator-body'), 'We can do Rs 700.');
    fireEvent.press(screen.getByRole('button', { name: 'Post reply' }));

    await waitFor(() => {
      const posted = fetchMock.mock.calls.find(
        (call) =>
          String(call[0]).includes('/seller-messages') &&
          (call[1] as RequestInit | undefined)?.method === 'POST',
      );
      expect(posted).toBeDefined();
      expect((posted?.[1] as RequestInit).body).toBe(JSON.stringify({ body: 'We can do Rs 700.' }));
    });
  });
});

/* -------------------------------------------------------------------------- */

describe('SettingsScreen', () => {
  const TOOLS_OK = {
    match: '/api/tools',
    body: { ok: true, tools: [], note: 'There is deliberately no accept_deal tool.' },
  };

  test('reports the key as accepted when an authenticated route succeeds', async () => {
    stubFetch([{ match: '/health', body: healthFixture }, TOOLS_OK]);

    renderWithProviders(<SettingsScreen />);

    await waitFor(() => expect(screen.getByText('Connected')).toBeTruthy());
    expect(await screen.findByText('Accepted')).toBeTruthy();
  });

  test('A HEALTHY SERVER WITH A BAD KEY IS NOT REPORTED AS FINE', async () => {
    // /health deliberately sits outside the server's API-key check, so it
    // succeeds even when the key is wrong. The screen must not call that
    // "Connected" and leave it there.
    stubFetch([
      { match: '/health', body: healthFixture },
      {
        match: '/api/tools',
        status: 401,
        body: { ok: false, error: { message: 'invalid or missing x-api-key', details: null } },
      },
    ]);

    renderWithProviders(<SettingsScreen />);

    expect(await screen.findByText('The server rejected this API key')).toBeTruthy();
    expect(screen.getByText('Rejected')).toBeTruthy();
  });

  test('warns loudly when the agent is in dry-run', async () => {
    stubFetch([
      {
        match: '/health',
        body: { ...healthFixture, agent: { ...healthFixture.agent, dry_run: true } },
      },
      TOOLS_OK,
    ]);

    renderWithProviders(<SettingsScreen />);
    expect(await screen.findByText('Dry-run mode is on')).toBeTruthy();
  });

  test('an unreachable server is reported as unreachable, not as a bad key', async () => {
    stubFetch([]);
    renderWithProviders(<SettingsScreen />);
    expect(await screen.findByText('Cannot reach the server')).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */

describe('AuditTrailScreen', () => {
  beforeEach(() => {
    mockRouteParams = { negotiationId: '1', requirementId: '1' };
  });

  const runs = [
    {
      id: 1,
      action: 'open',
      reason: 'opening',
      state_before: 'DRAFT',
      state_after: 'AWAITING_REPLY',
      counter_price: null,
      llm_provider: 'rules',
      llm_model: null,
      grounded: null,
      fell_back: true,
      latency_ms: 1,
      detail: { verdict: 'awaiting' },
      created_at: '2026-01-01T10:00:00.000Z',
    },
    {
      id: 2,
      action: 'hold',
      reason: 'awaiting_reply',
      state_before: 'AWAITING_REPLY',
      state_after: 'AWAITING_REPLY',
      counter_price: null,
      llm_provider: 'rules',
      llm_model: null,
      grounded: null,
      fell_back: false,
      latency_ms: 0,
      detail: {},
      created_at: '2026-01-01T10:01:00.000Z',
    },
  ];

  test('summarises the run and lists every step, quiet ones included', async () => {
    stubFetch([
      { match: '/api/negotiations/1/runs', body: { ok: true, runs } },
      { match: '/api/requirements/1', body: { ok: true, requirement: requirementFixture } },
    ]);

    renderWithProviders(<AuditTrailScreen />);

    await waitFor(() => expect(screen.getByText('Opened enquiry')).toBeTruthy());
    expect(screen.getByText('Held')).toBeTruthy();
    expect(screen.getByText('Steps')).toBeTruthy();
  });

  test('the quiet filter hides holds and says why the list is empty', async () => {
    stubFetch([
      { match: '/api/negotiations/1/runs', body: { ok: true, runs: [runs[1]] } },
      { match: '/api/requirements/1', body: { ok: true, requirement: requirementFixture } },
    ]);

    renderWithProviders(<AuditTrailScreen />);

    fireEvent.press(await screen.findByText('Hide steps that sent nothing'));

    await waitFor(() => expect(screen.getByText('No steps sent a message')).toBeTruthy());
  });
});
