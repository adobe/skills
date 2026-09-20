#!/usr/bin/env node
// Fixture test: wave.mjs — the resumable wave driver (T27.1) and its regate-list sub-command (T06.4).
//
//   (a) a lint park never parks the wave: 3 of 4 pages reach `deployed`, one is parked `lint`; a second
//       run makes ZERO stage invocations (idempotent);
//   (b) mutating one converted file re-runs lint + local gate for that page only; a code-tree change
//       re-runs the local gate on every deployed page and re-converts nothing;
//   (c) deploy-batch exit 3 parks the batch's undelivered pages `da-token`, status.jsonl gains
//       `blocked` + `next`, exit 3 propagates, and the token-free live gate of the delivered page still ran;
//   (d) a local gate exiting 124 (and a real deadline) → `noverdict`, not parked, SUMMARY noverdict=, no FAIL;
//   (e) --unpark lint clears only lint parks; --unpark all clears all;
//   (f) without --publish deploy-batch is never invoked with --publish and the live gate targets the
//       preview host; with --publish only live-gated pages publish; a --force override is refused (exit 2);
//   (g) a hard stage with no command and a missing artefact → exit 2 before any stage runs;
//   (h) the home page: roster `index` → served path `/`, deploy-batch key `/index` in the paths file, the ledger
//       lookup and the live-gate URL (a `/` in the paths file is `missing … not in content tree` — no row, proven
//       on the stub, which keys the tree exactly as deploy-batch's walkHtml does);
//   (i) a child whose stdout exceeds the pipe buffer is read to `close`: the `next=` line after ~300 KB of log is
//       intact in status.jsonl (runCapped unit case too);
//   (j) --pixel sample runs the soft pixel stage on the first roster page of each type and stamps the rest
//       `pixelSkipped: sample`; --pixel all runs it on the rest.
//   regate-list: blocks/<name>/** → mapped pages; styles/** → all (site-wide); content/<path>.html → that
//       page (content); an unknown file → all (unmapped→all); empty diff → empty list exit 0; no coverage → exit 2.
//
// Usage: node plugins/stardust/skills/rollout/scripts/test/wave.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCapped, deployKey, ledgerRow } from '../wave.mjs';

const HERE = import.meta.dirname;
const WAVE = join(HERE, '..', 'wave.mjs');
const FX = join(HERE, 'fixtures', 'wave');
const SHARED = join(HERE, '..', '..', '..', '..', 'evals', '_shared', 'fixture-post-migrate', 'stardust', 'migrated');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));

