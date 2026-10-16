#!/usr/bin/env node
// skills/stardust/scripts/test/browser-lock.test.mjs — the browser-lock.mjs contract (the machine-wide browser
// semaphore), ported from the smoke on `stardust/next`. Every run points at a temp --lock-dir (the CLI) or
// STARDUST_BROWSER_LOCK_DIR (the API) — never the real ~/.stardust. No browser, no network.
//   (a) SLOTS=2: two acquires succeed (two live pids), a third with --wait 2 exits 124 after
//       printing one `waiting for a slot` line at 0:00 and appending `waiting-slot` to
//       $STARDUST_PROGRESS_LOG; 124 is the no-verdict code, never a FAIL;
//   (b) a slot file with a dead pid and one with an old mtime are reaped and re-acquired;
//   (c) SLOTS=0 acquires without creating the dir; --no-lock likewise;
//   (d) release frees the slot (by pid; --all --stale removes only stale files);
//   (e) status --json prints holders, slots and the orphan census; --help exits 0; usage exits 2;
//   (f) TTL: an API holder outlives STARDUST_BROWSER_TTL_MIN (its unref'd keep-alive touches the file);
//       a shell holder's aged slot is reaped by the census unless `refresh --pid` touched it first;
//   (g) a non-numeric --wait / --slots / --min / --pid is usage (exit 2, at once) — never a NaN deadline that
//       spins forever; `surplus()` names the newest holders past the budget (race repair after a write);
//   (h) acquireProcess() hands the same slot to a second caller; a 124 rejection clears the memo.
// Run: node plugins/stardust/skills/stardust/scripts/test/browser-lock.test.mjs   (about 10 s)
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { surplus } from '../browser-lock.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'browser-lock.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'browser-lock-test-'));
const dir = join(tmp, 'locks');
const envDir = join(tmp, 'env-locks'); // the env fallback — every CLI run below passes --lock-dir, which wins
const log = join(tmp, 'agent.log');
const env = { ...process.env, STARDUST_BROWSER_SLOTS: '2', STARDUST_BROWSER_POLL_MS: '200', STARDUST_PROGRESS_LOG: log, STARDUST_BROWSER_LOCK_DIR: envDir };
delete env.STARDUST_BROWSER_WAIT; delete env.STARDUST_BROWSER_TTL_MIN;
const apiEnv = { ...env, STARDUST_BROWSER_LOCK_DIR: dir };
const run = (args, extraEnv = {}) => spawnSync(process.execPath, [CLI, ...args, '--lock-dir', dir], { encoding: 'utf8', env: { ...env, ...extraEnv } });
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const holders = [spawn('sleep', ['60']), spawn('sleep', ['60'])]; // two live pids to record

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

