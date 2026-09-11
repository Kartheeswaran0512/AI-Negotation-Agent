import { verdictFor, meetsTarget, withinBudget, hasRealPrice, VERDICT } from '../../src/domain/verdict.js';
import { createLimits } from '../../src/domain/limits.js';
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

describe('verdict', () => {
  test.each([
    [null, VERDICT.AWAITING],
    [undefined, VERDICT.AWAITING],
    [0, VERDICT.AWAITING],
    [-100, VERDICT.AWAITING],
    [toMinor('599.99'), VERDICT.BELOW_TARGET],
    [toMinor('600'), VERDICT.AT_TARGET],
    [toMinor('600.01'), VERDICT.WITHIN_BUDGET],
    [toMinor('700'), VERDICT.WITHIN_BUDGET],
    [toMinor('700.01'), VERDICT.OVER_BUDGET],
    [toMinor('850'), VERDICT.OVER_BUDGET],
  ])('%p reads as %s', (price, expected) => {
    expect(verdictFor(price, limits)).toBe(expected);
  });

  test('the boundaries are inclusive on the right side of the buyer', () => {
    expect(meetsTarget(verdictFor(toMinor('600'), limits))).toBe(true);
    expect(meetsTarget(verdictFor(toMinor('600.01'), limits))).toBe(false);
    expect(withinBudget(verdictFor(toMinor('700'), limits))).toBe(true);
    expect(withinBudget(verdictFor(toMinor('700.01'), limits))).toBe(false);
  });

  test('awaiting and declined are not real prices', () => {
    expect(hasRealPrice(VERDICT.AWAITING)).toBe(false);
    expect(hasRealPrice(VERDICT.DECLINED)).toBe(false);
    expect(hasRealPrice(VERDICT.OVER_BUDGET)).toBe(true);
  });
});
