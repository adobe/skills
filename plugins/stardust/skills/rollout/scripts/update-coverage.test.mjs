#!/usr/bin/env node
// Fixture test: rollout/scripts/update-coverage.mjs --from-ledger + the family precondition exit.
//
//   --from-ledger  reconciles a deploy-batch ledger into coverage/pages.json in one pass
//                  (coverage-model.md § Verify; T06.1 item 7): live | previewed flips only
//                  pending | converting | failed | stale to `deployed` (verified and deployed
//                  rows keep their status and stamps, content-pending is untouched); *-fail
//                  → `failed` with the ledger's lastError; a ledger `pending` row is no
//                  verdict; `/index` ≡ `/`, trailing slashes are ignored; a row keyed by its
//                  source slug (`/about.jsp`) matched at its served path (`/about`) carries
//                  delivery.deployedPath; a seeded deployedPath is matched, not overwritten;
//                  a ledger path with no coverage row is listed on stdout, never invented;
//                  a second run changes nothing (idempotent); every delivery key written is
//                  one the schema lists; roll-ups are re-derived; the ledger file is untouched.
//   preconditions  assemble, optimize, dashboard and update-coverage exit 2 on a missing
//                  coverage/pages.json, the code verify.mjs uses (2 = usage / precondition, so
//                  1 keeps one meaning per script); redirects alone keeps 1 — its exit 2 is
//                  the shadow gate. Every script in the family answers --help with exit 0.
//
// Usage: node plugins/stardust/skills/rollout/scripts/update-coverage.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = import.meta.dirname;
const node = (script, args, opts = {}) => spawnSync(process.execPath, [join(HERE, script), ...args], { encoding: 'utf8', ...opts });
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const SCHEMA = json(join(HERE, '..', 'schemas', 'rollout-pages.schema.json'));
const DELIVERY_KEYS = new Set(Object.keys(SCHEMA.$defs.page.properties.delivery.properties));

const T = mkdtempSync(join(tmpdir(), 'update-coverage-test-'));
const OUT = join(T, 'rollout'); const LEDGER = join(T, 'content', '.deploy-ledger.json');
mkdirSync(join(OUT, 'coverage'), { recursive: true }); mkdirSync(join(T, 'content'), { recursive: true });

const row = (slug, path, status, extra = {}) => ({ slug, path, title: slug, templateId: 't', source: { migratedHtml: null, metaJson: null, sourceHash: 'sha256:0' }, blocks: [], delivery: { status, deployedUrl: null, deployedAt: null, verifiedAt: null, error: null, ...extra } });
const seed = () => {
  writeFileSync(join(OUT, 'coverage', 'pages.json'), JSON.stringify({ pages: [
    row('index', '/', 'pending'), row('a', '/a', 'pending'), row('conv', '/conv', 'converting'), row('st', '/st', 'stale'),
    row('v', '/v', 'verified', { verifiedAt: '2026-01-01T00:00:00.000Z' }), row('dep', '/dep', 'deployed', { deployedAt: '2026-01-02T00:00:00.000Z' }),
    row('cp', '/cp', 'content-pending'), row('about', '/about.jsp', 'pending'), row('business', '/business', 'pending', { deployedPath: '/commercial' }),
    row('f', '/f', 'deployed'), row('v2', '/v2', 'verified'), row('pend', '/pend', 'pending'),
  ] }));
  writeFileSync(join(OUT, 'rollout.json'), JSON.stringify({ site: { liveHost: 'https://main--x--y.aem.live/' }, lastRun: {} }));
};
const rec = (status, extra = {}) => ({ status, attempts: 1, ts: '2026-03-01T00:00:00.000Z', put: 201, preview: 200, live: 200, verify: true, lastError: null, bodyHash: 'abc', branch: 'main', ...extra });
const ledger = {
  '/index': rec('live'), '/a/': rec('previewed'), '/conv': rec('live'), '/st': rec('live'), '/v': rec('live'), '/dep': rec('live'),
  '/cp': rec('live'), '/about': rec('live'), '/commercial': rec('live'), '/f': rec('put-fail', { lastError: 'PUT 500' }),
  '/v2': rec('verify-fail', { lastError: 'about:error in body' }), '/pend': rec('pending'), '/ghost': rec('live'),
};
writeFileSync(LEDGER, JSON.stringify(ledger));
const ledgerBytes = readFileSync(LEDGER, 'utf8');
seed();
const status = (slug) => json(join(OUT, 'coverage', 'pages.json')).pages.find((p) => p.slug === slug).delivery;

