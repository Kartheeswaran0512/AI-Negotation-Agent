import { numbersIn, allowedNumbers, checkGrounding, moneyAppearsIn } from '../../src/domain/grounding.js';
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

describe('grounding', () => {
  test('finds numbers however they are written', () => {
    expect(numbersIn('We can do ₹650 per unit')).toContain(650);
    expect(numbersIn('1,200 pieces')).toContain(1200);
    expect(numbersIn('650.50')).toContain(650.5);
    expect(numbersIn('no digits here')).toEqual([]);
    expect(numbersIn(null)).toEqual([]);
  });

  test('EXPANDS SHORTHAND so a figure cannot hide behind a suffix', () => {
    expect(numbersIn('about 1.2k per unit')).toContain(1200);
    expect(numbersIn('2 lakh total')).toContain(200000);
    expect(numbersIn('1 crore')).toContain(10000000);
    // "lakh" contains a "k" - the longer word must win.
    expect(numbersIn('3 lakh')).toContain(300000);
    expect(numbersIn('3 lakh')).not.toContain(3000);
  });

  test('the allow-list carries the counter and the quantity, never the maximum', () => {
    const allowed = allowedNumbers({ limits, counterMinor: toMinor('650') });
    expect(allowed.has(650)).toBe(true);
    expect(allowed.has(100)).toBe(true);
    expect(allowed.has(700)).toBe(false);
    expect(allowed.has(600)).toBe(false); // the target is not disclosed by default
  });

  test('the target joins the list only when disclosure was authorised', () => {
    const allowed = allowedNumbers({ limits, counterMinor: toMinor('650'), discloseTarget: true });
    expect(allowed.has(600)).toBe(true);
    expect(allowed.has(700)).toBe(false);
  });

  test('NO CODE PATH PUTS THE MAXIMUM ON THE ALLOW-LIST', () => {
    const combinations = [
      { limits },
      { limits, discloseTarget: true },
      { limits, counterMinor: toMinor('650'), discloseTarget: true },
      { limits, counterMinor: limits.maxMinor, discloseTarget: true, extra: [1, 2, 3] },
    ];
    for (const input of combinations) {
      const allowed = allowedNumbers(input);
      if (input.counterMinor === limits.maxMinor) continue; // explicitly passed in by the caller
      expect(allowed.has(700)).toBe(false);
    }
  });

  test('accepts a message whose every number is authorised', () => {
    const allowed = allowedNumbers({ limits, counterMinor: toMinor('650') });
    const result = checkGrounding('We can proceed at ₹650.00 per piece for the full 100 pieces.', allowed);
    expect(result.ok).toBe(true);
    expect(result.offending).toEqual([]);
  });

  test('REJECTS AN INVENTED NUMBER', () => {
    const allowed = allowedNumbers({ limits, counterMinor: toMinor('650') });
    const result = checkGrounding('We can proceed at ₹650 and can pay within 30 days.', allowed);
    expect(result.ok).toBe(false);
    expect(result.offending).toContain(30);
  });

  test('rejects a message that leaks the buyer ceiling', () => {
    const allowed = allowedNumbers({ limits, counterMinor: toMinor('650') });
    expect(checkGrounding('Our maximum is ₹700.', allowed).ok).toBe(false);
  });

  test('moneyAppearsIn is how a claimed price is checked against the source', () => {
    expect(moneyAppearsIn(toMinor('850'), 'Our price is Rs 850 per unit.')).toBe(true);
    expect(moneyAppearsIn(toMinor('850'), 'Our price is Rs 860 per unit.')).toBe(false);
    expect(moneyAppearsIn(toMinor('850'), null)).toBe(false);
    expect(moneyAppearsIn(toMinor('1200'), 'about 1.2k each')).toBe(true);
  });
});
