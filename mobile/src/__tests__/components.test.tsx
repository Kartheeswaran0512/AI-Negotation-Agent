/**
 * The components that carry the product's safety claims.
 *
 * Two of these assertions are the important ones. The audit row must surface
 * what verification threw away - that line is the clearest evidence the model
 * is not trusted with a price. And no component may ever render the buyer's
 * ceiling in something a supplier could see.
 */

import { render, screen } from '@testing-library/react-native';

import type { AgentRun, Message, Negotiation, Recommendation } from '@/api/types';
import { AgentRunRow, MessageBubble, NegotiationCard, RecommendationCard } from '@/components/domain';
import { Banner, Button, Chip, ProgressBar, Stat } from '@/components/primitives';
import { money, negotiationFixture, requirementFixture } from './helpers';

describe('MessageBubble', () => {
  const base: Message = {
    id: 1,
    negotiation_id: 1,
    author: 'agent',
    kind: 'offer',
    body: 'We can proceed at ₹650.00 per piece.',
    price: money(65000),
    in_reply_to: 2,
    generated_by: 'template',
    created_at: '2026-01-01T10:00:00.000Z',
  };

  test('renders the body and attributes it to the agent', () => {
    render(<MessageBubble message={base} currency="INR" />);
    expect(screen.getByText(base.body)).toBeTruthy();
    expect(screen.getByText('Agent')).toBeTruthy();
  });

  test('SHOWS WHO WROTE THE WORDS - template or model', () => {
    render(<MessageBubble message={base} currency="INR" />);
    expect(screen.getByText('· template')).toBeTruthy();

    screen.rerender(<MessageBubble message={{ ...base, generated_by: 'llm' }} currency="INR" />);
    expect(screen.getByText('· model-worded')).toBeTruthy();
  });

  test('a supplier message is attributed to the supplier and carries no provenance badge', () => {
    render(
      <MessageBubble
        message={{ ...base, author: 'seller', generated_by: null, body: 'Rs 850 per unit.' }}
        currency="INR"
      />,
    );
    expect(screen.getByText('Supplier')).toBeTruthy();
    expect(screen.queryByText('· template')).toBeNull();
  });

  test('a buyer acceptance is attributed to the buyer', () => {
    render(
      <MessageBubble
        message={{ ...base, author: 'buyer', kind: 'accept', generated_by: null }}
        currency="INR"
      />,
    );
    expect(screen.getByText('You')).toBeTruthy();
  });
});

describe('NegotiationCard', () => {
  test('shows the supplier price and the distance from target', () => {
    render(
      <NegotiationCard
        negotiation={negotiationFixture as Negotiation}
        requirement={requirementFixture}
        onPress={() => undefined}
      />,
    );

    expect(screen.getByText('₹850.00')).toBeTruthy();
    // 850 against a 600 target is +41.7%.
    expect(screen.getByText('+41.7%')).toBeTruthy();
    expect(screen.getByText('2 of 6')).toBeTruthy();
  });

  test('NEVER RENDERS THE BUYER CEILING', () => {
    render(
      <NegotiationCard
        negotiation={negotiationFixture as Negotiation}
        requirement={requirementFixture}
        onPress={() => undefined}
      />,
    );
    expect(screen.queryByText('₹700.00')).toBeNull();
  });

  test('says so plainly when there is no quote yet', () => {
    render(
      <NegotiationCard
        negotiation={{ ...negotiationFixture, supplier_price: null } as Negotiation}
        requirement={requirementFixture}
        onPress={() => undefined}
      />,
    );
    expect(screen.getByText('No quote yet')).toBeTruthy();
  });

  test('uses the remembered supplier label when there is one', () => {
    render(
      <NegotiationCard
        negotiation={negotiationFixture as Negotiation}
        requirement={requirementFixture}
        sellerLabel="Northline Electronics"
        onPress={() => undefined}
      />,
    );
    expect(screen.getByText('Northline Electronics')).toBeTruthy();
  });
});

