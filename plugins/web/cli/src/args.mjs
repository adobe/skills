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
