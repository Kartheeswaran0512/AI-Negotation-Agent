/**
 * The agent's tool surface.
 *
 * Every effect the agent can have on the world is one of these eight tools.
 * Each has a schema, is validated on entry, and is the only route to the
 * capability it names - which makes "what can this agent do?" a question with a
 * short, complete answer.
 *
 * THERE IS NO accept_deal TOOL, and the absence is enforced by a test. The
 * agent cannot commit the buyer to anything, and it cannot do so by mistake,
 * because the capability is not on the list. Acceptance lives on a
 * buyer-authenticated HTTP route.
 *
 * `send_message` deliberately does NOT take a message body. A tool that accepts
 * arbitrary text is a tool through which a model writes, unchecked, to a real
 * company; instead the tool triggers the guarded pipeline, which decides the
 * content deterministically, phrases it, checks the phrasing, claims an
 * idempotency key, and only then sends.
 */

import { z } from 'zod';

import { nextCounter, askCeiling } from '../../domain/pricing.js';
import { verdictFor } from '../../domain/verdict.js';
import { STATE } from '../../domain/machine.js';
import { formatMoney } from '../../domain/money.js';
import { limitsFor } from '../../services/recommendService.js';

/** Names this project will never expose. Asserted in the tests. */
export const FORBIDDEN_TOOL_NAMES = Object.freeze([
  'accept_deal',
  'accept_offer',
  'finalise_deal',
  'finalize_deal',
  'sign_contract',
  'place_order',
]);

const negotiationRef = z.object({ negotiation_id: z.union([z.number().int(), z.string()]) });

export class ToolError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ToolError';
    this.status = status;
  }
}

/**
 * @param {object} deps
 * @param {object} deps.services
 * @param {import('../../repositories/types.js').Repositories} deps.repositories
 */