describe('RecommendationCard', () => {
  const recommendation: Recommendation = {
    id: 1,
    requirement_id: 1,
    negotiation_id: 1,
    decision: 'accept',
    rationale: 'target_met',
    price: money(60000),
    summary: 'Recommended: accept at ₹600.00 per piece. The decision is yours.',
    created_at: '2026-01-01T10:00:00.000Z',
    note: 'A recommendation only. Accepting is a buyer action.',
  };

  test('renders the decision and the summary', () => {
    render(<RecommendationCard recommendation={recommendation} />);
    expect(screen.getByText('Accept')).toBeTruthy();
    expect(screen.getByText(recommendation.summary as string)).toBeTruthy();
  });

  test('ALWAYS REPEATS THE SERVER NOTE that the agent cannot accept', () => {
    render(<RecommendationCard recommendation={recommendation} />);
    expect(screen.getByText('A recommendation only. Accepting is a buyer action.')).toBeTruthy();
  });

  test('handles the absent recommendation without pretending there is one', () => {
    render(<RecommendationCard recommendation={null} />);
    expect(screen.getByText('No recommendation yet')).toBeTruthy();
  });
});

describe('AgentRunRow', () => {
  const base: AgentRun = {
    id: 1,
    action: 'counter',
    reason: 'improve_price',
    state_before: 'EVALUATING',
    state_after: 'COUNTERED',
    counter_price: money(65000),
    llm_provider: 'rules',
    llm_model: null,
    grounded: null,
    fell_back: false,
    latency_ms: 3,
    detail: { verdict: 'over_budget', sellerPriceMinor: 85000, droppedByVerification: [] },
    created_at: '2026-01-01T10:00:00.000Z',
  };

  test('explains the action in a sentence, not a code', () => {
    render(<AgentRunRow run={base} currency="INR" />);
    expect(screen.getByText('Countered')).toBeTruthy();
    expect(screen.getByText(/Countering to move the supplier closer/)).toBeTruthy();
    expect(screen.getByText('EVALUATING → COUNTERED')).toBeTruthy();
  });

  test('SURFACES WHAT VERIFICATION DISCARDED', () => {
    render(
      <AgentRunRow
        run={{ ...base, detail: { ...base.detail, droppedByVerification: ['unit_price'] } }}
        currency="INR"
      />,
    );
    expect(screen.getByText(/Verification discarded unit_price/)).toBeTruthy();
    expect(screen.getByText(/does not appear in the supplier/)).toBeTruthy();
  });

  test('explains an injection as refused rather than handled', () => {
    render(
      <AgentRunRow
        run={{
          ...base,
          action: 'escalate',
          reason: 'prompt_injection_suspected',
          detail: { injection: 'prompt_injection_suspected' },
        }}
        currency="INR"
      />,
    );
    expect(screen.getByText('Escalated')).toBeTruthy();
    expect(screen.getByText(/never interpreted/)).toBeTruthy();
  });

  test('reports a rejected generation distinctly from a grounded one', () => {
    render(<AgentRunRow run={{ ...base, grounded: false }} currency="INR" />);
    expect(screen.getByText('wording rejected')).toBeTruthy();

    screen.rerender(<AgentRunRow run={{ ...base, grounded: true }} currency="INR" />);
    expect(screen.getByText('wording grounded')).toBeTruthy();
  });

  test('a hold is rendered as a considered pause', () => {
    render(
      <AgentRunRow
        run={{ ...base, action: 'hold', reason: 'awaiting_reply', counter_price: null }}
        currency="INR"
      />,
    );
    expect(screen.getByText('Held')).toBeTruthy();
    expect(screen.getByText(/waiting and will not chase|has not replied|Waiting for the supplier/i)).toBeTruthy();
  });
});

describe('primitives', () => {
  test('a disabled button reports itself as disabled to assistive tech', () => {
    render(<Button label="Run agent step" onPress={() => undefined} disabled />);
    const button = screen.getByRole('button', { name: 'Run agent step' });
    expect(button.props.accessibilityState.disabled).toBe(true);
  });

  test('a loading button is busy and cannot be pressed twice', () => {
    const onPress = jest.fn();
    render(<Button label="Accept" onPress={onPress} loading />);
    const button = screen.getByRole('button', { name: 'Accept' });
    expect(button.props.accessibilityState.busy).toBe(true);
  });

  test('a banner is announced as an alert', () => {
    render(<Banner tone="danger" title="Cannot reach the server" message="Check the address." />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Cannot reach the server')).toBeTruthy();
  });

  test('the progress bar clamps a value beyond its maximum', () => {
    render(<ProgressBar value={9} max={6} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 6, now: 9 });
  });

  test('chip and stat render their content', () => {
    render(
      <>
        <Chip label="Target met" tone="success" />
        <Stat label="Supplier price" value="₹850.00" />
      </>,
    );
    expect(screen.getByText('Target met')).toBeTruthy();
    expect(screen.getByText('Supplier price')).toBeTruthy();
    expect(screen.getByText('₹850.00')).toBeTruthy();
  });
});
