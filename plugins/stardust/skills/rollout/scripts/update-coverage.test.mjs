#!/usr/bin/env node
// Fixture test: update-coverage.mjs --from-ledger (T06.1 item 5 — the bulk reconcile that replaces per-page calls).
//
//   merge rules  live|previewed → deployed only from pending|converting|failed|stale; verified never
//                downgraded by a delivery; *-fail → failed with lastError (a newer `verified` verdict
//                survives an older ledger failure); ledger `pending` kept; content-pending kept.
//   deployedPath a ledger path that matches a row only by normalised key (`/About-Us.jsp` ↔ `/about-us`)
//                writes delivery.deployedPath = the served path on a live|previewed row; an exact
//                match writes none, and so does a pending or failed row (nothing was served there).
//   docs agree   rollout/SKILL.md and deploy/da-deploy-protocol.md both name `--from-ledger` as the
//                reconcile and neither instructs a per-page `--status deployed` call.
//   unmatched    a ledger path with no coverage row is counted and listed, never invented.
//   --url-base   deployedUrl = <origin><served path> on promotion.
//   idempotent   the second run over the same ledger promotes nothing; roll-ups re-derived; exit codes.
//   ledger shapes `/index` ≡ `/` and a trailing slash carry no deployedPath; a seeded deployedPath is
//                matched, not overwritten; every delivery key written is a schema key; the ledger
//                file is read-only here; a missing / non-object ledger is exit 2.
//   preconditions assemble, optimize, dashboard, update-coverage and verify exit 2 on a missing
//                coverage/pages.json (2 = usage / precondition, so 1 keeps one meaning per script);
//                redirects alone keeps 1 — its exit 2 is the shadow gate. Every script in the family
//                answers --help with exit 0.
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
  assert.equal(run('--from-ledger', join(T, 'nope.json'), '--out', OUT).status, 2, 'missing ledger exits 2 (the family precondition code)');
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

  // deployedPath is a SERVED path: a pending (halt-reset) or failed ledger row matching a
  // coverage row only by normalised key writes none and counts none (before the fix
  // `/Contact.aspx` pending + ledger `/contact: pending` → deployedPath '/contact')
  {
    const pages = [row('k', '/Contact.aspx', { status: 'pending' }), row('m', '/Team.aspx', { status: 'pending' }), row('n', '/News.aspx', { status: 'pending' })];
    const { counts: c } = mergeLedgerIntoCoverage(pages, { '/contact': { status: 'pending', ts }, '/team': { status: 'put-fail', ts, lastError: 'PUT 500' }, '/news': { status: 'live', ts } });
    assert.deepEqual([pages[0].delivery.status, pages[0].delivery.deployedPath], ['pending', undefined], 'ledger pending: nothing served → no deployedPath');
    assert.deepEqual([pages[1].delivery.status, pages[1].delivery.deployedPath], ['failed', undefined], 'ledger failure: nothing served → no deployedPath');
    assert.deepEqual([pages[2].delivery.status, pages[2].delivery.deployedPath], ['deployed', '/news'], 'a served row still records where it was served');
    assert.equal(c.deployedPath, 1, 'only the served row counts as deployedPath written');
  }

  // the two skills that record the procedure agree: the ledger reconcile replaces per-page
  // `--status deployed` calls (rollout/SKILL.md and deploy/da-deploy-protocol.md name --from-ledger)
  const rolloutSkill = readFileSync(join(HERE, '..', 'SKILL.md'), 'utf8');
  const protocol = readFileSync(join(HERE, '..', '..', 'deploy', 'da-deploy-protocol.md'), 'utf8');
  assert.ok(!/update-coverage\.mjs <slug> --status deployed/.test(rolloutSkill), 'rollout/SKILL.md no longer instructs the per-page --status deployed call');
  assert.match(rolloutSkill, /update-coverage\.mjs --from-ledger/, 'rollout/SKILL.md names --from-ledger as the reconcile');
  assert.match(protocol, /update-coverage\.mjs --from-ledger/, 'da-deploy-protocol.md names --from-ledger');

  // verified newer than a ledger failure keeps its verdict (pure helper)
  const { counts } = mergeLedgerIntoCoverage([row('v', '/v', { status: 'verified', verifiedAt: NEW })], { '/v': { status: 'put-fail', ts, lastError: 'old' } });
  assert.deepEqual([counts.kept, counts.failed], [1, 0], 'an older ledger failure never overrides a newer verified verdict');
  console.log('update-coverage.test: ok (--from-ledger merge rules, deployedPath, unmatched, url-base, idempotent, roll-ups, exit codes)');
} finally {
  rmSync(T, { recursive: true, force: true });
}

