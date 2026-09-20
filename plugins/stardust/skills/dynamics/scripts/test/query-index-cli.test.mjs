#!/usr/bin/env node
/**
 * Fixture test for skills/rollout/scripts/query-index.mjs — the Registration gate's instrument
 * (reference/listings.md § Mechanics). No network beyond one local node:http stand-in, no browser.
 *
 *   (1) a value flag followed by another flag (`--sample --replace`) is usage: exit 2 before any
 *       request — never the silent fallback that picked the default sample and posted;
 *   (2) a 401/403 on the bulk-index POST is the owner class: exit 3, `DENIED` on stderr,
 *       index-status.json `registered: denied` / exit 3, INDEX-CONFIG.md written — not exit 4 (no verdict);
 *   (3) the two exit-3 reasons are told apart by the stderr word: REFUSED (remote-only names, nothing
 *       written) vs DENIED (INDEX-CONFIG.md written).
 * Before the fix (1) exited 0 after posting and (2) exited 4.
 * Run: node plugins/stardust/skills/dynamics/scripts/test/query-index-cli.test.mjs
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, '..', '..', '..', 'rollout', 'scripts', 'query-index.mjs');
const FIX = join(here, '..', '..', '..', '..', 'evals', 'lint', 'fixtures', 'query-index');
const yamlText = readFileSync(join(FIX, 'helix-query.yaml'), 'utf8');
const remoteText = readFileSync(join(FIX, 'remote-query.yaml'), 'utf8');
let failed = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failed += 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`); };

let state = {}; let log = [];
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  req.on('data', () => {}); req.on('end', () => {
    log.push({ method: req.method, path });
    const send = (status, body = '', type = 'application/json') => { res.writeHead(status, { 'content-type': type }); res.end(body); };
    if (path.startsWith('/config/')) return req.method === 'GET' ? send(200, state.remote ?? yamlText, 'text/yaml') : send(204);
    if (path.startsWith('/index/')) return send(state.indexPost ?? 403, '');
    return send(404);
  });
});
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const BASE = `http://127.0.0.1:${server.address().port}`;

const run = (extra, st = {}) => new Promise((resolve) => {
  state = st; log = [];
  const tmp = mkdtempSync(join(tmpdir(), 'query-index-cli-'));
  const out = join(tmp, 'stardust', 'dynamics');
  mkdirSync(join(tmp, 'coverage'), { recursive: true });
  const pages = join(tmp, 'coverage', 'pages.json');
  writeFileSync(pages, readFileSync(join(FIX, 'coverage', 'pages.json')));
  const child = spawn(process.execPath, [SCRIPT, '--org', 'o', '--site', 's', '--yaml', join(FIX, 'helix-query.yaml'), '--admin', BASE, '--origin', BASE, '--out', out, '--pages', pages, '--poll-ms', '50', '--timeout', '5', ...extra], { env: { ...process.env, DA_TOKEN: 'fixture' }, cwd: tmp });
  let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => {
    const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
    const statusJson = read(join(out, 'index-status.json')); const indexConfig = existsSync(join(tmp, 'stardust', 'rollout', 'INDEX-CONFIG.md'));
    rmSync(tmp, { recursive: true, force: true });
    resolve({ status, stderr, reqs: log, statusJson, indexConfig });
  });
});

// (1) value flag followed by a flag → usage, no request
let r = await run(['--sample', '--replace']);
eq('--sample --replace → exit 2', r.status, 2);
eq('… before any request', r.reqs.length, 0);
eq('… names the flag', /--sample needs a value/.test(r.stderr), true);
r = await run(['--ref']);
eq('trailing --ref without a value → exit 2, no request', [r.status, r.reqs.length], [2, 0]);

// (2) bulk index POST 403 → DENIED, exit 3, INDEX-CONFIG.md, index-status registered denied
r = await run([], { indexPost: 403 });
eq('index POST 403 → exit 3 (owner), not 4', r.status, 3);
eq('… stderr word DENIED', /bulk index POST DENIED \(HTTP 403/.test(r.stderr), true);
eq('… index-status.json registered denied / exit 3 / verdict index-denied', [r.statusJson?.registered, r.statusJson?.exit, r.statusJson?.verdict], ['denied', 3, 'index-denied']);
eq('… INDEX-CONFIG.md written', r.indexConfig, true);
eq('… the token value is never printed', r.stderr.includes('fixture'), false);
r = await run([], { indexPost: 503 });
eq('index POST 503 stays no verdict (exit 4)', r.status, 4);

// (3) REFUSED vs DENIED: the remote-only name path posts and writes nothing
r = await run([], { remote: remoteText, indexPost: 403 });
eq('remote-only index name → exit 3 with REFUSED', [r.status, /REFUSED/.test(r.stderr), /DENIED/.test(r.stderr)], [3, true, false]);
eq('… nothing posted, nothing written', [r.reqs.filter((q) => q.method === 'POST').length, r.statusJson, r.indexConfig], [0, null, false]);

server.close();
if (failed) { console.error(`query-index-cli test: ${failed} failure(s)`); process.exit(1); }
console.log('query-index-cli test: ok (value-flag guard exit 2 before any request; index POST 401/403 → DENIED exit 3 + INDEX-CONFIG.md; REFUSED writes nothing)');
