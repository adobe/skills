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

// `scheme://user:pass@host`: everything between `//` and `@` is credentials.
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@'"`]+@/gi;
// `Authorization: Basic <token>` / `Bearer <token>` echoed in a message.
const AUTH_TOKEN = /\b(Basic|Bearer)\s+[A-Za-z0-9+/=._~-]{8,}/g;

/**
 * Hide credentials a message may carry: the user and password of a URL (a remote browser
 * endpoint such as `wss://user:pass@host`) and Basic or Bearer tokens.
 * @param {string} text
 * @returns {string}
 */
export function redactCredentials(text) {
  if (typeof text !== 'string') return text;
  return text.replace(URL_USERINFO, '$1[redacted]@').replace(AUTH_TOKEN, '$1 [redacted]');
}
