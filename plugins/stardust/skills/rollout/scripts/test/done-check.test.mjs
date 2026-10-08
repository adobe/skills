#!/usr/bin/env node
// skills/rollout/scripts/test/done-check.test.mjs — the completion verdict of done-check.mjs: each gap fires
// on its own condition and only then (unfinished rows, failed rows and failed gate rows, delivered rows the
// live host does not serve, open P1 findings the optimize gate would count, a rollout whose last I-dashboard
// line is not an `end`); a clean run is complete; the live probe keeps input order and treats non-200 and
// network errors as not live; the CLI exits 0 / 1 / 2 and --offline says the probe was skipped. Offline: the
// probe runs against a stub fetch. --help writes nothing.
// Run: node plugins/stardust/skills/rollout/scripts/test/done-check.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { doneGaps, deliveredPaths, openP1, probeLive, rolloutEnded } from '../done-check.mjs';
import { SOURCE_PARITY_PREFIX } from '../lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'done-check.mjs');
let failed = 0;
const tests = [];
const check = (name, fn) => tests.push([name, fn]);

// --- fixtures -------------------------------------------------------------------------------------
const row = (slug, path, status, gate) => ({ slug, path, delivery: { status, ...(gate === undefined ? {} : { gate: { pass: gate } }) } });
const CLEAN_PAGES = [row('home', '/', 'verified', true), row('about', '/about', 'verified', true)];
const ENDED = [
  { skill: 'stardust:rollout', phase: 'I-dashboard', event: 'start' },
  { skill: 'stardust:rollout', phase: 'I-dashboard', event: 'end' },
];
const finding = (severity, status, evidence = 'x') => ({ id: `${severity}-${status}-${evidence}`, severity, status, fixability: evidence.startsWith(SOURCE_PARITY_PREFIX) ? 'out-of-scope' : 'platform-migration', evidence });

// --- pure verdict ---------------------------------------------------------------------------------
check('a clean run is complete, with the live probe recorded as run', () => {
  const v = doneGaps({ pages: CLEAN_PAGES, findings: [], ledgerLines: ENDED, notLive: [] });
  assert.deepEqual(v, { complete: true, gaps: [], liveChecked: true });
});

check('unfinished counts every not-yet-verified status, and only those', () => {
  const pages = ['pending', 'content-pending', 'converting', 'deployed', 'stale', 'verified', 'failed'].map((s, i) => row(`p${i}`, `/p${i}`, s));
  const v = doneGaps({ pages, ledgerLines: ENDED, notLive: [] });
  assert.ok(v.gaps.includes('pages_unfinished:5'), v.gaps.join(' | '));
});

check('failed lists failed rows and rows whose gate failed, by path', () => {
  const pages = [row('a', '/a', 'failed'), row('b', '/b', 'verified', false), row('c', '/c', 'verified', true)];
  const v = doneGaps({ pages, ledgerLines: ENDED, notLive: [] });
  assert.ok(v.gaps.includes('pages_failed:2: /a, /b'), v.gaps.join(' | '));
});

check('not-live lists the probe misses; an offline run neither reports it nor claims it checked', () => {
  const live = doneGaps({ pages: CLEAN_PAGES, ledgerLines: ENDED, notLive: ['/about'] });
  assert.ok(live.gaps.includes('pages_not_live:1: /about'));
  const offline = doneGaps({ pages: CLEAN_PAGES, ledgerLines: ENDED, notLive: null });
  assert.equal(offline.complete, true);
  assert.equal(offline.liveChecked, false);
});

check('open P1 counts open and in-progress P1s, never source parity, accepted, fixed or P2', () => {
  const findings = [finding('P1', 'open'), finding('P1', 'in-progress'), finding('P1', 'open', `${SOURCE_PARITY_PREFIX}same on source`),
    finding('P1', 'accepted'), finding('P1', 'fixed'), finding('P2', 'open')];
  assert.equal(openP1(findings).length, 2);
  assert.ok(doneGaps({ pages: CLEAN_PAGES, findings, ledgerLines: ENDED, notLive: [] }).gaps.includes('open_p1:2'));
});

