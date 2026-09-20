#!/usr/bin/env node
/**
 * Fixture test: skills/deploy/scripts/lockdown.mjs (T12.2 — the lockdown step before the hand-off).
 * Run: node skills/deploy/scripts/test/lockdown.test.mjs   (exit 1 on failure)
 *
 * One local http server plays admin (config / secrets / access) AND both delivery hosts (LOCKDOWN_DELIVERY_BASE);
 * a `gh` shim on PATH plays GitHub (mode file). Network-free. Pins:
 *   - DA_TOKEN missing or a placeholder → exit 2 before any request; an env file that is NOT git-ignored → exit 2, zero POSTs;
 *   - config 404 → exit 2 "config not enabled", zero POSTs, .env untouched; config 401 → exit 2;
 *   - the happy path: gh repo edit ran, secrets POST {} once, access/site.json GET → merged POST with the
 *     existing `allow` entries preserved and `secretId` APPENDED (never replaced), `.env` gains
 *     `SITE_TOKEN_<SLUG>=<value>` (mode 600) and the value never appears on stdout/stderr, state.json
 *     `credentials.siteTokenEnv` set with other keys kept, verify anonymous 401 / token 200 on both hosts (a 30x on `/`
 *     followed one hop for BOTH reads; a proven-open host outranks a no-verdict sibling: exit 1, never 2), exit 0,
 *     last line `SUMMARY lockdown …`; a live host that 404s WITH the token is accepted (nothing published yet);
 *   - anonymous stays 200 → polls capped by --wait, exit 1, never "locked"; token rejected → exit 1;
 *   - gh denied (403) → exit 3, `owner: gh repo edit … --visibility private …`, the site half still ran and
 *     verified; --gh-mode print → exit 3 with the same owner line and no gh mutation; already private → no edit;
 *   - --no-repo → gh never called; --allow honoured; the default allow list comes from git config user.email;
 *   - --inventory prints the 8-column TSV header and one row per repo (prefix filter; class locked | public-served
 *     | unserved), three anonymous GETs per repo and no POST; --help lists every documented flag.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeAccess, writeEnvVar, parseArgs } from '../lockdown.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'lockdown.mjs');
const dir = mkdtempSync(join(tmpdir(), 'lockdown-'));
const bin = join(dir, 'bin'); mkdirSync(bin);
const proj = join(dir, 'project'); mkdirSync(join(proj, 'stardust'), { recursive: true });
const home = join(dir, 'home'); mkdirSync(home);
const modeFile = join(dir, 'gh-mode'); const ghLog = join(dir, 'gh.log');
const setGh = (m) => writeFileSync(modeFile, m);
writeFileSync(join(bin, 'gh'), `#!/bin/sh
MODE=$(cat "${modeFile}")
echo "gh $@" >> "${ghLog}"
case "$1 $2" in
  "api repos/o/r") [ "$MODE" = "private" ] && { echo true; exit 0; }; echo false; exit 0;;
  "repo edit") case "$MODE" in ok) exit 0;; denied) echo "GraphQL: Resource not accessible by integration (HTTP 403)" >&2; exit 1;; *) echo "shim: unexpected mode $MODE" >&2; exit 1;; esac;;
  "api orgs/o/repos") printf '%s\\n' '{"name":"sdt-alpha","visibility":"public","pushed_at":"2026-09-01T10:00:00Z"}' '{"name":"sdt-beta","visibility":"private","pushed_at":"2026-08-11T10:00:00Z"}' '{"name":"other","visibility":"public","pushed_at":"2026-01-01T00:00:00Z"}'; exit 0;;
esac
echo "shim: unexpected $@" >&2; exit 1
`); chmodSync(join(bin, 'gh'), 0o755);
const ghCalls = () => (existsSync(ghLog) ? readFileSync(ghLog, 'utf8').trim().split('\n').filter(Boolean) : []);
const g = (...args) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=ops@operator.example', ...args], { cwd: proj, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };

// ---- mock admin + delivery -----------------------------------------------------
const SECRET = 'sekret-VALUE-9f8e7d6c';
const rules = { config: 200, access: { allow: ['*@old.example'], secretId: 'old-id' }, anonPage: 401, anonLive: 401, tokLive: 200, tokPage: 200, anonOpenPolls: 0, servedByRepo: {}, anonRedirect: null, tokRedirect: null };
let requests = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const auth = req.headers.authorization || '';
    requests.push({ method: req.method, path: u.pathname, auth, body });
    const send = (status, data, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(data === undefined ? '' : (typeof data === 'string' ? data : JSON.stringify(data))); };
    if (u.pathname === '/config/o/sites/s.json') return send(rules.config, rules.config === 200 ? { title: 's' } : '');
    if (u.pathname === '/config/o/sites/s/secrets.json' && req.method === 'POST') return send(200, { id: 'new-id', token: SECRET });
    if (u.pathname === '/config/o/sites/s/access/site.json') { if (req.method === 'GET') return rules.access ? send(200, rules.access) : send(404, ''); rules.access = JSON.parse(body); return send(200, rules.access); }
    const m = u.pathname.match(/^\/aem\.(page|live)(\/.*)$/);
    if (m) {
      const kind = m[1]; const p = m[2];
      if (p === '/scripts/aem.js') { const st = rules.servedByRepo[u.searchParams.get('repo') || ''] ?? 200; return send(st, '// aem'); }
      if (auth === `token ${SECRET}`) { if (rules.tokRedirect && p === '/') return send(302, '', { location: `/aem.${kind}${rules.tokRedirect}` }); return send(kind === 'live' ? rules.tokLive : rules.tokPage, '<html>ok</html>'); }
      if (auth) return send(401, '', { 'x-error': 'access-not-allowed' });
      if (rules.anonRedirect && p === '/') return send(302, '', { location: `/aem.${kind}${rules.anonRedirect}` }); // a locale redirect on the root (absolute-path Location, under the test-hook base)
      if (rules.anonOpenPolls > 0) { rules.anonOpenPolls -= 1; return send(200, '<html>open</html>'); }
      const st = kind === 'live' ? rules.anonLive : rules.anonPage;
      return send(st, st === 200 ? '<html>open</html>' : '', st === 401 ? { 'x-error': 'access-not-allowed' } : {});
    }
    send(404, '');
  });
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

const run = (args, env = {}) => new Promise((resolve) => {
  const c = spawn(process.execPath, [CLI, ...args], { cwd: proj, env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, LOCKDOWN_DELIVERY_BASE: base, LOCKDOWN_POLL_MS: '20', ...env } });
  let stdout = ''; let stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  const t = setTimeout(() => { c.kill(); stderr += '\n[test] TIMEOUT'; }, 20000);
  c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr, all: stdout + stderr }); });
});
const LOCK = ['--org', 'o', '--repo', 'r', '--site', 's', '--admin-base', base, '--env', join(proj, '.env'), '--state', join(proj, 'stardust', 'state.json'), '--wait', '1'];
const envFile = () => (existsSync(join(proj, '.env')) ? readFileSync(join(proj, '.env'), 'utf8') : '');
const posts = () => requests.filter((q) => q.method === 'POST');
const reset = () => { requests = []; rmSync(ghLog, { force: true }); rules.config = 200; rules.access = { allow: ['*@old.example'], secretId: 'old-id' }; rules.anonPage = 401; rules.anonLive = 401; rules.tokLive = 200; rules.tokPage = 200; rules.anonOpenPolls = 0; rules.anonRedirect = null; rules.tokRedirect = null; };
const stateFile = join(proj, 'stardust', 'state.json');

try {
  // pure helpers
  assert.deepEqual(mergeAccess({ allow: ['*@old.example'], secretId: 'old-id', other: 1 }, ['*@operator.example'], 'new-id'), { allow: ['*@old.example', '*@operator.example'], secretId: ['old-id', 'new-id'], other: 1 });
  assert.deepEqual(mergeAccess(null, ['*@a.example'], 'id1'), { allow: ['*@a.example'], secretId: ['id1'] });
  assert.deepEqual(mergeAccess({ secretId: ['id1'] }, [], 'id1'), { allow: [], secretId: ['id1'] }, 'idempotent append');
  const ef = join(dir, 'x.env'); writeFileSync(ef, 'A=1\nSITE_TOKEN_S=old\n');
  assert.equal(writeEnvVar(ef, 'SITE_TOKEN_S', 'new'), 'replaced'); assert.equal(readFileSync(ef, 'utf8'), 'A=1\nSITE_TOKEN_S=new\n');
  assert.equal(writeEnvVar(ef, 'B', '2'), 'appended'); assert.equal(readFileSync(ef, 'utf8'), 'A=1\nSITE_TOKEN_S=new\nB=2\n');
  const pa = parseArgs(['--org', 'o', '--repo', 'my-site']); assert.equal(pa.site, 'my-site'); assert.equal(pa.siteTokenEnv, 'SITE_TOKEN_MY_SITE');
  assert.throws(() => parseArgs(['--org', 'o', '--repo', 'r', '--gh-mode', 'curl']), /gh-mode/);

  // project: git repo whose .gitignore excludes .env (Setup step 6), a state.json with other keys
  g('init', '-q', '-b', 'main');
  writeFileSync(stateFile, JSON.stringify({ flow: 'replica', site: { originUrl: 'https://x.example' }, credentials: { da: 'ok', gh: 'skipped' } }, null, 2));
  writeFileSync(join(proj, 'README.md'), 'x\n');

  // 1. DA_TOKEN missing → exit 2 before any request
  setGh('public'); reset();
  let r = await run(LOCK);
  assert.equal(r.status, 2, r.all); assert.match(r.stdout, /DA_TOKEN: missing/); assert.equal(requests.length, 0); assert.equal(ghCalls().length, 0);
  assert.match(r.stdout.trim().split('\n').at(-1), /^SUMMARY lockdown o\/s repo=- site=- verify=- exit=2$/);
  r = await run(LOCK, { DA_TOKEN: 'placeholder' }); assert.equal(r.status, 2); assert.match(r.stdout, /DA_TOKEN: a placeholder, not a token \(source: shell\)/); assert.equal(requests.length, 0, 'a placeholder never reaches the network');

  // 2. env file not ignored → exit 2, zero requests (no .gitignore yet)
  reset(); r = await run(LOCK, { DA_TOKEN: 'da-tok' });
  assert.equal(r.status, 2, r.all); assert.match(r.stdout, /is NOT git-ignored .* run master Setup step 6/); assert.equal(requests.length, 0);
  writeFileSync(join(proj, '.gitignore'), '.env\n.env.*\n'); g('add', '-A'); g('commit', '-q', '-m', 'base');

  // 3. config 404 → exit 2, zero POSTs, nothing written
  reset(); rules.config = 404;
  r = await run(LOCK, { DA_TOKEN: 'da-tok' });
  assert.equal(r.status, 2, r.all); assert.match(r.stdout, /config not enabled for o\/s \(GET .*\/config\/o\/sites\/s\.json → 404\) — enable the config service/); assert.match(r.stdout, /re-run: node skills\/deploy\/scripts\/lockdown\.mjs --org o --repo r --site s/);
  assert.equal(posts().length, 0); assert.equal(envFile(), ''); assert.equal(ghCalls().length, 0, 'the repo half never runs without a config');
  assert.equal(requests[0].auth, 'Bearer da-tok', 'admin reads carry the DA token');
  reset(); rules.config = 401; r = await run(LOCK, { DA_TOKEN: 'da-tok' }); assert.equal(r.status, 2); assert.match(r.stdout, /config service answers 401/); assert.equal(posts().length, 0);

  // 4. happy path
  reset(); setGh('ok');
  r = await run([...LOCK, '--allow', '*@operator.example'], { DA_TOKEN: 'da-tok' });
  assert.equal(r.status, 0, r.all);
  assert.deepEqual(ghCalls(), ['gh api repos/o/r --jq .private', 'gh repo edit o/r --visibility private --accept-visibility-change-consequences']);
  const seq = requests.map((q) => `${q.method} ${q.path}`);
  assert.deepEqual(seq.slice(0, 4), ['GET /config/o/sites/s.json', 'POST /config/o/sites/s/secrets.json', 'GET /config/o/sites/s/access/site.json', 'POST /config/o/sites/s/access/site.json'], `admin order: ${seq}`);
  assert.equal(requests[1].body, '{}', 'secrets POST body is {}');
  assert.deepEqual(rules.access, { allow: ['*@old.example', '*@operator.example'], secretId: ['old-id', 'new-id'] }, 'allow preserved + secretId appended');
  assert.ok(seq.slice(4).every((s) => s.startsWith('GET /aem.')), 'then delivery reads only');
  assert.ok(requests.some((q) => q.path === '/aem.page/' && !q.auth) && requests.some((q) => q.path === '/aem.live/' && q.auth === `token ${SECRET}`), 'anonymous and token reads on both hosts');
  assert.ok(!requests.some((q) => q.path.startsWith('/aem.') && q.auth.startsWith('Bearer')), 'the DA token never goes to a delivery host');
  assert.match(envFile(), /^SITE_TOKEN_S=sekret-VALUE-9f8e7d6c$/m); assert.equal(statSync(join(proj, '.env')).mode & 0o777, 0o600);
  assert.doesNotMatch(r.all, /sekret-VALUE/, 'the value is never printed');
  const st = JSON.parse(readFileSync(stateFile, 'utf8')); assert.equal(st.credentials.siteTokenEnv, 'SITE_TOKEN_S'); assert.equal(st.credentials.da, 'ok', 'other credential keys kept'); assert.equal(st.flow, 'replica');
  assert.match(r.stdout, /verify: .*\/aem\.page\/ {2}anonymous 401 · token 200 → locked/); assert.match(r.stdout, /verify: .*\/aem\.live\/ {2}anonymous 401 · token 200 → locked/);
  assert.match(r.stdout.trim().split('\n').at(-1), /^SUMMARY lockdown o\/s repo=private site=locked verify=ok exit=0$/);
  assert.match(r.stdout, /access: allow \*@old\.example, \*@operator\.example · secretId 2 entries/);
  // token accepted with 404 on live (nothing published yet) still counts as locked
  reset(); setGh('private'); rules.tokLive = 404;
  r = await run([...LOCK, '--allow', '*@operator.example'], { DA_TOKEN: 'da-tok' });
  assert.equal(r.status, 0, r.all); assert.match(r.stdout, /repo: o\/r already private/); assert.deepEqual(ghCalls(), ['gh api repos/o/r --jq .private'], 'no edit on a private repo'); assert.match(r.stdout, /token 404 \(accepted — nothing published on this host yet\) → locked/);
  assert.deepEqual(rules.access.secretId, ['old-id', 'new-id'], 'a re-run appends the id to what the service holds, never replaces');
  // --json shape
  reset(); setGh('private'); r = await run([...LOCK, '--allow', '*@operator.example', '--json'], { DA_TOKEN: 'da-tok' }); assert.equal(r.status, 0); const j = JSON.parse(r.stdout); assert.equal(j.exit, 0); assert.equal(j.siteAuth, 'locked'); assert.doesNotMatch(r.stdout, /sekret-VALUE/);

  // 5. verification failure: anonymous stays 200 → capped polls, exit 1; token rejected → exit 1
  reset(); setGh('private'); rules.anonPage = 200;
  r = await run([...LOCK, '--allow', '*@operator.example'], { DA_TOKEN: 'da-tok' });
  assert.equal(r.status, 1, r.all); assert.match(r.stdout, /anonymous 200 \(still open\) · token 200 → NOT locked/); assert.match(r.stdout, /verification failed after 1s .* do not hand off \(exit 1\)/);
  const pagePolls = requests.filter((q) => q.path === '/aem.page/' && !q.auth).length; assert.ok(pagePolls >= 2 && pagePolls <= 60, `polls capped by --wait: ${pagePolls}`);
  assert.match(r.stdout.trim().split('\n').at(-1), /repo=already-private site=applied verify=failed exit=1$/);
  reset(); setGh('private'); rules.anonOpenPolls = 2; r = await run([...LOCK, '--allow', '*@operator.example'], { DA_TOKEN: 'da-tok' }); assert.equal(r.status, 0, `propagation: open for two polls, then locked → 0: ${r.all}`);
  reset(); setGh('private'); rules.tokPage = 401; r = await run([...LOCK, '--allow', '*@operator.example'], { DA_TOKEN: 'da-tok' }); assert.equal(r.status, 1); assert.match(r.stdout, /anonymous 401 · token 401 → NOT locked/);
  // NEGATIVE (verify semantics): a 5xx WITH the token is no verdict, never "accepted → locked" (was: any non-401/403 status counted as accepted)
  reset(); setGh('private'); rules.tokLive = 503; r = await run([...LOCK, '--allow', '*@operator.example'], { DA_TOKEN: 'da-tok' });
  assert.equal(r.status, 2, `5xx with the token is no verdict (exit 2), not locked: ${r.all}`); assert.match(r.stdout, /token 503 \(no verdict — the host did not answer; not a lock result\) → NO VERDICT/); assert.doesNotMatch(r.stdout, /aem\.live\/ {2}anonymous 401 · token 503 → locked/);
  assert.match(r.stdout.trim().split('\n').at(-1), /verify=no-verdict exit=2$/);
  // an anonymous 302 on `/` (locale redirect) is followed one hop: the 401 behind it is the verdict, not "still open"
  reset(); setGh('private'); rules.anonRedirect = '/en/'; r = await run([...LOCK, '--allow', '*@operator.example'], { DA_TOKEN: 'da-tok' });
  assert.equal(r.status, 0, `one redirect hop is followed: ${r.all}`); assert.match(r.stdout, /anonymous 401 \(after a 302 hop\) · token 200 → locked/);
  // NEGATIVE: the locale redirect applies to the token read too — a 302 WITH the token was read as "rejected" (exit 1 NOT locked) although the hop lands on 200
  reset(); setGh('private'); rules.anonRedirect = '/en/'; rules.tokRedirect = '/en/'; r = await run([...LOCK, '--allow', '*@operator.example'], { DA_TOKEN: 'da-tok' });
  assert.equal(r.status, 0, `the token read follows the same one hop: ${r.all}`); assert.match(r.stdout, /anonymous 401 \(after a 302 hop\) · token 200 \(after a 302 hop\) → locked/);
  // NEGATIVE (precedence): a host proven OPEN plus a sibling answering 5xx with the token is exit 1 NOT locked — the no-verdict host never softens a failed lock to exit 2
  reset(); setGh('private'); rules.anonPage = 200; rules.tokLive = 503; r = await run([...LOCK, '--allow', '*@operator.example'], { DA_TOKEN: 'da-tok' });
  assert.equal(r.status, 1, `open host outranks no-verdict host: ${r.all}`); assert.match(r.stdout, /aem\.page\/ {2}anonymous 200 \(still open\) · token 200 → NOT locked/); assert.match(r.stdout, /aem\.live\/ {2}anonymous 401 · token 503 .* → NO VERDICT/);
  assert.match(r.stdout.trim().split('\n').at(-1), /verify=failed exit=1$/);
  // an OPEN host whose token read also 5xx's is NOT locked (the lock is disproven by the anonymous 200), not "no verdict"
  reset(); setGh('private'); rules.anonPage = 200; rules.tokPage = 503; r = await run([...LOCK, '--allow', '*@operator.example'], { DA_TOKEN: 'da-tok' });
  assert.equal(r.status, 1, `open + 5xx on the same host = NOT locked: ${r.all}`); assert.match(r.stdout, /anonymous 200 \(still open\) · token 503 → NOT locked/);

  // 6. repo denied → exit 3 with the exact owner command; the site half ran and verified
  reset(); setGh('denied');
  r = await run([...LOCK, '--allow', '*@operator.example'], { DA_TOKEN: 'da-tok' });
  assert.equal(r.status, 3, r.all); assert.match(r.stdout, /repo: denied \(GraphQL: Resource not accessible by integration \(HTTP 403\)\) — owner: gh repo edit o\/r --visibility private --accept-visibility-change-consequences/);
  assert.match(r.stdout, /^owner: gh repo edit o\/r --visibility private --accept-visibility-change-consequences$/m);
  assert.equal(posts().length, 2, 'the site half still ran'); assert.match(r.stdout.trim().split('\n').at(-1), /repo=owner site=locked verify=ok exit=3 owner="gh repo edit/);
  reset(); setGh('public'); r = await run([...LOCK, '--allow', '*@operator.example', '--gh-mode', 'print'], { DA_TOKEN: 'da-tok' });
  assert.equal(r.status, 3); assert.equal(ghCalls().length, 0, 'print mode never calls gh'); assert.match(r.stdout, /^owner: gh repo edit o\/r --visibility private/m);
  reset(); setGh('public'); r = await run([...LOCK, '--allow', '*@operator.example', '--no-repo'], { DA_TOKEN: 'da-tok' }); assert.equal(r.status, 0); assert.equal(ghCalls().length, 0); assert.match(r.stdout, /repo=skipped site=locked verify=ok exit=0$/m);
  // default allow list: the operator's mail domain from git config user.email
  reset(); setGh('private'); r = await run(LOCK, { DA_TOKEN: 'da-tok', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.email', GIT_CONFIG_VALUE_0: 'ops@operator.example' });
  assert.equal(r.status, 0, r.all); assert.ok(rules.access.allow.includes('*@operator.example'), `default allow from user.email: ${rules.access.allow}`);

  // 7. --inventory: TSV header + rows, three anonymous GETs per repo, no POST
  reset(); rules.anonPage = 401; rules.servedByRepo = {};
  r = await run(['--inventory', '--org', 'o', '--prefix', 'sdt-'], { DA_TOKEN: 'da-tok' });
  assert.equal(r.status, 0, r.all);
  const rows = r.stdout.trim().split('\n');
  assert.equal(rows[0], ['repo', 'visibility', 'last push', 'served', 'page', 'live', 'site auth', 'class'].join('\t'), 'the 8-column header');
  assert.equal(rows.length, 3, 'prefix filter keeps two of three repos'); assert.match(rows[1], /^sdt-alpha\tpublic\t2026-09-01\tyes\t401\t401\ton\tlocked$/);
  assert.equal(posts().length, 0); assert.equal(requests.length, 6, 'three GETs per repo');
  reset(); rules.anonPage = 200; rules.anonLive = 200; r = await run(['--inventory', '--org', 'o', '--json'], { DA_TOKEN: 'da-tok' }); const inv = JSON.parse(r.stdout); assert.equal(inv.length, 3); assert.equal(inv[0].class, 'public-served'); assert.equal(inv[0]['site auth'], 'off');

  // usage / flag parity with the header
  r = await run(['--help']); assert.equal(r.status, 0);
  for (const f of ['--org', '--repo', '--site', '--branch', '--allow', '--token-env', '--site-token-env', '--env', '--state', '--no-repo', '--inventory', '--prefix', '--admin-base', '--gh-mode', '--wait', '--json']) assert.ok(r.stdout.includes(f), `--help lists ${f}`);
  assert.equal((await run(['--repo', 'r'])).status, 2, '--org required'); assert.equal((await run(['--org', 'o'])).status, 2, '--repo required outside --inventory');
  console.log('lockdown test: ok');
} finally {
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
