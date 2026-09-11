import { createRulesAdapter, extractUnitPrice, extractQuantity } from '../../src/llm/rulesAdapter.js';

const adapter = createRulesAdapter();

describe('rules adapter: price reading', () => {
  test.each([
    ['Our price is Rs 850 per unit.', 850],
    ['We can offer ₹640 each.', 640],
    ['We can supply 100 pieces at 820 per unit.', 820],
    ['100 units at $12.50 each', 12.5],
    ['Best we can do is 1,200/- per piece', 1200],
    ['We can do 780.', 780],
  ])('reads a unit price out of: %s', (text, expected) => {
    expect(extractUnitPrice(text)).toBe(expected);
  });

  test('prefers the price over the quantity when both are present', () => {
    expect(extractUnitPrice('We can supply 100 units at 850 each.')).toBe(850);
    expect(extractQuantity('We can supply 100 units at 850 each.')).toBe(100);
  });

  test('returns null when there is no number at all', () => {
    expect(extractUnitPrice('We will get back to you shortly.')).toBeNull();
    expect(extractUnitPrice('')).toBeNull();
    expect(extractUnitPrice(null)).toBeNull();
  });
});

describe('rules adapter: intent', () => {
  const intentOf = async (text) => (await adapter.readSellerMessage({ text })).reading.intent;

  test('a refusal to supply is a decline', async () => {
    await expect(intentOf('Sorry, we cannot supply this item.')).resolves.toBe('decline');
    await expect(intentOf('We regret that we must decline.')).resolves.toBe('decline');
    await expect(intentOf('That item is out of stock.')).resolves.toBe('decline');
  });

  test('REFUSING A PRICE IS NOT REFUSING TO SUPPLY', async () => {
    // The distinction that matters: this is a counter, not a decline.
    await expect(intentOf("We can't go below 800 on this.")).resolves.not.toBe('decline');
  });

  test('a price is an offer, a bare question is a question', async () => {
    await expect(intentOf('We can offer Rs 780 per unit.')).resolves.toBe('offer');
    await expect(intentOf('What quantity do you need?')).resolves.toBe('question');
    await expect(intentOf('Thanks, noted.')).resolves.toBe('other');
  });

  test('an agreement reads as accept', async () => {
    await expect(intentOf('We accept your offer.')).resolves.toBe('accept');
  });
});

describe('rules adapter: requirement extraction', () => {
  test('reads the brief example', async () => {
    const { extraction } = await adapter.extractRequirement({
      text: 'I need 100 wireless earbuds. My target is 600 per unit and my maximum budget is 700 per unit.',
    });
    expect(extraction.quantity).toBe(100);
    expect(extraction.target_price).toBe(600);
    expect(extraction.max_price).toBe(700);
    expect(extraction.price_basis).toBe('per_unit');
    expect(extraction.product).toContain('wireless earbuds');
  });

  test('NAMES WHAT IT COULD NOT FIND rather than guessing', async () => {
    const { extraction } = await adapter.extractRequirement({ text: 'I need some earbuds.' });
    expect(extraction.unverified).toEqual(
      expect.arrayContaining(['target_price', 'max_price', 'price_basis']),
    );
  });

  test('does not invent a price basis from an ambiguous budget', async () => {
    const { extraction } = await adapter.extractRequirement({
      text: 'I want 5 chairs, budget 10000.',
    });
    expect(extraction.price_basis).toBeNull();
    expect(extraction.unverified).toContain('price_basis');
  });
});

describe('rules adapter: what it will not do', () => {
  test('it cannot write prose, and says so by returning null', async () => {
    await expect(adapter.phraseMessage({})).resolves.toEqual({ text: null, usage: {} });
    await expect(adapter.explainOutcome({})).resolves.toEqual({ text: null, usage: {} });
  });

  test('repeated scans are not affected by regex lastIndex', async () => {
    const text = 'We can offer ₹640 each.';
    for (let i = 0; i < 5; i += 1) {
      expect(extractUnitPrice(text)).toBe(640);
    }
  });
});
