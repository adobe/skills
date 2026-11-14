#!/usr/bin/env node
// skills/rollout/scripts/test/assemble.test.mjs — the assemble.mjs contract: the assembled sitemap is the
// EXPECTED set (one <loc> per coverage row, a --new row included; never served itself), and
// --verify-origin reads the SERVED sitemap: exit 1 naming the extra paths (chrome documents that lack
// `Robots: noindex`) and the missing ones, host-agnostic path comparison, a sitemap index followed on the
// verified origin, fail-closed on an unreadable sitemap, no network call without the flag, the result
// recorded in manifest.json; --help writes nothing. The origin is a local node:http fake.
// Run: node plugins/stardust/skills/rollout/scripts/test/assemble.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'assemble.mjs');
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const run = (args, cwd) => new Promise((res) => {
  const p = spawn(process.execPath, [SCRIPT, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => res({ code, out, err }));
});

// Coverage: three captured pages plus one row added with `update-coverage.mjs --new` (a D2-built search page).
const PAGES = [
  { slug: 'home', path: '/', source: { migratedHtml: 'stardust/migrated/index.html', sourceHash: 'sha256:0' }, delivery: { status: 'verified' } },
  { slug: 'about', path: '/about', source: { migratedHtml: 'stardust/migrated/about.html', sourceHash: 'sha256:0' }, delivery: { status: 'verified' } },
  { slug: 'tours-bali', path: '/tours/bali', source: { migratedHtml: 'stardust/migrated/tours/bali.html', sourceHash: 'sha256:0' }, delivery: { status: 'deployed' } },
  { slug: 'search', path: '/search', templateId: 'search', source: { migratedHtml: 'dynamics:search', metaJson: null, sourceHash: 'sha256:1' }, blocks: [], delivery: { status: 'deployed' } },
];
const PATHS = PAGES.map((p) => p.path);
const fixture = () => {
  const proj = mkdtempSync(join(tmpdir(), 'assemble-'));
  const out = join(proj, 'stardust', 'rollout'); mkdirSync(join(out, 'coverage'), { recursive: true });
  writeFileSync(join(out, 'coverage', 'pages.json'), JSON.stringify({ pages: PAGES }, null, 2));
  writeFileSync(join(out, 'coverage', 'blocks.json'), JSON.stringify({ blocks: [
    { id: 'header', kind: 'chrome', delivery: { status: 'converted', blockPath: null } },
    { id: 'footer', kind: 'chrome', delivery: { status: 'converted', blockPath: null } },
    { id: 'hero', kind: 'module', delivery: { status: 'converted' } },
  ] }, null, 2));
  writeFileSync(join(out, 'rollout.json'), JSON.stringify({ site: { liveHost: 'www.example.test' } }, null, 2));
  return { proj, out };
};
const manifest = (out) => JSON.parse(readFileSync(join(out, 'site', 'manifest.json'), 'utf8'));
const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

// The fake served origin. Its <loc>s name a DIFFERENT host (the canonical one) on purpose: the
// comparison is by path. `mode` picks what /sitemap.xml serves.
let mode = 'exact';
const hits = [];
const urlset = (paths) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((p) => `  <url><loc>https://www.example.test${p}</loc><lastmod>2026-01-01</lastmod></url>`).join('\n')}\n</urlset>`;
const server = createServer((req, res) => {
  hits.push(req.url);
  const ok = (body, type = 'application/xml') => { res.writeHead(200, { 'content-type': type }); res.end(body); };
  if (req.url === '/sitemap.xml') {
    if (mode === 'exact') return ok(urlset(['/', '/about/', '/tours/bali', '/search'])); // a trailing slash normalizes away
    if (mode === 'chrome') return ok(urlset([...PATHS, '/nav', '/footer', '/de/nav-de', '/de/footer-de', '/de']));
    if (mode === 'missing') return ok(urlset(['/', '/about', '/search']));
    if (mode === 'index') return ok('<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://www.example.test/sitemap-en.xml</loc></sitemap><sitemap><loc>/sitemap-de.xml</loc></sitemap></sitemapindex>');
    if (mode === 'html') return ok('<html><body>not a sitemap</body></html>', 'text/html');
    res.writeHead(404); return res.end('nope');
  }
  if (req.url === '/sitemap-en.xml') return ok(urlset(['/', '/about', '/search']));
  if (req.url === '/sitemap-de.xml') return ok(urlset(['/tours/bali']));
  res.writeHead(404); return res.end();
});
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

await check('--help prints the header (naming --verify-origin) and writes nothing', async () => {
  const proj = mkdtempSync(join(tmpdir(), 'assemble-help-'));
  const r = await run(['--help'], proj);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /--verify-origin <live-origin>/); assert.match(r.out, /Usage:/);
  assert.deepEqual(readdirSync(proj), []);
  rmSync(proj, { recursive: true, force: true });
});

await check('without --verify-origin: the assembled sitemap lists every coverage row (the --new row included), nothing is fetched, fragments carry robots: noindex', async () => {
  const { proj, out } = fixture();
  const before = hits.length;
  const r = await run([], proj);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(locs(readFileSync(join(out, 'site', 'sitemap.xml'), 'utf8')), PATHS.map((p) => `https://www.example.test${p}`));
  assert.match(r.out, /sitemap\.xml {3}4 urls @ https:\/\/www\.example\.test {3}\(the EXPECTED set/);
  assert.match(r.out, /fragments {5}2: header.*footer.*\(each needs a `Robots \| noindex` metadata row\)/);
  const m = manifest(out);
  assert.equal(m.servedSitemap, null);
  assert.deepEqual(m.fragments.map((f) => f.robots), ['noindex', 'noindex']);
  assert.equal(hits.length, before, 'no network call without the flag');
  rmSync(proj, { recursive: true, force: true });
});

