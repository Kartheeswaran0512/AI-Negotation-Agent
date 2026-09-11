import { createLimits, bandWidth, isSingleFigure, PRICE_BASIS, LimitsError } from '../../src/domain/limits.js';
import { toMinor } from '../../src/domain/money.js';

const base = {
  product: 'wireless earbuds',
  quantity: 100,
  unit: 'pieces',
  currency: 'inr',
  targetMinor: toMinor('600'),
  maxMinor: toMinor('700'),
  basis: PRICE_BASIS.PER_UNIT,
};

describe('limits', () => {
  test('builds a frozen per-unit boundary', () => {
    const limits = createLimits(base);
    expect(limits.targetMinor).toBe(60000);
    expect(limits.maxMinor).toBe(70000);
    expect(limits.currency).toBe('INR');
    expect(Object.isFrozen(limits)).toBe(true);
  });

  test('converts a total-basis budget to per unit', () => {
    const limits = createLimits({
      ...base,
      basis: PRICE_BASIS.TOTAL,
      targetMinor: toMinor('60000'),
      maxMinor: toMinor('70000'),
    });
    expect(limits.targetMinor).toBe(60000);
    expect(limits.maxMinor).toBe(70000);
    expect(limits.basis).toBe(PRICE_BASIS.TOTAL);
  });

  test('REFUSES a total-basis budget with no quantity rather than picking a reading', () => {
    expect(() =>
      createLimits({ ...base, quantity: 0, basis: PRICE_BASIS.TOTAL }),
    ).toThrow(LimitsError);
  });

  test('refuses a maximum below the target', () => {
    expect(() => createLimits({ ...base, maxMinor: toMinor('500') })).toThrow(LimitsError);
  });

  test('refuses a missing product, a bad basis and a non-positive target', () => {
    expect(() => createLimits({ ...base, product: '   ' })).toThrow(LimitsError);
    expect(() => createLimits({ ...base, basis: 'per_kg' })).toThrow(LimitsError);
    expect(() => createLimits({ ...base, targetMinor: 0 })).toThrow(LimitsError);
    expect(() => createLimits({ ...base, quantity: -1 })).toThrow(LimitsError);
  });

  test('a target equal to the maximum is legal and reported as a single figure', () => {
    const limits = createLimits({ ...base, maxMinor: toMinor('600') });
    expect(bandWidth(limits)).toBe(0);
    expect(isSingleFigure(limits)).toBe(true);
  });
});
