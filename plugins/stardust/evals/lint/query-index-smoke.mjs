#!/usr/bin/env node
// Smoke: skills/rollout/scripts/query-index.mjs (index registration + read-back gate) against
// one local node:http server standing in for both the admin API (--admin) and the target
// origin (--origin). No network, no browser; DA_TOKEN=fixture in the child env.
//
// Why: the script is a gate — exit 0 is what lets rollout D2 mark an index-backed row done —
// so its exit table needs an input in the repo that exercises every row: (1) remote names ==
// file → POST → job → rows → exit 0; (2) the POST body is the file, content-type text/yaml;
// (3) config GET 403 → no second config call, bulk index, rows → exit 0, registered repo-yaml;
// (4) 403 + {total:0} → exit 3 + INDEX-CONFIG.md; (5) job settled, sample absent → exit 1;
// (6) empty coverage, no --sample → exit 4 and nothing posted; (7) remote carries an index the
// file lacks → exit 3, nothing posted; --replace → posts.
//
// Usage: node plugins/stardust/evals/lint/query-index-smoke.mjs  (exit 1 on findings)
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const HERE = import.meta.dirname;
const SCRIPT = join(HERE, '..', '..', 'skills', 'rollout', 'scripts', 'query-index.mjs');
const FIX = join(HERE, 'fixtures', 'query-index');
const YAML = join(FIX, 'helix-query.yaml');
const yamlText = readFileSync(YAML, 'utf8');
const remoteText = readFileSync(join(FIX, 'remote-query.yaml'), 'utf8');
const indexRows = JSON.parse(readFileSync(join(FIX, 'query-index.json'), 'utf8'));
const SAMPLE = '/locations/harbourview';
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

// --- the stand-in server: state is reset per case, every request is logged -----------------
let state = {}; let log = [];
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x'); const path = url.pathname;
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    log.push({ method: req.method, path, body, contentType: req.headers['content-type'] || '', auth: req.headers.authorization || '' });
    const send = (status, payload, type = 'application/json') => { res.writeHead(status, { 'content-type': type }); res.end(payload === undefined ? '' : typeof payload === 'string' ? payload : JSON.stringify(payload)); };
    if (path.startsWith('/config/')) {
      if (req.method === 'GET') return state.configGet.status === 200 ? send(200, state.configGet.body, 'text/yaml') : send(state.configGet.status, '');
      return send(state.configPost ?? 204);
    }
    if (path.startsWith('/index/')) return send(202, { job: { name: 'j1', state: 'created' }, links: { self: `${BASE}/job/o/s/main/index/j1` } });
    if (path.startsWith('/job/')) { state.polls = (state.polls || 0) + 1; return send(200, state.polls < 2 ? { name: 'j1', state: 'running', progress: { total: 2, processed: 1 } } : { name: 'j1', state: 'stopped', progress: { total: 2, processed: 2 } }); }
    if (path === '/query-index.json') return send(200, state.index);
    return send(404, '');
  });
});
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const BASE = `http://127.0.0.1:${server.address().port}`;

const run = (extra = [], { pages = 'fixture', ...st } = {}) => new Promise((resolve) => {
  state = { configGet: { status: 200, body: yamlText }, index: indexRows, ...st }; log = [];
  const tmp = mkdtempSync(join(tmpdir(), 'query-index-smoke-'));
  const out = join(tmp, 'stardust', 'dynamics');
  mkdirSync(join(tmp, 'coverage'), { recursive: true });
  const pagesFile = join(tmp, 'coverage', 'pages.json');
  writeFileSync(pagesFile, pages === 'fixture' ? readFileSync(join(FIX, 'coverage', 'pages.json')) : JSON.stringify({ pages: [] }));
  const args = [SCRIPT, '--org', 'o', '--site', 's', '--yaml', YAML, '--admin', BASE, '--origin', BASE, '--out', out, '--pages', pagesFile, '--poll-ms', '50', '--timeout', '5', ...extra];
  const child = spawn(process.execPath, args, { env: { ...process.env, DA_TOKEN: 'fixture' }, cwd: tmp });
  let stdout = ''; let stderr = ''; child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => {
    const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : null);
    const statusJson = read(join(out, 'index-status.json')); const indexConfig = read(join(tmp, 'stardust', 'rollout', 'INDEX-CONFIG.md'));
    rmSync(tmp, { recursive: true, force: true });
    const reqs = log; const configCalls = reqs.filter((r) => r.path.startsWith('/config/')); const posts = reqs.filter((r) => r.method === 'POST');
    resolve({ status, stdout, stderr, reqs, configCalls, posts, statusJson: statusJson ? JSON.parse(statusJson) : null, indexConfig });
  });
});

