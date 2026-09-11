/**
 * The architectural rule, enforced rather than documented.
 *
 * `src/domain` may not import anything outside itself: no database, no HTTP, no
 * config, no LLM, no npm package. If that ever stops being true, the decision
 * core stops being provable in a unit test and starts being something you have
 * to run infrastructure to observe.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOMAIN_DIR = join(HERE, '..', '..', 'src', 'domain');

const IMPORT_PATTERN = /(?:^|\n)\s*import\s+[^'"]*from\s+['"]([^'"]+)['"]/g;
const BARE_IMPORT_PATTERN = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_PATTERN = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const REQUIRE_PATTERN = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

async function domainFiles() {
  const entries = await readdir(DOMAIN_DIR);
  return entries.filter((name) => name.endsWith('.js'));
}

function specifiersIn(source) {
  const found = [];
  for (const pattern of [IMPORT_PATTERN, BARE_IMPORT_PATTERN, DYNAMIC_IMPORT_PATTERN, REQUIRE_PATTERN]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match) {
      found.push(match[1]);
      match = pattern.exec(source);
    }
  }
  return found;
}

describe('domain purity', () => {
  test('there are domain files to check', async () => {
    const files = await domainFiles();
    expect(files.length).toBeGreaterThan(8);
  });

  test('NO FILE IN src/domain IMPORTS ANYTHING OUTSIDE src/domain', async () => {
    const offenders = [];

    for (const file of await domainFiles()) {
      const source = await readFile(join(DOMAIN_DIR, file), 'utf8');
      for (const specifier of specifiersIn(source)) {
        const isLocal = specifier.startsWith('./') && !specifier.startsWith('../');
        if (!isLocal) offenders.push(`${file} imports ${specifier}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  test('the domain touches no global I/O surface', async () => {
    const banned = [
      /\bprocess\.env\b/,
      /\brequire\s*\(\s*['"]node:/,
      /\bfetch\s*\(/,
      /\bnew Date\s*\(\s*\)/, // time is an input, not something the domain reads
    ];

    const offenders = [];
    for (const file of await domainFiles()) {
      const source = await readFile(join(DOMAIN_DIR, file), 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');
      for (const pattern of banned) {
        if (pattern.test(code)) offenders.push(`${file} matches ${pattern}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