// ---- the rollout lane's cases: ledger shapes, schema keys, read-only ledger, family precondition exit
{
  const SCHEMA = json(join(HERE, '..', 'schemas', 'rollout-pages.schema.json'));
  const DELIVERY_KEYS = new Set(Object.keys(SCHEMA.$defs.page.properties.delivery.properties));
  const T2 = mkdtempSync(join(tmpdir(), 'update-coverage-test2-'));
  try {
    const OUT2 = join(T2, 'rollout'); const LEDGER = join(T2, 'content', '.deploy-ledger.json');
    mkdirSync(join(OUT2, 'coverage'), { recursive: true }); mkdirSync(join(T2, 'content'), { recursive: true });
    const row2 = (slug, path, status, extra = {}) => ({ slug, path, title: slug, templateId: 't', source: { migratedHtml: null, metaJson: null, sourceHash: 'sha256:0' }, blocks: [], delivery: { status, deployedUrl: null, deployedAt: null, verifiedAt: null, error: null, ...extra } });
    writeFileSync(join(OUT2, 'coverage', 'pages.json'), JSON.stringify({ pages: [
      row2('index', '/', 'pending'), row2('a', '/a', 'pending'), row2('conv', '/conv', 'converting'), row2('st', '/st', 'stale'),
      row2('v', '/v', 'verified', { verifiedAt: '2026-01-01T00:00:00.000Z' }), row2('dep', '/dep', 'deployed', { deployedAt: '2026-01-02T00:00:00.000Z' }),
      row2('cp', '/cp', 'content-pending'), row2('about', '/about.jsp', 'pending'), row2('business', '/business', 'pending', { deployedPath: '/commercial' }),
      row2('f', '/f', 'deployed'), row2('v2', '/v2', 'verified'), row2('pend', '/pend', 'pending'),
    ] }));
    writeFileSync(join(OUT2, 'rollout.json'), JSON.stringify({ site: { liveHost: 'https://main--x--y.aem.live/' }, lastRun: {} }));
    const rec = (status, extra = {}) => ({ status, attempts: 1, ts: '2026-03-01T00:00:00.000Z', put: 201, preview: 200, live: 200, verify: true, lastError: null, bodyHash: 'abc', branch: 'main', ...extra });
    writeFileSync(LEDGER, JSON.stringify({
      '/index': rec('live'), '/a/': rec('previewed'), '/conv': rec('live'), '/st': rec('live'), '/v': rec('live'), '/dep': rec('live'),
      '/cp': rec('live'), '/about': rec('live'), '/commercial': rec('live'), '/f': rec('put-fail', { lastError: 'PUT 500' }),
      '/v2': rec('verify-fail', { lastError: 'about:error in body' }), '/pend': rec('pending'), '/ghost': rec('live'),
    }));
    const ledgerBytes = readFileSync(LEDGER, 'utf8');
    const status = (slug) => json(join(OUT2, 'coverage', 'pages.json')).pages.find((p) => p.slug === slug).delivery;

    let r = run('--from-ledger', LEDGER, '--out', OUT2);
    assert.equal(r.status, 0, `--from-ledger exits 0\n${r.stderr}`);
    assert.match(r.stdout, /13 rows · 6 → deployed · 2 → failed · 4 kept · 1 unmatched · 1 deployedPath written/, `one summary line: ${r.stdout}`);
    assert.match(r.stderr, /unmatched .*: \/ghost/, 'the unmatched path is listed');
    assert.deepEqual([status('index').status, status('index').deployedPath], ['deployed', undefined], '`/index` ≡ `/` — no deployedPath carried for the same resource');
    assert.deepEqual([status('a').status, status('a').deployedAt, status('a').deployedPath], ['deployed', '2026-03-01T00:00:00.000Z', undefined], 'previewed → deployed, deployedAt = ledger ts, trailing slash ignored');
    assert.deepEqual([status('conv').status, status('st').status], ['deployed', 'deployed'], 'converting and stale rows flip to deployed');
    assert.deepEqual([status('v').status, status('v').verifiedAt], ['verified', '2026-01-01T00:00:00.000Z'], 'a verified row is never downgraded');
    assert.deepEqual([status('dep').status, status('dep').deployedAt], ['deployed', '2026-01-02T00:00:00.000Z'], 'an already-deployed row keeps its deployedAt');
    assert.equal(status('cp').status, 'content-pending', 'content-pending is untouched by a live row');
    assert.deepEqual([status('about').status, status('about').deployedPath], ['deployed', '/about'], 'source-slug row matched at its served path carries deployedPath');
    assert.deepEqual([status('business').status, status('business').deployedPath], ['deployed', '/commercial'], 'a seeded deployedPath is matched and kept');
    assert.deepEqual([status('f').status, status('f').error], ['failed', 'PUT 500'], '*-fail → failed with the ledger lastError');
    assert.deepEqual([status('v2').status, status('v2').error], ['failed', 'about:error in body'], 'verify-fail → failed on a verified row with no verifiedAt (the ledger verdict is the newer one)');
    assert.equal(status('pend').status, 'pending', 'a ledger `pending` row is no verdict');
    assert.ok(!json(join(OUT2, 'coverage', 'pages.json')).pages.some((p) => p.slug === 'ghost' || p.path === '/ghost'), 'an unmatched ledger path is never invented as a row');
    for (const p of json(join(OUT2, 'coverage', 'pages.json')).pages) for (const k of Object.keys(p.delivery)) assert.ok(DELIVERY_KEYS.has(k), `${p.slug}: delivery.${k} is a schema key`);
    const cfg = json(join(OUT2, 'rollout.json'));
    assert.deepEqual([cfg.lastRun.pages.deployed, cfg.lastRun.pages.failed, cfg.lastRun.pages.verified], [7, 2, 1], 'rollout.json roll-ups re-derived');
    assert.equal(readFileSync(LEDGER, 'utf8'), ledgerBytes, 'the ledger is read-only here');

    const before = json(join(OUT2, 'coverage', 'pages.json')).pages.map((p) => p.delivery);
    r = run('--from-ledger', LEDGER, '--out', OUT2);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /0 → deployed · 2 → failed · 10 kept/, 'second run: nothing left to flip (fail rows re-stamp the same verdict)');
    assert.deepEqual(json(join(OUT2, 'coverage', 'pages.json')).pages.map((p) => p.delivery), before, 'second run changes no delivery');

    // usage / ledger validity
    assert.equal(run('--from-ledger', '--out', OUT2).status, 2, '--from-ledger without a path → exit 2');
    writeFileSync(join(T2, 'list.json'), '[1,2]');
    assert.equal(run('--from-ledger', join(T2, 'list.json'), '--out', OUT2).status, 2, 'a non-object ledger → exit 2');
    assert.equal(run('--from-ledger', LEDGER, '--out', join(T2, 'nowhere')).status, 2, 'coverage missing → exit 2');

    // family precondition exit (coverage missing → 2, the verify.mjs code)
    const NOWHERE = join(T2, 'nowhere');
    const node = (script, args) => spawnSync(process.execPath, [join(HERE, script), ...args], { encoding: 'utf8' });
    const pre = {
      'assemble.mjs': ['--out', NOWHERE],
      'optimize.mjs': ['--root', T2, '--out', NOWHERE],
      'dashboard.mjs': ['--out', NOWHERE],
      'update-coverage.mjs': ['a', '--status', 'deployed', '--out', NOWHERE],
      'update-coverage.mjs --block': ['--block', 'hero', '--status', 'converted', '--out', NOWHERE],
      'verify.mjs': ['--root', T2, '--out', NOWHERE],
    };
    for (const [label, args] of Object.entries(pre)) {
      const res = node(label.split(' ')[0], args);
      assert.equal(res.status, 2, `${label}: coverage missing → exit 2 (got ${res.status}; ${res.stderr.trim()})`);
      assert.match(res.stderr, /run (inventory|blocks)\.mjs first/, `${label}: names the precondition`);
    }
    assert.equal(node('redirects.mjs', ['--out', NOWHERE]).status, 1, 'redirects keeps exit 1 for missing input — its exit 2 is the shadow gate');
    for (const sc of ['assemble.mjs', 'optimize.mjs', 'dashboard.mjs', 'update-coverage.mjs', 'verify.mjs', 'redirects.mjs']) assert.equal(node(sc, ['--help']).status, 0, `${sc} --help exits 0`);
    console.log('update-coverage.test: ok (ledger shapes, schema keys, read-only ledger, ledger validity exits; family precondition exit 2, redirects exception, --help)');
  } finally {
    rmSync(T2, { recursive: true, force: true });
  }
}

