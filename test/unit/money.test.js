import {
  toMinor,
  fromMinor,
  formatMoney,
  multiplyMinor,
  divideMinor,
  isPositiveMinor,
  MINOR,
} from '../../src/domain/money.js';

describe('money', () => {
  test('parses whole and fractional major units without floating point', () => {
    expect(toMinor('600')).toBe(60000);
    expect(toMinor('600.50')).toBe(60050);
    expect(toMinor('600.5')).toBe(60050);
    expect(toMinor(600)).toBe(60000);
    expect(toMinor('1,200')).toBe(120000);
  });

  test('600.10 does not lose a paise to IEEE 754', () => {
    // 600.10 * 100 === 60009.999999999996 in binary floating point.
    expect(toMinor('600.10')).toBe(60010);
    expect(toMinor(600.1)).toBe(60010);
  });

  test('round-trips through the decimal string the database column expects', () => {
    for (const value of ['0.01', '1.00', '600.50', '99999.99']) {
      expect(fromMinor(toMinor(value))).toBe(Number(value).toFixed(2));
    }
  });

  test('rejects values it cannot parse exactly', () => {
    expect(() => toMinor('six hundred')).toThrow(TypeError);
    expect(() => toMinor('600.123')).toThrow(TypeError);
    expect(() => toMinor(Number.NaN)).toThrow(TypeError);
    expect(() => toMinor(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  test('formats with a symbol when it knows one and a code when it does not', () => {
    expect(formatMoney(60000, 'INR')).toBe('₹600.00');
    expect(formatMoney(60000, 'USD')).toBe('$600.00');
    expect(formatMoney(60000, 'JPY')).toBe('600.00 JPY');
  });

  test('multiplies and divides exactly', () => {
    expect(multiplyMinor(60050, 100)).toBe(6005000);
    expect(divideMinor(6005000, 100)).toBe(60050);
    expect(divideMinor(100001, 3)).toBe(33334); // rounded, never truncated silently
  });

  test('isPositiveMinor rejects zero, negatives and non-integers', () => {
    expect(isPositiveMinor(1)).toBe(true);
    expect(isPositiveMinor(0)).toBe(false);
    expect(isPositiveMinor(-1)).toBe(false);
    expect(isPositiveMinor(1.5)).toBe(false);
    expect(isPositiveMinor(null)).toBe(false);
  });

  test('MINOR is the documented 100', () => {
    expect(MINOR).toBe(100);
  });
});
