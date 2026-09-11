/**
 * A very small structured logger.
 *
 * One line of JSON per event, so an agent run can be traced end to end by its
 * correlation id without pulling in a logging framework.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

/**
 * @param {object} [options]
 * @param {string} [options.level]
 * @param {object} [options.base] fields added to every line
 * @param {(line: string) => void} [options.sink]
 */
export function createLogger({ level = 'info', base = {}, sink = defaultSink } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const emit = (levelName) => (message, fields = {}) => {
    if (LEVELS[levelName] < threshold) return;
    sink(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: levelName,
        msg: message,
        ...base,
        ...fields,
      }),
    );
  };

  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    /** A child logger that stamps every line with extra fields. */
    child(fields) {
      return createLogger({ level, base: { ...base, ...fields }, sink });
    },
  };
}

function defaultSink(line) {
  process.stdout.write(`${line}\n`);
}

/** A logger that discards everything. Used by tests. */
export const silentLogger = createLogger({ level: 'silent', sink: () => {} });
