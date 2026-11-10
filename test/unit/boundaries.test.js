/**
 * The negotiating agent cannot reach payments.
 *
 * Paying - including every call into PayPal's Agent Toolkit - happens only in
 * the payment service, after the buyer's own acceptance. These tests keep it
 * that way structurally: nothing the agent runs on imports payment code or the
 * toolkit, and its tool registry offers nothing that creates an order or
 * invoice.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWorld } from '../../src/simulation/harness.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const AGENT_SIDE = ['agent', 'llm', 'domain'];
const SPECIFIER = /(?:import\s+[^'"]*from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return filesUnder(path);
      return entry.name.endsWith('.js') ? [path] : [];
    }),
  );
  return nested.flat();
}

describe('the agent and payments', () => {
  test('NOTHING THE AGENT RUNS ON IMPORTS PAYMENT CODE OR THE PAYPAL TOOLKIT', async () => {
    const offenders = [];
    for (const area of AGENT_SIDE) {
      for (const file of await filesUnder(join(SRC, area))) {
        const source = await readFile(file, 'utf8');
        for (const match of source.matchAll(SPECIFIER)) {
          const specifier = match[1];
          if (/payments|paymentService|@paypal\//.test(specifier)) {
            offenders.push(`${file.slice(SRC.length)} imports ${specifier}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the agent's tool registry has no way to create an order, capture, or invoice", async () => {
    const world = await createWorld();
    const names = world.tools.definitions().map((tool) => tool.name);
    for (const name of names) {
      expect(name).not.toMatch(/order|capture|invoice|pay|accept/i);
    }
  });
});
