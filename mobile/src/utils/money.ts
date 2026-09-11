/**
 * Money on the client.
 *
 * The same rule as the backend: arithmetic happens on integer minor units, and
 * a float never touches a price. The server hands us `{minor, amount, display}`
 * precisely so the client never has to parse a rendered string back into a
 * number, and this module keeps that discipline.
 */

import type { Money } from '@/api/types';

export const MINOR = 100;

const DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * Parse a user-typed major-unit amount into minor units, without floating
 * point. "600.10" must not become 60009.999999999996, which is what
 * `Number("600.10") * 100` produces.
 */
export function parseAmountToMinor(input: string): number | null {
  const trimmed = input.trim().replace(/,/g, '');
  if (!DECIMAL_PATTERN.test(trimmed)) return null;

  const [whole = '0', fraction = ''] = trimmed.split('.');
  const padded = (fraction + '00').slice(0, 2);
  const minor = Number(whole) * MINOR + Number(padded);
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Minor units to the plain decimal string the API expects in a request body. */
export function minorToAmount(minor: number): string {
  const negative = minor < 0;
  const absolute = Math.abs(Math.trunc(minor));
  const whole = Math.floor(absolute / MINOR);
  const fraction = String(absolute % MINOR).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

/** Mirrors the server's formatMoney so locally computed totals match the API. */
export function formatMinor(minor: number, currency = 'INR'): string {
  const body = minorToAmount(minor);
  const symbol = CURRENCY_SYMBOLS[currency];
  return symbol ? `${symbol}${body}` : `${body} ${currency}`;
}

/**
 * The order total, as exact integer arithmetic. Used only for display on the
 * acceptance screen - the server never sends a total, and computing one from
 * `amount` as a float would produce a figure nobody offered.
 */
export function multiplyMinor(minor: number, quantity: number): number {
  if (!Number.isSafeInteger(quantity) || quantity < 0) return 0;
  const total = minor * quantity;
  return Number.isSafeInteger(total) ? total : 0;
}

/** Render a Money field, or a dash when the server sent null. */
export function displayMoney(money: Money | null | undefined, fallback = '—'): string {
  return money ? money.display : fallback;
}

/**
 * How far a supplier price sits from the buyer's target, as a signed
 * percentage of the target. Integer-safe: both inputs are minor units.
 */
export function percentAboveTarget(priceMinor: number, targetMinor: number): number | null {
  if (targetMinor <= 0) return null;
  return Math.round(((priceMinor - targetMinor) / targetMinor) * 1000) / 10;
}
