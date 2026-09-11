/**
 * Money on the client keeps the same promise the backend does: a price is
 * never handled as a float. These tests are the ones that would fail if
 * somebody "simplified" parseAmountToMinor into `Number(x) * 100`.
 */

import {
  formatMinor,
  minorToAmount,
  multiplyMinor,
  parseAmountToMinor,
  percentAboveTarget,
} from '@/utils/money';
import { displayMoney } from '@/utils/money';
import type { Money } from '@/api/types';

describe('parseAmountToMinor', () => {
  test('parses whole and fractional amounts', () => {
    expect(parseAmountToMinor('600')).toBe(60000);
    expect(parseAmountToMinor('600.5')).toBe(60050);
    expect(parseAmountToMinor('600.50')).toBe(60050);
    expect(parseAmountToMinor('0.01')).toBe(1);
  });

  test('600.10 DOES NOT lose a paise to floating point', () => {
    // Number('600.10') * 100 === 60009.999999999996
    expect(parseAmountToMinor('600.10')).toBe(60010);
    expect(parseAmountToMinor('1.10')).toBe(110);
    expect(parseAmountToMinor('2.675')).toBeNull();
  });

  test('tolerates thousands separators and surrounding space', () => {
    expect(parseAmountToMinor(' 1,250.75 ')).toBe(125075);
  });

  test('rejects anything it cannot parse exactly', () => {
    expect(parseAmountToMinor('')).toBeNull();
    expect(parseAmountToMinor('abc')).toBeNull();
    expect(parseAmountToMinor('600.123')).toBeNull();
    expect(parseAmountToMinor('-600')).toBeNull();
    expect(parseAmountToMinor('₹600')).toBeNull();
  });
});

describe('minorToAmount', () => {
  test('produces the exact decimal string the API expects', () => {
    expect(minorToAmount(60000)).toBe('600.00');
    expect(minorToAmount(60050)).toBe('600.50');
    expect(minorToAmount(1)).toBe('0.01');
    expect(minorToAmount(0)).toBe('0.00');
  });

  test('round-trips with parseAmountToMinor', () => {
    for (const minor of [1, 99, 100, 60000, 60010, 125075, 999999]) {
      expect(parseAmountToMinor(minorToAmount(minor))).toBe(minor);
    }
  });
});

describe('formatMinor', () => {
  test('matches the server formatting for known currencies', () => {
    expect(formatMinor(60000, 'INR')).toBe('₹600.00');
    expect(formatMinor(60050, 'USD')).toBe('$600.50');
    expect(formatMinor(60000, 'EUR')).toBe('€600.00');
  });

  test('falls back to a trailing code for currencies with no symbol', () => {
    expect(formatMinor(60000, 'JPY')).toBe('600.00 JPY');
  });
});

describe('multiplyMinor', () => {
  test('computes an order total exactly', () => {
    expect(multiplyMinor(60050, 100)).toBe(6005000);
    expect(multiplyMinor(1, 3)).toBe(3);
  });

  test('refuses a nonsense quantity rather than producing a wrong total', () => {
    expect(multiplyMinor(60000, -1)).toBe(0);
    expect(multiplyMinor(60000, 1.5)).toBe(0);
  });
});

describe('percentAboveTarget', () => {
  test('reports the signed distance from the target', () => {
    expect(percentAboveTarget(85000, 60000)).toBeCloseTo(41.7, 1);
    expect(percentAboveTarget(60000, 60000)).toBe(0);
    expect(percentAboveTarget(57000, 60000)).toBeCloseTo(-5, 1);
  });

  test('refuses to divide by a non-positive target', () => {
    expect(percentAboveTarget(60000, 0)).toBeNull();
  });
});

describe('displayMoney', () => {
  const money: Money = { minor: 60000, amount: '600.00', display: '₹600.00' };

  test('renders the server display string, never a recomputed one', () => {
    expect(displayMoney(money)).toBe('₹600.00');
  });

  test('falls back when the server sent null', () => {
    expect(displayMoney(null)).toBe('—');
    expect(displayMoney(undefined, 'No quote')).toBe('No quote');
  });
});
