/**
 * The MySQL connection pool.
 *
 * `decimalNumbers` is deliberately left false: mysql2 returns DECIMAL columns
 * as strings, and strings are exactly what the money helpers want. Turning it
 * on would hand every price to IEEE 754 on the way out of the database.
 */

import mysql from 'mysql2/promise';

/**
 * @param {object} dbConfig
 * @param {object} [overrides]
 * @returns {import('mysql2/promise').Pool}
 */
export function createPool(dbConfig, overrides = {}) {
  return mysql.createPool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    connectionLimit: dbConfig.connectionLimit,
    waitForConnections: true,
    queueLimit: 0,
    decimalNumbers: false,
    dateStrings: false,
    multipleStatements: false,
    charset: 'utf8mb4_unicode_ci',
    ...overrides,
  });
}

/**
 * Run a function inside a transaction, rolling back on any throw.
 *
 * @template T
 * @param {import('mysql2/promise').Pool} pool
 * @param {(conn: import('mysql2/promise').PoolConnection) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(pool, fn) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // The rollback failing does not change what we report: the original
      // error is the one the caller needs to see.
    }
    throw error;
  } finally {
    connection.release();
  }
}
