#!/usr/bin/env node
/**
 * Fixture test: skills/deploy/scripts/code-sync-verify.mjs (T22.1, verify mode) + deploy-batch --require-code-synced.
 * Run: node skills/deploy/scripts/test/code-sync-verify.test.mjs   (exit 1 on failure)
 *
 * A temp git repo (blocks/ styles/ scripts/ head.html) pushed to a bare `origin`, one in-process origin that
 * serves gzip bodies from a mutable map, and a fake admin that records POST /code/ and /cache/:
 *   - served == tree → exit 0, one OK row per tracked path, `/code/…/*` once then `/cache/` per path, record ok + HEAD sha;
 *   - a pushed change the origin still serves stale → exit 124 (never 2), only that path re-synced then purged
 *     (since = the record's headSha), message says pending, record status `pending` / path `stale`;
 *   - origin catches up → exit 0 again; a run with nothing changed refreshes the record, exit 0;
 *   - dirty tree → exit 3 with ZERO requests; unpushed commit → exit 3; unknown remote ref → exit 3;
 *   - admin 401 → exit 2; --no-purge → no /cache/ POST; a served 404 → 124 with `http 404` in the record;
 *   - missing DA token → exit 2 before any POST; usage: --help 0, no args 1, bad --root 1;
 *   - deploy-batch --require-code-synced: missing / other-ref / pending record → exit 3 and no ledger file;
 *     an ok record lets the drive run against the mock DA.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-da.mjs';
import { codeSyncRefusal } from '../deploy-batch.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'code-sync-verify.mjs');
const BATCH = join(here, '..', 'deploy-batch.mjs');
const root = mkdtempSync(join(tmpdir(), 'code-sync-verify-'));
const repo = join(root, 'repo'); const bare = join(root, 'origin.git'); const home = join(root, 'home');
mkdirSync(home);
const g = (...args) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x.test', ...args], { cwd: repo, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const files = {
  'blocks/cards/cards.js': 'export default function decorate(block) { block.classList.add("ready"); }\n',
  'blocks/cards/cards.css': '.cards { display: grid; }\n',
  'styles/styles.css': ':root { --brand: #123; }\n',
  'scripts/scripts.js': 'import { loadPage } from "./aem.js"; loadPage();\n',
  'head.html': '<meta charset="utf-8">\n',
};
for (const [p, body] of Object.entries(files)) { mkdirSync(join(repo, dirname(p)), { recursive: true }); writeFileSync(join(repo, p), body); }
writeFileSync(join(repo, 'README.md'), 'not a code path\n');
spawnSync('git', ['init', '-q', '--bare', bare]);
spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
g('add', '-A'); g('commit', '-q', '-m', 'init'); g('remote', 'add', 'origin', bare); g('push', '-q', '-u', 'origin', 'main');

// served origin (gzip) + fake admin, one server
const served = { ...files };
let adminStatus = null; // null = 202 for /code/, 200 for /cache/
const admin = [];
const server = createServer((req, res) => {
  if (req.method === 'POST') {
    admin.push(req.url);
    const st = adminStatus ?? (req.url.startsWith('/admin/code/') ? 202 : 200);
    res.writeHead(st); return res.end();
  }
  const p = req.url.replace(/^\/served\//, '').split('?')[0];
  if (!(p in served)) { res.writeHead(404, { 'content-encoding': 'gzip' }); return res.end(gzipSync(Buffer.from('nope'))); }
  res.writeHead(200, { 'content-type': 'text/css', 'content-encoding': 'gzip', 'last-modified': 'Thu, 01 Jan 2026 00:00:00 GMT', age: '12', 'x-cache': 'HIT, MISS' });
  res.end(gzipSync(Buffer.from(served[p])));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const record = join(repo, 'stardust', 'code-sync.json');
const baseArgs = ['--org', 'o', '--repo', 'r', '--ref', 'main', '--root', repo, '--served-base', `${base}/served`, '--admin-base', `${base}/admin`, '--wait', '1'];
const run = (args, env = {}) => new Promise((resolve) => {
  const c = spawn(process.execPath, [CLI, ...args], { cwd: repo, env: { PATH: process.env.PATH, HOME: home, DA_TOKEN: 'x', CODE_SYNC_POLL_MS: '50', ...env } });
  let stdout = ''; let stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  const t = setTimeout(() => { c.kill(); stderr += '\n[test] TIMEOUT'; }, 20000);
  c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr, all: stdout + stderr }); });
});
const rec = () => JSON.parse(readFileSync(record, 'utf8'));

try {
  // pure helper
  assert.match(codeSyncRefusal({ codeSyncRecord: join(root, 'none.json'), org: 'o', repo: 'r', branch: 'main' }), /no code-sync record/);

  // 1. served == tree
  let r = await run(baseArgs);
  assert.equal(r.status, 0, r.all);
  assert.equal((r.stdout.match(/^OK    /gm) || []).length, 5, `one row per tracked code path:\n${r.stdout}`);
  assert.match(r.stdout, /OK {4}styles\/styles\.css · code 202 · cache 200 · last-modified=\S+ age=12 x-cache=HIT,_MISS · 200 gzip \d+B sha=match/);
  assert.doesNotMatch(r.stdout, /README/);
  assert.deepEqual(admin.filter((u) => u.includes('/code/')), ['/admin/code/o/r/main/*'], 'first run: one whole-ref re-sync');
  assert.equal(admin.filter((u) => u.includes('/cache/')).length, 5, 'one purge per path');
  let rc = rec(); assert.equal(rc.status, 'ok'); assert.equal(rc.headSha, g('rev-parse', 'HEAD')); assert.equal(rc.ref, 'main'); assert.equal(rc.paths['head.html'].status, 'ok');

  // 2. pushed change, origin stale → 124, only that path
  admin.length = 0;
  writeFileSync(join(repo, 'styles/styles.css'), ':root { --brand: #456; }\n');
  g('commit', '-q', '-am', 'brand'); g('push', '-q', 'origin', 'main');
  r = await run(baseArgs);
  assert.equal(r.status, 124, `deadline is no verdict, never 2: ${r.all}`);
  assert.deepEqual(admin, ['/admin/code/o/r/main/styles/styles.css', '/admin/cache/o/r/main/styles/styles.css'], 'code then cache, for the changed path only');
  assert.match(r.stdout, /^STALE styles\/styles\.css .* sha=differ \(served [0-9a-f]{12} \/ local [0-9a-f]{12}\)/m);
  assert.match(r.stderr, /1 of 1 path\(s\) still differ after 1s — propagation pending, no verdict \(exit 124\)/);
  assert.match(r.stderr, /Neither \?cb= nor Cache-Control: no-cache busts the code bus/);
  rc = rec(); assert.equal(rc.status, 'pending'); assert.equal(rc.paths['styles/styles.css'].status, 'stale');

  // 3. origin catches up → 0; nothing changed → record refreshed
  served['styles/styles.css'] = ':root { --brand: #456; }\n';
  r = await run(baseArgs); assert.equal(r.status, 0, r.all); assert.equal(rec().status, 'ok');
  r = await run(baseArgs); assert.equal(r.status, 0); assert.match(r.stdout, /no code path changed since [0-9a-f]{7}/);

  // 4. local preconditions — zero requests
  admin.length = 0;
  writeFileSync(join(repo, 'blocks/cards/cards.css'), '.cards { display: grid; gap: 1rem; }\n');
  r = await run(baseArgs); assert.equal(r.status, 3); assert.match(r.stderr, /uncommitted changes under the code paths — commit and push first:\n {2}.*blocks\/cards\/cards\.css/); assert.equal(admin.length, 0);
  g('commit', '-q', '-am', 'gap');
  r = await run(baseArgs); assert.equal(r.status, 3); assert.match(r.stderr, /1 commit\(s\) not on origin\/main — push first/); assert.equal(admin.length, 0);
  g('push', '-q', 'origin', 'main'); served['blocks/cards/cards.css'] = '.cards { display: grid; gap: 1rem; }\n';
  writeFileSync(join(repo, 'README.md'), 'docs change is not a code path\n');
  r = await run(baseArgs); assert.equal(r.status, 0, 'a dirty non-code file does not block'); g('checkout', '--', 'README.md');
  r = await run([...baseArgs.slice(0, 6), 'feature', ...baseArgs.slice(6)].filter((x, i, arr) => !(x === 'main' && arr[i - 1] === '--ref')));
  assert.equal(r.status, 3, 'unknown origin/feature'); assert.match(r.stderr, /origin\/feature is unknown here/);

  // 5. admin verdicts, --no-purge, served 404, missing token
  adminStatus = 401; r = await run(baseArgs.concat('--all')); assert.equal(r.status, 2); assert.match(r.stderr, /admin 401 on .*\/code\/o\/r\/main\/\* — DA_TOKEN rejected/); adminStatus = null;
  admin.length = 0; r = await run(baseArgs.concat('--all', '--no-purge')); assert.equal(r.status, 0, r.all); assert.equal(admin.filter((u) => u.includes('/cache/')).length, 0);
  mkdirSync(join(repo, 'blocks/hero'), { recursive: true }); writeFileSync(join(repo, 'blocks/hero/hero.css'), '.hero { min-height: 40vh; }\n');
  g('add', '-A'); g('commit', '-q', '-m', 'hero'); g('push', '-q', 'origin', 'main');
  r = await run(baseArgs); assert.equal(r.status, 124); assert.equal(rec().paths['blocks/hero/hero.css'].status, 'http 404'); served['blocks/hero/hero.css'] = '.hero { min-height: 40vh; }\n';
  admin.length = 0; r = await run(baseArgs, { DA_TOKEN: '' }); assert.equal(r.status, 2); assert.match(r.stderr, /DA_TOKEN missing — run node skills\/deploy\/scripts\/da-token-check\.mjs first; nothing POSTed/); assert.equal(admin.length, 0);
  r = await run(baseArgs); assert.equal(r.status, 0, r.all);

  // 6. usage
  assert.equal((await run(['--help'])).status, 0);
  assert.equal((await run([])).status, 1);
  assert.equal((await run(baseArgs.concat('--root', join(root, 'nope')))).status, 1);

  // 7. deploy-batch --require-code-synced
  const mock = await startMock();
  const content = join(root, 'content'); mkdirSync(content);
  writeFileSync(join(content, 'a.html'), `<body><header></header><main><div><h1>A</h1><p>${'lorem ipsum '.repeat(30)}</p></div></main><footer></footer></body>\n`);
  const ledger = join(content, '.deploy-ledger.json');
  const batch = (extra, env = {}) => new Promise((resolve) => {
    const c = spawn(process.execPath, [BATCH, '--org', 'o', '--repo', 'r', '--branch', 'main', '--content', content, '--no-progress', '--require-code-synced', ...extra], { cwd: root, env: { PATH: process.env.PATH, HOME: home, DA_TOKEN: 'x', ...mock.env(), ...env } });
    let stdout = ''; let stderr = '';
    c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
    c.on('close', (status) => resolve({ status, stdout, stderr }));
  });
  try {
    r = await batch(['--code-sync-record', join(root, 'none.json')]);
    assert.equal(r.status, 3, r.stderr); assert.match(r.stderr, /REFUSED \(--require-code-synced\): no code-sync record/); assert.match(r.stdout, /SUMMARY deploy-batch .*exit=3 .*refused=code-sync/); assert.equal(existsSync(ledger), false, 'refusal happens before the ledger is opened');
    const stale = join(root, 'stale.json');
    writeFileSync(stale, JSON.stringify({ ...rec(), ref: 'feature' })); r = await batch(['--code-sync-record', stale]); assert.equal(r.status, 3); assert.match(r.stderr, /verified ref "feature", this run previews on "main"/);
    writeFileSync(stale, JSON.stringify({ ...rec(), status: 'pending' })); r = await batch(['--code-sync-record', stale]); assert.equal(r.status, 3); assert.match(r.stderr, /status is "pending"/);
    assert.equal(mock.requests.length, 0, 'no DA request on a refusal');
    r = await batch(['--code-sync-record', record]); assert.equal(r.status, 0, r.stderr); assert.equal(existsSync(ledger), true); assert.match(r.stdout, /SUMMARY deploy-batch ok=1/);
    r = await batch(['--code-sync-record', join(root, 'none.json'), '--plan']); assert.equal(r.status, 0, '--plan is offline: the requirement applies to driving runs');
  } finally { await mock.close(); }
  console.log('code-sync-verify test: ok');
} finally {
  server.closeAllConnections(); server.close();
  rmSync(root, { recursive: true, force: true });
}
