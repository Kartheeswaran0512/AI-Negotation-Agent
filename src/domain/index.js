/**
 * The domain barrel.
 *
 * THE ONE ARCHITECTURAL RULE OF THIS PROJECT: nothing under src/domain imports
 * anything outside src/domain. No database, no HTTP, no environment, no LLM,
 * no clock. That is enforced by a test (test/unit/purity.test.js) which reads
 * every file in this directory and fails on a foreign import.
 *
 * It buys three things: the decision logic runs in microseconds in tests, it
 * cannot be broken by an outage, and it cannot leak anything, because it has
 * nowhere to leak to.
 */

export * from './money.js';
export * from './limits.js';
export * from './verdict.js';
export * from './pricing.js';
export * from './disclosure.js';
export * from './machine.js';
export * from './guard.js';
export * from './grounding.js';
export * from './templates.js';
export * from './decide.js';
export * from './recommend.js';
