import http from 'node:http';
import tls from 'node:tls';
import { readFileSync } from 'node:fs';
import { CliError } from '#src/errors.mjs';

const PEM = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
// The settings withProxy changes belong to the whole process: one proxied run at a time.
let active = false;
// No user:pass@ example: output redaction would print it as [redacted]@.
const PROXY_HINT =
  'pass an http:// or https:// URL such as http://proxy.example.com:8080, with user:pass@ before the host if it needs a login';

/**
 * Check a proxy URL: http: or https: with a host. The message never quotes the value, which may
 * hold a password.
 * @param {string} value
 */
export function assertProxyUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CliError('USAGE', 'invalid proxy URL', { hint: PROXY_HINT });
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new CliError('USAGE', 'the proxy URL must use http:// or https://', {
      hint: PROXY_HINT,
    });
  }
}

/** The certificates of a PEM file, or USAGE. */
function readCertificates(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    throw new CliError('USAGE', `cannot read --proxy-ca ${file}: ${err.message}`);
  }
  const certs = text.match(PEM);
  if (!certs) {
    throw new CliError('USAGE', `--proxy-ca ${file} holds no PEM certificate`, {
      hint: `convert a DER file with: openssl x509 -inform der -in ${file} -out ca.pem`,
    });
  }
  return certs;
}

/**
 * Run `fn` with every `fetch` and `http(s).request` of the process sent through `proxy`, then
 * restore Node's global agents, dispatcher, trusted certificates and certificate checks.
 * Node's proxy support is process-wide: while `fn` runs, every request of the process goes
 * through the proxy, with the extra CAs and, with `insecure`, without certificate checks. A
 * second call while one runs is refused.
 *
 * Without `http.setGlobalProxyFromEnv` (Node < 24.14, or 25.0 to 25.3) this throws UNSUPPORTED
 * before any request: the requests must never go out directly when a proxy was asked for.
 * @template T
 * @param {{ proxy?: string, ca?: string, insecure?: boolean }} options `ca`: a PEM file of
 *   certificates to trust as well (proxies that re-sign TLS); `insecure`: skip certificate checks
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withProxy({ proxy, ca, insecure } = {}, fn) {
  if (!proxy) return fn();
  if (active) {
    throw new CliError('UNSUPPORTED', 'a proxied scan is already running in this process', {
      hint: 'run proxied scans one after the other',
    });
  }
  if (typeof http.setGlobalProxyFromEnv !== 'function') {
    throw new CliError(
      'UNSUPPORTED',
      `a proxy (--proxy or WEB_PROXY) needs Node.js 24.14+ or 25.4+; this is ${process.version}`,
      { hint: 'upgrade Node.js, or unset WEB_PROXY and drop --proxy to scan without a proxy' },
    );
  }
  const extra = ca ? readCertificates(ca) : [];
  const roots = tls.getCACertificates('default');
  const reject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  let restoreProxy;
  active = true;
  try {
    if (extra.length) {
      try {
        tls.setDefaultCACertificates([...roots, ...extra]);
      } catch (err) {
        throw new CliError('USAGE', `--proxy-ca ${ca}: ${err.message}`);
      }
    }
    // Node reads this on every TLS connection; it prints its own warning the first time.
    if (insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    // Every variable set, in both cases: Node still reads the ones missing from the object in
    // process.env, and a NO_PROXY there would send matching requests out directly.
    restoreProxy = http.setGlobalProxyFromEnv({
      http_proxy: proxy,
      https_proxy: proxy,
      HTTP_PROXY: proxy,
      HTTPS_PROXY: proxy,
      no_proxy: '',
      NO_PROXY: '',
    });
    return await fn();
  } finally {
    active = false;
    restoreProxy?.();
    if (extra.length) tls.setDefaultCACertificates(roots);
    if (insecure) {
      if (reject === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = reject;
    }
  }
}
