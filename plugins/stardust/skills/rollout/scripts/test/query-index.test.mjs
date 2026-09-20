#!/usr/bin/env node
// Fixture test: rollout/scripts/query-index.mjs — the two exit-code contracts the evals smoke does not pin (D7 follow-ups).
//
//   usage    a value flag followed by another flag is exit 2 before any request (`--sample --replace` picked the default
//            sample silently before — NEGATIVE); `--timeout abc` stays exit 2
//   denied   a 401/403 on the bulk-index POST is a denial, not "no verdict": INDEX-CONFIG.md written for an org admin,
//            index-status.json verdict denied, exit 3 (NEGATIVE: exit 4 "unreachable" before); no read-back request
//
// Offline: a local mock admin on 127.0.0.1 (config GET 404 → POST 200 → index POST 403); the evals fixture yaml +
// coverage are read, never written. Usage: node plugins/stardust/skills/rollout/scripts/test/query-index.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';

const HERE = import.meta.dirname;
const CLI = join(HERE, '..', 'query-index.mjs');
const FIX = join(HERE, '..', '..', '..', '..', 'evals', 'lint', 'fixtures', 'query-index');
const T = mkdtempSync(join(tmpdir(), 'query-index-test-'));
const env = { ...process.env, DA_TOKEN: 'test-token-never-printed' };
const ARGS = (a) => [CLI, '--org', 'acme', '--site', 'site', '--yaml', join(FIX, 'helix-query.yaml'), '--pages', join(FIX, 'coverage', 'pages.json'), '--out', join(T, 'stardust', 'dynamics'), ...a];
const run = (...a) => spawnSync(process.execPath, ARGS(a), { encoding: 'utf8', cwd: T, env });
// the mock lives in THIS process: the CLI must run asynchronously or the event loop cannot answer it
const runAsync = (...a) => new Promise((done) => { const c = spawn(process.execPath, ARGS(a), { cwd: T, env }); let stdout = ''; let stderr = ''; c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; }); c.on('close', (status) => done({ status, stdout, stderr })); });

// usage: swallowed flag → exit 2, nothing requested (no --admin reachable is irrelevant: the check runs first)
let r = run('--admin', 'http://127.0.0.1:9', '--sample', '--replace');
assert.equal(r.status, 2, r.stderr); assert.match(r.stderr, /--sample needs a value \(got --replace\)/);
r = run('--admin', 'http://127.0.0.1:9', '--timeout', 'abc'); assert.equal(r.status, 2); assert.match(r.stderr, /--timeout must be a positive number/);
assert.equal(spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' }).status, 0);

// denied on the bulk-index POST → INDEX-CONFIG.md + exit 3
const hits = [];
const server = createServer((req, res) => {
  hits.push(`${req.method} ${req.url}`);
  const send = (code, body = '') => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(body); };
  if (/\/config\//.test(req.url) && req.method === 'GET') return send(404);
  if (/\/config\//.test(req.url) && req.method === 'POST') { req.on('data', () => {}); req.on('end', () => send(200, '{}')); return; }
  if (/\/index\//.test(req.url) && req.method === 'POST') return send(403, '{"error":"forbidden"}');
  return send(500);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const admin = `http://127.0.0.1:${server.address().port}`;
r = await runAsync('--admin', admin, '--origin', 'http://127.0.0.1:9', '--sample', '/locations/harbourview', '--timeout', '5', '--poll-ms', '100');
server.close();
assert.equal(r.status, 3, `${r.stdout}\n${r.stderr}`);
assert.match(r.stderr, /bulk index POST DENIED \(HTTP 403 for DA_TOKEN\)/); assert.doesNotMatch(r.stderr, /test-token/, 'the token value is never printed');
const cfg = join(T, 'stardust', 'rollout', 'INDEX-CONFIG.md');
assert.ok(existsSync(cfg), 'INDEX-CONFIG.md written for an org admin'); assert.match(readFileSync(cfg, 'utf8'), /locations/);
const st = JSON.parse(readFileSync(join(T, 'stardust', 'dynamics', 'index-status.json'), 'utf8'));
assert.equal(st.registered, 'denied'); assert.equal(st.exit, 3); assert.match(st.reason, /HTTP 403/);
assert.deepEqual(hits.map((h) => h.split(' ')[0]), ['GET', 'POST', 'POST'], 'config GET, config POST, index POST — no read-back after the denial');
rmSync(T, { recursive: true, force: true });
console.log('query-index.test: ok (usage exit 2 on a swallowed flag; bulk-index 403 → INDEX-CONFIG.md + exit 3, token never printed, no read-back)');
