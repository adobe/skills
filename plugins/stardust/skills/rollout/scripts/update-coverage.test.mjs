#!/usr/bin/env node
// Fixture test: update-coverage.mjs --from-ledger (T06.1 item 5 — the bulk reconcile that replaces per-page calls).
//
//   merge rules  live|previewed → deployed only from pending|converting|failed|stale; verified never
//                downgraded by a delivery; *-fail → failed with lastError (a newer `verified` verdict
//                survives an older ledger failure); ledger `pending` kept; content-pending kept.
//   deployedPath a ledger path that matches a row only by normalised key (`/About-Us.jsp` ↔ `/about-us`)
//                writes delivery.deployedPath = the served path; an exact match writes none.
//   unmatched    a ledger path with no coverage row is counted and listed, never invented.
//   --url-base   deployedUrl = <origin><served path> on promotion.
//   idempotent   the second run over the same ledger promotes nothing; roll-ups re-derived; exit codes.
//
// Usage: node plugins/stardust/skills/rollout/scripts/update-coverage.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathKey, mergeLedgerIntoCoverage } from './update-coverage.mjs';

const HERE = import.meta.dirname;
const CLI = join(HERE, 'update-coverage.mjs');
const run = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8' });
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));

// pure helpers
assert.equal(pathKey('/About-Us.jsp'), '/about-us');
assert.equal(pathKey('/blog/index.html'), '/blog');
assert.equal(pathKey('/x/'), '/x');
assert.equal(pathKey('//'), '/');
assert.equal(pathKey('/index'), '/');

const T = mkdtempSync(join(tmpdir(), 'update-coverage-test-'));
const OUT = join(T, 'rollout');
mkdirSync(join(OUT, 'coverage'), { recursive: true });
const pagesPath = join(OUT, 'coverage', 'pages.json');
const row = (slug, path, delivery) => ({ slug, path, template: 'article', source: { sourceHash: 'h' }, blocks: [], delivery });
const OLD = '2026-01-01T00:00:00.000Z'; const NEW = '2026-09-01T00:00:00.000Z';
writeFileSync(pagesPath, JSON.stringify({
  generatedAt: OLD,
  pages: [
    row('a', '/a', { status: 'pending' }),
    row('b', '/b', { status: 'verified', verifiedAt: NEW, deployedUrl: 'https://old.example/b' }),
    row('c', '/c', { status: 'stale', deployedUrl: 'https://old.example/c' }),
    row('d', '/d', { status: 'deployed', deployedAt: OLD }),
    row('e', '/About-Us.jsp', { status: 'pending' }),
    row('f', '/f', { status: 'verified', verifiedAt: OLD }),
    row('g', '/g', { status: 'content-pending' }),
    row('h', '/h', { status: 'deployed', deployedAt: OLD }),
    row('i', '/i', { status: 'converting' }),
  ],
}, null, 2));
writeFileSync(join(OUT, 'coverage', 'templates.json'), JSON.stringify({ templates: [{ id: 'article', pages: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }] }));
writeFileSync(join(OUT, 'rollout.json'), JSON.stringify({ site: { liveHost: 'example.test' } }));
const ledgerPath = join(T, '.deploy-ledger.json');
const ts = '2026-06-01T00:00:00.000Z';
writeFileSync(ledgerPath, JSON.stringify({
  '/a': { status: 'previewed', attempts: 1, ts, bodyHash: 'x' },
  '/b': { status: 'live', attempts: 1, ts },
  '/c': { status: 'live', attempts: 2, ts },
  '/d': { status: 'verify-fail', attempts: 3, ts, lastError: 'about:error (persists after re-preview)' },
  '/about-us': { status: 'previewed', attempts: 1, ts },
  '/f': { status: 'put-fail', attempts: 1, ts, lastError: 'PUT 500 boom' },
  '/g': { status: 'previewed', attempts: 1, ts },
  '/h': { status: 'pending', attempts: 1, ts },
  '/i': { status: 'live', attempts: 1, ts },
  '/zzz': { status: 'live', attempts: 1, ts },
}));

