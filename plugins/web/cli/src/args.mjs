import { InvalidArgumentError } from 'commander';

/**
 * Commander argParser for non-negative integer options.
 * @param {string} value
 * @returns {number}
 */
export function parseIntArg(value) {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError(`expected an integer, got "${value}"`);
  }
  return Number(value);
}

/**
 * Commander argParser for integer options that must be at least 1.
 * @param {string} value
 * @returns {number}
 */
export function parsePositiveIntArg(value) {
  const n = parseIntArg(value);
  if (n < 1) throw new InvalidArgumentError(`expected an integer >= 1, got "${value}"`);
  return n;
}