// ---- the template claim gate (T28.4 Gate B): --block … --status verified follows the archetype's published pass
{
  const { archetypePublishedPass, ungatedClause } = await import('./lib.mjs');
  const T3 = mkdtempSync(join(tmpdir(), 'update-coverage-test3-'));
  try {
    const OUT3 = join(T3, 'stardust', 'rollout');
    mkdirSync(join(OUT3, 'coverage'), { recursive: true }); mkdirSync(join(T3, 'stardust', 'replica'), { recursive: true });
    const page = (slug, path, templateId, blocks) => ({ slug, path, title: slug, templateId, source: { sourceHash: 'h' }, blocks, delivery: { status: 'deployed' } });
    writeFileSync(join(OUT3, 'coverage', 'pages.json'), JSON.stringify({ pages: [page('home', '/', 'home', ['hero']), page('business', '/business', 'home', ['hero']), page('insurance__home', '/insurance/home', 'insurance__home', ['quote-cta']), page('leaf', '/leaf', 'thin:leaf', ['plain'])] }));
    writeFileSync(join(OUT3, 'coverage', 'templates.json'), JSON.stringify({ templates: [
      { id: 'home', representativeSlug: 'home', pages: ['home', 'business'], blocks: ['hero'] },
      { id: 'insurance__home', representativeSlug: 'insurance__home', pages: ['insurance__home'], blocks: ['quote-cta'] },
      { id: 'thin:leaf', representativeSlug: 'leaf', pages: ['leaf'], blocks: ['plain'] },
    ] }));
    const blk = (id, templates) => ({ id, usedByTemplates: templates, usedByPages: [], delivery: { status: 'deployed', edsBlockName: id } });
    writeFileSync(join(OUT3, 'coverage', 'blocks.json'), JSON.stringify({ blocks: [blk('hero', ['home']), blk('quote-cta', ['insurance__home']), blk('shared', ['home', 'insurance__home']), blk('plain', ['thin:leaf'])] }));
    writeFileSync(join(OUT3, 'rollout.json'), JSON.stringify({ site: { liveHost: 'https://main--x--y.aem.live/' }, lastRun: {} }));
    const pass = { pass: true, pixelPct: 2.1 };
    const progress = { breakpointsConfigured: [1440, 360], archetypes: [
      { pageType: 'landing', archetype: 'home', gated: true, published: { 1440: pass, 360: { result: { pass: true } } } }, // both shapes progress-record.mjs writes
      { pageType: 'program', archetype: 'insurance__home', gated: false },
    ] };
    writeFileSync(join(T3, 'stardust', 'replica', 'progress.json'), JSON.stringify(progress));
    const bstatus = (id) => json(join(OUT3, 'coverage', 'blocks.json')).blocks.find((b) => b.id === id).delivery.status;

    // pure helper: absent published slot = ungated (not FAIL); pass:false = failed; thin templates are not gate-bound
    assert.deepEqual(archetypePublishedPass(progress, { id: 'home', representativeSlug: 'home' }).ok, true);
    assert.deepEqual(archetypePublishedPass(progress, { id: 'insurance__home', representativeSlug: 'insurance__home' }).ungated, [{ bp: '1440', state: 'ungated' }, { bp: '360', state: 'ungated' }]);
    assert.deepEqual(archetypePublishedPass({ ...progress, archetypes: [{ pageType: 'landing', archetype: 'home', published: { 1440: pass, 360: { pass: false } } }] }, { id: 'home' }).ungated, [{ bp: '360', state: 'failed' }]);
    assert.equal(archetypePublishedPass(progress, { id: 'home' }, [1440]).ok, true, 'rollout.json breakpoints override the configured list');
    assert.equal(archetypePublishedPass(progress, { id: 'thin:leaf' }).thin, true);
    assert.equal(archetypePublishedPass(null, { id: 'home' }).ok, false, 'no progress file → ungated');
    assert.deepEqual(ungatedClause(progress, json(join(OUT3, 'coverage', 'templates.json')).templates), ['program archetype insurance__home@1440', 'program archetype insurance__home@360'], 'the Blocks-line clause names <T> archetype <slug>@<bp> — absent slot is ungated, never FAIL');

    // CLI: the landing block verifies; the program block is refused (exit 2) naming archetype × bp; a block shared with an ungated template is refused too
    let r = run('--block', 'hero', '--status', 'verified', '--out', OUT3);
    assert.equal(r.status, 0, `home passed published at 1440 + 360 → hero verifies\n${r.stderr}`); assert.equal(bstatus('hero'), 'verified');
    r = run('--block', 'quote-cta', '--status', 'verified', '--out', OUT3);
    assert.equal(r.status, 2, 'ungated archetype → the verified claim is refused'); assert.match(r.stderr, /quote-cta cannot be verified — program archetype insurance__home ungated at 1440, program archetype insurance__home ungated at 360/); assert.match(r.stderr, /never edit the ledger/);
    assert.equal(bstatus('quote-cta'), 'deployed', 'status untouched by a refused claim');
    r = run('--block', 'shared', '--status', 'verified', '--out', OUT3); assert.equal(r.status, 2, 'every template using the block must be gated'); assert.equal(bstatus('shared'), 'deployed');
    r = run('--block', 'plain', '--status', 'verified', '--out', OUT3); assert.equal(r.status, 0, 'a thin template has no archetype to gate'); assert.equal(bstatus('plain'), 'verified');
    r = run('--block', 'quote-cta', '--status', 'deployed', '--out', OUT3); assert.equal(r.status, 0, 'other statuses are not gated');
    // the dashboard prints the same clause on its Blocks line and records it in data.json
    r = spawnSync(process.execPath, [join(HERE, 'dashboard.mjs'), '--out', OUT3], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^Blocks 4 total · 4 converted · 2 verified · ungated: program archetype insurance__home@1440 · program archetype insurance__home@360$/m);
    assert.deepEqual(json(join(OUT3, 'dashboard', 'data.json')).blocks.ungated, ['program archetype insurance__home@1440', 'program archetype insurance__home@360']);
    // the archetype gated later → the claim goes through (the ledger is the only path; the test writes what progress-record.mjs would)
    progress.archetypes[1].published = { 1440: pass, 360: pass }; writeFileSync(join(T3, 'stardust', 'replica', 'progress.json'), JSON.stringify(progress));
    r = run('--block', 'quote-cta', '--status', 'verified', '--out', OUT3); assert.equal(r.status, 0, r.stderr); assert.equal(bstatus('quote-cta'), 'verified');
    // a failed published pass is `failed at <bp>`, still refused
    progress.archetypes[1].published[360] = { pass: false }; writeFileSync(join(T3, 'stardust', 'replica', 'progress.json'), JSON.stringify(progress));
    r = run('--block', 'shared', '--status', 'verified', '--out', OUT3); assert.equal(r.status, 2); assert.match(r.stderr, /insurance__home failed at 360/);
    // flow: redesign → the check is skipped and printed as skipped (the published-origin gate is replica's)
    writeFileSync(join(T3, 'stardust', 'state.json'), JSON.stringify({ flow: 'redesign' }));
    r = run('--block', 'shared', '--status', 'verified', '--out', OUT3); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /published-origin check skipped under flow: redesign/);
    r = spawnSync(process.execPath, [join(HERE, 'dashboard.mjs'), '--out', OUT3], { encoding: 'utf8' }); assert.doesNotMatch(r.stdout, /ungated:/, 'no ungated clause under redesign');
    // the rule lives in one reference and the operator card points at it
    const model = readFileSync(join(HERE, '..', 'reference', 'coverage-model.md'), 'utf8');
    assert.match(model, /published\.<bp>\.pass/, 'coverage-model.md § Block delivery status lifecycle carries the claim-gate rule');
    assert.match(readFileSync(join(HERE, '..', 'SKILL.md'), 'utf8'), /Block delivery status lifecycle/, 'the operator card points at the section');
    console.log('update-coverage.test: ok (template claim gate: --block … --status verified refused until the archetype passed the published-origin gate at every breakpoint; thin templates exempt; redesign skipped; dashboard Blocks line)');
  } finally {
    rmSync(T3, { recursive: true, force: true });
  }
}
