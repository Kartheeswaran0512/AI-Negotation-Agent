import { loadConfig } from '../src/config/env.js';
import { quoteDeal } from '../src/payments/convert.js';
import { formatMoney, toMinor } from '../src/domain/money.js';

// 100 units at Rs 570 -> Rs 57000.00 -> $670.59 at the default rate of 85.
const quote = quoteDeal({
  unitPriceMinor: toMinor('570'),
  quantity: 100,
  currency: 'INR',
  inrPerUsd: loadConfig().paypal.inrPerUsd,
});
console.log({
  ...quote,
  deal: formatMoney(quote.dealMinor, quote.dealCurrency),
  charge: formatMoney(quote.chargeMinor, quote.chargeCurrency),
});
