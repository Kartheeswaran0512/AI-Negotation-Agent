/**
 * Whole negotiations, end to end, against simulated suppliers.
 *
 * These drive the real services, the real decision core and the real fences -
 * only the store and the supplier are simulated. They are the closest thing to
 * production traffic this project has, and they are where the invariants that
 * matter get asserted: never above the ceiling, never more messages than
 * rounds, never a duplicate, never an acceptance.
 */

import { createWorld, playNegotiation } from '../../src/simulation/harness.js';
import {
  stubbornSeller,
  gradualSeller,
  instantTargetSeller,
  questioningSeller,
  decliningSeller,
  injectingSeller,
  silentSeller,
  ALL_PERSONAS,
} from '../../src/simulation/mockSellers.js';
import { numbersIn } from '../../src/domain/grounding.js';
import { TERMINAL_STATES } from '../../src/domain/machine.js';

const TARGET = 600;
const MAXIMUM = 700;
const CEILING = 650; // the midpoint: the highest figure the agent may ever name

describe('scenario: stubborn supplier', () => {
  test('the round cap stops the agent, and it never exceeds the ceiling', async () => {
    const world = await createWorld();
    const result = await playNegotiation({ world, seller: stubbornSeller() });

    expect(result.negotiation.state).toBe('ROUNDS_SPENT');
    expect(result.negotiation.round).toBe(world.config.agent.maxRounds);
    expect(result.agentMessages.length).toBe(world.config.agent.maxRounds);

    for (const message of result.agentMessages) {
      if (message.priceMinor === null) continue;
      expect(message.priceMinor).toBeLessThanOrEqual(CEILING * 100);
    }
    expect(result.recommendation.decision).toBe('reject');
  });
});

describe('scenario: supplier who discounts gradually', () => {
  test('the negotiation converges and stops the moment the target is beaten', async () => {
    const world = await createWorld();
    const result = await playNegotiation({ world, seller: gradualSeller() });

    expect(result.negotiation.state).toBe('TARGET_MET');
    expect(result.negotiation.currentSellerPriceMinor).toBeLessThanOrEqual(TARGET * 100);
    expect(result.recommendation.decision).toBe('accept');

    // Successive counters converge rather than repeating one refused number.
    const counters = result.agentMessages
      .map((message) => message.priceMinor)
      .filter((price) => price !== null);
    for (let index = 1; index < counters.length; index += 1) {
      expect(counters[index]).toBeLessThanOrEqual(counters[index - 1]);
    }
  });
});

describe('scenario: supplier who meets the target immediately', () => {
  test('one message out, one in, and it is over', async () => {
    const world = await createWorld();
    const result = await playNegotiation({ world, seller: instantTargetSeller() });

    expect(result.negotiation.state).toBe('TARGET_MET');
    expect(result.agentMessages).toHaveLength(1); // the opener only
    expect(result.recommendation.decision).toBe('accept');
    expect(result.recommendation.priceMinor).toBe(TARGET * 100);
  });
});

describe('scenario: supplier who asks what we will pay', () => {
  test('the question is answered with the target, and only because they asked', async () => {
    const world = await createWorld();
    const result = await playNegotiation({ world, seller: questioningSeller() });

    const answer = result.agentMessages[1];
    expect(answer.body).toContain('600.00');
    expect(answer.body).not.toContain('700');

    // The opener, sent before any question, discloses nothing.
    expect(result.agentMessages[0].body).not.toContain('600');
    expect(result.negotiation.state).toBe('TARGET_MET');
  });
});

describe('scenario: supplier who declines', () => {
  test('the negotiation closes as declined, not as a failure to negotiate', async () => {
    const world = await createWorld();
    const result = await playNegotiation({ world, seller: decliningSeller() });

    expect(result.negotiation.state).toBe('DECLINED');
    expect(result.negotiation.outcome).toBe('declined');
    expect(result.agentMessages).toHaveLength(1);
    expect(result.recommendation.decision).toBe('reject');
  });
});

describe('scenario: supplier attempting a prompt injection', () => {
  test('THE AGENT STOPS AND HANDS IT TO A HUMAN', async () => {
    const world = await createWorld();
    const result = await playNegotiation({ world, seller: injectingSeller() });

    expect(result.negotiation.state).toBe('ESCALATED');
    expect(result.negotiation.outcome).toBe('escalated');
  });

  test('the injected price never becomes a fact', async () => {
    const world = await createWorld();
    const result = await playNegotiation({ world, seller: injectingSeller() });

    expect(result.negotiation.currentSellerPriceMinor).toBeNull();

    const offers = await world.repositories.offers.listByNegotiation(result.negotiation.id);
    expect(offers).toHaveLength(0);

    // And the agent said nothing back to it.
    expect(result.agentMessages).toHaveLength(1); // the opener, sent before the injection arrived
  });

  test('the audit trail records why', async () => {
    const world = await createWorld();
    const result = await playNegotiation({ world, seller: injectingSeller() });

    const escalation = result.runs.find((run) => run.action === 'escalate');
    expect(escalation.reason).toBe('prompt_injection_suspected');
    expect(escalation.detail.injection).toBe('prompt_injection_suspected');
  });
});

