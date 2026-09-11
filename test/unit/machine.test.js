import {
  STATE,
  STATES,
  TERMINAL_STATES,
  TRANSITIONS,
  isTerminal,
  canTransition,
  transition,
  TransitionError,
} from '../../src/domain/machine.js';

describe('state machine', () => {
  test('the terminal set is exactly the four closing states', () => {
    expect([...TERMINAL_STATES].sort()).toEqual(
      [STATE.DECLINED, STATE.ESCALATED, STATE.ROUNDS_SPENT, STATE.TARGET_MET].sort(),
    );
  });

  test('TERMINAL STATES HAVE NO OUTGOING TRANSITIONS', () => {
    for (const state of TERMINAL_STATES) {
      expect(TRANSITIONS[state]).toEqual([]);
      expect(isTerminal(state)).toBe(true);
      for (const target of STATES) {
        expect(canTransition(state, target)).toBe(false);
      }
    }
  });

  test('every state has a transition list and every target is a real state', () => {
    for (const state of STATES) {
      expect(Array.isArray(TRANSITIONS[state])).toBe(true);
      for (const target of TRANSITIONS[state]) {
        expect(STATES).toContain(target);
      }
    }
  });

  test('the ordinary path through a negotiation is legal', () => {
    expect(canTransition(STATE.DRAFT, STATE.AWAITING_REPLY)).toBe(true);
    expect(canTransition(STATE.AWAITING_REPLY, STATE.EVALUATING)).toBe(true);
    expect(canTransition(STATE.EVALUATING, STATE.COUNTERED)).toBe(true);
    expect(canTransition(STATE.COUNTERED, STATE.EVALUATING)).toBe(true);
    expect(canTransition(STATE.EVALUATING, STATE.TARGET_MET)).toBe(true);
  });

  test('nonsense transitions are refused, not tolerated', () => {
    expect(canTransition(STATE.DRAFT, STATE.COUNTERED)).toBe(false);
    expect(canTransition(STATE.TARGET_MET, STATE.EVALUATING)).toBe(false);
    expect(canTransition('NOT_A_STATE', STATE.DRAFT)).toBe(false);
    expect(() => transition(STATE.DECLINED, STATE.COUNTERED)).toThrow(TransitionError);
  });

  test('transition returns the new state when it is legal', () => {
    expect(transition(STATE.DRAFT, STATE.AWAITING_REPLY)).toBe(STATE.AWAITING_REPLY);
  });
});
