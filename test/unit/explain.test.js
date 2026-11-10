import { explainRun } from '../../src/domain/explain.js';
import { createLimits } from '../../src/domain/limits.js';
import { formatMoney, toMinor } from '../../src/domain/money.js';

const limits = createLimits({
  product: 'wireless earbuds',
  quantity: 100,
  unit: 'pieces',
  currency: 'INR',
  targetMinor: toMinor('600'),
  maxMinor: toMinor('700'),
  basis: 'per_unit',
});

const run = (overrides) => ({
  action: 'hold',
  reason: 'awaiting_reply',
  counterPriceMinor: null,
  fellBack: true,
  detail: {},
  ...overrides,
});

describe('why the agent did this', () => {
  test('a counter names both sides of the table', () => {
    const why = explainRun(
      run({ action: 'counter', reason: 'improve_price', counterPriceMinor: 65000, detail: { sellerPriceMinor: 85000 } }),
      limits,
    );
    expect(why.headline).toBe('Countered at ₹650.00');
    expect(why.detail).toMatch(/Their price of ₹850\.00 was higher than you want to pay/);
    expect(why.supplierPriceMinor).toBe(85000);
    expect(why.agentOfferMinor).toBe(65000);
  });

  test('each reason reads as a plain sentence', () => {
    const cases = [
      [{ action: 'open', reason: 'opening' }, 'Opened the negotiation'],
      [{ action: 'counter', reason: 'answering_budget_question', counterPriceMinor: 60000 }, 'Answered their budget question'],
      [{ action: 'end', reason: 'target_met', detail: { sellerPriceMinor: 57000 } }, 'Stopped: your target was met'],
      [{ action: 'end', reason: 'rounds_spent' }, 'Stopped: out of rounds'],
      [{ action: 'end', reason: 'seller_declined' }, 'Stopped: the supplier declined'],
      [{ action: 'escalate', reason: 'needs_human', detail: { injection: 'prompt_injection_suspected' } }, 'Handed to a person'],
      [{ action: 'hold', reason: 'send_limit', detail: { refusal: 'send_limit' } }, 'Held: daily send limit'],
      [{ action: 'hold', reason: 'awaiting_reply' }, 'Waited for their reply'],
    ];
    for (const [overrides, headline] of cases) {
      const why = explainRun(run(overrides), limits);
      expect(why.headline).toBe(headline);
      expect(why.detail.length).toBeGreaterThan(10);
    }
  });

  test('a suspected prompt injection is called what it is', () => {
    const why = explainRun(run({ action: 'escalate', reason: 'needs_human', detail: { injection: 'prompt_injection_suspected' } }), limits);
    expect(why.detail).toMatch(/instructions/);
  });

  test('NEVER STATES THE TARGET OR THE MAXIMUM, whatever the figures are', () => {
    const target = formatMoney(limits.targetMinor, 'INR');
    const maximum = formatMoney(limits.maxMinor, 'INR');
    const figures = [57000, 60000, 60500, 62000, 65000, 70000, 71000, 85000, null];
    const shapes = [
      { action: 'counter', reason: 'improve_price' },
      { action: 'counter', reason: 'answering_budget_question' },
      { action: 'counter', reason: 'improve_price', sellerAskedOurBudget: true },
      { action: 'end', reason: 'target_met' },
      { action: 'end', reason: 'rounds_spent' },
      { action: 'hold', reason: 'awaiting_reply' },
    ];

    for (const shape of shapes) {
      for (const counter of figures) {
        for (const seller of figures) {
          const why = explainRun(
            run({
              action: shape.action,
              reason: shape.reason,
              counterPriceMinor: counter,
              detail: { sellerPriceMinor: seller, sellerAskedOurBudget: Boolean(shape.sellerAskedOurBudget) },
            }),
            limits,
          );
          const said = JSON.stringify(why);
          expect(said).not.toContain(target);
          expect(said).not.toContain(maximum);
          expect([why.supplierPriceMinor, why.agentOfferMinor]).not.toContain(limits.targetMinor);
          expect([why.supplierPriceMinor, why.agentOfferMinor]).not.toContain(limits.maxMinor);
        }
      }
    }
  });

  test('a counter that lands on the target is still explained, just without the figure', () => {
    const why = explainRun(
      run({ action: 'counter', reason: 'improve_price', counterPriceMinor: 60000, detail: { sellerPriceMinor: 61000 } }),
      limits,
    );
    expect(why.headline).toBe('Made a counter-offer');
    expect(why.agentOfferMinor).toBeNull();
    expect(why.supplierPriceMinor).toBe(61000);
  });
});
