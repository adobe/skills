#!/usr/bin/env node
// Fixture test: skills/diff/scripts/live-budget.mjs — the shared per-host live
// budget + live lock (module docstring is the rule):
//   takeNavigation — ≤ 10/min AND ≥ 3 s gap per host, one bucket per host per
//     process, tightened (never loosened) by stardust/live-budget.json and a
//     robots Crawl-delay; a learned ceiling older than LIVE_BUDGET_TTL_MS is ignored;
//   recordRateLimit — bare 429: halve + double gap, persist merge-by-host with
//     learnedBy/lastStatus, return the ONE-retry wait (Retry-After ≤ 60 s);
//   acquireLiveLock — stardust/.work/live-<host>.lock, pid liveness: a live
//     holder → LiveLockError (STARDUST_LIVE_FORCE=1 → WARN + proceed), a dead
//     holder is taken over, idempotent per host per process, release() unlinks.
// Runs without playwright or timers (fake clock injected through budgetFor).
// Usage: node plugins/stardust/evals/fixtures/live-budget.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'stardust-live-budget-'));
process.env.STARDUST_LIVE_BUDGET = join(dir, 'live-budget.json');
process.env.STARDUST_LIVE_LOCK_DIR = join(dir, '.work');
delete process.env.STARDUST_LIVE_FORCE;
const lb = await import('../../skills/diff/scripts/live-budget.mjs');
const { BUDGET_DEFAULT, HostBudget, budgetFor, takeNavigation, recordRateLimit, acquireLiveLock, tuneBudget, LIVE_BUDGET_PATH, LIVE_LOCK_DIR, LIVE_BUDGET_TTL_MS } = lb;
assert.equal(LIVE_BUDGET_PATH, process.env.STARDUST_LIVE_BUDGET); assert.equal(LIVE_LOCK_DIR, process.env.STARDUST_LIVE_LOCK_DIR);
assert.deepEqual(BUDGET_DEFAULT, { navPerMin: 10, minGapMs: 3000 });
const errs = []; const origErr = console.error; console.error = (m) => errs.push(String(m));

