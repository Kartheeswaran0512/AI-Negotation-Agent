/**
 * The words on the PayPal invoice raised for a paid deal.
 *
 * Built only from what both sides agreed - product, quantity, the accepted
 * unit price, the total, the rounds it took - never from the buyer's target or
 * maximum, which this function is not even given.
 */

import { formatMoney } from '../domain/money.js';

/**
 * @param {object} deal
 * @param {object} deal.payment       a payment row (PAID)
 * @param {object} deal.requirement   product, quantity, unit
 * @param {object} deal.negotiation   id, round
 * @param {object|null} deal.seller   company or name
 * @param {number} deal.unitPriceMinor the accepted per-unit price
 */
export function describeInvoice({ payment, requirement, negotiation, seller, unitPriceMinor }) {
  const unit = requirement.unit || 'units';
  const rounds = negotiation.round;
  const supplier = seller?.company || seller?.name || 'the supplier';
  const charged =
    payment.currency !== payment.dealCurrency
      ? ` Charged as ${formatMoney(payment.amountMinor, payment.currency)} at a fixed demo exchange rate.`
      : '';

  return {
    invoiceNumber: `NEG-${payment.providerOrderId}`,
    reference: `Negotiation ${negotiation.id}`,
    itemName: `${capitalise(requirement.product)} x ${requirement.quantity} ${unit}`,
    itemDescription:
      `${requirement.quantity} ${unit} of ${requirement.product} at ` +
      `${formatMoney(unitPriceMinor, payment.dealCurrency)} per ${singular(unit)}, ` +
      `${formatMoney(payment.dealAmountMinor, payment.dealCurrency)} in total. ` +
      `Agreed with ${supplier} after ${rounds} negotiation ${rounds === 1 ? 'round' : 'rounds'}.${charged}`,
    note: `Paid through PayPal: order ${payment.providerOrderId}${payment.captureId ? `, capture ${payment.captureId}` : ''}.`,
  };
}

function capitalise(text) {
  const value = String(text ?? '');
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

/** "pieces" reads better as "piece" after a price. */
function singular(unit) {
  const trimmed = unit.trim();
  if (/ss$/i.test(trimmed)) return trimmed;
  return /s$/i.test(trimmed) ? trimmed.slice(0, -1) : trimmed;
}
