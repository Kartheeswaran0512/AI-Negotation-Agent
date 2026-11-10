// Creates one real order against the PayPal API in PAYPAL_ENV (sandbox by
// default) and prints the approval link. Nothing is charged until someone
// approves it and the app captures it.
import { loadConfig } from '../src/config/env.js';
import { createPayPalClient } from '../src/payments/paypal.js';

const config = loadConfig();
if (!config.paypal.enabled) {
  console.error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env first.');
  process.exit(1);
}

const paypal = createPayPalClient(config.paypal);
const reference = `test-${Date.now()}`;
const order = await paypal.createOrder({
  amountMinor: 1000, // $10.00
  currency: 'USD',
  description: 'Test deal',
  referenceId: reference,
  requestId: reference,
  returnUrl: config.paypal.returnUrl,
  cancelUrl: config.paypal.cancelUrl,
});
console.log({ env: config.paypal.env, ...order });