const T = mkdtempSync(join(tmpdir(), 'wave-test-'));
const P = join(T, 'project');
const run = (args, opts = {}) => spawnSync(process.execPath, [WAVE, ...args], { cwd: P, encoding: 'utf8', env: { ...process.env, WAVE_T: T }, ...opts });
const calls = () => (existsSync(join(T, 'calls.jsonl')) ? readFileSync(join(T, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const resetCalls = () => { try { rmSync(join(T, 'calls.jsonl')); } catch { /* none */ } };
const setPark = (o) => writeFileSync(join(T, 'park.json'), JSON.stringify(o));
const setMode = (o) => writeFileSync(join(T, 'deploy-mode.json'), JSON.stringify(o));
const state = () => json(join(P, 'stardust', 'rollout', 'waves', 'w1.state.json'));
const status = () => readFileSync(join(P, 'stardust', 'status.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

// ---- project fixture: 4 pages with capture + migrated + converted artefacts, stub stage commands ----
const pages = [['p1', '/p1'], ['p2', '/p2'], ['p3', '/p3'], ['p4', '/p4']];
for (const [slug, path] of pages) {
  mkdirSync(join(P, 'stardust', 'current', 'pages'), { recursive: true });
  writeFileSync(join(P, 'stardust', 'current', 'pages', `${slug}.html`), `<html><body><main><h1>${slug}</h1></main></body></html>`);
  mkdirSync(join(P, 'stardust', 'migrated', slug), { recursive: true });
  writeFileSync(join(P, 'stardust', 'migrated', slug, 'index.html'), `<html><body><main><h1>${slug}</h1></main></body></html>`);
  mkdirSync(join(P, 'content'), { recursive: true });
  writeFileSync(join(P, 'content', `${path.slice(1)}.html`), `<body><main><div><h1>${slug}</h1><p>${'copy '.repeat(40)}</p></div></main></body>`);
}
mkdirSync(join(P, 'blocks', 'hero'), { recursive: true });
writeFileSync(join(P, 'blocks', 'hero', 'hero.css'), '.hero { color: red; }');
const stub = (n) => `node ${join(FX, n)}`;
const rolloutJson = {
  site: { da: { org: 'acme', site: 'site', ref: 'main' } },
  waves: { stages: {
    lint: { cmd: `${stub('stub-lint.mjs')} {slug}` },
    'local-gate': { cmd: `${stub('stub-gate.mjs')} {slug}` },
    deploy: { cmd: `${stub('stub-deploy-batch.mjs')} --org {org} --repo {repo} --branch {branch} --content {content} --paths {pathsFile}` },
    'live-gate': { cmd: `${stub('stub-live.mjs')} {previewOrigin}{webPath}.plain.html` },
    pixel: { cmd: `${stub('stub-pixel.mjs')} {slug}` },
    publish: { cmd: `${stub('stub-deploy-batch.mjs')} --org {org} --repo {repo} --branch {branch} --content {content} --publish --paths {pathsFile}` },
  } },
};
mkdirSync(join(P, 'stardust', 'rollout'), { recursive: true });
writeFileSync(join(P, 'stardust', 'rollout', 'rollout.json'), JSON.stringify(rolloutJson, null, 2));
writeFileSync(join(P, 'roster.txt'), `# wave 1\n${pages.map(([s, p]) => `${s}|landing|https://www.larkspurmutual.example${p}/`).join('\n')}\n`);

// ---- (g) hard stage with no command + missing artefact → exit 2 before any stage --------------
rmSync(join(P, 'content', 'p4.html'));
setPark({}); setMode({ mode: 'ok' }); resetCalls();
let r = run(['w1', 'roster.txt']);
assert.equal(r.status, 2, `hard stage without a command and a missing artefact is a config error\n${r.stderr}`);
assert.match(r.stderr, /hard stage "convert" has no command and 1 page\(s\) lack its artefact \(p4\)/);
assert.equal(calls().length, 0, 'nothing ran');
writeFileSync(join(P, 'content', 'p4.html'), `<body><main><div><h1>p4</h1><p>${'copy '.repeat(40)}</p></div></main></body>`);
assert.equal(run(['w1', 'roster.txt', '--stages', '{"lint":{"cmd":"node x --force"}}', '--dry-run']).status, 0, 'a per-page command may carry any token; the refusal is on batch commands');
r = run(['w1', 'roster.txt', '--stages', `{"deploy":{"cmd":"${stub('stub-deploy-batch.mjs').replace(/\\/g, '/')} --force --paths {pathsFile}"}}`]);
assert.equal(r.status, 2, '--force on the deploy command is refused'); assert.match(r.stderr, /--force — refused/);
rmSync(join(P, 'stardust', 'rollout', 'waves'), { recursive: true, force: true });

// ---- (a) run 1: p3 parks at lint; 3 pages deployed; run 2: zero invocations ------------------------
setPark({ lintFail: ['p3'] }); resetCalls();
r = run(['w1', 'roster.txt']);
assert.equal(r.status, 1, `a parked page → exit 1\n${r.stderr}\n${r.stdout}`);
let st = state();
assert.equal(st.pages.p3.parked, 'lint'); assert.match(st.pages.p3.parkedDetail, /P1 link-absolute/); assert.match(st.pages.p3.next, /--unpark lint/);
for (const s of ['p1', 'p2', 'p4']) { assert.equal(st.pages[s].deployed, true, `${s} deployed`); assert.equal(st.pages[s].liveOk, true, `${s} live-gated`); assert.equal(st.pages[s].parked, undefined); }
assert.deepEqual(calls().filter((c) => c.stage === 'deploy-batch').length, 1, 'one deploy batch');
assert.ok(!calls().some((c) => c.stage === 'deploy-batch' && c.argv.includes('--publish')), '(f) never --publish without the flag');
assert.ok(calls().filter((c) => c.stage === 'live-gate').every((c) => c.url.startsWith('https://main--site--acme.aem.page/')), '(f) live gate on the preview origin');
assert.ok(!calls().some((c) => c.slug === 'p3' && c.stage === 'local-gate'), 'a parked page is excluded from later stages');
assert.match(r.stdout, /SUMMARY wave ok=3 failed=1 exit=1 details=stardust\/rollout\/waves\/w1\.state\.json parked=1 wave=w1/);
assert.ok(existsSync(join(P, 'stardust', '.work', 'rollout', 'wave.progress.json')), 'progress file written');
assert.ok(existsSync(join(P, 'stardust', 'rollout', 'waves', 'w1.report.md')), 'wave report written');
assert.match(readFileSync(join(P, 'stardust', 'rollout', 'waves', 'w1.report.md'), 'utf8'), /\| p3 \| lint \|/, 'parked table in the report');
assert.equal(status().at(-2).event, 'start'); assert.ok(status().at(-1).event === 'end' && /wave\.mjs w1 roster\.txt/.test(status().at(-1).next), 'start + end lines; end carries next');
resetCalls();
r = run(['w1', 'roster.txt']);
assert.equal(r.status, 1, 'still one parked page');
assert.equal(calls().length, 0, '(a) run 2 → zero stage invocations');

// ---- (b) content mutation → that page only; code change → local gate on every deployed page ----------
writeFileSync(join(P, 'content', 'p2.html'), `<body><main><div><h1>p2 changed</h1><p>${'copy '.repeat(40)}</p></div></main></body>`);
resetCalls(); r = run(['w1', 'roster.txt']);
let c = calls();
assert.deepEqual(c.filter((x) => x.stage === 'lint').map((x) => x.slug), ['p2'], '(b) lint re-runs for the mutated page only');
assert.deepEqual(c.filter((x) => x.stage === 'local-gate').map((x) => x.slug), ['p2'], '(b) local gate re-runs for the mutated page only');
assert.equal(c.filter((x) => x.stage === 'deploy-batch').length, 1, 'the mutated page re-enters the deploy batch (the ledger hash decides the PUT)');
assert.deepEqual(readFileSync(join(P, 'stardust', 'rollout', 'waves', 'w1.deploy-paths.txt'), 'utf8').trim().split('\n'), ['/p2']);
writeFileSync(join(P, 'blocks', 'hero', 'hero.css'), '.hero { color: blue; }');
resetCalls(); r = run(['w1', 'roster.txt']);
c = calls();
assert.deepEqual(c.filter((x) => x.stage === 'local-gate').map((x) => x.slug).sort(), ['p1', 'p2', 'p4'], '(b) code change → local gate on every deployed page');
assert.equal(c.filter((x) => x.stage === 'lint').length, 0, '(b) nothing re-lints / re-converts');
assert.equal(c.filter((x) => x.stage === 'deploy-batch').length, 0, '(b) nothing re-deploys on a code-only change');

// ---- (e) --unpark lint clears only lint parks; --unpark all clears all ------------------------------------
st = state(); st.pages.p1.parked = 'preview'; st.pages.p1.parkedDetail = 'seeded'; writeFileSync(join(P, 'stardust', 'rollout', 'waves', 'w1.state.json'), JSON.stringify(st));
setPark({}); resetCalls();
r = run(['w1', 'roster.txt', '--unpark', 'lint']);
st = state();
assert.equal(st.pages.p3.parked, undefined, '(e) lint park cleared'); assert.equal(st.pages.p1.parked, 'preview', '(e) other parks untouched');
assert.deepEqual(calls().filter((x) => x.stage === 'lint').map((x) => x.slug), ['p3'], 'the unparked page re-runs from lint');
assert.equal(st.pages.p3.deployed, true, 'and reaches deployed');
r = run(['w1', 'roster.txt', '--unpark', 'all']);
assert.equal(r.status, 0, `(e) all parks cleared → every page deployed → exit 0\n${r.stderr}`);
assert.ok(Object.values(state().pages).every((p) => !p.parked && p.deployed));

// ---- (d) local gate exit 124 → noverdict, not parked; real deadline too --------------------------------------
writeFileSync(join(P, 'content', 'p4.html'), `<body><main><div><h1>p4 v2</h1><p>${'copy '.repeat(40)}</p></div></main></body>`);
setPark({ gate124: ['p4'] }); resetCalls();
r = run(['w1', 'roster.txt']);
assert.equal(r.status, 0, `(d) a no-verdict page is not a FAIL\n${r.stderr}`);
assert.match(r.stdout, /SUMMARY wave ok=3 failed=0 noverdict=1 exit=0/);
assert.doesNotMatch(r.stdout, /FAIL/);
st = state(); assert.equal(st.pages.p4.parked, undefined, '(d) not parked'); assert.equal(st.pages.p4.stage, 'lint', '(d) keeps its stage'); assert.equal(st.pages.p4.noverdict, undefined, 'noverdict is per-run, not persisted');
assert.equal(calls().filter((x) => x.stage === 'deploy-batch').length, 0, '(d) a no-verdict page never enters the deploy batch');
setPark({ gateSleep: ['p4'] }); resetCalls();
r = run(['w1', 'roster.txt', '--timeout', '1']);
assert.match(r.stdout, /noverdict=1/, '(d) a real deadline (child killed at --timeout) is a no verdict too');
setPark({}); r = run(['w1', 'roster.txt']); assert.equal(r.status, 0, 're-run completes p4');

// ---- (c) deploy-batch exit 3: da-token parks, blocked + next, exit 3, token-free stages of others ran ---------
for (const s of ['p1', 'p2']) writeFileSync(join(P, 'content', `${s}.html`), `<body><main><div><h1>${s} v3</h1><p>${'copy '.repeat(40)}</p></div></main></body>`);
setMode({ mode: 'exit3', bigStdout: true }); resetCalls();
r = run(['w1', 'roster.txt']);
assert.equal(r.status, 3, `(c) exit 3 propagates\n${r.stderr}`);
st = state();
assert.equal(st.pages.p1.parked, undefined, 'the row the driver delivered before the halt is deployed'); assert.equal(st.pages.p1.deployed, true);
assert.equal(st.pages.p2.parked, 'da-token', '(c) the undelivered page parks da-token');
const blocked = status().filter((l) => l.event === 'blocked');
assert.equal(blocked.length, 1); assert.match(blocked[0].next, /deploy-batch\.mjs --paths/); assert.match(blocked[0].detail, /DA_TOKEN halt/);
assert.match(blocked[0].next, /^node skills\/deploy\/scripts\/deploy-batch\.mjs --paths stardust\/rollout\/waves\/w1\.deploy-paths\.txt$/, '(i) the next= line after ~300 KB of child stdout is intact (read to close, not exit)');
assert.deepEqual(calls().filter((x) => x.stage === 'live-gate').map((x) => x.url), ['https://main--site--acme.aem.page/p1.plain.html'], '(c) the token-free live gate of the delivered page still ran');
assert.match(r.stdout, /SUMMARY wave .*exit=3/);
setMode({ mode: 'ok' });
r = run(['w1', 'roster.txt', '--unpark', 'da-token']); assert.equal(r.status, 0, 'unpark da-token resumes at deploy');
assert.deepEqual(readFileSync(join(P, 'stardust', 'rollout', 'waves', 'w1.deploy-paths.txt'), 'utf8').trim().split('\n'), ['/p2'], 'only the halted page re-enters the batch');

// ---- (f) --publish: only live-gated pages publish; a failed preview row parks `preview` --------------------
setPark({ liveFail: ['/p3.plain.html'] }); setMode({ mode: 'ok' });
writeFileSync(join(P, 'content', 'p3.html'), `<body><main><div><h1>p3 v2</h1><p>${'copy '.repeat(40)}</p></div></main></body>`);
resetCalls(); r = run(['w1', 'roster.txt', '--publish']);
assert.equal(r.status, 1, 'a live-gate park → exit 1');
st = state();
assert.equal(st.pages.p3.parked, 'live-gate'); assert.equal(st.pages.p3.published, undefined);
for (const s of ['p1', 'p2', 'p4']) assert.equal(st.pages[s].published, true, `(f) ${s} published after its live gate passed`);
const pub = calls().filter((x) => x.stage === 'deploy-batch' && x.argv.includes('--publish'));
assert.equal(pub.length, 1, 'one publish batch');
assert.deepEqual(readFileSync(join(P, 'stardust', 'rollout', 'waves', 'w1.publish-paths.txt'), 'utf8').trim().split('\n').sort(), ['/p1', '/p2', '/p4'], '(f) the publish roster holds the live-gated pages only');
setPark({}); setMode({ mode: 'fail', failPath: '/p3' });
writeFileSync(join(P, 'content', 'p3.html'), `<body><main><div><h1>p3 v3</h1><p>${'copy '.repeat(40)}</p></div></main></body>`);
r = run(['w1', 'roster.txt', '--unpark', 'live-gate']);
assert.equal(state().pages.p3.parked, 'preview', 'a non-ok ledger row parks `preview`'); assert.match(state().pages.p3.parkedDetail, /put-fail: DA 500/);

// ---- (h) the home page: served path `/`, deploy-batch key `/index` everywhere the ledger is involved ------------------
assert.equal(deployKey('/'), '/index'); assert.equal(deployKey('/p1'), '/p1');
assert.deepEqual(ledgerRow({ '/index': { status: 'live' } }, '/'), { status: 'live' }, 'the ledger row for `/` is keyed /index');
writeFileSync(join(P, 'stardust', 'current', 'pages', 'index.html'), '<html><body><main><h1>home</h1></main></body></html>');
writeFileSync(join(P, 'stardust', 'migrated', 'index.html'), '<html><body><main><h1>home</h1></main></body></html>');
writeFileSync(join(P, 'content', 'index.html'), `<body><main><div><h1>home</h1><p>${'copy '.repeat(40)}</p></div></main></body>`);
writeFileSync(join(P, 'roster-home.txt'), 'index|landing|https://www.larkspurmutual.example/\n');
setPark({}); setMode({ mode: 'ok' }); resetCalls();
r = run(['w2', 'roster-home.txt']);
assert.equal(r.status, 0, `(h) the home page deploys\n${r.stderr}\n${r.stdout}`);
const home = json(join(P, 'stardust', 'rollout', 'waves', 'w2.state.json')).pages.index;
assert.equal(home.path, '/', 'served path stays /'); assert.equal(home.deployed, true); assert.equal(home.liveOk, true); assert.equal(home.parked, undefined);
assert.deepEqual(readFileSync(join(P, 'stardust', 'rollout', 'waves', 'w2.deploy-paths.txt'), 'utf8').trim().split('\n'), ['/index'], '(h) the paths file carries deploy-batch\'s key');
assert.ok(json(join(P, 'content', '.deploy-ledger.json'))['/index'], 'ledger row under /index');
assert.deepEqual(calls().filter((x) => x.stage === 'live-gate').map((x) => x.url), ['https://main--site--acme.aem.page/index.plain.html'], '(h) live gate hits /index.plain.html, never //.plain.html');
assert.deepEqual(calls().filter((x) => x.stage === 'lint').map((x) => x.argv || x.slug), ['index']);
// negative fixture: a `/` in the paths file is not in deploy-batch's tree → no row (what parked the home page before)
writeFileSync(join(T, 'slash-paths.txt'), '/\n');
const slash = spawnSync(process.execPath, [join(FX, 'stub-deploy-batch.mjs'), '--content', 'content', '--paths', join(T, 'slash-paths.txt')], { cwd: P, encoding: 'utf8', env: { ...process.env, WAVE_T: T } });
assert.match(slash.stdout, /missing \/  not in content tree/, 'a bare / is not a content-tree key'); assert.equal(json(join(P, 'content', '.deploy-ledger.json'))['/'], undefined, 'and gets no ledger row');

// ---- (i) runCapped reads the child to `close`: 300 KB of stdout then a next= line ---------------------------------------
{
  const big = await runCapped([process.execPath, '-e', "process.stdout.write('x'.repeat(300000) + '\\nnext=OK\\n'); process.exitCode = 7"], { cwd: P, timeoutSec: 30 });
  assert.equal(big.code, 7, 'exit code is the verdict'); assert.ok(big.stdout.endsWith('next=OK\n'), `(i) stdout complete at close (${big.stdout.length} B)`); assert.equal(big.stdout.length, 300009);
  const dead = await runCapped([process.execPath, '-e', 'setTimeout(() => {}, 30000)'], { cwd: P, timeoutSec: 1 });
  assert.equal(dead.code, 124, 'deadline → 124'); assert.equal(dead.timedOut, true);
}

// ---- (j) --pixel sample: first page per type; --pixel all: the rest --------------------------------------------------------
resetCalls(); r = run(['w1', 'roster.txt', '--pixel', 'sample']);
assert.deepEqual(calls().filter((x) => x.stage === 'pixel').map((x) => x.slug), ['p1'], '(j) sample = the first roster page of each type (p3 is parked)');
st = state(); assert.equal(st.pages.p1.pixelDone, true); assert.equal(st.pages.p2.pixelSkipped, 'sample'); assert.equal(st.pages.p4.pixelSkipped, 'sample'); assert.equal(st.pages.p2.pixelDone, undefined, 'a sampled-out page is not pixel-gated'); assert.notEqual(st.pages.p2.stage, 'pixel', 'and keeps its stage so --pixel all can reach it');
resetCalls(); r = run(['w1', 'roster.txt', '--pixel', 'sample']); assert.equal(calls().filter((x) => x.stage === 'pixel').length, 0, '(j) a second sample run is idempotent');
resetCalls(); r = run(['w1', 'roster.txt', '--pixel', 'all']);
assert.deepEqual(calls().filter((x) => x.stage === 'pixel').map((x) => x.slug).sort(), ['p2', 'p4'], '(j) all = every page not yet pixel-gated');
assert.equal(state().pages.p2.pixelSkipped, undefined); assert.equal(state().pages.p2.pixelDone, true);
assert.equal(run(['w1', 'roster.txt', '--pixel', 'some']).status, 2, '--pixel takes all|sample|none');

// ---- regate-list ------------------------------------------------------------------------------------------
const R = join(T, 'regate'); mkdirSync(join(R, 'stardust'), { recursive: true });
cpSync(SHARED, join(R, 'stardust', 'migrated'), { recursive: true });
const inv = spawnSync(process.execPath, [join(HERE, '..', 'inventory.mjs'), '--migrated', 'stardust/migrated', '--out', 'stardust/rollout'], { cwd: R, encoding: 'utf8' });
assert.equal(inv.status, 0, inv.stderr);
assert.equal(spawnSync(process.execPath, [join(HERE, '..', 'blocks.mjs'), '--out', 'stardust/rollout'], { cwd: R, encoding: 'utf8' }).status, 0);
const rg = (args) => spawnSync(process.execPath, [WAVE, 'regate-list', '--out', 'stardust/rollout', ...args], { cwd: R, encoding: 'utf8' });
const slugs = (out) => out.trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
r = rg(['--files', 'blocks/coverage-tiles/coverage-tiles.css']);
assert.equal(r.status, 0, r.stderr);
assert.deepEqual(slugs(r.stdout).map((x) => x[0]).sort(), ['business', 'home'], 'block touched → its usedByPages');
assert.ok(slugs(r.stdout).every((x) => x[2] === 'block:coverage-tiles'));
r = rg(['--files', 'styles/styles.css']);
assert.equal(slugs(r.stdout).length, 6); assert.ok(slugs(r.stdout).every((x) => x[2] === 'site-wide'), 'styles → all pages, site-wide');
r = rg(['--files', 'content/news/annual-report-2025.html']);
assert.deepEqual(slugs(r.stdout), [['news__annual-report-2025', '/news/annual-report-2025', 'content']], 'content file → that page');
r = rg(['--files', 'README.md']);
assert.equal(slugs(r.stdout).length, 6); assert.ok(slugs(r.stdout).every((x) => x[2] === 'unmapped→all'), 'unknown file → fail-open to all');
assert.match(r.stderr, /1 touched files → 6 pages \(0 block-mapped · 0 content · 0 site-wide · 1 unmapped→all\)/);
r = rg(['--all', '--json']);
assert.equal(slugs(r.stdout).length, 6); assert.equal(JSON.parse(r.stdout.split('\n')[0]).reason, 'forced');
spawnSync('git', ['init', '-q'], { cwd: R }); spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: R });
spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base'], { cwd: R });
r = rg(['--since', 'HEAD']);
assert.equal(r.status, 0); assert.equal(r.stdout.trim(), '', 'empty diff → empty list, exit 0'); assert.match(r.stderr, /empty diff/);
assert.equal(rg(['--out', 'nowhere', '--files', 'x']).status, 2, 'no coverage → exit 2');

rmSync(T, { recursive: true, force: true });
console.log('wave.test: ok — park/unpark, hash re-gate, token halt, no-verdict, D1/D16 publish order, home page /index key, close-read stdout, pixel sample, regate-list');
