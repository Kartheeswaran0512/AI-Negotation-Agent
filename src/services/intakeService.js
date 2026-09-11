/**
 * Turning what a buyer wants into a requirement the agent can act on.
 *
 * Two doors. `createRequirement` takes structured input and is the one the API
 * and the tests use. `readRequirementText` takes free text, asks the
 * interpreter to read it, and returns a DRAFT reading plus the list of fields
 * it could not verify - it deliberately does not create anything, because a
 * misread requirement is not a typo, it is an enquiry sent to real companies
 * for the wrong product at the wrong price.
 *
 * The buyer confirms; the model never does.
 */

import { createLimits, PRICE_BASIS } from '../domain/limits.js';

export class ValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'ValidationError';
    this.status = 422;
    this.details = details;
  }
}

/**
 * @param {object} deps
 * @param {import('../repositories/types.js').Repositories} deps.repositories
 * @param {object} deps.interpreter
 */
export function createIntakeService({ repositories, interpreter }) {
  /**
   * @param {object} input already-structured, already-confirmed
   */
  async function createRequirement(input) {
    const buyer = await repositories.users.findById(input.buyerId);
    if (!buyer) throw new ValidationError('buyer not found');
    if (buyer.role !== 'buyer') throw new ValidationError('that user is not a buyer');

    // Building the limits is the validation: createLimits refuses an inverted
    // band, a non-positive target, and a total-basis budget with no quantity.
    let limits;
    try {
      limits = createLimits({
        product: input.product,
        quantity: input.quantity ?? 0,
        unit: input.unit,
        currency: input.currency,
        targetMinor: input.targetPriceMinor,
        maxMinor: input.maxPriceMinor,
        basis: input.priceBasis,
      });
    } catch (error) {
      throw new ValidationError(error.message);
    }

    const requirement = await repositories.requirements.create({
      buyerId: input.buyerId,
      product: input.product.trim(),
      quantity: input.quantity ?? 0,
      unit: input.unit ?? null,
      currency: limits.currency,
      targetPriceMinor: input.targetPriceMinor,
      maxPriceMinor: input.maxPriceMinor,
      priceBasis: input.priceBasis,
      status: 'active',
      sourceText: input.sourceText ?? null,
    });

    return { requirement, limits };
  }

  /**
   * Read free text into a proposed requirement. Creates nothing.
   *
   * @param {object} params
   * @param {string} params.text
   * @returns {Promise<{reading: object|null, unverified: string[], ready: boolean, question: string|null, source: string}>}
   */
  async function readRequirementText({ text }) {
    const { extraction, unverified, source, fellBack } = await interpreter.extract({ text });

    if (!extraction) {
      return {
        reading: null,
        unverified: ['product', 'target_price', 'max_price', 'price_basis'],
        ready: false,
        question: 'What product are you looking to source, and at what price?',
        source,
        fellBack,
      };
    }

    const missing = [];
    if (!extraction.product) missing.push('product');
    if (extraction.targetPriceMinor === null) missing.push('target_price');
    if (extraction.maxPriceMinor === null) missing.push('max_price');
    if (!extraction.priceBasis) missing.push('price_basis');
    if (extraction.priceBasis === PRICE_BASIS.TOTAL && !extraction.quantity) missing.push('quantity');

    return {
      reading: extraction,
      unverified: [...new Set([...unverified, ...missing])],
      ready: missing.length === 0,
      question: questionFor(missing),
      source,
      fellBack,
    };
  }

  return { createRequirement, readRequirementText };
}

function questionFor(missing) {
  if (missing.length === 0) return null;
  if (missing.includes('product')) return 'What product or service are you looking to source?';
  if (missing.includes('price_basis')) {
    return 'Is that price per unit, or for the whole order?';
  }
  if (missing.includes('quantity')) return 'How many units do you need?';
  if (missing.includes('target_price')) return 'What price are you aiming for?';
  if (missing.includes('max_price')) return 'What is the most you would pay?';
  return 'Could you confirm the details of your requirement?';
}
