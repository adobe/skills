#!/usr/bin/env node
// dynamics-detect.mjs --reuse-if-fresh: a `_dynamics.json` written after the rollout run's `A-inventory`
// start, with the same URL set, settle, width and roster, stands in for the live run; `--fresh` re-probes.
// The pure part (detectReuse) and the CLI decision need no browser (URLs point at a closed local port, never
// the network); the end-to-end part runs where playwright is importable and prints a skip line otherwise.
// Run: node plugins/stardust/skills/dynamics/scripts/test/dynamics-detect.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectReuse } from '../lib.mjs';

const SCRIPT = new URL('../dynamics-detect.mjs', import.meta.url).pathname;
let failures = 0;
async function check(name, fn) {
  try { await fn(); } catch (e) { failures += 1; console.error(`FAIL ${name}\n  ${e.message}`); }
}
const rosterOf = (urls) => {
  const u = [...new Set(urls)].sort();
  return { sha256: createHash('sha256').update(u.join('\n')).digest('hex'), n: u.length };
};

// ---- pure: detectReuse ------------------------------------------------------------------------
const T0 = '2026-01-01T00:00:00Z';
const U1 = 'http://127.0.0.1:1/'; const U2 = 'http://127.0.0.1:1/about';
const ROSTER = rosterOf([U1, U2]);
const prov = (over = {}) => ({ writtenBy: 'stardust:dynamics detect', writtenAt: '2026-01-01T01:00:00.000Z', settleMs: 500, width: 1440, urls: [U1, U2], roster: ROSTER, ...over });
const ask = (over = {}, provOver = {}) => detectReuse({ prev: { _provenance: prov(provOver), pages: {}, findings: [] }, urls: [U1, U2], settleMs: 500, width: 1440, runStart: T0, roster: ROSTER, ...over });

await check('fresh + equal URL set, settle, width and roster ⇒ reuse', () => {
  assert.equal(ask().reuse, true);
  assert.equal(ask({ urls: [U2, U1] }).reuse, true, 'order alone does not change the set');
});
await check('written before or at the A-inventory start ⇒ live; a ledger ts without ms still compares by time', () => {
  const r = ask({}, { writtenAt: '2025-12-31T23:59:59.999Z' });
  assert.equal(r.reuse, false); assert.match(r.why, /not after A-inventory start/);
  assert.equal(ask({}, { writtenAt: '2026-01-01T00:00:00.000Z' }).reuse, false);
  assert.equal(ask({}, { writtenAt: '2026-01-01T00:00:00.500Z' }).reuse, true);
  assert.equal(ask({}, { writtenAt: 'garbage' }).reuse, false);
});
await check('no A-inventory start, no previous file or no provenance ⇒ live', () => {
  assert.equal(ask({ runStart: null }).reuse, false);
  assert.equal(detectReuse({ prev: null, urls: [U1], settleMs: 500, width: 1440, runStart: T0 }).reuse, false);
  assert.equal(detectReuse({ prev: { findings: [] }, urls: [U1], settleMs: 500, width: 1440, runStart: T0 }).reuse, false);
});
await check('URL set differs ⇒ live', () => {
  assert.match(ask({ urls: [U1] }).why, /URL set/);
  assert.equal(ask({ urls: [U1, U2, `${U1}x`] }).reuse, false);
  assert.equal(ask({ urls: [U1, `${U1}x`] }).reuse, false);
});
await check('settle or width differ ⇒ live', () => {
  assert.match(ask({ settleMs: 5000 }).why, /settle/);
  assert.match(ask({ width: 390 }).why, /width/);
});
await check('roster hash differs, newly present or gone ⇒ live', () => {
  assert.match(ask({ roster: rosterOf([U1, U2, `${U1}x`]) }).why, /roster changed/);
  assert.equal(ask({}, { roster: undefined }).reuse, false, 'present now, absent then');
  assert.equal(ask({ roster: null }).reuse, false, 'absent now, present then');
  assert.equal(ask({ roster: null }, { roster: undefined }).reuse, true, 'absent on both sides');
});
await check('--reach asked but the previous run rolled up none (or another dir) ⇒ live', () => {
  assert.match(ask({ reachSource: 'stardust/current/pages' }).why, /reach/);
  assert.equal(ask({ reachSource: 'stardust/current/pages' }, { reachSource: 'stardust/current/pages' }).reuse, true);
  assert.equal(ask({}, { reachSource: 'stardust/current/pages' }).reuse, true, 'a rolled-up reach is kept when not asked');
});

