/**
 * The mapping layers: server vocabulary in, buyer-readable English out.
 *
 * These are the tests that fail when the backend adds a reason code or a state
 * and the UI silently renders a bare identifier at somebody.
 */

import { TERMINAL_STATES, isTerminalState, type NegotiationState } from '@/api/types';
import { decisionTone, stateAppearance, toneColors } from '@/theme/states';
import { lightPalette, darkPalette } from '@/theme/tokens';
import {
  describeAction,
  describeDecision,
  describeField,
  describeRationale,
  describeReason,
  describeVerdict,
  isQuietAction,
} from '@/utils/reasons';

const ALL_STATES: NegotiationState[] = [
  'DRAFT',
  'AWAITING_REPLY',
  'EVALUATING',
  'COUNTERED',
  'TARGET_MET',
  'ROUNDS_SPENT',
  'DECLINED',
  'ESCALATED',
];

describe('negotiation states', () => {
  test('the terminal set matches the backend exactly', () => {
    expect([...TERMINAL_STATES].sort()).toEqual(
      ['DECLINED', 'ESCALATED', 'ROUNDS_SPENT', 'TARGET_MET'].sort(),
    );
  });

  test('isTerminalState agrees with that set', () => {
    for (const state of ALL_STATES) {
      expect(isTerminalState(state)).toBe(TERMINAL_STATES.includes(state));
    }
  });

  test('EVERY state has a label and a hint - none renders as a bare identifier', () => {
    for (const state of ALL_STATES) {
      const appearance = stateAppearance(state);
      expect(appearance.label).toBeTruthy();
      expect(appearance.label).not.toBe(state);
      expect(appearance.hint.length).toBeGreaterThan(10);
    }
  });

  test('an unknown state degrades visibly instead of crashing', () => {
    const appearance = stateAppearance('SOMETHING_NEW' as NegotiationState);
    expect(appearance.label).toBe('SOMETHING_NEW');
    expect(appearance.tone).toBe('neutral');
  });

  test('a finished negotiation reads as finished, not as an error', () => {
    expect(stateAppearance('TARGET_MET').tone).toBe('success');
    expect(stateAppearance('DECLINED').tone).toBe('danger');
    expect(stateAppearance('ESCALATED').tone).toBe('accent');
  });
});

describe('tones', () => {
  test('every tone resolves in both palettes', () => {
    const tones = ['neutral', 'info', 'warning', 'success', 'danger', 'accent'] as const;
    for (const palette of [lightPalette, darkPalette]) {
      for (const tone of tones) {
        const { foreground, background } = toneColors(tone, palette);
        expect(foreground).toMatch(/^#/);
        expect(background).toMatch(/^#/);
      }
    }
  });

  test('the recommendation decisions map to distinct tones', () => {
    expect(decisionTone('accept')).toBe('success');
    expect(decisionTone('reject')).toBe('danger');
    expect(decisionTone('continue')).toBe('info');
  });
});

describe('reason codes', () => {
  /** Every reason string src/domain/decide.js and guard.js can emit. */
  const SERVER_REASONS = [
    'terminal',
    'needs_human',
    'seller_declined',
    'opening',
    'target_met',
    'already_answered',
    'awaiting_reply',
    'awaiting_price',
    'rounds_spent',
    'answering_budget_question',
    'improve_price',
    'agent_disabled',
    'dry_run',
    'send_limit',
    'not_opened',
    'prompt_injection_suspected',
  ];

  test('EVERY reason the server can send has a sentence', () => {
    for (const reason of SERVER_REASONS) {
      const text = describeReason(reason);
      expect(text).toBeTruthy();
      expect(text).not.toBe(reason);
      expect(text.length).toBeGreaterThan(15);
    }
  });

  test('an unrecognised reason is shown, not swallowed', () => {
    expect(describeReason('some_new_reason')).toBe('some new reason');
    expect(describeReason(null)).toBe('No reason recorded.');
  });

  test('the injection explanation says the claim was not believed', () => {
    expect(describeReason('prompt_injection_suspected')).toMatch(/not interpreted/i);
  });
});

describe('actions', () => {
  test('all five action kinds have labels', () => {
    expect(describeAction('hold')).toBe('Held');
    expect(describeAction('open')).toBe('Opened enquiry');
    expect(describeAction('counter')).toBe('Countered');
    expect(describeAction('end')).toBe('Ended');
    expect(describeAction('escalate')).toBe('Escalated');
  });

  test('A HOLD IS THE QUIET ACTION - and nothing else is', () => {
    expect(isQuietAction('hold')).toBe(true);
    for (const action of ['open', 'counter', 'end', 'escalate'] as const) {
      expect(isQuietAction(action)).toBe(false);
    }
  });
});

describe('verdicts, decisions and fields', () => {
  test('every verdict reads as plain English', () => {
    const verdicts = [
      'awaiting',
      'below_target',
      'at_target',
      'within_budget',
      'over_budget',
      'declined',
    ] as const;
    for (const verdict of verdicts) {
      expect(describeVerdict(verdict)).toBeTruthy();
      expect(describeVerdict(verdict)).not.toBe(verdict);
    }
    expect(describeVerdict(null)).toBeNull();
  });

  test('decisions are phrased as advice, not commands', () => {
    expect(describeDecision('accept')).toBe('Accept');
    expect(describeDecision('continue')).toBe('Keep negotiating');
  });

  test('every rationale the server emits is explained', () => {
    for (const rationale of [
      'target_met',
      'best_within_budget_and_finished',
      'nothing_within_budget',
      'no_offers_at_all',
      'still_negotiating',
    ]) {
      expect(describeRationale(rationale)).not.toBe(rationale);
    }
  });

  test('unverified field names are humanised for the intake form', () => {
    expect(describeField('price_basis')).toBe('price basis');
    expect(describeField('max_price')).toBe('maximum price');
    expect(describeField('unknown_field')).toBe('unknown field');
  });
});
