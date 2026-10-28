import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import { ensureCert } from '#src/cache/cert.mjs';
import { loadHarIndex } from '#src/cache/har.mjs';
import { isDirectRequest } from '#src/cache/proxy.mjs';

export const TRACKERS =
  /google-analytics|analytics\.google|googletagmanager|doubleclick|googlesyndication|demdex|2o7\.net|omtrdc|clarity\.ms|facebook\.(com|net)\/tr|hotjar|segment\.(io|com)|intellimize|stackadapt|attn\.tv|monorail|visualwebsiteoptimizer|semrush|stripe\.com\/(0|\?)|cdn-cgi\/rum|owox/;

// Hop-by-hop headers plus those fetch computes itself or rejects.
const UNFORWARDED_REQUEST_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'expect',
  'host',
  'accept-encoding',
  'content-length',
];
const UNRELAYED_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'set-cookie',
]);

/** Write a full response, `content-length` set to the body size. */
function send(res, { method, status, headers, body }) {
  const length = status === 204 || status === 304 ? {} : { 'content-length': body.length };
  res.writeHead(status, { ...headers, ...length });
  res.end(method === 'HEAD' ? undefined : body);
}

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
};

/** Fetch `url` from the network, unstored, with the client's request headers. */
async function fetchLive(req, url, timeoutMs) {
  const headers = { ...req.headers };
  for (const k of UNFORWARDED_REQUEST_HEADERS) delete headers[k];
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const resp = await fetch(url, {
    method: req.method,
    headers,
    body: hasBody ? await readBody(req) : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  /** @type {Record<string, string | string[]>} */
  const relayed = {};
  for (const [k, v] of resp.headers) if (!UNRELAYED_RESPONSE_HEADERS.has(k)) relayed[k] = v;
  const cookies = resp.headers.getSetCookie();
  if (cookies.length) relayed['set-cookie'] = cookies;
  return { status: resp.status, headers: relayed, body: Buffer.from(await resp.arrayBuffer()) };
}

/** The proxied URL, or null for an origin-form request to the proxy itself. */
function targetUrl(req) {
  if (req.socket.encrypted) return `https://${req.headers.host?.replace(/:443$/, '')}${req.url}`;
  return /^https?:\/\//.test(req.url) ? req.url : null;
}

/**
 * Start a forward proxy on 127.0.0.1 that answers from the HAR files in `cacheDir`. HTTPS is
 * intercepted with a self-signed certificate; misses go live (never stored) unless `offline`,
 * and tracker misses are refused.
 * @param {{ port?: number, cacheDir: string, offline?: boolean, timeoutMs?: number,
 *   log?: (line: string) => void }} options `port: 0` picks a free port.
 * @returns {Promise<{ port: number, url: string, entries: number, stats: object,
 *   closed: Promise<void>, stop: () => Promise<void> }>}
 */
export async function startHarProxy({
  port = 3002,
  cacheDir,
  offline = false,
  timeoutMs = 5000,
  log = () => {},
}) {
  const dir = path.resolve(cacheDir);
  mkdirSync(dir, { recursive: true });
  const index = loadHarIndex(dir);
  const { key, cert } = ensureCert(dir);
  const entries = index.size;
  const stats = { hits: 0, misses: 0, live: 0, liveFailed: 0, blocked: 0, missed: new Set() };
  const text = (res, status, message) => {
    res.writeHead(status, { 'content-type': 'text/plain' });
    res.end(message);
  };

  function control(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/__status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ...stats, entries, missed: [...stats.missed] }));
    }
    if (pathname !== '/__stop') return text(res, 404, 'Not found.\n');
    if (!isDirectRequest(req)) return text(res, 403, 'Forbidden.\n');
    text(res, 200, 'Shutting down.\n');
    return stop();
  }

  async function handle(req, res) {
    const url = targetUrl(req);
    if (!url) return control(req, res);
    const hit = index.get(`${req.method} ${url}`);
    if (hit) {
      stats.hits += 1;
      log(`[hit] ${url}`);
      return send(res, { method: req.method, ...hit, body: hit.body() });
    }
    if (TRACKERS.test(url)) {
      stats.blocked += 1;
      log(`[blocked] ${url}`);
      return send(res, { method: req.method, status: 403, headers: {}, body: Buffer.alloc(0) });
    }
    stats.misses += 1;
    stats.missed.add(url);
    if (offline) {
      log(`[miss] ${url} (offline)`);
      return text(res, 504, `Cache miss (offline): ${url}\n`);
    }
    try {
      const live = await fetchLive(req, url, timeoutMs);
      stats.live += 1;
      log(`[live] ${url}`);
      return send(res, { method: req.method, ...live });
    } catch (err) {
      stats.liveFailed += 1;
      log(`[live-failed] ${url}: ${err.message}`);
      return text(res, 502, `Live fetch failed: ${url}: ${err.message}\n`);
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      log(`[error] ${err.message}`);
      if (!res.headersSent) text(res, 500, `Proxy error: ${err.message}\n`);
    });
  });
  server.on('connect', (req, socket, head) => {
    socket.on('error', (err) => log(`[tunnel-error] ${req.url}: ${err.message}`));
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) socket.unshift(head);
    const tlsSocket = new tls.TLSSocket(socket, {
      isServer: true,
      key,
      cert,
      ALPNProtocols: ['http/1.1'],
    });
    server.emit('connection', tlsSocket);
  });
  server.on('upgrade', (req, socket) => socket.destroy());
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', ok);
  });
  const actual = server.address().port;
  const closed = new Promise((ok) => server.once('close', ok));
  const stop = () => {
    server.close();
    server.closeAllConnections();
    return closed;
  };
  return { port: actual, url: `http://127.0.0.1:${actual}`, entries, stats, closed, stop };
}
