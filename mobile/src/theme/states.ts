/**
 * How the eight negotiation states and three recommendation decisions look.
 *
 * Kept in one file so a state means the same thing on every screen: the colour
 * on the board is the colour in the thread header is the colour in the audit
 * trail. `tone` names a palette pair rather than a raw colour, so dark mode
 * needs no separate mapping.
 */

import type { NegotiationState, RecommendationDecision } from '@/api/types';
import type { Palette } from './tokens';

export type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'accent';

export interface ToneColors {
  foreground: string;
  background: string;
}

export function toneColors(tone: Tone, colors: Palette): ToneColors {
  switch (tone) {
    case 'success':
      return { foreground: colors.success, background: colors.successSurface };
    case 'warning':
      return { foreground: colors.warning, background: colors.warningSurface };
    case 'danger':
      return { foreground: colors.danger, background: colors.dangerSurface };
    case 'info':
      return { foreground: colors.info, background: colors.infoSurface };
    case 'accent':
      return { foreground: colors.accent, background: colors.accentSurface };
    case 'neutral':
    default:
      return { foreground: colors.textMuted, background: colors.border };
  }
}

export interface StateAppearance {
  label: string;
  tone: Tone;
  /** One line explaining what this state means for the buyer. */
  hint: string;
}

const STATE_APPEARANCE: Record<NegotiationState, StateAppearance> = {
  DRAFT: {
    label: 'Not started',
    tone: 'neutral',
    hint: 'The negotiation exists but the agent has not sent the opening enquiry yet.',
  },
  AWAITING_REPLY: {
    label: 'Waiting for supplier',
    tone: 'info',
    hint: 'The enquiry has gone out. The agent is waiting and will not chase.',
  },
  EVALUATING: {
    label: 'Agent is thinking',
    tone: 'warning',
    hint: 'A supplier message has arrived and has not been acted on yet.',
  },
  COUNTERED: {
    label: 'Counter-offer sent',
    tone: 'info',
    hint: 'The agent has countered. It is the supplier’s turn.',
  },
  TARGET_MET: {
    label: 'Target met',
    tone: 'success',
    hint: 'The supplier reached or beat your target. Nothing has been bought yet.',
  },
  ROUNDS_SPENT: {
    label: 'Rounds used up',
    tone: 'warning',
    hint: 'The agreed number of negotiating rounds has been used.',
  },
  DECLINED: {
    label: 'Supplier declined',
    tone: 'danger',
    hint: 'The supplier will not quote for this requirement.',
  },
  ESCALATED: {
    label: 'Needs your attention',
    tone: 'accent',
    hint: 'The agent stopped and handed this negotiation to a person.',
  },
};

export function stateAppearance(state: NegotiationState): StateAppearance {
  return (
    STATE_APPEARANCE[state] ?? {
      label: state,
      tone: 'neutral' as Tone,
      hint: 'Unrecognised state reported by the server.',
    }
  );
}

const DECISION_TONE: Record<RecommendationDecision, Tone> = {
  accept: 'success',
  reject: 'danger',
  continue: 'info',
};

export function decisionTone(decision: RecommendationDecision): Tone {
  return DECISION_TONE[decision] ?? 'neutral';
}
