// skills/reskin/scripts/test/fixtures/figma-kit/fake-figma.mjs — a local fake of the Figma REST API
// for the figma-donor tests (node http on a random port; no network). Serves from fixtureDir:
//   GET /v1/files/:key                 → file.json
//   GET /v1/files/:key/nodes           → nodes.json
//   GET /v1/files/:key/variables/local → variables.json, else 403 (variables-403.json body if present)
//   GET /v1/images/:key                → images.json with "{{base}}" replaced by the fake's origin
//   GET /img/<name>                    → the bytes of fixtureDir/<name>, no token required (signed storage)
// /v1/* requires X-Figma-Token === token, else 403. behaviors[pathname] overrides a route: an object
// { status, headers, body, delay } applies to every request; an array is consumed one entry per
// request, then the route falls through. requests records { method, rawUrl, path, query, headers }.
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

export async function startFakeFigma({ fixtureDir, token, behaviors = {} } = {}) {
  const requests = [];
  const state = { fixtureDir };
  let base = '';
  const send = (res, status, body, headers = {}) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body ?? {}));
    const type = Buffer.isBuffer(body) ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain' : 'application/json';
    res.writeHead(status, { 'content-type': type, ...headers });
    res.end(buf);
  };
  const fixture = (name) => {
    const p = join(state.fixtureDir || '', name);
    return state.fixtureDir && existsSync(p) ? readFileSync(p) : null;
  };
  const json = (name) => { const b = fixture(name); return b ? JSON.parse(b.toString('utf8').split('{{base}}').join(base)) : null; };

  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://fake');
    const entry = { method: req.method, rawUrl: req.url, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: req.headers };
    requests.push(entry);
    const override = behaviors[u.pathname];
    const b = Array.isArray(override) ? override.shift() : override;
    const run = () => {
      if (b && b.status) return send(res, b.status, b.body ?? '', b.headers);
      if (u.pathname.startsWith('/img/')) {
        const bytes = fixture(u.pathname.slice('/img/'.length));
        return bytes ? send(res, 200, bytes, { 'content-type': 'image/png' }) : send(res, 404, 'no such object');
      }
      if (!u.pathname.startsWith('/v1/')) return send(res, 404, { status: 404, err: 'Not found' });
      if (req.headers['x-figma-token'] !== token) return send(res, 403, { status: 403, err: 'Invalid token' });
      let m;
      if ((m = /^\/v1\/files\/[^/]+\/variables\/local$/.exec(u.pathname))) {
        const vars = json('variables.json');
        return vars ? send(res, 200, vars) : send(res, 403, json('variables-403.json') ?? { status: 403, error: true, message: 'Limited by Figma plan' });
      }
      const route = [
        [/^\/v1\/files\/[^/]+$/, 'file.json'],
        [/^\/v1\/files\/[^/]+\/nodes$/, 'nodes.json'],
        [/^\/v1\/images\/[^/]+$/, 'images.json'],
      ].find(([re]) => re.test(u.pathname));
      const body = route && json(route[1]);
      return body ? send(res, 200, body) : send(res, 404, { status: 404, err: 'Not found' });
    };
    if (b && b.delay) setTimeout(run, b.delay); else run();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    requests,
    behaviors,
    setFixtureDir(dir) { state.fixtureDir = dir; },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}
