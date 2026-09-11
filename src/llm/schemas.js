/**
 * What we will accept back from a language model.
 *
 * Two layers, and both are needed. The JSON Schemas are sent to the model as
 * strict tool definitions so the API itself rejects malformed arguments; the
 * Zod schemas re-validate on arrival, because schema-valid is not the same as
 * semantically valid and because a model is not the only thing that can put a
 * value in this code path.
 *
 * Neither layer checks TRUTH. That is `verify.js`, and it is the layer that
 * actually matters.
 */

import { z } from 'zod';

/** Intents the reader may return. Anything else is a rejection. */
export const INTENTS = Object.freeze(['offer', 'question', 'decline', 'accept', 'other']);

export const readingZod = z.object({
  intent: z.enum(INTENTS),
  unit_price: z.number().finite().nullable(),
  quantity: z.number().int().nonnegative().nullable(),
  currency: z.string().max(8).nullable(),
  confidence: z.number().min(0).max(1),
});

export const readingJsonSchema = Object.freeze({
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: [...INTENTS],
      description: 'What the supplier is doing in this message.',
    },
    unit_price: {
      type: ['number', 'null'],
      description:
        'The per-unit price the supplier stated, as a plain number. Null unless a price is literally written in their message.',
    },
    quantity: {
      type: ['integer', 'null'],
      description: 'The quantity the supplier referred to. Null when they did not state one.',
    },
    currency: {
      type: ['string', 'null'],
      description: 'ISO 4217 code when the supplier made the currency explicit, otherwise null.',
    },
    confidence: {
      type: 'number',
      description: 'How confident you are in this reading, from 0 to 1.',
    },
  },
  required: ['intent', 'unit_price', 'quantity', 'currency', 'confidence'],
  additionalProperties: false,
});

export const extractionZod = z.object({
  product: z.string().max(191).nullable(),
  quantity: z.number().int().nonnegative().nullable(),
  unit: z.string().max(32).nullable(),
  currency: z.string().max(8).nullable(),
  target_price: z.number().finite().nullable(),
  max_price: z.number().finite().nullable(),
  price_basis: z.enum(['per_unit', 'total']).nullable(),
  unverified: z.array(z.string().max(64)).max(12),
});

export const extractionJsonSchema = Object.freeze({
  type: 'object',
  properties: {
    product: {
      type: ['string', 'null'],
      description: "What the buyer wants, using only words the buyer actually typed.",
    },
    quantity: { type: ['integer', 'null'], description: 'How many, when the buyer stated it.' },
    unit: { type: ['string', 'null'], description: 'The unit the buyer used, e.g. pieces, kg.' },
    currency: { type: ['string', 'null'], description: 'ISO 4217 code when it is unambiguous.' },
    target_price: {
      type: ['number', 'null'],
      description: 'The price the buyer said they are aiming for. Must be written in their message.',
    },
    max_price: {
      type: ['number', 'null'],
      description: 'The most the buyer said they would pay. Must be written in their message.',
    },
    price_basis: {
      type: ['string', 'null'],
      enum: ['per_unit', 'total', null],
      description:
        'Whether the prices are per unit or for the whole order. Null when the buyer did not make it clear - do not guess.',
    },
    unverified: {
      type: 'array',
      items: { type: 'string' },
      description: 'Names of any fields you were unsure about or had to leave out.',
    },
  },
  required: [
    'product',
    'quantity',
    'unit',
    'currency',
    'target_price',
    'max_price',
    'price_basis',
    'unverified',
  ],
  additionalProperties: false,
});
