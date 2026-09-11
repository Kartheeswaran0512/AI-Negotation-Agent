import {
  openingMessage,
  counterMessage,
  budgetAnswerMessage,
  holdExplanation,
  outcomeExplanation,
  recommendationSummary,
} from '../../src/domain/templates.js';
import { allowedNumbers, checkGrounding } from '../../src/domain/grounding.js';
import { createLimits } from '../../src/domain/limits.js';
import { nextCounter } from '../../src/domain/pricing.js';
import { toMinor } from '../../src/domain/money.js';

const limitsFor = (target, max, quantity = 100, unit = 'pieces') =>
  createLimits({
    product: 'wireless earbuds',
    quantity,
    unit,
    currency: 'INR',
    targetMinor: toMinor(target),
    maxMinor: toMinor(max),
    basis: 'per_unit',
  });

const limits = limitsFor('600', '700');

describe('templates', () => {
  test('the opening message contains no price at all', () => {
    const text = openingMessage({ limits });
    const allowed = allowedNumbers({ limits });
    expect(checkGrounding(text, allowed).ok).toBe(true);
    expect(text).not.toContain('600');
    expect(text).not.toContain('700');
  });

  test('a counter states its own figure and nothing else', () => {
    const counterMinor = nextCounter(toMinor('850'), limits);
    const text = counterMessage({ limits, counterMinor });
    expect(text).toContain('650.00');
    expect(checkGrounding(text, allowedNumbers({ limits, counterMinor })).ok).toBe(true);
  });

  test('a disclosing counter states the target too, and still no ceiling', () => {
    const counterMinor = nextCounter(toMinor('850'), limits);
    const text = counterMessage({ limits, counterMinor, discloseTarget: true });
    expect(text).toContain('600.00');
    expect(text).not.toContain('700');
    expect(
      checkGrounding(text, allowedNumbers({ limits, counterMinor, discloseTarget: true })).ok,
    ).toBe(true);
  });

  test('EVERY TEMPLATE IS GROUNDED BY CONSTRUCTION, across many shapes of buyer', () => {
    const cases = [
      limitsFor('600', '700', 100, 'pieces'),
      limitsFor('600', '600', 100, 'pieces'),
      limitsFor('1200.50', '1500.75', 1, 'unit'),
      limitsFor('12', '19', 0, ''),
      limitsFor('99999', '99999.99', 5000, 'kg'),
    ];

    for (const current of cases) {
      const counterMinor = nextCounter(current.maxMinor * 2, current) ?? current.targetMinor;

      for (const discloseTarget of [false, true]) {
        const allowed = allowedNumbers({ limits: current, counterMinor, discloseTarget });
        for (const text of [
          openingMessage({ limits: current, discloseTarget }),
          counterMessage({ limits: current, counterMinor, discloseTarget }),
          budgetAnswerMessage({ limits: current, counterMinor }),
        ]) {
          const result = checkGrounding(text, allowed);
          expect({ text, offending: result.offending, ok: result.ok }).toEqual({
            text,
            offending: [],
            ok: true,
          });
        }
      }
    }
  });

  test('the budget answer states the authorised figure', () => {
    const text = budgetAnswerMessage({ limits, counterMinor: limits.targetMinor });
    expect(text).toContain('600.00');
    expect(text).not.toContain('700');
  });

  test('hold and outcome explanations are buyer-facing sentences', () => {
    expect(holdExplanation('awaiting_reply')).toMatch(/not replied/i);
    expect(holdExplanation('unknown_reason')).toMatch(/no action/i);
    expect(outcomeExplanation({ outcome: 'target_met', limits, priceMinor: toMinor('580') })).toContain(
      '580.00',
    );
    expect(outcomeExplanation({ outcome: 'declined', limits })).toMatch(/declined/i);
  });

  test('every recommendation says the buyer decides', () => {
    const accept = recommendationSummary(
      { decision: 'accept', priceMinor: toMinor('650') },
      limits,
    );
    expect(accept).toMatch(/decision is yours/i);
    expect(accept).toMatch(/cannot accept on your behalf/i);
  });
});