// (1) same names → POST → job → rows → exit 0, registered config, sample found with Tier-2 fields
const same = await run();
check(same.status === 0, `same-names: expected exit 0, got ${same.status}\n${same.stderr}`);
check(same.statusJson && same.statusJson.registered === 'config', `same-names: registered must be "config", got ${same.statusJson && same.statusJson.registered}`);
check(same.statusJson && Object.keys(same.statusJson)[0] === '_provenance', 'same-names: _provenance must be the first key of index-status.json');
check(same.statusJson && same.statusJson.indices[0].sampleFound === true && same.statusJson.indices[0].fields.includes('city'), 'same-names: indices[0] must record sampleFound true with the Tier-2 field "city"');
check(same.configCalls.length === 2 && same.configCalls[0].method === 'GET' && same.configCalls[1].method === 'POST', `same-names: expected one config GET then one POST, got ${same.configCalls.map((c) => c.method).join(',')}`);
check(same.posts.filter((p) => p.path.startsWith('/index/')).length === 1, 'same-names: exactly one bulk index POST');
check(same.reqs.every((r) => r.auth === 'Bearer fixture' || r.path === '/query-index.json'), 'same-names: admin calls carry Authorization: Bearer <token>; the read-back carries none');
check(!`${same.stdout}${same.stderr}`.includes('fixture'), 'same-names: the token value must never be printed');

// (2) the config POST body is the file, verbatim, as text/yaml
const post = same.configCalls[1] || {};
check(post.body === yamlText, 'post-body: config POST body must equal helix-query.yaml byte for byte');
check(/^text\/yaml/.test(post.contentType), `post-body: content-type must be text/yaml, got "${post.contentType}"`);

// (3) config GET 403 → one config call only, bulk index still runs, rows → exit 0, registered repo-yaml, loud fallback line
const denied = await run([], { configGet: { status: 403 } });
check(denied.status === 0, `denied-honoured: expected exit 0, got ${denied.status}\n${denied.stderr}`);
check(denied.configCalls.length === 1, `denied-honoured: the config route is probed once, got ${denied.configCalls.length} calls`);
check(denied.posts.some((p) => p.path.startsWith('/index/')), 'denied-honoured: the bulk index POST must still run');
check(denied.statusJson && denied.statusJson.registered === 'repo-yaml', `denied-honoured: registered must be "repo-yaml", got ${denied.statusJson && denied.statusJson.registered}`);
check(/DENIED.*403.*falling back/.test(denied.stderr), 'denied-honoured: stderr must carry one loud fallback line naming the fallback');
check(denied.indexConfig === null, 'denied-honoured: INDEX-CONFIG.md must not be written when the read-back passes');