try {
  // ---- pacing: one bucket per host per process, fake clock ----
  let clock = 1_000_000; const slept = [];
  const b = budgetFor('WWW.Example.test', { now: () => clock, sleep: async (ms) => { slept.push(ms); clock += ms; } });
  assert.ok(b instanceof HostBudget); assert.equal(budgetFor('www.example.test'), b, 'host key is case-insensitive and process-wide');
  await takeNavigation('www.example.test'); assert.deepEqual(slept, [], 'first navigation immediate');
  await takeNavigation('www.example.test'); assert.deepEqual(slept, [3000], 'second waits the 3 s gap');
  for (let i = 2; i < 20; i += 1) await takeNavigation('www.example.test');
  const n = slept.length; await takeNavigation('www.example.test');
  assert.ok(slept.slice(n).reduce((a, c) => a + c, 0) > 3000, 'dry bucket waits for a token, not just the gap');
  assert.equal(budgetFor('other.example.test', { now: () => clock, sleep: async () => {} }).tokens, 10, 'another host has its own full bucket');

  // ---- bare 429: halve + persist merge-by-host, one-retry wait ----
  writeFileSync(LIVE_BUDGET_PATH, JSON.stringify({ 'keep.example.test': { navPerMin: 2, minGapMs: 9000, learnedAt: new Date().toISOString() } }));
  const wait = recordRateLimit('www.example.test', '7', { tool: 'stitch-shot.mjs' });
  assert.equal(wait, 7000, 'Retry-After seconds honoured');
  assert.equal(b.navPerMin, 5); assert.equal(b.minGapMs, 6000); assert.equal(b.source, 'rate-limited');
  const saved = JSON.parse(readFileSync(LIVE_BUDGET_PATH, 'utf8'));
  assert.deepEqual(Object.keys(saved).sort(), ['keep.example.test', 'www.example.test'], 'merge-by-host keeps other hosts');
  assert.equal(saved['www.example.test'].navPerMin, 5); assert.equal(saved['www.example.test'].lastStatus, 429); assert.equal(saved['www.example.test'].learnedBy, 'stitch-shot.mjs');
  assert.ok(Date.parse(saved['www.example.test'].learnedAt) > 0, 'learnedAt is an ISO timestamp (the TTL clock)');
  assert.equal(recordRateLimit('www.example.test', '600'), 60000, 'Retry-After capped at 60 s');
  assert.equal(recordRateLimit('www.example.test', null), Math.min(60000, b.minGapMs * 4), 'no Retry-After → 4 gaps (≤ 60 s)');

  // ---- learned ceilings tighten, never loosen; expire after the TTL ----
  const fresh = () => new HostBudget({ now: () => clock, sleep: async () => {} });
  assert.deepEqual(tuneBudget(fresh(), 'keep.example.test').toJSON(), { navPerMin: 2, minGapMs: 9000, source: 'live-budget.json' }, 'a stricter learned ceiling applies');
  assert.equal(typeof LIVE_BUDGET_TTL_MS, 'number', 'live-budget.mjs exports LIVE_BUDGET_TTL_MS (learned ceilings expire)');
  writeFileSync(LIVE_BUDGET_PATH, JSON.stringify({
    'loose.example.test': { navPerMin: 40, minGapMs: 100, learnedAt: new Date().toISOString() },
    'old.example.test': { navPerMin: 1, minGapMs: 30000, learnedAt: new Date(Date.now() - LIVE_BUDGET_TTL_MS - 60000).toISOString() },
    'undated.example.test': { navPerMin: 3, minGapMs: 5000 },
  }));
  assert.deepEqual(tuneBudget(fresh(), 'loose.example.test').toJSON(), { navPerMin: 10, minGapMs: 3000, source: 'default' }, 'a looser entry never loosens the default');
  assert.deepEqual(tuneBudget(fresh(), 'old.example.test').toJSON(), { navPerMin: 10, minGapMs: 3000, source: 'default' }, `a ceiling learned more than ${LIVE_BUDGET_TTL_MS / 86400000} days ago has expired — one 429 must not slow every later run forever`);
  assert.deepEqual(tuneBudget(fresh(), 'undated.example.test').toJSON(), { navPerMin: 3, minGapMs: 5000, source: 'live-budget.json' }, 'an entry without learnedAt (older writer) still applies');
  assert.equal(tuneBudget(fresh(), 'keep.example.test', 12).minGapMs, 12000, 'robots Crawl-delay widens the gap');

  // ---- live lock ----
  const h1 = acquireLiveLock('www.example.test', 'anchor.mjs');
  assert.equal(h1.file, join(LIVE_LOCK_DIR, 'live-www.example.test.lock'));
  assert.deepEqual(JSON.parse(readFileSync(h1.file, 'utf8')).pid, process.pid);
  assert.equal(acquireLiveLock('www.example.test', 'anchor.mjs'), h1, 'idempotent per host per process');
  // a LIVE holder (the parent process is alive) refuses
  const heldFile = join(LIVE_LOCK_DIR, 'live-busy.example.test.lock');
  writeFileSync(heldFile, JSON.stringify({ host: 'busy.example.test', pid: process.ppid, tool: 'crawl.mjs', startedAt: '2026-01-01T00:00:00Z' }));
  assert.throws(() => acquireLiveLock('busy.example.test', 'stitch-shot.mjs'), (e) => e.name === 'LiveLockError' && e.errorClass === 'LiveLockError' && /crawl\.mjs \(pid \d+/.test(e.message) && /STARDUST_LIVE_FORCE=1/.test(e.message), 'a live holder → LiveLockError naming tool + pid + override');
  assert.equal(JSON.parse(readFileSync(heldFile, 'utf8')).pid, process.ppid, 'the refused caller does not clobber the holder');
  process.env.STARDUST_LIVE_FORCE = '1';
  const forced = acquireLiveLock('busy.example.test', 'stitch-shot.mjs');
  assert.ok(errs.some((l) => /WARN live lock overridden/.test(l)), 'force → WARN and proceed');
  assert.equal(JSON.parse(readFileSync(forced.file, 'utf8')).pid, process.pid);
  delete process.env.STARDUST_LIVE_FORCE; forced.release();
  // a DEAD holder is stale — taken over silently
  const dead = spawnSync(process.execPath, ['-e', '0']).pid;
  writeFileSync(join(LIVE_LOCK_DIR, 'live-stale.example.test.lock'), JSON.stringify({ host: 'stale.example.test', pid: dead, tool: 'crawl.mjs', startedAt: '2026-01-01T00:00:00Z' }));
  const h3 = acquireLiveLock('stale.example.test', 'anchor.mjs');
  assert.equal(JSON.parse(readFileSync(h3.file, 'utf8')).pid, process.pid, 'stale lock taken over');
  h3.release(); assert.ok(!existsSync(h3.file), 'release unlinks');
  assert.notEqual(acquireLiveLock('stale.example.test', 'anchor.mjs'), h3, 'after release a new handle is issued');
  h1.release();
} finally { console.error = origErr; }
console.log('live-budget test: ok (per-host pacing, bare-429 persist + TTL, live lock refuse/force/stale)');