check('the rollout is ended only when its LAST I-dashboard line is an end', () => {
  assert.equal(rolloutEnded([]), false);
  assert.equal(rolloutEnded(ENDED), true);
  assert.equal(rolloutEnded([...ENDED, { skill: 'stardust:rollout', phase: 'I-dashboard', event: 'start' }]), false);
  assert.equal(rolloutEnded([{ skill: 'stardust:replica', phase: 'I-dashboard', event: 'end' }]), false);
  assert.ok(doneGaps({ pages: CLEAN_PAGES, ledgerLines: [], notLive: [] }).gaps.includes('rollout_incomplete'));
});

check('gaps come in a fixed order and long path lists are capped', () => {
  const many = Array.from({ length: 25 }, (_, i) => row(`f${i}`, `/f${i}`, 'failed'));
  const v = doneGaps({ pages: [row('u', '/u', 'pending'), ...many], findings: [finding('P1', 'open')], ledgerLines: [], notLive: ['/x'] });
  assert.deepEqual(v.gaps.map((g) => g.split(':')[0]), ['pages_unfinished', 'pages_failed', 'pages_not_live', 'open_p1', 'rollout_incomplete']);
  assert.match(v.gaps[1], /, … \(\+5\)$/);
});

check('only deployed and verified rows are probed', () => {
  assert.deepEqual(deliveredPaths([row('a', '/a', 'deployed'), row('b', '/b', 'verified'), row('c', '/c', 'pending'), row('d', '/d', 'failed')]), ['/a', '/b']);
});

// --- live probe (stub fetch) ----------------------------------------------------------------------
check('the probe HEADs each path on the host, keeps input order, and counts non-200 and errors as missing', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push([url, opts.method]);
    if (url.endsWith('/gone')) return { status: 404 };
    if (url.endsWith('/moved')) return { status: 301 };
    if (url.endsWith('/boom')) throw new Error('network');
    return { status: 200 };
  };
  const missing = await probeLive('main--site--org.aem.live', ['/', '/boom', '/ok', '/gone', '/moved'], { fetchImpl, concurrency: 2 });
  assert.deepEqual(missing, ['/boom', '/gone', '/moved']);
  assert.ok(seen.every(([u, m]) => u.startsWith('https://main--site--org.aem.live/') && m === 'HEAD'));
});

// --- CLI ------------------------------------------------------------------------------------------
function project({ pages = CLEAN_PAGES, ledger = ENDED, liveHost } = {}) {
  const proj = mkdtempSync(join(tmpdir(), 'done-check-'));
  const out = join(proj, 'stardust', 'rollout');
  mkdirSync(join(out, 'coverage'), { recursive: true });
  if (pages) writeFileSync(join(out, 'coverage', 'pages.json'), JSON.stringify({ pages }));
  writeFileSync(join(out, 'rollout.json'), JSON.stringify(liveHost ? { site: { liveHost } } : {}));
  writeFileSync(join(proj, 'stardust', 'status.jsonl'), ledger.map((l) => JSON.stringify(l)).join('\n'));
  return proj;
}
const run = (proj, args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: proj, encoding: 'utf8' });

check('CLI: --help prints the usage header and writes nothing', () => {
  const proj = project();
  const before = readdirSync(join(proj, 'stardust')).join();
  const r = run(proj, ['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /pages_not_live/);
  assert.equal(readdirSync(join(proj, 'stardust')).join(), before);
  rmSync(proj, { recursive: true, force: true });
});

check('CLI: a clean offline run exits 0 and the JSON says the probe was skipped', () => {
  const proj = project();
  const r = run(proj, ['--offline', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { complete: true, gaps: [], liveChecked: false });
  rmSync(proj, { recursive: true, force: true });
});

check('CLI: gaps exit 1, one line each, then the summary line', () => {
  const proj = project({ pages: [row('a', '/a', 'pending')], ledger: [] });
  const r = run(proj, ['--offline']);
  assert.equal(r.status, 1);
  assert.deepEqual(r.stdout.trim().split('\n'), ['pages_unfinished:1', 'rollout_incomplete', '✗ 2 gap(s) (live probe skipped: --offline)']);
  rmSync(proj, { recursive: true, force: true });
});

check('CLI: usage errors exit 2 — no pages.json; no live host without --offline', () => {
  const noPages = project({ pages: null });
  assert.equal(run(noPages, ['--offline']).status, 2);
  const noHost = project();
  const r = run(noHost, []);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--live-host/);
  [noPages, noHost].forEach((p) => rmSync(p, { recursive: true, force: true }));
});

for (const [name, fn] of tests) {
  try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); }
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
