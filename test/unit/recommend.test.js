import { recommendFor, DECISION, RATIONALE } from '../../src/domain/recommend.js';
import { createLimits } from '../../src/domain/limits.js';
import { STATE } from '../../src/domain/machine.js';
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

const offer = (id, price, status = STATE.COUNTERED) => ({
  negotiationId: id,
  sellerId: id * 10,
  priceMinor: price === null ? null : toMinor(price),
  status,
});

describe('recommend', () => {
  test('accepts as soon as one supplier meets the target', () => {
    const result = recommendFor({
      offers: [offer(1, '850'), offer(2, '600')],
      limits,
    });
    expect(result.decision).toBe(DECISION.ACCEPT);
    expect(result.rationale).toBe(RATIONALE.TARGET_MET);
    expect(result.negotiationId).toBe(2);
  });

  test('picks the cheapest offer within budget', () => {
    const result = recommendFor({
      offers: [offer(1, '690', STATE.ROUNDS_SPENT), offer(2, '650', STATE.ROUNDS_SPENT)],
      limits,
    });
    expect(result.decision).toBe(DECISION.ACCEPT);
    expect(result.negotiationId).toBe(2);
    expect(result.priceMinor).toBe(toMinor('650'));
  });

  test('keeps negotiating while any negotiation is still live', () => {
    const result = recommendFor({
      offers: [offer(1, '690', STATE.COUNTERED), offer(2, '850', STATE.ROUNDS_SPENT)],
      limits,
    });
    expect(result.decision).toBe(DECISION.CONTINUE);
    expect(result.rationale).toBe(RATIONALE.STILL_NEGOTIATING);
    // It still reports the best standing offer so the buyer can override.
    expect(result.priceMinor).toBe(toMinor('690'));
  });

  test('rejects when everything finished over budget', () => {
    const result = recommendFor({
      offers: [offer(1, '850', STATE.ROUNDS_SPENT), offer(2, '900', STATE.ROUNDS_SPENT)],
      limits,
    });
    expect(result.decision).toBe(DECISION.REJECT);
    expect(result.rationale).toBe(RATIONALE.NOTHING_WITHIN_BUDGET);
    expect(result.priceMinor).toBeNull();
  });

  test('rejects when nobody quoted at all', () => {
    const result = recommendFor({
      offers: [offer(1, null, STATE.DECLINED), offer(2, null, STATE.ROUNDS_SPENT)],
      limits,
    });
    expect(result.decision).toBe(DECISION.REJECT);
    expect(result.rationale).toBe(RATIONALE.NO_OFFERS_AT_ALL);
  });

  test('an empty board is not a rejection', () => {
    const result = recommendFor({ offers: [], limits });
    expect(result.decision).toBe(DECISION.CONTINUE);
    expect(result.finished).toBe(false);
  });

  test('never recommends a price over the buyer maximum', () => {
    for (const price of ['701', '850', '1200', '99999']) {
      const result = recommendFor({ offers: [offer(1, price, STATE.ROUNDS_SPENT)], limits });
      expect(result.priceMinor).toBeNull();
      expect(result.decision).not.toBe(DECISION.ACCEPT);
    }
  });

  test('the decision vocabulary is exactly accept, reject, continue', () => {
    expect(Object.values(DECISION).sort()).toEqual(['accept', 'continue', 'reject']);
  });
});
