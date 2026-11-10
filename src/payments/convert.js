/**
 * What a deal costs, and what PayPal is asked to charge for it.
 *
 * Integer minor units throughout, like the rest of the project: a float here
 * would be a payment for an amount nobody agreed.
 *
 * PayPal cannot charge INR to most accounts, so an INR deal is charged in USD
 * at DEMO_INR_PER_USD. That is a fixed demo rate, not a market quote - replace
 * it with a real one before taking real money.
 */

import { multiplyMinor, toMinor } from '../domain/money.js';

/** Deal currencies checkout knows how to charge. */
export const SUPPORTED_DEAL_CURRENCIES = Object.freeze(['INR', 'USD']);

/** What PayPal is always asked for. */
export const CHARGE_CURRENCY = 'USD';

/**
 * INR minor units (paise) to USD minor units (cents), rounding half up.
 *
 * @param {number} inrMinor
 * @param {string|number} inrPerUsd e.g. '85' or '83.25'
 * @returns {number} cents
 */
export function inrToUsdMinor(inrMinor, inrPerUsd) {
  // The rate in hundredths (85 -> 8500) keeps the division between integers:
  // cents = paise / rate = paise * 100 / rateHundredths.
  const rateHundredths = toMinor(inrPerUsd);
  if (rateHundredths <= 0) throw new RangeError('exchange rate must be greater than zero');
  const numerator = inrMinor * 100;
  return Math.floor((2 * numerator + rateHundredths) / (2 * rateHundredths));
}

/**
 * The order total in the deal's own currency, and what to charge in USD.
 *
 * @param {object} params
 * @param {number} params.unitPriceMinor  the accepted per-unit price
 * @param {number} params.quantity        a positive whole number
 * @param {string} params.currency        the requirement's currency
 * @param {string|number} params.inrPerUsd
 */
export function quoteDeal({ unitPriceMinor, quantity, currency, inrPerUsd }) {
  if (!SUPPORTED_DEAL_CURRENCIES.includes(currency)) {
    throw new RangeError(`cannot charge a ${currency} deal`);
  }
  const dealMinor = multiplyMinor(unitPriceMinor, quantity);
  const chargeMinor = currency === 'INR' ? inrToUsdMinor(dealMinor, inrPerUsd) : dealMinor;

  return { dealMinor, dealCurrency: currency, chargeMinor, chargeCurrency: CHARGE_CURRENCY };
}
