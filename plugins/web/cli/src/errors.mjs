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

// `scheme://user:pass@host`: everything between `//` and the `@` before the host is
// credentials. Userinfo may hold any character but whitespace and the delimiters `/ ? # @`
// (quotes included).
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@]+@/gi;
// An Authorization header value: the scheme is kept, the credentials go, whatever their length.
const AUTH_HEADER = /\b(authorization\s*[:=]\s*["']?)([a-z][a-z0-9_-]*)\s+[^\s"',;]+/gi;
// A bare `Basic <token>` / `Bearer <token>` elsewhere in a message; 8+ characters, so prose
// such as "Basic auth required" is left alone.
const AUTH_TOKEN = /\b(basic|bearer)\s+[A-Za-z0-9+/=._~-]{8,}/gi;

/**
 * Hide credentials a message may carry: the user and password of a URL (a remote browser
 * endpoint such as `wss://user:pass@host`), Authorization header values and Basic or Bearer
 * tokens.
 * @param {string} text
 * @returns {string}
 */
export function redactCredentials(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(URL_USERINFO, '$1[redacted]@')
    .replace(AUTH_HEADER, '$1$2 [redacted]')
    .replace(AUTH_TOKEN, '$1 [redacted]');
}