export function createToolRegistry({ services, repositories }) {
  /** @type {Record<string, {description: string, input: z.ZodTypeAny, jsonSchema: object, handler: Function}>} */
  const tools = {
    get_requirement: {
      description: "Read the buyer's requirement and negotiating limits.",
      input: z.object({ requirement_id: z.union([z.number().int(), z.string()]) }),
      jsonSchema: objectSchema({ requirement_id: { type: ['integer', 'string'] } }, ['requirement_id']),
      async handler({ requirement_id: requirementId }) {
        const requirement = await repositories.requirements.findById(requirementId);
        if (!requirement) throw new ToolError('requirement not found', 404);
        const limits = limitsFor(requirement);
        return {
          requirement_id: requirement.id,
          product: limits.product,
          quantity: limits.quantity,
          unit: limits.unit,
          currency: limits.currency,
          target: formatMoney(limits.targetMinor, limits.currency),
          // The ceiling is reported to the BUYER's own tooling, never put in a
          // message: `allowedNumbers` has no path that authorises it outbound.
          maximum: formatMoney(limits.maxMinor, limits.currency),
          price_basis: limits.basis,
          status: requirement.status,
        };
      },
    },

    get_thread: {
      description: 'Read the message history of one negotiation.',
      input: negotiationRef,
      jsonSchema: objectSchema({ negotiation_id: { type: ['integer', 'string'] } }, ['negotiation_id']),
      async handler({ negotiation_id: negotiationId }) {
        const { negotiation, messages } = await services.negotiations.thread(negotiationId);
        return {
          negotiation_id: negotiation.id,
          state: negotiation.state,
          round: negotiation.round,
          max_rounds: negotiation.maxRounds,
          messages: messages.map((message) => ({
            id: message.id,
            author: message.author,
            kind: message.kind,
            body: message.body,
            created_at: message.createdAt,
          })),
        };
      },
    },

    propose_counter: {
      description:
        'Compute the next counter-offer for a negotiation. Pure arithmetic over the buyer\'s limits and the supplier\'s stated price. Sends nothing.',
      input: negotiationRef,
      jsonSchema: objectSchema({ negotiation_id: { type: ['integer', 'string'] } }, ['negotiation_id']),
      async handler({ negotiation_id: negotiationId }) {
        const negotiation = await repositories.negotiations.findById(negotiationId);
        if (!negotiation) throw new ToolError('negotiation not found', 404);
        const requirement = await repositories.requirements.findById(negotiation.requirementId);
        const limits = limitsFor(requirement);

        const counter = nextCounter(negotiation.currentSellerPriceMinor, limits);
        return {
          negotiation_id: negotiation.id,
          supplier_price:
            negotiation.currentSellerPriceMinor === null
              ? null
              : formatMoney(negotiation.currentSellerPriceMinor, limits.currency),
          verdict: verdictFor(negotiation.currentSellerPriceMinor, limits),
          counter: counter === null ? null : formatMoney(counter, limits.currency),
          highest_the_agent_may_ever_offer: formatMoney(askCeiling(limits), limits.currency),
        };
      },
    },

    send_message: {
      description:
        "Run the agent's guarded send pipeline for one negotiation. Takes no message body: the content is decided deterministically, phrased, checked and de-duplicated before anything is sent.",
      input: negotiationRef,
      jsonSchema: objectSchema({ negotiation_id: { type: ['integer', 'string'] } }, ['negotiation_id']),
      async handler({ negotiation_id: negotiationId }, context = {}) {
        const result = await services.negotiations.tick({
          negotiationId,
          triggerSource: context.triggerSource ?? 'tool',
          correlationId: context.correlationId ?? null,
        });
        return {
          negotiation_id: negotiationId,
          action: result.action.kind,
          reason: result.action.reason,
          state: result.state,
          sent: Boolean(result.message),
          message_id: result.message?.id ?? null,
          generated_by: result.generatedBy,
        };
      },
    },

    record_offer: {
      description: 'Record a price a supplier stated, when it arrived outside the message thread.',
      input: z.object({
        negotiation_id: z.union([z.number().int(), z.string()]),
        unit_price_minor: z.number().int().positive(),
        quantity: z.number().int().positive().nullable().optional(),
      }),
      jsonSchema: objectSchema(
        {
          negotiation_id: { type: ['integer', 'string'] },
          unit_price_minor: { type: 'integer' },
          quantity: { type: ['integer', 'null'] },
        },
        ['negotiation_id', 'unit_price_minor'],
      ),
      async handler(input) {
        const negotiation = await repositories.negotiations.findById(input.negotiation_id);
        if (!negotiation) throw new ToolError('negotiation not found', 404);
        const requirement = await repositories.requirements.findById(negotiation.requirementId);
        const limits = limitsFor(requirement);

        const offer = await repositories.offers.record({
          negotiationId: negotiation.id,
          actor: 'seller',
          unitPriceMinor: input.unit_price_minor,
          quantity: input.quantity ?? null,
          currency: limits.currency,
        });
        await repositories.negotiations.update(
          negotiation.id,
          { currentSellerPriceMinor: input.unit_price_minor },
          negotiation.version,
        );
        return { offer_id: offer.id, verdict: verdictFor(input.unit_price_minor, limits) };
      },
    },

    flag_for_human: {
      description: 'Stop the agent on this negotiation and hand it to a person.',
      input: z.object({
        negotiation_id: z.union([z.number().int(), z.string()]),
        reason: z.string().min(1).max(64),
      }),
      jsonSchema: objectSchema(
        { negotiation_id: { type: ['integer', 'string'] }, reason: { type: 'string' } },
        ['negotiation_id', 'reason'],
      ),
      async handler(input) {
        const negotiation = await repositories.negotiations.findById(input.negotiation_id);
        if (!negotiation) throw new ToolError('negotiation not found', 404);
        await repositories.negotiations.update(
          negotiation.id,
          { state: STATE.ESCALATED, outcome: 'escalated' },
          negotiation.version,
        );
        return { negotiation_id: negotiation.id, state: STATE.ESCALATED, reason: input.reason };
      },
    },

    end_negotiation: {
      description: 'Close a negotiation with a stated outcome. Never an acceptance.',
      input: z.object({
        negotiation_id: z.union([z.number().int(), z.string()]),
        outcome: z.enum(['declined', 'rounds_spent', 'target_met']),
      }),
      jsonSchema: objectSchema(
        {
          negotiation_id: { type: ['integer', 'string'] },
          outcome: { type: 'string', enum: ['declined', 'rounds_spent', 'target_met'] },
        },
        ['negotiation_id', 'outcome'],
      ),
      async handler(input) {
        const negotiation = await repositories.negotiations.findById(input.negotiation_id);
        if (!negotiation) throw new ToolError('negotiation not found', 404);

        const stateByOutcome = {
          declined: STATE.DECLINED,
          rounds_spent: STATE.ROUNDS_SPENT,
          target_met: STATE.TARGET_MET,
        };

        await repositories.negotiations.update(
          negotiation.id,
          { state: stateByOutcome[input.outcome], outcome: input.outcome },
          negotiation.version,
        );
        return { negotiation_id: negotiation.id, state: stateByOutcome[input.outcome] };
      },
    },

    recommend: {
      description:
        'Produce a recommendation for the buyer: accept, reject or continue. A recommendation only - the buyer decides.',
      input: z.object({ requirement_id: z.union([z.number().int(), z.string()]) }),
      jsonSchema: objectSchema({ requirement_id: { type: ['integer', 'string'] } }, ['requirement_id']),
      async handler({ requirement_id: requirementId }) {
        const recommendation = await services.recommendations.refresh(requirementId);
        if (!recommendation) throw new ToolError('requirement not found', 404);
        return {
          decision: recommendation.decision,
          rationale: recommendation.rationale,
          summary: recommendation.summary,
          negotiation_id: recommendation.negotiationId,
          // Stated plainly on every recommendation, because it is the one
          // sentence that describes this system's limit.
          note: 'The agent cannot accept on the buyer\'s behalf.',
        };
      },
    },
  };

  for (const forbidden of FORBIDDEN_TOOL_NAMES) {
    if (forbidden in tools) {
      throw new Error(`tool registry: "${forbidden}" must not exist in this system`);
    }
  }

  return {
    names: Object.keys(tools),

    /** Definitions in the shape a model tool-calling loop would want. */
    definitions() {
      return Object.entries(tools).map(([name, tool]) => ({
        name,
        description: tool.description,
        input_schema: tool.jsonSchema,
      }));
    },

    /**
     * @param {string} name
     * @param {object} input
     * @param {object} [context]
     */
    async run(name, input, context = {}) {
      const tool = tools[name];
      if (!tool) throw new ToolError(`unknown tool: ${name}`, 404);

      const parsed = tool.input.safeParse(input ?? {});
      if (!parsed.success) {
        throw new ToolError(
          `invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
          422,
        );
      }
      return tool.handler(parsed.data, context);
    },
  };
}

function objectSchema(properties, required) {
  return { type: 'object', properties, required, additionalProperties: false };
}
