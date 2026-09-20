#!/usr/bin/env node
/**
 * Fixture test: skills/deploy/scripts/da-token-check.mjs (T09.1) — offline decode + the mock DA list smoke.
 * Run: node skills/deploy/scripts/test/da-token-check.test.mjs   (exit 1 on failure)
 *
 *   - resolution order shell > ./.env > ~/.claude/.env > ~/.env, the CLASS printed, the value never;
 *   - IMS claims (created_at + expires_in, string ms) valid → 0 / expired → 2 with the refresh file named;
 *     plain `exp` seconds; three-segment garbage and two-segment strings → "expiry unknown", exit 0 offline;
 *   - smoke: list 200 → 0 with `list: 200`; 401 → 2 (rejected); 403 → 2; 404 → 2 (org/repo not visible to this
 *     identity — never `valid · list: 404`, the site-bootstrap pointer printed); unreachable / 5xx → 1 (no verdict,
 *     `da: unreachable` in the block); an expired decode makes ZERO requests;
 *   - --need: remaining < need → 2;
 *   - --credentials: exact SITE_TOKEN slug match (LEDGERLINE vs LEDGERLINE_DEMO), schema keys incl. `daTarget`
 *     (unchecked without a smoke, ok on 200, not-visible on 404 with exit 2, denied on 403), state.json merged
 *     (other keys kept, no token value inside), gh skipped / ok (mock GitHub) / expired;
 *   - usage: --help 0, unknown flag 1, --org without --repo 1.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteTokenName, siteTokenNamesIn } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'da-token-check.mjs');
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const ims = (hoursLeft) => `h.${b64u({ created_at: String(Date.now() - 3600_000), expires_in: String(Math.round((1 + hoursLeft) * 3600_000)), client_id: 'x' })}.s`;
const jwtExp = (hoursLeft) => `h.${b64u({ exp: Math.round(Date.now() / 1000 + hoursLeft * 3600) })}.s`;

// pure helpers
assert.equal(siteTokenName('ledgerline-demo'), 'SITE_TOKEN_LEDGERLINE_DEMO');
assert.equal(siteTokenName('Larkspur Mutual'), 'SITE_TOKEN_LARKSPUR_MUTUAL');

const root = mkdtempSync(join(tmpdir(), 'da-token-check-'));
const home = join(root, 'home'); const cwd = join(root, 'proj');
mkdirSync(join(home, '.claude'), { recursive: true }); mkdirSync(join(cwd, 'stardust'), { recursive: true });
const secret = 'SECRETVALUE';
let listStatus = 200; let ghStatus = 200; let hits = 0;
const server = createServer((req, res) => {
  hits += 1;
  if (req.url.startsWith('/list/')) { res.writeHead(listStatus, { 'content-type': 'application/json' }); return res.end('[]'); }
  if (req.url === '/gh/user') { res.writeHead(ghStatus); return res.end('{}'); }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const run = (args, env = {}) => new Promise((resolve) => {
  const c = spawn(process.execPath, [CLI, ...args], { cwd, env: { PATH: process.env.PATH, HOME: home, DEPLOY_BATCH_DA_LIST: `${base}/list`, DA_TOKEN_CHECK_GH_API: `${base}/gh`, ...env } });
  let stdout = ''; let stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  const t = setTimeout(() => { c.kill(); stderr += '\n[test] TIMEOUT'; }, 20000);
  c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr, all: stdout + stderr }); });
});
const envFile = (file, lines) => writeFileSync(file, `${lines.join('\n')}\n`);

try {
  // missing everywhere → 2, every lookup place named
  let r = await run(['--no-smoke']);
  assert.equal(r.status, 2); assert.match(r.stdout, /DA_TOKEN: missing — looked in the shell, \.\/\.env, ~\/\.claude\/\.env, ~\/\.env/);

  // resolution order + class + value hygiene
  envFile(join(home, '.env'), [`DA_TOKEN=${ims(5)}${secret}`]);
  r = await run(['--no-smoke']);
  assert.equal(r.status, 0, r.all); assert.match(r.stdout, /valid ~5\.0h \(source: home-env, ~\/\.env\)/); assert.doesNotMatch(r.all, new RegExp(secret));
  envFile(join(home, '.claude', '.env'), [`export DA_TOKEN="${ims(7)}"`]);
  r = await run(['--no-smoke']); assert.match(r.stdout, /~7\.0h \(source: global-env, ~\/\.claude\/\.env\)/);
  envFile(join(cwd, '.env'), [`DA_TOKEN=${ims(9)}`]);
  r = await run(['--no-smoke']); assert.match(r.stdout, /~9\.0h \(source: repo-env, \.\/\.env\)/);
  r = await run(['--no-smoke'], { DA_TOKEN: ims(11) }); assert.match(r.stdout, /~11\.0h \(source: shell\)$/m);
  r = await run(['--no-smoke', '--token-env', 'OTHER'], { OTHER: jwtExp(3) }); assert.equal(r.status, 0); assert.match(r.stdout, /^OTHER: valid ~3\.0h/);

  // expiry classes
  r = await run(['--no-smoke'], { DA_TOKEN: ims(-8.6) });
  assert.equal(r.status, 2); assert.match(r.stdout, /DA_TOKEN: expired 8\.6h ago \(source: shell\) — refresh it in the shell environment/);
  envFile(join(cwd, '.env'), [`DA_TOKEN=${ims(-2)}`]);
  r = await run(['--no-smoke']); assert.equal(r.status, 2); assert.match(r.stdout, /refresh it in \.\/\.env \(log in at https:\/\/da\.live\)/);
  r = await run(['--no-smoke'], { DA_TOKEN: 'a.!!!notbase64json!!!.c' }); assert.equal(r.status, 0, 'garbage payload → unknown, advisory'); assert.match(r.stdout, /WARN DA_TOKEN: expiry unknown/); assert.match(r.stdout, /valid \(expiry unknown\)/);
  r = await run(['--no-smoke'], { DA_TOKEN: 'twosegments.only' }); assert.equal(r.status, 0); assert.match(r.stdout, /expiry unknown/);

  // smoke verdicts (one request each), none on a proven-expired token
  hits = 0; r = await run(['--org', 'o', '--repo', 'r'], { DA_TOKEN: ims(4) });
  assert.equal(r.status, 0, r.all); assert.match(r.stdout, /valid ~4\.0h \(source: shell\) · list: 200/); assert.equal(hits, 1, 'exactly one list GET');
  listStatus = 401; r = await run(['--org', 'o', '--repo', 'r'], { DA_TOKEN: ims(4) }); assert.equal(r.status, 2); assert.match(r.stdout, /rejected \(list 401; source: shell\)/);
  listStatus = 403; r = await run(['--org', 'o', '--repo', 'r'], { DA_TOKEN: ims(4) }); assert.equal(r.status, 2); assert.match(r.stdout, /answers 403/);
  listStatus = 404; r = await run(['--org', 'o', '--repo', 'r'], { DA_TOKEN: ims(4) }); assert.equal(r.status, 2, '404 = target not visible → exit 2, never usable'); assert.match(r.stdout, /valid ~4\.0h \(source: shell\) but o\/r answers 404 — the DA org\/repo is not visible to this identity/); assert.match(r.stdout, /site-bootstrap\.md/); assert.doesNotMatch(r.stdout, /list: 404/);
  r = await run(['--org', 'o', '--repo', 'r', '--json'], { DA_TOKEN: ims(4) }); assert.equal(r.status, 2); assert.equal(JSON.parse(r.stdout).smoke, 404); assert.equal(JSON.parse(r.stdout).da, 'ok', 'the token itself is fine');
  listStatus = 503; r = await run(['--org', 'o', '--repo', 'r'], { DA_TOKEN: ims(4) }); assert.equal(r.status, 1, '5xx = no verdict, exit 1 not 2'); assert.match(r.stdout, /list: 503 — no verdict/);
  r = await run(['--org', 'o', '--repo', 'r', '--json'], { DA_TOKEN: ims(4) }); assert.equal(JSON.parse(r.stdout).da, 'unreachable', 'no verdict is not `ok`');
  listStatus = 200;
  r = await run(['--org', 'o', '--repo', 'r'], { DA_TOKEN: ims(4), DEPLOY_BATCH_DA_LIST: 'http://127.0.0.1:9/list' }); assert.equal(r.status, 1); assert.match(r.stdout, /list: 000 — no verdict/);
  hits = 0; r = await run(['--org', 'o', '--repo', 'r'], { DA_TOKEN: ims(-1) }); assert.equal(r.status, 2); assert.equal(hits, 0, 'decode proves expiry → no request');
  r = await run(['--org', 'o', '--repo', 'r'], { DA_TOKEN: 'a.!!!.c' }); assert.equal(r.status, 0, 'unknown expiry: the smoke decides'); assert.match(r.stdout, /the smoke decides/); assert.match(r.stdout, /list: 200/);

  // --need
  r = await run(['--no-smoke', '--need', '4'], { DA_TOKEN: ims(1) }); assert.equal(r.status, 2); assert.match(r.stdout, /valid ~1\.0h but the batch needs 4h/);
  r = await run(['--no-smoke', '--need', '0.5'], { DA_TOKEN: ims(1) }); assert.equal(r.status, 0);

  // --credentials: exact slug match, schema, state merge, gh
  const state = join(cwd, 'stardust', 'state.json');
  writeFileSync(state, JSON.stringify({ flow: 'replica', site: { originUrl: 'https://x.example' } }, null, 2));
  envFile(join(cwd, '.env'), [`DA_TOKEN=${ims(6)}`, 'SITE_TOKEN_LEDGERLINE=aaa', 'SITE_TOKEN_LEDGERLINE_DEMO=bbb', 'SITE_TOKEN_MERIDIAN_AIRWAYS=ccc']);
  assert.deepEqual(siteTokenNamesIn({ cwd, home, env: {} }), ['SITE_TOKEN_LEDGERLINE', 'SITE_TOKEN_LEDGERLINE_DEMO', 'SITE_TOKEN_MERIDIAN_AIRWAYS']);
  r = await run(['--credentials', '--site', 'ledgerline', '--no-smoke', '--state', state]);
  assert.equal(r.status, 0, r.all);
  assert.match(r.stdout, /credentials: da=ok daSource=repo-env daExpiresAt=\S+ daTarget=unchecked siteTokenEnv=SITE_TOKEN_LEDGERLINE gh=skipped/);
  let st = JSON.parse(readFileSync(state, 'utf8'));
  assert.equal(st.flow, 'replica', 'other keys kept');
  assert.deepEqual(Object.keys(st.credentials).sort(), ['at', 'da', 'daExpiresAt', 'daSource', 'daTarget', 'gh', 'siteTokenEnv']);
  // daTarget says WHY step 8 refused when the token is fine: list 404 → not-visible (exit 2, da still ok); 200 → ok; 403 → denied
  listStatus = 404; r = await run(['--credentials', '--site', 'ledgerline', '--org', 'o', '--repo', 'r', '--state', state]);
  assert.equal(r.status, 2, r.all); assert.match(r.stdout, /credentials: da=ok daSource=repo-env daExpiresAt=\S+ daTarget=not-visible /); assert.equal(JSON.parse(readFileSync(state, 'utf8')).credentials.daTarget, 'not-visible');
  listStatus = 200; r = await run(['--credentials', '--site', 'ledgerline', '--org', 'o', '--repo', 'r', '--state', state]); assert.equal(r.status, 0); assert.match(r.stdout, /daTarget=ok /);
  listStatus = 403; r = await run(['--credentials', '--site', 'ledgerline', '--org', 'o', '--repo', 'r', '--state', state]); assert.equal(r.status, 2); assert.match(r.stdout, /da=expired .*daTarget=denied /);
  listStatus = 200;
  assert.equal(st.credentials.siteTokenEnv, 'SITE_TOKEN_LEDGERLINE'); assert.doesNotMatch(readFileSync(state, 'utf8'), /aaa|bbb|ccc/);
  r = await run(['--credentials', '--site', 'ledgerline-demo', '--no-smoke', '--state', state]); assert.match(r.stdout, /siteTokenEnv=SITE_TOKEN_LEDGERLINE_DEMO/);
  r = await run(['--credentials', '--repo', 'ledger', '--org', 'o', '--no-smoke', '--state', state]);
  assert.match(r.stdout, /siteTokenEnv=none \(looked for SITE_TOKEN_LEDGER\)/, 'prefix never matches');
  st = JSON.parse(readFileSync(state, 'utf8')); assert.equal(st.credentials.siteTokenEnv, null); assert.equal('siteTokenWanted' in st.credentials, false);
  r = await run(['--credentials', '--site', 'ledgerline', '--no-smoke', '--state', join(cwd, 'nope.json')]); assert.equal(r.status, 0); assert.match(r.stdout, /absent — not created/);
  r = await run(['--credentials', '--site', 'ledgerline', '--no-smoke', '--state', state, '--gh']); assert.match(r.stdout, /gh=missing/);
  r = await run(['--credentials', '--site', 'ledgerline', '--no-smoke', '--state', state], { GH_PAT: 'ghp_SECRETPAT' }); assert.match(r.stdout, /gh=ok/); assert.doesNotMatch(r.all, /SECRETPAT/);
  ghStatus = 401; r = await run(['--credentials', '--site', 'ledgerline', '--no-smoke', '--state', state], { GH_PAT: 'ghp_x' }); assert.match(r.stdout, /gh=expired/); ghStatus = 200;
  // an expired token still writes the block (da=expired) — the master reads it into the blocked line
  r = await run(['--credentials', '--site', 'ledgerline', '--no-smoke', '--state', state], { DA_TOKEN: ims(-3) });
  assert.equal(r.status, 2); st = JSON.parse(readFileSync(state, 'utf8')); assert.equal(st.credentials.da, 'expired'); assert.equal(st.credentials.daSource, 'shell');
  r = await run(['--credentials', '--site', 'ledgerline', '--no-smoke', '--json', '--state', state]);
  const j = JSON.parse(r.stdout); assert.equal(j.credentials.siteTokenEnv, 'SITE_TOKEN_LEDGERLINE'); assert.equal(j.exit, 0);

  // usage
  assert.equal((await run(['--help'])).status, 0);
  assert.equal((await run(['--bogus'])).status, 1);
  assert.equal((await run(['--org', 'o'])).status, 1, '--org without --repo');
  assert.equal((await run(['--credentials'])).status, 1, '--credentials needs --site or --repo');
  console.log('da-token-check test: ok');
} finally {
  server.closeAllConnections(); server.close();
  rmSync(root, { recursive: true, force: true });
}