// ---- CLI: the decision (no browser) -----------------------------------------------------------
const PREV = { _provenance: prov(), pages: { '/': { url: U1, status: 200 }, '/about': { url: U2, status: 200 } }, findings: [{ id: 'm-dialog', class: 'M', feature: 'dialog', pages: ['/'] }] };
const ledger = (ts) => [
  { ts: '2025-12-01T00:00:00Z', skill: 'stardust:rollout', phase: 'A-inventory', event: 'start' },
  { ts: '2025-12-01T00:10:00Z', skill: 'stardust:rollout', phase: 'A-inventory', event: 'end' },
  'not json',
  { ts, skill: 'stardust:rollout', phase: 'A-inventory', event: 'start' },
  { ts: '2026-01-01T00:05:00Z', skill: 'stardust:replica', phase: 'extract', event: 'start' },
].map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n');
function project({ prev = PREV, start = T0, rosterUrls = [U1, U2, U1] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sd-detect-'));
  mkdirSync(join(dir, 'stardust', 'rollout', 'coverage'), { recursive: true });
  mkdirSync(join(dir, 'out'));
  writeFileSync(join(dir, 'stardust', 'status.jsonl'), `${ledger(start)}\n`);
  const rows = [...rosterUrls.map((sourceUrl) => ({ source: { sourceUrl } })), { source: { sourceUrl: null } }];
  writeFileSync(join(dir, 'stardust', 'rollout', 'coverage', 'pages.json'), JSON.stringify({ pages: rows }));
  if (prev) writeFileSync(join(dir, 'out', '_dynamics.json'), JSON.stringify(prev));
  return dir;
}
// a live attempt (when the decision says so) fails at the closed port's navigation, before any settle
const detect = (dir, args, urls = `${U1},${U2}`) => spawnSync(process.execPath, [SCRIPT, '--urls', urls, '--settle', '500', '--out', 'out', ...args], { cwd: dir, encoding: 'utf8', timeout: 120000 });
const readOut = (dir) => JSON.parse(readFileSync(join(dir, 'out', '_dynamics.json'), 'utf8'));
const REUSED = /^\[dynamics\] reused /m;

await check('--reuse-if-fresh on a fresh file: exit 0, one `reused` line, findings untouched, every reuse appended', () => {
  const dir = project();
  try {
    for (const n of [1, 2]) {
      const r = detect(dir, ['--reuse-if-fresh']);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stderr, /^\[dynamics\] reused out\/_dynamics\.json \(written 2026-01-01T01:00:00\.000Z, after A-inventory start 2026-01-01T00:00:00Z; 2 URLs, roster unchanged\) — --fresh to re-probe$/m);
      const out = readOut(dir);
      assert.deepEqual(out.findings, PREV.findings); assert.deepEqual(out.pages, PREV.pages);
      assert.equal(out._provenance.writtenAt, PREV._provenance.writtenAt);
      assert.equal(out._provenance.reuses.length, n);
      assert.equal(out._provenance.reuses[n - 1].runStart, T0); assert.equal(out._provenance.reuses[n - 1].urls, 2);
      assert.ok(Date.parse(out._provenance.reuses[n - 1].at) > Date.parse(T0));
    }
    assert.equal(existsSync(join(dir, 'out', 'dynamic-features.generated.md')), false, 'the table is not rewritten');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const [name, opts, args, why, urls] of [
  ['the roster gained a page', { rosterUrls: [U1, U2, `${U1}new`] }, [], /roster changed/],
  ['the file predates the run\'s A-inventory start', { start: '2026-01-01T02:00:00Z' }, [], /not after A-inventory start 2026-01-01T02:00:00Z/],
  ['the URL set changed', {}, [], /URL set changed/, U1],
  ['no previous file', { prev: null }, [], /no previous/],
  ['--fresh wins', {}, ['--fresh'], /--fresh/],
]) {
  await check(`not reused when ${name}: one \`not reused\` line, no reuse recorded, no crash before the decision`, () => {
    const dir = project(opts);
    try {
      const r = detect(dir, ['--reuse-if-fresh', ...args], urls);
      assert.doesNotMatch(r.stderr, REUSED);
      const line = r.stderr.split('\n').filter((l) => l.startsWith('[dynamics] not reused: '));
      assert.equal(line.length, 1, r.stderr); assert.match(line[0], why);
      if (existsSync(join(dir, 'out', '_dynamics.json'))) assert.equal(readOut(dir)._provenance.reuses, undefined);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

await check('without --reuse-if-fresh nothing changes: no reuse decision is printed', () => {
  const dir = project();
  try {
    const r = detect(dir, []);
    assert.doesNotMatch(r.stderr, /^\[dynamics\] (not )?reused/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await check('--help in an empty cwd: exit 0, names the reuse flags, writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sd-detect-help-'));
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd: dir, encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /--reuse-if-fresh/); assert.match(r.stdout, /--fresh/); assert.match(r.stdout, /A-inventory/);
    assert.deepEqual(readdirSync(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- end-to-end: a live run records the roster, the next run loads nothing (needs playwright) ----
let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  end-to-end live run + reuse (playwright not importable here; run this test in an environment that has it)'); }
if (playwrightOk) {
  let hits = 0;
  const server = createServer((req, res) => { hits += 1; res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><html><body><main><h1>Fixture</h1><button aria-haspopup="dialog">Open</button></main></body></html>'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const run = (args, cwd) => new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, '--urls', url, '--settle', '0', '--out', 'out', ...args], { cwd });
    let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolve({ status, stderr }));
  });
  await check('live run records _provenance.roster; the next --reuse-if-fresh run makes 0 live loads', async () => {
    const dir = project({ prev: null, start: new Date(Date.now() - 60000).toISOString(), rosterUrls: [url] });
    try {
      const first = await run(['--reuse-if-fresh'], dir);
      assert.equal(first.status, 0, first.stderr); assert.match(first.stderr, /not reused: no previous/);
      const loads = hits; assert.ok(loads > 0, 'the first run loads the page');
      assert.deepEqual(readOut(dir)._provenance.roster, rosterOf([url]));
      const second = await run(['--reuse-if-fresh'], dir);
      assert.equal(second.status, 0, second.stderr); assert.match(second.stderr, REUSED);
      assert.equal(hits, loads, 'no request reached the origin on the reused run');
      assert.equal(readOut(dir)._provenance.reuses.length, 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  server.close();
}

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log('dynamics-detect: all checks passed');
