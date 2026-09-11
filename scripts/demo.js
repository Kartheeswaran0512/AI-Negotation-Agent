#!/usr/bin/env node
/**
 * `npm run demo`
 *
 * Plays a full negotiation against every simulated supplier and prints the
 * transcript. No database, no Docker, no API key - the point is that you can
 * clone this repository and watch the agent work before configuring anything.
 *
 * With ANTHROPIC_API_KEY set and LLM_PROVIDER=auto the wording comes from
 * Claude and the decisions are identical, because the decisions never came from
 * the model in the first place.
 */

import { createWorld, playNegotiation, DEFAULT_REQUIREMENT } from '../src/simulation/harness.js';
import { ALL_PERSONAS } from '../src/simulation/mockSellers.js';
import { formatMoney } from '../src/domain/money.js';
import { toMinor } from '../src/domain/money.js';

const line = (text = '') => process.stdout.write(`${text}\n`);
const rule = (char = '-') => line(char.repeat(74));

async function main() {
  const useModel = process.env.ANTHROPIC_API_KEY ? 'auto' : 'rules';
  const world = await createWorld({ configOverrides: { LLM_PROVIDER: useModel } });

  rule('=');
  line('  AI NEGOTIATION AGENT - simulation');
  rule('=');
  line(`  Product      : ${DEFAULT_REQUIREMENT.quantity} ${DEFAULT_REQUIREMENT.unit} of ${DEFAULT_REQUIREMENT.product}`);
  line(`  Buyer target : ${formatMoney(toMinor(DEFAULT_REQUIREMENT.target), 'INR')} per unit`);
  line(`  Buyer ceiling: ${formatMoney(toMinor(DEFAULT_REQUIREMENT.max), 'INR')} per unit  (never disclosed to a supplier)`);
  line(`  Interpreter  : ${world.interpreter.provider}${world.interpreter.model ? ` (${world.interpreter.model})` : ''}`);
  line(`  Max rounds   : ${world.config.agent.maxRounds}`);
  line('');

  for (const persona of ALL_PERSONAS) {
    const seller = persona();
    const result = await playNegotiation({ world, seller });

    rule();
    line(`SUPPLIER: ${seller.name}  -  ${seller.description}`);
    rule();

    for (const message of result.messages) {
      const who = message.author === 'agent' ? 'AGENT ' : 'SELLER';
      const via = message.generatedBy ? ` [${message.generatedBy}]` : '';
      line(`  ${who}${via}: ${message.body}`);
    }

    if (result.messages.length === 0) line('  (no messages)');

    line('');
    line(`  final state : ${result.negotiation.state}`);
    line(`  outcome     : ${result.negotiation.outcome ?? '-'}`);
    line(`  rounds used : ${result.negotiation.round} of ${result.negotiation.maxRounds}`);
    line(
      `  last price  : ${
        result.negotiation.currentSellerPriceMinor === null
          ? '-'
          : formatMoney(result.negotiation.currentSellerPriceMinor, 'INR')
      }`,
    );
    line(`  audit rows  : ${result.runs.length}`);
    if (result.recommendation) {
      line(`  RECOMMENDATION: ${result.recommendation.decision.toUpperCase()} - ${result.recommendation.summary}`);
    }
    line('');
  }

  rule('=');
  line('  Note: every price above came from arithmetic over the buyer\'s own limits');
  line('  and the supplier\'s own words. The agent never accepted anything.');
  rule('=');

  await world.repositories.close();
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
