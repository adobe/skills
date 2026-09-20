/**
 * mock-da.mjs — an in-process stand-in for the three hosts deploy-batch.mjs talks to.
 *
 *   /da/<org>/<repo><path>.html        DA Source API (PUT, HEAD, GET)
 *   /admin/preview|live/<org>/<repo>/<ref><path>   admin.hlx.page
 *   /delivery/<tld><path>.plain.html   the delivered tree (aem.page | aem.live)
 *   /list/<org>/<repo>/                the DA list smoke (preflight)
 *   /da/<org>/<repo>/media/<scope>/<file>  DA media PUT (rasterise-svg / rehost-media) — bytes kept in
 *                                      `server.media` (path → Buffer); status from rules.mediaStatus(path, n)
 *   /cdn/<name>                        a source CDN fixture (media-reconcile / rehost-media probes):
 *                                      rules.cdn(name, headers, search) → { status, body: Buffer|string, headers }
 *                                      (`{ hang: true }` leaves the request unanswered)
 *                                      (default 404); a `range` request against a Buffer body answers 206
 *                                      with content-range (`total` overrides the advertised size) unless
 *                                      the rule sets `noRange`
 *   /                                  the CDN origin's home document: rules.root(headers) → { status, body,
 *                                      headers } (default 200 HTML setting `sess=1` — an in-page fetch from
 *                                      that document carries the cookie, a bare GET does not)
 *
 * `server.requests` records `{ method, url, auth, ua, range, accept, cookie }` in order; `server.rules`
 * is a mutable object the test edits between runs:
 *   putStatus(path, n) → status for the n-th PUT of that path (default 201)
 *   previewStatus(path, n), liveStatus(path, n) → default 200
 *   delivered(tld, path, n) → { status, body, headers } for the n-th GET
 *   listStatus → default 200
 * Bodies PUT are kept in `server.source` (path → string) so a GET of the DA
 * source returns what was written (shrink guard, two-clocks).
 *
 * Usage: const s = await startMock(); … env(s) … await s.close();
 */
import { createServer } from 'node:http';

export async function startMock() {
  const requests = [];
  const source = {};
  const counts = {};
  const nth = (key) => { counts[key] = (counts[key] || 0) + 1; return counts[key]; };
  const rules = {
    putStatus: () => 201,
    previewStatus: () => 200,
    liveStatus: () => 200,
    delivered: () => ({ status: 200, body: '<main><h1>ok</h1></main>' }),
    listStatus: () => 200,
    mediaStatus: () => 201,
    cdn: () => ({ status: 404, body: 'no such asset' }),
    root: () => ({ status: 200, body: '<!doctype html><title>mock origin</title>', headers: { 'set-cookie': 'sess=1; Path=/' } }),
  };
  const media = {};
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const body = raw.toString('utf8');
    const url = new URL(req.url, 'http://x');
    requests.push({ method: req.method, url: url.pathname, auth: req.headers.authorization || null, ua: req.headers['user-agent'] || null, range: req.headers.range || null, accept: req.headers.accept || null, cookie: req.headers.cookie || null });
    const reply = (status, text = '', headers = {}) => { res.writeHead(status, { 'content-type': 'text/html', ...headers }); res.end(text); };
    let m;
    if ((m = url.pathname.match(/^\/da\/[^/]+\/[^/]+(\/media\/.+)$/)) && !/\.html$/.test(url.pathname)) {
      const p = decodeURI(m[1]);
      if (req.method === 'PUT') {
        const st = rules.mediaStatus(p, nth(`media${p}`));
        if (st < 400) {
          // multipart: the binary part sits between the part's blank line and the closing boundary
          const start = raw.indexOf('\r\n\r\n'); const tail = raw.lastIndexOf('\r\n--');
          media[p] = start !== -1 && tail > start ? raw.subarray(start + 4, tail) : raw;
        }
        return reply(st, st >= 400 ? `media put ${st}` : '');
      }
      if (req.method === 'HEAD' || req.method === 'GET') return p in media ? reply(200, req.method === 'GET' ? media[p] : '') : reply(404);
    }
    if ((m = url.pathname.match(/^\/cdn\/(.+)$/))) {
      const d = rules.cdn(decodeURI(m[1]), req.headers, url.search) || { status: 404 };
      if (d.hang) return undefined; // never answered: the killed-run fixtures park one fetch here
      const buf = Buffer.isBuffer(d.body) ? d.body : Buffer.from(d.body || '');
      const range = req.headers.range && !d.noRange && d.status === 200 && Buffer.isBuffer(d.body) ? req.headers.range.match(/^bytes=(\d+)-(\d*)$/) : null;
      if (range) {
        const from = Number(range[1]); const to = Math.min(range[2] === '' ? buf.length - 1 : Number(range[2]), buf.length - 1);
        res.writeHead(206, { 'content-type': 'application/octet-stream', ...(d.headers || {}), 'content-range': `bytes ${from}-${to}/${d.total || buf.length}`, 'content-length': String(to - from + 1) });
        return res.end(buf.subarray(from, to + 1));
      }
      res.writeHead(d.status, { 'content-type': 'application/octet-stream', ...(d.headers || {}) });
      return res.end(req.method === 'HEAD' ? '' : buf);
    }
    if ((m = url.pathname.match(/^\/da\/[^/]+\/[^/]+(\/.+)\.html$/))) {
      const p = decodeURI(m[1]);
      if (req.method === 'PUT') {
        const st = rules.putStatus(p, nth(`put${p}`));
        if (st < 400) {
          // multipart: keep the part body between the first blank line and the closing boundary
          const part = body.split(/\r?\n\r?\n/).slice(1).join('\n\n').replace(/\r?\n--[^\n]*--\r?\n?$/, '');
          source[p] = part;
        }
        return reply(st, st >= 400 ? `put ${st}` : '');
      }
      if (req.method === 'HEAD' || req.method === 'GET') {
        if (!(p in source)) return reply(404);
        return reply(200, req.method === 'GET' ? source[p] : '');
      }
    }
    if ((m = url.pathname.match(/^\/admin\/(preview|live)\/[^/]+\/[^/]+\/[^/]+(\/.*)$/))) {
      const p = decodeURI(m[2]);
      const st = m[1] === 'preview' ? rules.previewStatus(p, nth(`preview${p}`)) : rules.liveStatus(p, nth(`live${p}`));
      return reply(st, st >= 400 ? `${m[1]} ${st}` : '');
    }
    if ((m = url.pathname.match(/^\/delivery\/(aem\.page|aem\.live)(\/.+)\.plain\.html$/))) {
      const p = decodeURI(m[2]);
      const d = rules.delivered(m[1], p, nth(`get${m[1]}${p}`), req.headers);
      return reply(d.status, d.body || '', d.headers || {});
    }
    if ((m = url.pathname.match(/^\/list\//))) return reply(rules.listStatus(), '[]', { 'content-type': 'application/json' });
    if (url.pathname === '/') { const d = rules.root(req.headers); return reply(d.status, d.body || '', d.headers || {}); }
    return reply(404, 'mock: no route');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    requests,
    source,
    media,
    rules,
    env: () => ({
      DEPLOY_BATCH_DA_SRC: `${base}/da`,
      DEPLOY_BATCH_ADMIN: `${base}/admin`,
      DEPLOY_BATCH_DELIVERY_BASE: `${base}/delivery`,
      DEPLOY_BATCH_DA_LIST: `${base}/list`,
    }),
    reset: () => { requests.length = 0; for (const k of Object.keys(counts)) delete counts[k]; },
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  };
}
