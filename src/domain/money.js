/**
 * Money, as integers.
 *
 * Every figure in the domain layer is an integer number of MINOR units (paise,
 * cents). Floating point is never used for money: `0.1 + 0.2 !== 0.3` is a
 * rounding error in a language model's answer, but in a negotiation it is a
 * price nobody offered.
 *
 * The database stores DECIMAL(12,2) and the repository layer converts at the
 * boundary. Nothing above this file should ever see a float.
 */

/** Minor units in one major unit. */
export const MINOR = 100;

/** Largest value we accept, chosen to stay well inside DECIMAL(12,2). */
export const MAX_MINOR = 9999999999;

const DECIMAL_PATTERN = /^-?\d+(\.\d{1,2})?$/;

/**
 * Parse a money value into minor units WITHOUT floating point arithmetic.
 *
 * Accepts an integer number of minor units is NOT what this does - it takes a
 * major-unit value ("600", "600.50", 600) and returns minor units (60000,
 * 60050). Strings are parsed digit-by-digit precisely because `600.10 * 100`
 * is 60009.999999999996 in IEEE 754.
 *
 * @param {string|number} value
 * @returns {number} minor units
 */
export function toMinor(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('money: value must be finite');
    // Round-trip through a fixed-precision string so the parsing below - not
    // binary floating point - decides the last digit.
    return toMinor(value.toFixed(2));
  }
  if (typeof value !== 'string') throw new TypeError('money: value must be a string or number');

  const trimmed = value.trim().replace(/,/g, '');
  if (!DECIMAL_PATTERN.test(trimmed)) {
    throw new TypeError(`money: cannot parse "${value}" as a money value`);
  }

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ''] = unsigned.split('.');
  const paddedFraction = (fraction + '00').slice(0, 2);
  const minor = Number(whole) * MINOR + Number(paddedFraction);

  if (!Number.isSafeInteger(minor)) throw new RangeError('money: value out of range');
  return negative ? -minor : minor;
}

/**
 * Render minor units as a plain decimal string, e.g. 60050 -> "600.50".
 * This is the exact form the database column expects.
 *
 * @param {number} minor
 * @returns {string}
 */
export function fromMinor(minor) {
  assertMinor(minor);
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / MINOR);
  const fraction = String(abs % MINOR).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * Human-facing rendering. Kept here so that every displayed figure comes from
 * one place and can be checked against the grounding allow-list.
 *
 * @param {number} minor
 * @param {string} currency ISO 4217 code
 * @returns {string}
 */
export function formatMoney(minor, currency = 'INR') {
  const body = fromMinor(minor);
  const symbol = CURRENCY_SYMBOLS[currency];
  return symbol ? `${symbol}${body}` : `${body} ${currency}`;
}

const CURRENCY_SYMBOLS = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

/**
 * Multiply a unit price by a whole quantity. Both sides are integers, so the
 * result is exact.
 *
 * @param {number} minor
 * @param {number} quantity
 * @returns {number}
 */
export function multiplyMinor(minor, quantity) {
  assertMinor(minor);
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new RangeError('money: quantity must be a non-negative integer');
  }
  const total = minor * quantity;
  if (!Number.isSafeInteger(total)) throw new RangeError('money: total out of range');
  return total;
}

/**
 * Divide a total by a quantity to get a unit price, rounding to the nearest
 * minor unit. Used only when a buyer states a TOTAL budget and a quantity.
 *
 * @param {number} totalMinor
 * @param {number} quantity
 * @returns {number}
 */
export function divideMinor(totalMinor, quantity) {
  assertMinor(totalMinor);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new RangeError('money: quantity must be a positive integer');
  }
  return Math.round(totalMinor / quantity);
}

/** @param {number} minor */
export function assertMinor(minor) {
  if (!Number.isSafeInteger(minor)) throw new TypeError('money: expected an integer of minor units');
  if (Math.abs(minor) > MAX_MINOR) throw new RangeError('money: value out of range');
  return minor;
}

/** True when the value is a usable, positive price. */
export function isPositiveMinor(minor) {
  return Number.isSafeInteger(minor) && minor > 0 && minor <= MAX_MINOR;
}
