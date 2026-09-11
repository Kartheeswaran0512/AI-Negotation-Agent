import { createToolRegistry, FORBIDDEN_TOOL_NAMES, ToolError } from '../../src/agent/tools/index.js';
import { createWorld } from '../../src/simulation/harness.js';
import { toMinor } from '../../src/domain/money.js';

async function setup() {
  const world = await createWorld();
  const seller = await world.repositories.users.create({
    role: 'seller',
    name: 'Tool Seller',
    email: `tools-${Math.random().toString(36).slice(2)}@example.test`,
  });
  const { requirement } = await world.services.intake.createRequirement({
    buyerId: world.buyer.id,
    product: 'wireless earbuds',
    quantity: 100,
    unit: 'pieces',
    currency: 'INR',
    targetPriceMinor: toMinor('600'),
    maxPriceMinor: toMinor('700'),
    priceBasis: 'per_unit',
  });
  const negotiation = await world.services.negotiations.open({
    requirementId: requirement.id,
    sellerId: seller.id,
  });
  return { world, requirement, negotiation, tools: world.tools };
}

describe('tool registry', () => {
  test('THERE IS NO ACCEPTANCE TOOL, UNDER ANY NAME', async () => {
    const { tools } = await setup();
    for (const forbidden of FORBIDDEN_TOOL_NAMES) {
      expect(tools.names).not.toContain(forbidden);
    }
    await expect(tools.run('accept_deal', {})).rejects.toThrow(ToolError);
  });

  test('exposes exactly the eight sanctioned tools', async () => {
    const { tools } = await setup();
    expect(tools.names.sort()).toEqual(
      [
        'end_negotiation',
        'flag_for_human',
        'get_requirement',
        'get_thread',
        'propose_counter',
        'recommend',
        'record_offer',
        'send_message',
      ].sort(),
    );
  });

  test('every definition carries a strict object schema', async () => {
    const { tools } = await setup();
    for (const definition of tools.definitions()) {
      expect(definition.input_schema.type).toBe('object');
      expect(definition.input_schema.additionalProperties).toBe(false);
      expect(Array.isArray(definition.input_schema.required)).toBe(true);
      expect(definition.description.length).toBeGreaterThan(10);
    }
  });

  test('rejects an unknown tool and invalid input', async () => {
    const { tools } = await setup();
    await expect(tools.run('definitely_not_a_tool', {})).rejects.toThrow(/unknown tool/);
    await expect(tools.run('get_requirement', {})).rejects.toThrow(/invalid input/);
    await expect(tools.run('record_offer', { negotiation_id: 1, unit_price_minor: -5 })).rejects.toThrow(
      /invalid input/,
    );
  });

  test('get_requirement reports the limits without putting the ceiling on the wire', async () => {
    const { tools, requirement } = await setup();
    const result = await tools.run('get_requirement', { requirement_id: requirement.id });
    expect(result.target).toBe('₹600.00');
    expect(result.maximum).toBe('₹700.00');
    expect(result.price_basis).toBe('per_unit');
  });

  test('propose_counter computes without sending anything', async () => {
    const { tools, negotiation, world } = await setup();
    await world.repositories.negotiations.update(
      negotiation.id,
      { currentSellerPriceMinor: toMinor('850') },
      undefined,
    );

    const result = await tools.run('propose_counter', { negotiation_id: negotiation.id });
    expect(result.counter).toBe('₹650.00');
    expect(result.highest_the_agent_may_ever_offer).toBe('₹650.00');
    expect(result.verdict).toBe('over_budget');

    const messages = await world.repositories.messages.listByNegotiation(negotiation.id);
    expect(messages).toHaveLength(0);
  });

  test('SEND_MESSAGE TAKES NO BODY - the model cannot dictate what is said', async () => {
    const { tools } = await setup();
    const definition = tools.definitions().find((entry) => entry.name === 'send_message');
    expect(Object.keys(definition.input_schema.properties)).toEqual(['negotiation_id']);
  });

  test('send_message runs the guarded pipeline and reports what happened', async () => {
    const { tools, negotiation, world } = await setup();
    const result = await tools.run('send_message', { negotiation_id: negotiation.id });

    expect(result.action).toBe('open');
    expect(result.sent).toBe(true);

    const messages = await world.repositories.messages.listByNegotiation(negotiation.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].author).toBe('agent');
  });

  test('flag_for_human stops the agent on that negotiation', async () => {
    const { tools, negotiation, world } = await setup();
    await tools.run('flag_for_human', { negotiation_id: negotiation.id, reason: 'looks odd' });

    const after = await world.repositories.negotiations.findById(negotiation.id);
    expect(after.state).toBe('ESCALATED');
  });

  test('recommend always says the buyer decides', async () => {
    const { tools, requirement } = await setup();
    const result = await tools.run('recommend', { requirement_id: requirement.id });
    expect(['accept', 'reject', 'continue']).toContain(result.decision);
    expect(result.note).toMatch(/cannot accept/i);
  });

  test('end_negotiation cannot be used to accept', async () => {
    const { tools, negotiation } = await setup();
    await expect(
      tools.run('end_negotiation', { negotiation_id: negotiation.id, outcome: 'accepted' }),
    ).rejects.toThrow(/invalid input/);
  });
});
