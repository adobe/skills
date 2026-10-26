export const EXIT = { OK: 0, FAILURE: 1, USAGE: 2, BLOCKED: 3 };

const USAGE_CODES = new Set([
  'NO_SESSION',
  'SESSION_EXISTS',
  'USAGE',
  'PLAYWRIGHT_CLI',
  'UNSUPPORTED',
]);

export class CliError extends Error {
  /**
   * @param {string} code machine-readable error code
   * @param {string} message human-readable message
   * @param {{ hint?: string }} [opts]
   */
  constructor(code, message, { hint } = {}) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

/** @param {string} code */
export function exitCodeFor(code) {
  if (code === 'BLOCKED') return EXIT.BLOCKED;
  return USAGE_CODES.has(code) ? EXIT.USAGE : EXIT.FAILURE;
}