try {
  await check('(a) SLOTS=2: two acquires succeed, a third exits 124 after one waiting line + a progress-log line', () => {
    let r = run(['acquire', '--pid', String(holders[0].pid), '--script', 'stitch-shot', '--project', '/x/proj-a']);
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^acquired /);
    r = run(['acquire', '--pid', String(holders[1].pid), '--script', 'gate.sh', '--project', '/x/proj-b']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readdirSync(dir).length, 2);
    const t0 = Date.now();
    r = run(['acquire', '--pid', String(process.pid), '--wait', '2']);
    assert.equal(r.status, 124, `third acquire exits 124 (no verdict)\n${r.stdout}${r.stderr}`);
    assert.ok(Date.now() - t0 >= 1900, 'waited the budget');
    // holders are listed in slot-file name order (pid first), so either order is the same census
    assert.equal(r.stderr.match(/^browser-lock: waiting for a slot \(2\/2 held by (?:pid \d+ stitch-shot proj-a, pid \d+ gate\.sh proj-b|pid \d+ gate\.sh proj-b, pid \d+ stitch-shot proj-a)\) 0:00$/gm)?.length, 1, `one waiting line\n${r.stderr}`);
    assert.match(r.stderr, /no slot within 2 s .* — exit 124, no verdict/);
    assert.match(readFileSync(log, 'utf8'), /waiting-slot ok waiting for a slot \(2\/2 held by/);
    assert.equal(readdirSync(dir).length, 2, 'the timed-out caller left no slot file');
  });

  await check('(d) release by pid frees a slot', () => {
    let r = run(['release', '--pid', String(holders[0].pid)]);
    assert.equal(r.stdout.trim(), 'released 1');
    assert.equal(readdirSync(dir).length, 1);
    r = run(['acquire', '--pid', String(process.pid), '--wait', '2']);
    assert.equal(r.status, 0, 'a freed slot is re-acquired');
  });

  await check('(b) a dead pid and an old mtime are reaped and re-used; --all --stale removes only stale files', () => {
    run(['release', '--all']);
    assert.equal(readdirSync(dir).length, 0);
    const dead = join(dir, '999999-dead.json');
    writeFileSync(dead, JSON.stringify({ pid: 999999, project: '/x/dead', script: 'x', since: '2026-01-01T00:00:00Z' }));
    const old = join(dir, `${holders[1].pid}-old.json`);
    writeFileSync(old, JSON.stringify({ pid: holders[1].pid, project: '/x/old', script: 'x', since: '2026-01-01T00:00:00Z' }));
    const past = new Date(Date.now() - 3 * 3_600_000);
    utimesSync(old, past, past);
    let r = run(['status', '--json']);
    const s = JSON.parse(r.stdout);
    assert.equal(s.reapedStale, 2, 'both stale files reaped by the census');
    assert.deepEqual(s.held, []);
    assert.ok(!existsSync(dead) && !existsSync(old));
    r = run(['acquire', '--pid', String(holders[1].pid), '--script', 'anchor']);
    assert.equal(r.status, 0);
    r = run(['acquire', '--pid', String(holders[0].pid), '--script', 'visual-diff']);
    assert.equal(r.status, 0, 'two slots free after the reap');
    writeFileSync(dead, JSON.stringify({ pid: 999999 }));
    r = run(['release', '--all', '--stale']);
    assert.equal(r.stdout.trim(), 'released 1');
    assert.equal(readdirSync(dir).length, 2, 'live holders untouched by --stale');
  });

  await check('(e) status: holders as JSON, orphan census present, human line; default budget 3 without the env', () => {
    let r = run(['status', '--json']);
    const s = JSON.parse(r.stdout);
    assert.equal(s.slots, 2);
    assert.deepEqual(s.held.map((h) => h.script).sort(), ['anchor', 'visual-diff']);
    for (const h of s.held) for (const k of ['pid', 'host', 'project', 'script', 'since', 'file']) assert.ok(k in h, `holder has ${k}`);
    assert.ok(Array.isArray(s.orphans), 'orphan census is a list');
    r = run(['status']);
    assert.match(r.stdout, /^browser-lock: 2\/2 slot\(s\) held \(pid \d+ (anchor|visual-diff) \S+, pid \d+ (anchor|visual-diff) \S+\) · 0 stale reaped · \d+ orphan browser process\(es\)/);
    r = run(['status', '--json'], { STARDUST_BROWSER_SLOTS: '' });
    assert.equal(JSON.parse(r.stdout).slots, 3, 'run-bg\'s per-project default: one project\'s pacing is unchanged');
  });

  await check('(c) SLOTS=0 and --no-lock touch nothing', () => {
    const dir0 = join(tmp, 'never');
    let r = spawnSync(process.execPath, [CLI, 'acquire', '--lock-dir', dir0], { encoding: 'utf8', env: { ...env, STARDUST_BROWSER_SLOTS: '0' } });
    assert.equal(r.status, 0); assert.match(r.stdout, /disabled \(STARDUST_BROWSER_SLOTS=0\)/);
    r = spawnSync(process.execPath, [CLI, 'acquire', '--no-lock', '--lock-dir', dir0], { encoding: 'utf8', env });
    assert.equal(r.status, 0); assert.match(r.stdout, /disabled \(--no-lock\)/);
    assert.ok(!existsSync(dir0), 'disabled lock never creates the dir');
  });

  await check('(f) TTL: an API holder keeps itself fresh past the TTL; a shell holder needs `refresh`', async () => {
    run(['release', '--all']);
    const ttlEnv = { STARDUST_BROWSER_TTL_MIN: '0.01' }; // 600 ms
    const code = `import { acquire } from ${JSON.stringify(pathToFileURL(CLI).href)};
      const slot = await acquire({ script: 'api-holder', dir: ${JSON.stringify(dir)} });
      await new Promise((r) => setTimeout(r, 1800)); slot.release(); console.log('api-holder done');`;
    const api = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { ...env, ...ttlEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    const apiOut = []; api.stdout.on('data', (d) => apiOut.push(d)); api.stderr.on('data', (d) => apiOut.push(d));
    const exited = new Promise((res) => { api.on('exit', res); });
    for (let i = 0; i < 40 && !(existsSync(dir) && readdirSync(dir).some((f) => f.startsWith(`${api.pid}-`))); i += 1) await sleep(50); // eslint-disable-line no-await-in-loop
    assert.ok(readdirSync(dir).some((f) => f.startsWith(`${api.pid}-`)), 'API holder took a slot');
    await sleep(1000); // past the 600 ms TTL
    let r = run(['status', '--json'], ttlEnv);
    let s = JSON.parse(r.stdout);
    assert.deepEqual(s.held.map((h) => h.script), ['api-holder'], `API holder still held past the TTL (kept fresh)\n${r.stdout}`);
    assert.equal(s.reapedStale, 0);
    await exited;
    assert.match(Buffer.concat(apiOut).toString(), /api-holder done/);
    assert.equal(readdirSync(dir).length, 0, 'release() removed the API holder\'s slot');
    r = run(['acquire', '--pid', String(holders[0].pid), '--script', 'shell-round'], ttlEnv);
    assert.equal(r.status, 0);
    const shellFile = join(dir, readdirSync(dir)[0]);
    const aged = new Date(Date.now() - 5_000);
    utimesSync(shellFile, aged, aged);
    r = run(['refresh', '--pid', String(holders[0].pid)], ttlEnv);
    assert.equal(r.stdout.trim(), 'refreshed 1');
    r = run(['status', '--json'], ttlEnv);
    assert.equal(JSON.parse(r.stdout).held.length, 1, 'refreshed shell slot survives the census');
    utimesSync(shellFile, aged, aged);
    r = run(['status', '--json'], ttlEnv);
    s = JSON.parse(r.stdout);
    assert.equal(s.reapedStale, 1, 'an aged, unrefreshed shell slot is reaped');
    assert.equal(run(['refresh', '--pid', String(holders[0].pid)]).stdout.trim(), 'refreshed 0', 'nothing left to refresh');
  });

  await check('(g) non-numeric budgets are usage errors decided before any wait; surplus() backs off the newest', () => {
    run(['release', '--all']);
    for (const bad of [['acquire', '--wait', 'abc'], ['acquire', '--slots', 'abc'], ['acquire', '--wait', ''], ['reap', '--min', 'abc'], ['release', '--pid', 'abc'], ['acquire', '--pid', '0']]) {
      const t1 = Date.now();
      const r = run(bad);
      assert.equal(r.status, 2, `${bad.join(' ')} exits 2\n${r.stdout}${r.stderr}`);
      assert.ok(Date.now() - t1 < 1500, `${bad.join(' ')} decided at once, no wait`);
      assert.match(r.stderr, /needs a number/);
    }
    assert.equal(readdirSync(dir).length, 0, 'a rejected acquire left no slot file');
    const held = [{ file: '/l/b.json', mtime: 20 }, { file: '/l/a.json', mtime: 10 }, { file: '/l/c.json', mtime: 20 }];
    assert.deepEqual(surplus(held, 2), ['/l/c.json'], 'newest by mtime, then name, backs off');
    assert.deepEqual(surplus(held, 3), [], 'within budget → nobody backs off');
    assert.deepEqual(surplus(held, 0), ['/l/a.json', '/l/b.json', '/l/c.json']);
  });

  await check('(h) acquireProcess is memoised per process and released at exit; a 124 rejection clears the memo', () => {
    run(['release', '--all']);
    const twice = `import { acquireProcess } from ${JSON.stringify(pathToFileURL(CLI).href)};
      const a = await acquireProcess({ script: 'p' }); const b = await acquireProcess({ script: 'p' });
      console.log(a === b ? 'same' : 'different');`;
    let r = spawnSync(process.execPath, ['--input-type=module', '-e', twice], { encoding: 'utf8', env: apiEnv });
    assert.equal(r.stdout.trim(), 'same', `acquireProcess is memoised per process\n${r.stderr}`);
    assert.equal(readdirSync(dir).length, 0, 'the memoised slot is released at exit');
    run(['acquire', '--pid', String(holders[0].pid)]); run(['acquire', '--pid', String(holders[1].pid)]);
    // the budget is full: the first call times out; with one slot freed, the next call waits afresh and acquires
    // (a memo that kept the rejection would answer 124 again)
    const timed = `import { acquireProcess, release } from ${JSON.stringify(pathToFileURL(CLI).href)};
      const e1 = await acquireProcess({ waitS: 1 }).catch((e) => e.code);
      release({ pid: ${holders[0].pid} });
      const s = await acquireProcess({ waitS: 1 }).catch((e) => e.code);
      console.log(e1 + ' ' + (s?.file ? 'acquired' : s));`;
    r = spawnSync(process.execPath, ['--input-type=module', '-e', timed], { encoding: 'utf8', env: apiEnv });
    assert.equal(r.stdout.trim(), '124 acquired', `a 124 rejection clears the memo\n${r.stderr}`);
    run(['release', '--all']);
  });

  await check('--help in an empty cwd: exit 0, the header (Usage:) on stdout, nothing written; an unknown command is usage (exit 2)', () => {
    const empty = join(tmp, 'empty'); mkdirSync(empty);
    let r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8', cwd: empty, env, timeout: 15_000 });
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Usage:/); assert.match(r.stdout, /Exit codes: 0 acquired/);
    r = spawnSync(process.execPath, [CLI, 'bogus'], { encoding: 'utf8', cwd: empty, env });
    assert.equal(r.status, 2);
    assert.deepEqual(readdirSync(empty), [], 'nothing written in the cwd');
  });

  await check('every run used its temp lock dir: --lock-dir wins over STARDUST_BROWSER_LOCK_DIR', () => {
    assert.ok(!existsSync(envDir), `${envDir} was created`);
  });
} finally {
  for (const h of holders) h.kill('SIGKILL');
  rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} failing` : '\nbrowser-lock: all checks passed');
process.exit(failed ? 1 : 0);
