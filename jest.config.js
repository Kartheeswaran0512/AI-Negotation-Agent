/**
 * Native ESM under Jest: `transform: {}` disables Babel so the files run as
 * written. The `--experimental-vm-modules` flag is supplied by the npm scripts.
 */
export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: ['**/test/**/*.test.js'],
  moduleFileExtensions: ['js', 'json'],
  collectCoverageFrom: ['src/**/*.js', '!src/index.js'],
  testTimeout: 15000,
  verbose: false,
};