// (4) 403 + empty index → exit 3, INDEX-CONFIG.md written, registered denied
const empty = await run([], { configGet: { status: 403 }, index: { total: 0, offset: 0, limit: 0, data: [] } });
check(empty.status === 3, `denied-empty: expected exit 3, got ${empty.status}\n${empty.stderr}`);
check(empty.statusJson && empty.statusJson.registered === 'denied', `denied-empty: registered must be "denied", got ${empty.statusJson && empty.statusJson.registered}`);
check(empty.indexConfig !== null && /\| `locations` \| `\/query-index\.json` \|/.test(empty.indexConfig) && empty.indexConfig.includes('```yaml'), 'denied-empty: INDEX-CONFIG.md must carry the sheet table and the yaml');
check(empty.indexConfig !== null && !empty.indexConfig.includes('fixture'), 'denied-empty: INDEX-CONFIG.md must not carry the token value');

// (5) config ok, job settled, the sample row is absent → exit 1 (a real FAIL)
const absent = await run([], { index: { ...indexRows, data: indexRows.data.filter((r) => r.path !== SAMPLE), total: indexRows.total - 1 } });
check(absent.status === 1, `sample-absent: expected exit 1, got ${absent.status}\n${absent.stderr}`);
check(absent.statusJson && absent.statusJson.indices[0].sampleFound === false, 'sample-absent: indices[0].sampleFound must be false');

// (6) empty coverage and no --sample → exit 4, nothing posted (config nor index)
const noSample = await run([], { pages: 'empty' });
check(noSample.status === 4, `no-sample: expected exit 4, got ${noSample.status}\n${noSample.stderr}`);
check(noSample.posts.length === 0, `no-sample: nothing may be posted, got ${noSample.posts.map((p) => p.path).join(',')}`);
check(noSample.statusJson && noSample.statusJson.registered === null, 'no-sample: index-status.json records registered null (no verdict)');

// (7) remote has `news`, the file does not → exit 3, nothing posted; --replace → posts
const extra = await run([], { configGet: { status: 200, body: remoteText } });
check(extra.status === 3, `remote-extra: expected exit 3, got ${extra.status}\n${extra.stderr}`);
check(extra.posts.length === 0, 'remote-extra: nothing may be posted without --replace');
check(/REFUSED.*news/.test(extra.stderr), 'remote-extra: stderr must name the remote-only index');
const replaced = await run(['--replace'], { configGet: { status: 200, body: remoteText } });
check(replaced.status === 0, `remote-extra --replace: expected exit 0, got ${replaced.status}\n${replaced.stderr}`);
check(replaced.configCalls.filter((c) => c.method === 'POST').length === 1, 'remote-extra --replace: the config POST must happen');

// --check: GET + diff only, nothing posted, nothing written
const dry = await run(['--check'], { configGet: { status: 200, body: remoteText } });
check(dry.status === 3 && dry.posts.length === 0 && dry.statusJson === null, `check: remote-extra diff under --check exits 3 with no POST and no writes (got ${dry.status}, ${dry.posts.length} posts)`);
const dryOk = await run(['--check']);
check(dryOk.status === 0 && dryOk.reqs.length === 1 && dryOk.statusJson === null, `check: same-names under --check exits 0 after one GET and writes nothing (got ${dryOk.status}, ${dryOk.reqs.length} requests)`);

// no token → exit 2 before any request
state = { configGet: { status: 200, body: yamlText }, index: indexRows }; log = [];
const noToken = await new Promise((resolve) => { const env = { ...process.env }; delete env.DA_TOKEN; const c = spawn(process.execPath, [SCRIPT, '--org', 'o', '--site', 's', '--yaml', YAML, '--admin', BASE, '--origin', BASE], { env, cwd: tmpdir() }); c.on('close', (status) => resolve(status)); });
check(noToken === 2 && log.length === 0, `no-token: expected exit 2 with no request, got ${noToken} / ${log.length} requests`);

server.close();
if (failures.length) { console.error(`query-index-smoke: ${failures.length} finding(s)`); for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
console.log('query-index-smoke: ok (same-names → 0 · POST body == file · 403 → repo-yaml 0 · 403 + empty → 3 + INDEX-CONFIG.md · sample absent → 1 · no sample → 4 · remote-only name → 3, --replace posts · --check writes nothing · no token → 2)');