await check('served set == assembled set (by path, host-agnostic, trailing slash normalized) → exit 0 and a recorded match', async () => {
  mode = 'exact';
  const { proj, out } = fixture();
  const r = await run(['--verify-origin', `${ORIGIN}/`], proj);
  assert.equal(r.code, 0, `${r.out}\n${r.err}`);
  assert.match(r.out, /served sitemap {2}\S+\/sitemap\.xml {2}4 urls {3}\(assembled 4\)/);
  assert.match(r.out, /✓ served sitemap matches the assembled set \(4 urls\)/);
  const s = manifest(out).servedSitemap;
  assert.equal(s.match, true); assert.equal(s.count, 4); assert.equal(s.assembled, 4); assert.deepEqual(s.extra, []); assert.deepEqual(s.missing, []);
  assert.equal(s.origin, ORIGIN, 'trailing slash stripped from the origin');
  rmSync(proj, { recursive: true, force: true });
});

await check('the recorded defect: chrome documents in the served sitemap → exit 1, counts + the extra paths named, the noindex remedy printed', async () => {
  mode = 'chrome';
  const { proj, out } = fixture();
  const r = await run(['--verify-origin', ORIGIN], proj);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /served sitemap {2}\S+ {2}9 urls {3}\(assembled 4\)/);
  assert.match(r.out, /extra {4}5: \/de, \/de\/footer-de, \/de\/nav-de, \/footer, \/nav/);
  assert.match(r.out, /Robots \| noindex/);
  assert.match(r.out, /missing {2}0\n/);
  assert.match(r.out, /✗ served sitemap does not match the assembled set \(served 9, assembled 4\)/);
  const s = manifest(out).servedSitemap;
  assert.equal(s.match, false); assert.deepEqual(s.extra, ['/de', '/de/footer-de', '/de/nav-de', '/footer', '/nav']); assert.deepEqual(s.missing, []);
  // the local artifacts are still written — the verify step never blocks assembly
  assert.equal(locs(readFileSync(join(out, 'site', 'sitemap.xml'), 'utf8')).length, 4);
  rmSync(proj, { recursive: true, force: true });
});

await check('a coverage page absent from the served sitemap → exit 1 with the missing path', async () => {
  mode = 'missing';
  const { proj, out } = fixture();
  const r = await run(['--verify-origin', ORIGIN], proj);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /extra {4}0\n/); assert.match(r.out, /missing {2}1: \/tours\/bali/);
  assert.deepEqual(manifest(out).servedSitemap.missing, ['/tours/bali']);
  rmSync(proj, { recursive: true, force: true });
});

await check('a sitemap index is followed on the verified origin (children re-hosted) and its union compared', async () => {
  mode = 'index';
  const { proj, out } = fixture();
  const before = hits.length;
  const r = await run(['--verify-origin', ORIGIN], proj);
  assert.equal(r.code, 0, `${r.out}\n${r.err}`);
  assert.deepEqual(hits.slice(before), ['/sitemap.xml', '/sitemap-en.xml', '/sitemap-de.xml']);
  assert.equal(manifest(out).servedSitemap.count, 4);
  rmSync(proj, { recursive: true, force: true });
});

await check('an unreadable served sitemap (HTML body, HTTP 404) fails closed: exit 1, reason printed and recorded', async () => {
  mode = 'html';
  let { proj, out } = fixture();
  let r = await run(['--verify-origin', ORIGIN], proj);
  assert.equal(r.code, 1, r.out); assert.match(r.out, /UNREADABLE — not a sitemap/); assert.match(manifest(out).servedSitemap.error, /not a sitemap/);
  rmSync(proj, { recursive: true, force: true });
  mode = 'gone';
  ({ proj, out } = fixture());
  r = await run(['--verify-origin', ORIGIN], proj);
  assert.equal(r.code, 1, r.out); assert.match(r.out, /UNREADABLE — HTTP 404/); assert.equal(manifest(out).servedSitemap.match, false);
  rmSync(proj, { recursive: true, force: true });
});

server.closeAllConnections(); server.close();
console.log(failed ? `\nassemble: ${failed} check(s) failed` : '\nassemble: all checks passed');
process.exit(failed ? 1 : 0);
