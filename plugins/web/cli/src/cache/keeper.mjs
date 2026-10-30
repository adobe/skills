import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { cleanHeaders, harFileName, loadHarIndex } from '#src/cache/har.mjs';
import { isTracker } from '#src/cache/har-proxy.mjs';

const EXTENSIONS = {
  'text/html': 'html',
  'text/css': 'css',
  'text/javascript': 'js',
  'application/javascript': 'js',
  'application/json': 'json',
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'font/woff': 'woff',
  'font/woff2': 'woff2',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
};

const mimeOf = (contentType = '') => contentType.split(';')[0].trim().toLowerCase();

/** Whether a response the browser received from the network is recorded in its page HAR. */
function isRecordable({ method, url, status }) {
  // 206 is one byte range of the resource: replaying it for the whole URL breaks media.
  if (method !== 'GET' || status <= 0 || status === 206 || status === 304) return false;
  return /^https?:\/\//.test(url) && !isTracker(url);
}

/** Whether a recorded response is served from the cache; errors are always re-checked live. */
const isCacheable = (status) => status >= 200 && status <= 399;

const PAGE_ID = 'page_1';
const OPEN_RECORDINGS = 16;

/** The absolute `location` of a response, or '' when it has none (HAR `redirectURL`). */
function redirectUrl(url, headers) {
  const location = headers.find(({ name }) => name.toLowerCase() === 'location')?.value;
  if (!location) return '';
  try {
    return new URL(location, url).href;
  } catch {
    return location;
  }
}

/** A request coming from page JavaScript rather than the session hooks or a CLI. */
const fromWebPage = (req) => {
  const site = req.headers['sec-fetch-site'];
  return Boolean(req.headers.origin) || (site !== undefined && site !== 'none');
};

let tmpCounter = 0;

