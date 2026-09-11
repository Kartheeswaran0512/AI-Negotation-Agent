import { nextCounter, askCeiling, openingAsk, isSafeToState, STEP, CEILING_MARGIN } from '../../src/domain/pricing.js';
import { createLimits } from '../../src/domain/limits.js';
import { toMinor, fromMinor } from '../../src/domain/money.js';

const limitsFor = (target, max, quantity = 100) =>
  createLimits({
    product: 'wireless earbuds',
    quantity,
    unit: 'pieces',
    currency: 'INR',
    targetMinor: toMinor(target),
    maxMinor: toMinor(max),
    basis: 'per_unit',
  });

const limits = limitsFor('600', '700');

describe('pricing', () => {
  test('the ceiling is the midpoint of the band, never the maximum', () => {
    expect(fromMinor(askCeiling(limits))).toBe('650.00');
    expect(askCeiling(limits)).toBeLessThan(limits.maxMinor);
  });

  test('halves the gap to the target and stops at the ceiling', () => {
    // 850 -> midpoint 725, but the ceiling is 650.
    expect(fromMinor(nextCounter(toMinor('850'), limits))).toBe('650.00');
    // 660 -> midpoint 630, comfortably under the ceiling.
    expect(fromMinor(nextCounter(toMinor('660'), limits))).toBe('630.00');
    expect(fromMinor(nextCounter(toMinor('620'), limits))).toBe('610.00');
  });

  test('never returns a figure below the buyer target', () => {
    for (const price of ['600.01', '601', '650', '700', '1000', '99999']) {
      const counter = nextCounter(toMinor(price), limits);
      expect(counter).toBeGreaterThanOrEqual(limits.targetMinor);
    }
  });

  test('NEVER returns a figure at or above the buyer maximum', () => {
    for (let major = 601; major <= 5000; major += 7) {
      const counter = nextCounter(toMinor(String(major)), limits);
      if (counter === null) continue;
      expect(counter).toBeLessThan(limits.maxMinor);
      expect(counter).toBeLessThanOrEqual(askCeiling(limits));
    }
  });

  test('is non-increasing as the supplier comes down', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let major = 900; major > 600; major -= 5) {
      const counter = nextCounter(toMinor(String(major)), limits);
      expect(counter).toBeLessThanOrEqual(previous);
      previous = counter;
    }
  });

  test('returns null when there is nothing to counter', () => {
    expect(nextCounter(null, limits)).toBeNull();
    expect(nextCounter(0, limits)).toBeNull();
    expect(nextCounter(-500, limits)).toBeNull();
    expect(nextCounter(toMinor('600'), limits)).toBeNull(); // already at target
    expect(nextCounter(toMinor('550'), limits)).toBeNull(); // already better
  });

  test('a single-figure buyer collapses the ceiling onto the target', () => {
    const tight = limitsFor('600', '600');
    expect(askCeiling(tight)).toBe(tight.targetMinor);
    expect(nextCounter(toMinor('900'), tight)).toBe(tight.targetMinor);
  });

  test('a one-paise band still stays strictly under the maximum', () => {
    const narrow = limitsFor('600', '600.01');
    expect(askCeiling(narrow)).toBeLessThan(narrow.maxMinor);
  });

  test('the opening ask is the buyer own target and nothing else', () => {
    expect(openingAsk(limits)).toBe(limits.targetMinor);
  });

  test('isSafeToState draws the line at the ceiling', () => {
    expect(isSafeToState(toMinor('600'), limits)).toBe(true);
    expect(isSafeToState(toMinor('650'), limits)).toBe(true);
    expect(isSafeToState(toMinor('650.01'), limits)).toBe(false);
    expect(isSafeToState(toMinor('700'), limits)).toBe(false);
    expect(isSafeToState(toMinor('599'), limits)).toBe(false);
  });

  test('the tuning constants are the documented ones', () => {
    expect(STEP).toBe(0.5);
    expect(CEILING_MARGIN).toBe(0.5);
  });
});
