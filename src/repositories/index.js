/**
 * Choose a store.
 *
 * Services never import either implementation directly - they are handed a
 * `Repositories` object, which is what makes the same service code run against
 * MySQL in production and against memory in the scenario tests.
 */

import { createPool } from '../db/pool.js';
import { createMysqlRepositories } from './mysqlRepositories.js';
import { createMemoryRepositories } from './memoryRepositories.js';

export { createMysqlRepositories, createMemoryRepositories };
export { DuplicateKeyError } from './memoryRepositories.js';

/**
 * @param {object} options
 * @param {'mysql'|'memory'} options.driver
 * @param {object} [options.db] required for the mysql driver
 * @returns {import('./types.js').Repositories}
 */
export function createRepositories({ driver, db }) {
  if (driver === 'memory') return createMemoryRepositories();
  if (driver === 'mysql') {
    if (!db) throw new Error('repositories: the mysql driver needs a db configuration');
    return createMysqlRepositories(createPool(db));
  }
  throw new Error(`repositories: unknown driver "${driver}"`);
}
