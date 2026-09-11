import { decide, ACTION, ACTION_KINDS, OUTCOME, REASON } from '../../src/domain/decide.js';
import { createLimits } from '../../src/domain/limits.js';
import { STATE, TERMINAL_STATES } from '../../src/domain/machine.js';
import { toMinor } from '../../src/domain/money.js';

const limits = createLimits({
  product: 'wireless earbuds',
  quantity: 100,
  unit: 'pieces',
  currency: 'INR',
  targetMinor: toMinor('600'),
  maxMinor: toMinor('700'),
  basis: 'per_unit',
});

const stateOf = (overrides = {}) => ({
  negotiationId: 1,
  status: STATE.EVALUATING,
  round: 1,
  maxRounds: 6,
  opened: true,
  sellerPriceMinor: null,
  sellerDeclined: false,
  lastInboundMessageId: 10,
  answeredMessageId: null,
  ...overrides,
});

describe('decide', () => {
  test('THERE IS NO ACCEPTANCE ACTION - the agent cannot express one', () => {
    // Copied before sorting: ACTION_KINDS is frozen, which is itself the point.
    expect([...ACTION_KINDS].sort()).toEqual(['counter', 'end', 'escalate', 'hold', 'open'].sort());
    expect(Object.isFrozen(ACTION_KINDS)).toBe(true);
    expect(ACTION_KINDS).not.toContain('accept');
    expect(Object.values(ACTION)).not.toContain('accept');
  });

  test('every terminal state holds and does nothing else', () => {
    for (const status of TERMINAL_STATES) {
      const action = decide(stateOf({ status, sellerPriceMinor: toMinor('850') }), limits);
      expect(action.kind).toBe(ACTION.HOLD);
      expect(action.reason).toBe(REASON.TERMINAL);
    }
  });

  test('a suspected injection escalates before anything can be sent', () => {
    const action = decide(stateOf({ sellerPriceMinor: toMinor('850') }), limits, {
      requiresHuman: 'prompt_injection_suspected',
    });
    expect(action.kind).toBe(ACTION.ESCALATE);
    expect(action.reason).toBe('prompt_injection_suspected');
  });

  test('a decline ends the negotiation and is named as its own outcome', () => {
    const action = decide(stateOf({ sellerDeclined: true }), limits);
    expect(action.kind).toBe(ACTION.END);
    expect(action.outcome).toBe(OUTCOME.DECLINED);
  });

  test('an unopened negotiation opens, disclosing nothing', () => {
    const action = decide(stateOf({ opened: false, status: STATE.DRAFT, lastInboundMessageId: null }), limits);
    expect(action.kind).toBe(ACTION.OPEN);
    expect(action.discloseTarget).toBe(false);
  });

  test('a met target ends the negotiation, even on a message already answered', () => {
    const atTarget = decide(stateOf({ sellerPriceMinor: toMinor('600') }), limits);
    expect(atTarget.kind).toBe(ACTION.END);
    expect(atTarget.outcome).toBe(OUTCOME.TARGET_MET);

    const beaten = decide(
      stateOf({ sellerPriceMinor: toMinor('550'), answeredMessageId: 10 }),
      limits,
    );
    expect(beaten.outcome).toBe(OUTCOME.TARGET_MET);
  });

  test('holds when the supplier has said nothing new', () => {
    const action = decide(
      stateOf({ sellerPriceMinor: toMinor('850'), answeredMessageId: 10 }),
      limits,
    );
    expect(action.kind).toBe(ACTION.HOLD);
    expect(action.reason).toBe(REASON.ALREADY_ANSWERED);
  });

  test('holds while the supplier has not replied at all', () => {
    const action = decide(
      stateOf({ status: STATE.AWAITING_REPLY, lastInboundMessageId: null }),
      limits,
    );
    expect(action.reason).toBe(REASON.AWAITING_REPLY);
  });

  test('ends when the round budget is spent, at the boundary', () => {
    expect(decide(stateOf({ round: 5, sellerPriceMinor: toMinor('850') }), limits).kind).toBe(
      ACTION.COUNTER,
    );
    const spent = decide(stateOf({ round: 6, sellerPriceMinor: toMinor('850') }), limits);
    expect(spent.kind).toBe(ACTION.END);
    expect(spent.outcome).toBe(OUTCOME.ROUNDS_SPENT);
  });

  test('a reply with no price is left alone unless it asked what we pay', () => {
    expect(decide(stateOf(), limits).reason).toBe(REASON.AWAITING_PRICE);

    const answering = decide(stateOf(), limits, { sellerAskedOurBudget: true });
    expect(answering.kind).toBe(ACTION.COUNTER);
    expect(answering.reason).toBe(REASON.ANSWERING_BUDGET_QUESTION);
    expect(answering.priceMinor).toBe(limits.targetMinor);
    expect(answering.discloseTarget).toBe(true);
  });

  test('counters a real price above the target, without disclosing by default', () => {
    const action = decide(stateOf({ sellerPriceMinor: toMinor('850') }), limits);
    expect(action.kind).toBe(ACTION.COUNTER);
    expect(action.discloseTarget).toBe(false);
    expect(action.priceMinor).toBe(toMinor('650'));
    expect(action.inReplyToMessageId).toBe(10);
  });

  test('discloses the target in a counter only when it was asked for', () => {
    const action = decide(stateOf({ sellerPriceMinor: toMinor('850') }), limits, {
      sellerAskedOurBudget: true,
    });
    expect(action.discloseTarget).toBe(true);
  });

  test('NO DECISION EVER NAMES A PRICE AT OR ABOVE THE BUYER MAXIMUM', () => {
    for (let major = 601; major <= 3000; major += 11) {
      for (const round of [0, 1, 3, 5]) {
        const action = decide(
          stateOf({ sellerPriceMinor: toMinor(String(major)), round }),
          limits,
          { sellerAskedOurBudget: round % 2 === 0 },
        );
        if (action.priceMinor === undefined) continue;
        expect(action.priceMinor).toBeLessThan(limits.maxMinor);
        expect(action.priceMinor).toBeGreaterThanOrEqual(limits.targetMinor);
      }
    }
  });

  test('every decision carries a reason', () => {
    const samples = [
      decide(stateOf(), limits),
      decide(stateOf({ sellerPriceMinor: toMinor('850') }), limits),
      decide(stateOf({ sellerDeclined: true }), limits),
      decide(stateOf({ status: STATE.TARGET_MET }), limits),
      decide(stateOf({ opened: false, status: STATE.DRAFT }), limits),
    ];
    for (const action of samples) {
      expect(typeof action.reason).toBe('string');
      expect(action.reason.length).toBeGreaterThan(0);
    }
  });

  test('is pure: the same inputs give the same answer and nothing is mutated', () => {
    const state = stateOf({ sellerPriceMinor: toMinor('850') });
    const snapshot = JSON.stringify(state);
    const first = decide(state, limits);
    const second = decide(state, limits);
    expect(first).toEqual(second);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