describe('scenario: silent supplier', () => {
  test('the agent opens once and then waits, without chasing', async () => {
    const world = await createWorld();
    const result = await playNegotiation({ world, seller: silentSeller() });

    expect(result.agentMessages).toHaveLength(1);
    expect(result.negotiation.state).toBe('AWAITING_REPLY');
    expect(result.negotiation.round).toBe(1);
  });

  test('further ticks change nothing at all', async () => {
    const world = await createWorld();
    const result = await playNegotiation({ world, seller: silentSeller() });

    for (let index = 0; index < 4; index += 1) {
      const tick = await world.services.negotiations.tick({ negotiationId: result.negotiation.id });
      expect(tick.action.kind).toBe('hold');
      expect(tick.action.reason).toBe('awaiting_reply');
    }

    const messages = await world.repositories.messages.listByNegotiation(result.negotiation.id);
    expect(messages.filter((message) => message.author === 'agent')).toHaveLength(1);
  });
});

describe('invariants across every persona', () => {
  test('NO OUTBOUND MESSAGE EVER CONTAINS THE BUYER CEILING', async () => {
    const world = await createWorld();
    for (const persona of ALL_PERSONAS) {
      const result = await playNegotiation({ world, seller: persona() });
      for (const message of result.agentMessages) {
        expect(numbersIn(message.body)).not.toContain(MAXIMUM);
        expect(message.priceMinor === null || message.priceMinor < MAXIMUM * 100).toBe(true);
      }
    }
  });

  test('the agent never sends more messages than it has rounds', async () => {
    const world = await createWorld();
    for (const persona of ALL_PERSONAS) {
      const result = await playNegotiation({ world, seller: persona() });
      expect(result.agentMessages.length).toBeLessThanOrEqual(world.config.agent.maxRounds);
      expect(result.negotiation.round).toBe(result.agentMessages.length);
    }
  });

  test('NO NEGOTIATION IS EVER ACCEPTED BY THE AGENT', async () => {
    const world = await createWorld();
    for (const persona of ALL_PERSONAS) {
      const result = await playNegotiation({ world, seller: persona() });

      expect(result.messages.some((message) => message.kind === 'accept')).toBe(false);
      expect(result.messages.some((message) => message.author === 'buyer')).toBe(false);
      expect(result.runs.some((run) => run.action === 'accept')).toBe(false);
      expect(result.negotiation.outcome).not.toBe('accepted_by_buyer');
    }
  });

  test('every tick leaves an audit row with a reason', async () => {
    const world = await createWorld();
    for (const persona of ALL_PERSONAS) {
      const result = await playNegotiation({ world, seller: persona() });
      expect(result.runs.length).toBe(result.ticks.length);
      for (const run of result.runs) {
        expect(typeof run.reason).toBe('string');
        expect(run.reason.length).toBeGreaterThan(0);
        expect(run.stateBefore).toBeTruthy();
        expect(run.stateAfter).toBeTruthy();
      }
    }
  });

  test('one message is sent per outbox claim, and no claim is used twice', async () => {
    const world = await createWorld();
    for (const persona of ALL_PERSONAS) {
      const result = await playNegotiation({ world, seller: persona() });
      const keys = new Set();
      for (const message of result.agentMessages) {
        const key = `neg:${result.negotiation.id}:reply:${message.inReplyTo ?? 'open'}`;
        expect(keys.has(key)).toBe(false);
        keys.add(key);
      }
    }
  });

  test('a finished negotiation is in a terminal state or waiting on the supplier', async () => {
    const world = await createWorld();
    for (const persona of ALL_PERSONAS) {
      const result = await playNegotiation({ world, seller: persona() });
      const acceptable = [...TERMINAL_STATES, 'AWAITING_REPLY'];
      expect(acceptable).toContain(result.negotiation.state);
    }
  });
});

describe('invariants across many buyer bands and supplier paths', () => {
  test('the counter is always within [target, ceiling) whatever the supplier does', async () => {
    const world = await createWorld();

    const bands = [
      { target: '600', max: '700' },
      { target: '1000', max: '1000' },
      { target: '15', max: '19' },
      { target: '2500.50', max: '4000.75' },
    ];

    for (const band of bands) {
      const ladder = [9999, 4000, 1500, 900, 700, 620, 601];
      let index = 0;
      const seller = {
        name: `sweep-${band.target}`,
        reply: () => {
          const price = ladder[Math.min(index, ladder.length - 1)];
          index += 1;
          return `We can do Rs ${price} per unit.`;
        },
      };

      const result = await playNegotiation({
        world,
        seller,
        requirement: { target: band.target, max: band.max },
      });

      const targetMinor = Math.round(Number(band.target) * 100);
      const maxMinor = Math.round(Number(band.max) * 100);
      const ceilingMinor = targetMinor + Math.floor((maxMinor - targetMinor) / 2);

      for (const message of result.agentMessages) {
        if (message.priceMinor === null) continue;
        expect(message.priceMinor).toBeGreaterThanOrEqual(targetMinor);
        expect(message.priceMinor).toBeLessThanOrEqual(ceilingMinor);
      }
    }
  });
});