// --- --from-ledger merge rules ------------------------------------------------------
let r = node('update-coverage.mjs', ['--from-ledger', LEDGER, '--out', OUT]);
assert.equal(r.status, 0, `--from-ledger exits 0\n${r.stderr}`);
assert.match(r.stdout, /13 rows · 6 → deployed · 2 → failed · 4 kept · 1 unmatched \(no coverage row\): \/ghost/, `one summary line: ${r.stdout}`);
assert.deepEqual([status('index').status, status('index').deployedPath], ['deployed', undefined], '`/index` ≡ `/` — no deployedPath carried for the same path');
assert.deepEqual([status('a').status, status('a').deployedAt, status('a').deployedPath], ['deployed', '2026-03-01T00:00:00.000Z', undefined], 'previewed → deployed, deployedAt = ledger ts, trailing slash ignored');
assert.deepEqual([status('conv').status, status('st').status], ['deployed', 'deployed'], 'converting and stale rows flip to deployed');
assert.deepEqual([status('v').status, status('v').verifiedAt], ['verified', '2026-01-01T00:00:00.000Z'], 'a verified row is never downgraded');
assert.deepEqual([status('dep').status, status('dep').deployedAt], ['deployed', '2026-01-02T00:00:00.000Z'], 'an already-deployed row keeps its deployedAt');
assert.equal(status('cp').status, 'content-pending', 'content-pending is untouched by a live row');
assert.deepEqual([status('about').status, status('about').deployedPath], ['deployed', '/about'], 'source-slug row matched at its served path carries deployedPath');
assert.deepEqual([status('business').status, status('business').deployedPath], ['deployed', '/commercial'], 'a seeded deployedPath is matched and kept');
assert.deepEqual([status('f').status, status('f').error], ['failed', 'PUT 500'], '*-fail → failed with the ledger lastError');
assert.deepEqual([status('v2').status, status('v2').error], ['failed', 'about:error in body'], 'verify-fail → failed even on a verified row (a later verdict)');
assert.equal(status('pend').status, 'pending', 'a ledger `pending` row is no verdict');
assert.ok(!json(join(OUT, 'coverage', 'pages.json')).pages.some((p) => p.slug === 'ghost' || p.path === '/ghost'), 'an unmatched ledger path is never invented as a row');
for (const p of json(join(OUT, 'coverage', 'pages.json')).pages) for (const k of Object.keys(p.delivery)) assert.ok(DELIVERY_KEYS.has(k), `${p.slug}: delivery.${k} is a schema key`);
const cfg = json(join(OUT, 'rollout.json'));
assert.deepEqual([cfg.lastRun.pages.deployed, cfg.lastRun.pages.failed, cfg.lastRun.pages.verified], [7, 2, 1], 'rollout.json roll-ups re-derived');
assert.equal(readFileSync(LEDGER, 'utf8'), ledgerBytes, 'the ledger is read-only here');

// idempotent: a second run writes the same deliveries
const before = json(join(OUT, 'coverage', 'pages.json')).pages.map((p) => p.delivery);
r = node('update-coverage.mjs', ['--from-ledger', LEDGER, '--out', OUT]);
assert.equal(r.status, 0);
assert.match(r.stdout, /0 → deployed · 2 → failed · 10 kept/, 'second run: nothing left to flip (fail rows re-stamp the same verdict)');
assert.deepEqual(json(join(OUT, 'coverage', 'pages.json')).pages.map((p) => p.delivery), before, 'second run changes no delivery');

// usage
assert.equal(node('update-coverage.mjs', ['--from-ledger', '--out', OUT]).status, 2, '--from-ledger without a path → exit 2');
assert.equal(node('update-coverage.mjs', ['--from-ledger', join(T, 'nope.json'), '--out', OUT]).status, 2, 'unreadable ledger → exit 2');
writeFileSync(join(T, 'list.json'), '[1,2]');
assert.equal(node('update-coverage.mjs', ['--from-ledger', join(T, 'list.json'), '--out', OUT]).status, 2, 'a non-object ledger → exit 2');
assert.equal(node('update-coverage.mjs', ['--from-ledger', LEDGER, '--out', join(T, 'nowhere')]).status, 2, 'coverage missing → exit 2');

// --- family precondition exit (coverage missing → 2, the verify.mjs code) ---------------
const NOWHERE = join(T, 'nowhere');
const pre = {
  'assemble.mjs': ['--out', NOWHERE],
  'optimize.mjs': ['--root', T, '--out', NOWHERE],
  'dashboard.mjs': ['--out', NOWHERE],
  'update-coverage.mjs': ['a', '--status', 'deployed', '--out', NOWHERE],
  'update-coverage.mjs --block': ['--block', 'hero', '--status', 'converted', '--out', NOWHERE],
  'verify.mjs': ['--root', T, '--out', NOWHERE],
};
for (const [label, args] of Object.entries(pre)) {
  const res = node(label.split(' ')[0], args);
  assert.equal(res.status, 2, `${label}: coverage missing → exit 2 (got ${res.status}; ${res.stderr.trim()})`);
  assert.match(res.stderr, /run (inventory|blocks)\.mjs first/, `${label}: names the precondition`);
}
assert.equal(node('redirects.mjs', ['--out', NOWHERE]).status, 1, 'redirects keeps exit 1 for missing input — its exit 2 is the shadow gate');
for (const s of ['assemble.mjs', 'optimize.mjs', 'dashboard.mjs', 'update-coverage.mjs', 'verify.mjs', 'redirects.mjs']) assert.equal(node(s, ['--help']).status, 0, `${s} --help exits 0`);

rmSync(T, { recursive: true, force: true });
console.log('update-coverage.test: ok (--from-ledger merge rules, deployedPath carry, unmatched listed, idempotent, schema keys, usage exits; family precondition exit 2, redirects exception, --help)');