try {
  // exit codes: missing ledger → 1; usage clash → 2; --help → 0
  assert.equal(run('--from-ledger', join(T, 'nope.json'), '--out', OUT).status, 1, 'missing ledger exits 1');
  assert.equal(run('a', '--status', 'deployed', '--from-ledger', ledgerPath, '--out', OUT).status, 2, 'slug + --from-ledger is a usage error');
  assert.equal(run('--help').status, 0);
  assert.match(run('--help').stdout, /--from-ledger/);

  let r = run('--from-ledger', ledgerPath, '--url-base', 'https://main--r--o.aem.page/', '--out', OUT);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), `from-ledger ${ledgerPath}: 10 rows · 4 → deployed · 2 → failed · 3 kept · 1 unmatched · 1 deployedPath written`, r.stdout);
  assert.match(r.stderr, /unmatched .*: \/zzz/);
  let pages = Object.fromEntries(json(pagesPath).pages.map((p) => [p.slug, p.delivery]));
  assert.equal(pages.a.status, 'deployed'); assert.equal(pages.a.deployedAt, ts); assert.equal(pages.a.deployedUrl, 'https://main--r--o.aem.page/a', 'url-base joins the served path');
  assert.equal(pages.b.status, 'verified', 'verified is never downgraded by a delivery'); assert.equal(pages.b.deployedUrl, 'https://old.example/b', 'kept rows keep their url');
  assert.equal(pages.c.status, 'deployed', 'stale → deployed'); assert.equal(pages.c.deployedUrl, 'https://main--r--o.aem.page/c');
  assert.equal(pages.d.status, 'failed'); assert.equal(pages.d.error, 'about:error (persists after re-preview)', 'lastError carried');
  assert.equal(pages.e.status, 'deployed', 'normalised match'); assert.equal(pages.e.deployedPath, '/about-us', 'served path written when it differs from path'); assert.equal(pages.e.deployedUrl, 'https://main--r--o.aem.page/about-us');
  assert.equal(pages.a.deployedPath, undefined, 'exact match writes no deployedPath');
  assert.equal(pages.f.status, 'failed', 'a ledger failure newer than the verified verdict wins'); assert.equal(pages.f.error, 'PUT 500 boom');
  assert.equal(pages.g.status, 'content-pending', 'content-pending is not promotable (inventory advances it)');
  assert.equal(pages.h.status, 'deployed', 'ledger pending (halt reset) keeps the row');
  assert.equal(pages.i.status, 'deployed', 'converting → deployed');
  assert.equal(json(pagesPath).pages.length, 9, 'no row invented for /zzz');
  const tpl = json(join(OUT, 'coverage', 'templates.json')).templates[0].delivery;
  assert.deepEqual(tpl, { verified: 1, deployed: 5, contentPending: 1, pending: 2 }, 'templates roll-up re-derived');
  const cfg = json(join(OUT, 'rollout.json')).lastRun.pages;
  assert.deepEqual([cfg.total, cfg.deployed, cfg.verified, cfg.failed], [9, 5, 1, 2], 'rollout.json roll-up re-derived');

  // idempotent: same ledger again → nothing promoted, nothing changed but generatedAt
  const before = json(pagesPath);
  r = run('--from-ledger', ledgerPath, '--out', OUT);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout.trim(), /0 → deployed · 2 → failed · 7 kept · 1 unmatched$/, `second run: ${r.stdout}`);
  const after = json(pagesPath);
  assert.deepEqual(after.pages, before.pages, 'second run is a no-op on the rows');

  // verified newer than a ledger failure keeps its verdict (pure helper)
  const { counts } = mergeLedgerIntoCoverage([row('v', '/v', { status: 'verified', verifiedAt: NEW })], { '/v': { status: 'put-fail', ts, lastError: 'old' } });
  assert.deepEqual([counts.kept, counts.failed], [1, 0], 'an older ledger failure never overrides a newer verified verdict');
  console.log('update-coverage.test: ok (--from-ledger merge rules, deployedPath, unmatched, url-base, idempotent, roll-ups, exit codes)');
} finally {
  rmSync(T, { recursive: true, force: true });
}
