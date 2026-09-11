import { asksOurBudget, disclosurePolicy } from '../../src/domain/disclosure.js';

describe('disclosure', () => {
  test.each([
    "What's your budget?",
    'What is your budget for this order?',
    'May I know your target price?',
    'Please share your expected price.',
    'How much can you pay per unit?',
    'What are you looking to pay?',
    'Let me know your price range.',
    "What's your best price?",
    'Our rate is 850. What is your budget?',
  ])('asks for our budget: %s', (text) => {
    expect(asksOurBudget(text)).toBe(true);
  });

  test.each([
    'Our price is 850 per unit.',
    'My best price is 820.',
    'We can supply 100 pieces next week.',
    'What quantity do you need?',
    'When do you need delivery?',
    'Can you confirm the specification?',
    'Thanks for your enquiry.',
    '',
    null,
    undefined,
  ])('does not ask for our budget: %s', (text) => {
    expect(asksOurBudget(text)).toBe(false);
  });

  test('a first-person sentence with no second person is about their side', () => {
    expect(asksOurBudget('Can we hold our price at 850?')).toBe(false);
  });

  test('the policy never authorises the maximum, whatever was asked', () => {
    expect(disclosurePolicy({ sellerAskedOurBudget: true })).toEqual({ target: true, maximum: false });
    expect(disclosurePolicy({ sellerAskedOurBudget: false })).toEqual({ target: false, maximum: false });
  });
});