/** Write via a temp file unique to this process, so keepers sharing a directory never collide. */
function writeAtomic(file, data) {
  tmpCounter += 1;
  const tmp = `${file}.${process.pid}-${tmpCounter}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

const readJson = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

function harEntry({
  startedAt = Date.now(),
  method,
  url,
  requestHeaders,
  status,
  statusText,
  headers,
  mimeType,
  size,
  file,
}) {
  return {
    pageref: PAGE_ID,
    startedDateTime: new Date(Number.isFinite(startedAt) ? startedAt : Date.now()).toISOString(),
    time: 0,
    request: {
      method,
      url,
      httpVersion: '',
      cookies: [],
      headers: requestHeaders,
      queryString: [],
      headersSize: -1,
      bodySize: 0,
    },
    response: {
      status,
      statusText,
      httpVersion: '',
      cookies: [],
      headers,
      content: { size, mimeType, ...(file && { _file: file }) },
      redirectURL: redirectUrl(url, headers),
      headersSize: -1,
      bodySize: -1,
    },
    cache: {},
    timings: { send: 0, wait: 0, receive: 0 },
  };
}

/** HAR `[{ name, value }]` headers from the index's `{ name: value | value[] }` form. */
const headerList = (headers) =>
  Object.entries(headers).flatMap(([name, value]) =>
    (Array.isArray(value) ? value : [value]).map((v) => ({ name, value: v })),
  );

/**
 * The on-disk side of a session cache: bodies named by content hash, one HAR per page, and an
 * in-memory index of every cached `GET <url>`.
 */
function createStore(dir) {
  const index = loadHarIndex(dir);
  for (const [key, { status }] of index) if (!isCacheable(status)) index.delete(key);
  const entries = index.size;
  /** @type {Map<unknown, { file: string, har: object }>} */
  const pages = new Map();

  function writeBody(body, mimeType) {
    const ext = EXTENSIONS[mimeOf(mimeType)] ?? 'bin';
    const name = `${createHash('sha1').update(body).digest('hex')}.${ext}`;
    const file = path.join(dir, name);
    if (!existsSync(file)) writeAtomic(file, body);
    return name;
  }

  function append(page, entry) {
    const current = pages.get(page);
    if (!current) return;
    // HAR entries are sorted by request start: a cache hit is known before an earlier
    // request's response has arrived.
    const { entries } = current.har.log;
    const at = entries.findLastIndex((e) => e.startedDateTime <= entry.startedDateTime);
    entries.splice(at + 1, 0, entry);
    writeAtomic(current.file, JSON.stringify(current.har));
  }

  function startPage(page, url) {
    const startedDateTime = new Date().toISOString();
    const harPages = [{ startedDateTime, id: PAGE_ID, title: url, pageTimings: {} }];
    const creator = { name: 'web-cli', version: '1' };
    const har = { log: { version: '1.2', creator, pages: harPages, entries: [] } };
    pages.set(page, { file: path.join(dir, harFileName(url)), har });
    // Late responses of recent pages still find their HAR; older recordings are let go.
    if (pages.size > OPEN_RECORDINGS) pages.delete(pages.keys().next().value);
  }

  function lookup({ url, page }) {
    const hit = index.get(`GET ${url}`);
    if (!hit) return null;
    const body = hit.body();
    const mimeType = mimeOf(String(hit.headers['content-type'] ?? ''));
    const file = hit.file ?? (body.length ? writeBody(body, mimeType) : undefined);
    const headers = headerList(hit.headers);
    append(
      page,
      harEntry({
        method: 'GET',
        url,
        requestHeaders: [],
        status: hit.status,
        statusText: '',
        headers,
        mimeType,
        size: body.length,
        file,
      }),
    );
    return { status: hit.status, headers: hit.headers, body };
  }

  function store(response) {
    const body = Buffer.from(response.body ?? '', 'base64');
    const mimeType = mimeOf(response.mimeType);
    const file = body.length ? writeBody(body, mimeType) : undefined;
    append(response.page, harEntry({ ...response, mimeType, size: body.length, file }));
    if (!isCacheable(response.status)) {
      index.delete(`GET ${response.url}`);
      return;
    }
    const read = file ? () => readFileSync(path.join(dir, file)) : () => Buffer.alloc(0);
    index.set(`GET ${response.url}`, {
      status: response.status,
      headers: cleanHeaders(response.headers),
      body: read,
      file,
    });
  }

  return { entries, lookup, store, startPage };
}

/**
 * Start the session cache keeper on 127.0.0.1: answers lookups from the HARs in `cacheDir` and
 * records the responses the session's browser fetched. It never fetches anything itself.
 * @param {{ cacheDir: string, port?: number, isSessionOpen?: () => boolean,
 *   livenessMs?: number, log?: (line: string) => void }} options `port: 0` picks a free port;
 *   without `isSessionOpen` the keeper runs until stopped.
 * @returns {Promise<{ port: number, url: string, entries: number, stats: object,
 *   closed: Promise<void>, stop: () => Promise<void> }>}
 */
export async function startKeeper({
  cacheDir,
  port = 0,
  isSessionOpen,
  livenessMs = 30_000,
  log = () => {},
}) {
  const dir = path.resolve(cacheDir);
  mkdirSync(dir, { recursive: true });
  const cache = createStore(dir);
  const stats = { hits: 0, misses: 0, stored: 0, errors: 0 };
  const reply = (res, status, headers = {}, body = '') => {
    res.writeHead(status, headers);
    res.end(body);
  };

  function onLookup(req, res, query) {
    if (query.nav && !query.redirect) cache.startPage(query.page, query.url);
    const hit = cache.lookup(query);
    if (!hit) {
      stats.misses += 1;
      return reply(res, 404, { 'x-web-cache': 'miss' });
    }
    stats.hits += 1;
    log(`[hit] ${query.url}`);
    return reply(res, hit.status, { ...hit.headers, 'x-web-cache': 'hit' }, hit.body);
  }

  function onStore(req, res, response) {
    if (isRecordable(response)) {
      cache.store(response);
      stats.stored += 1;
      log(`[stored] ${response.url}`);
    }
    reply(res, 204);
  }

  async function handle(req, res) {
    if (fromWebPage(req)) return reply(res, 403, {}, 'Forbidden.\n');
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/__status') {
      const body = JSON.stringify({ ...stats, entries: cache.entries });
      return reply(res, 200, { 'content-type': 'application/json' }, body);
    }
    if (pathname === '/__stop') {
      reply(res, 200, {}, 'Shutting down.\n');
      return stop();
    }
    const handler = { '/lookup': onLookup, '/store': onStore }[pathname];
    if (req.method !== 'POST' || !handler) return reply(res, 404, {}, 'Not found.\n');
    let payload;
    try {
      payload = await readJson(req);
    } catch (err) {
      stats.errors += 1;
      return reply(res, 400, {}, `Invalid JSON: ${err.message}\n`);
    }
    return handler(req, res, payload);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      stats.errors += 1;
      log(`[error] ${err.message}`);
      if (!res.headersSent) reply(res, 500, {}, `Keeper error: ${err.message}\n`);
    });
  });
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', ok);
  });
  const closed = new Promise((ok) => server.once('close', ok));
  const stop = () => {
    server.close();
    server.closeAllConnections();
    return closed;
  };
  if (isSessionOpen) {
    const timer = setInterval(() => {
      if (!isSessionOpen()) stop();
    }, livenessMs);
    timer.unref();
    closed.then(() => clearInterval(timer));
  }
  const actual = server.address().port;
  return {
    port: actual,
    url: `http://127.0.0.1:${actual}`,
    entries: cache.entries,
    stats,
    closed,
    stop,
  };
}
