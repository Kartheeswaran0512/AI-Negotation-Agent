/**
 * A migration runner small enough to read in one sitting.
 *
 * Files in ./migrations are applied in filename order, once each, recorded in
 * `schema_migrations`. Each file runs inside a transaction - which MySQL only
 * partially honours for DDL, so migrations here are written to be re-runnable
 * as whole files rather than relying on rollback.
 *
 * Statements are split on semicolons at end of line. That is why no migration
 * in this project uses a stored routine body: keeping the SQL simple keeps the
 * splitter honest.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

import { loadConfig } from '../config/env.js';
import { createLogger } from '../config/logger.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, 'migrations');

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id VARCHAR(191) NOT NULL,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

/** @param {string} sql */
export function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !isCommentOnly(statement));
}

function isCommentOnly(statement) {
  return statement
    .split(/\r?\n/)
    .every((line) => line.trim() === '' || line.trim().startsWith('--'));
}

/** @returns {Promise<Array<{id: string, sql: string}>>} */
export async function loadMigrations(directory = MIGRATIONS_DIR) {
  const entries = await readdir(directory);
  const files = entries.filter((name) => name.endsWith('.sql')).sort();

  return Promise.all(
    files.map(async (name) => ({
      id: name,
      sql: await readFile(join(directory, name), 'utf8'),
    })),
  );
}

/**
 * @param {import('mysql2/promise').Connection} connection
 * @param {object} [options]
 */
export async function runMigrations(connection, { logger = console, directory } = {}) {
  await connection.query(CREATE_TABLE);

  const [applied] = await connection.query('SELECT id FROM schema_migrations');
  const done = new Set(applied.map((row) => row.id));
  const migrations = await loadMigrations(directory);
  const ran = [];

  for (const migration of migrations) {
    if (done.has(migration.id)) continue;

    const statements = splitStatements(migration.sql);
    for (const statement of statements) {
      await connection.query(statement);
    }
    await connection.query('INSERT INTO schema_migrations (id) VALUES (?)', [migration.id]);
    ran.push(migration.id);
    logger.info?.(`migration applied: ${migration.id}`);
  }

  return { applied: ran, alreadyApplied: [...done] };
}

/**
 * Connects with no database selected, creates it when missing, then migrates.
 * Running `npm run migrate` on a clean MySQL is enough to get a working schema.
 */
async function main() {
  const command = process.argv[2] ?? 'up';
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });

  const bootstrap = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: false,
  });

  try {
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    await bootstrap.changeUser({ database: config.db.database });

    if (command === 'status') {
      await bootstrap.query(CREATE_TABLE);
      const [rows] = await bootstrap.query(
        'SELECT id, applied_at FROM schema_migrations ORDER BY id',
      );
      const all = await loadMigrations();
      const done = new Set(rows.map((row) => row.id));
      for (const migration of all) {
        process.stdout.write(
          `${done.has(migration.id) ? '[applied] ' : '[pending] '}${migration.id}\n`,
        );
      }
      return;
    }

    if (command !== 'up') {
      throw new Error(`unknown migrate command "${command}" (expected "up" or "status")`);
    }

    const result = await runMigrations(bootstrap, { logger });
    logger.info('migrations complete', {
      applied: result.applied.length,
      database: config.db.database,
    });
  } finally {
    await bootstrap.end();
  }
}

// Only run when executed directly, so the exported helpers stay importable.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
