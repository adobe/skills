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
//       preview host; with --publish the batch is the HELD-free set: a live-gated page with no gate-report.json
//       entry is held `gate:ungated` (NEGATIVE: it published on liveOk alone before), `latest.pass !== true` →
//       `gate:<status>`, an _acceptance record ≠ pass → `content:<verdict>`, a coverage row without / with an
//       unmeasured or failing delivery.gates.ai-readability | editability → `<gate>:ungated|unmeasured|fail`;
//       held rows stay previewed (never parked), print a held table + `held=` + one `blocked` status line with the
//       re-drive; a --force override is refused (exit 2);
//   (g) a hard stage with no command and a missing artefact → exit 2 before any stage runs;
//   (h) the home page: roster `index` → served path `/`, deploy-batch key `/index` in the paths file, the ledger
//       lookup and the live-gate URL (a `/` in the paths file is `missing … not in content tree` — no row, proven
//       on the stub, which keys the tree exactly as deploy-batch's walkHtml does);
//   (i) a child whose stdout exceeds the pipe buffer is read to `close`: the `next=` line after ~300 KB of log is
//       intact in status.jsonl (runCapped unit case too);
//   (j) --pixel sample runs the soft pixel stage on the first roster page of each type and stamps the rest
//       `pixelSkipped: sample`; --pixel all runs it on the rest.
//   (k) --stage <name> never skips an earlier hard stage: `--stage deploy` on a page that has not passed lint runs
//       nothing (listed `not ready`, notready=1, no paths file); the page reaches deploy only through lint → local-gate;
//   (l) close: when a stage ran and coverage exists the driver runs update-coverage --from-ledger, then verify.mjs
//       --paths <the wave's deployed pages> --base <preview origin> and dashboard.mjs (overridable; a non-zero exit is
//       logged in the report, never a park); an idempotent re-run runs no close step; cmd null disables a step;
//   (m) the `content` stage (Gate 7) sits between build and convert with the default command
//       `content-acceptance.mjs --slug {slug} --target {migrated}`: exit 2 parks `content`, exit 1 (unmeasured) is a
//       no verdict (keeps its stage, never parked), exit 0 records contentOk for the migrated file's bytes;
//   (n) the capture stage runs ONE instrument at a time whatever --concurrency says (a stub that detects an
//       overlapping sibling would park the page — NEGATIVE before the fix);
//   (o) rollout.json waves.{stages,ledger,content,previewOrigin,close} carry only rollout-config.schema.json keys
//       (the key-walk inventory.test/gate-ingest.test apply — NEGATIVE: `waves` was not a schema key);
//   regate-list: blocks/<name>/** → mapped pages; styles/** → all (site-wide); content/<path>.html → that
//       page (content); an unknown file → all (unmapped→all); empty diff → empty list exit 0; no coverage → exit 2;
//       --json reads bodyHash/branch from rollout.json waves.ledger (not a hard-coded content/.deploy-ledger.json).
//
// Usage: node plugins/stardust/skills/rollout/scripts/test/wave.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCapped, deployKey, ledgerRow, publishHold, holdNext, STAGES, CLOSE_STEPS } from '../wave.mjs';

// holdNext: the readability re-drive is `verify --paths <served path>` (verify matches pathKey, never slugs) — NEGATIVE: `--paths news__foo` before
assert.match(holdNext('ai-readability:fail', { slug: 'news__foo', path: '/news/foo' }, {}), / --paths \/news\/foo$/);
assert.match(holdNext('ai-readability:ungated', { slug: 'home', path: '/' }, {}), / --paths \/index$/, 'home page → deploy-batch key /index');
assert.match(holdNext('gate:ungated', { slug: 'news__foo', path: '/news/foo' }, { previewOrigin: 'https://x.aem.page' }), /gate-publish\.mjs --slug news__foo --origin https:\/\/x\.aem\.page$/, 'gate-publish stays slug-keyed');
assert.match(holdNext('content:fail', { slug: 'news__foo', path: '/news/foo' }, {}), /content-acceptance\.mjs --slug news__foo$/);


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
const setClose = (o) => writeFileSync(join(T, 'close-mode.json'), JSON.stringify(o));
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

// ---- (f) --publish: the hold — live gate + Gates 5–8 read from their artefacts; nothing publishes ungated ----------------
setPark({ liveFail: ['/p3.plain.html'] }); setMode({ mode: 'ok' });
writeFileSync(join(P, 'content', 'p3.html'), `<body><main><div><h1>p3 v2</h1><p>${'copy '.repeat(40)}</p></div></main></body>`);
resetCalls(); r = run(['w1', 'roster.txt', '--publish']);
assert.equal(r.status, 1, 'a live-gate park → exit 1');
st = state();
assert.equal(st.pages.p3.parked, 'live-gate'); assert.equal(st.pages.p3.published, undefined);
// NEGATIVE (the blocker): before the hold, p1/p2/p4 published on liveOk alone — there is no gate-report.json yet
for (const s of ['p1', 'p2', 'p4']) { assert.ok(!st.pages[s].published, `(f) ${s} is HELD without a gate-report entry`); assert.equal(st.pages[s].held, 'gate:ungated'); assert.match(st.pages[s].heldNext, /gate-publish\.mjs --slug/); assert.equal(st.pages[s].parked, undefined, 'held is not a park'); }
assert.equal(calls().filter((x) => x.stage === 'deploy-batch' && x.argv.includes('--publish')).length, 0, '(f) no publish batch when every row is held');
assert.match(r.stdout, /SUMMARY wave .*held=3/, 'held= on the SUMMARY line'); assert.match(r.stdout, /\| p1 \| gate:ungated \| node skills\/rollout\/scripts\/gate-publish\.mjs --slug p1 --origin https:\/\/main--site--acme\.aem\.page \|/, 'held table with the re-drive');
{ const b = status().filter((l) => l.event === 'blocked').at(-1); assert.match(b.detail, /publish hold: 3 page\(s\) held \(gate:ungated\)/); assert.match(b.next, /gate-publish\.mjs/); }
// seed the artefacts: Gate 8 report (p1 + p4 pass, p2 fail), Gate 7 records (p1 pass, p4 fail), Gates 5–6 rows (p1 ok)
const gr = (pass, status) => ({ latest: { pass, status, at: '2026-09-20T00:00:00Z', breakpoints: {} } });
const writeGateReport = (pages) => writeFileSync(join(P, 'stardust', 'rollout', 'gate-report.json'), JSON.stringify({ generatedAt: '2026-09-20T00:00:00Z', pages }));
writeGateReport({ '/p1': gr(true, 'pass'), '/p2': gr(false, 'fail'), '/p4': gr(true, 'pass') });
const acc = (slug, verdict) => writeFileSync(join(P, 'stardust', 'migrated', '_acceptance', `${slug}.json`), JSON.stringify({ slug, verdict }));
mkdirSync(join(P, 'stardust', 'migrated', '_acceptance'), { recursive: true }); acc('p1', 'pass'); acc('p4', 'fail');
const gatesOk = { 'ai-readability': { strict: 96, code: 99, unmeasured: false, min: 98 }, editability: { authored: 4, editable: 4, dead: 0, duplicated: 0, unmeasured: false } };
const writeCoverage = (gatesBySlug) => writeFileSync(join(P, 'stardust', 'rollout', 'coverage', 'pages.json'), JSON.stringify({ pages: pages.map(([slug, path]) => ({ slug, path, templateId: 'landing', delivery: { status: 'deployed', ...(gatesBySlug[slug] ? { gates: gatesBySlug[slug] } : {}) } })) }));
mkdirSync(join(P, 'stardust', 'rollout', 'coverage'), { recursive: true }); writeCoverage({ p1: gatesOk });
resetCalls(); r = run(['w1', 'roster.txt', '--publish']);
st = state();
assert.equal(st.pages.p1.published, true, `(f) p1 passes every gate → published\n${r.stderr}`); assert.equal(st.pages.p1.held, undefined);
assert.equal(st.pages.p2.held, 'gate:fail'); assert.ok(!st.pages.p2.published, 'a FAIL row is held');
assert.equal(st.pages.p4.held, 'content:fail'); assert.match(st.pages.p4.heldNext, /content-acceptance\.mjs --slug p4/);
assert.equal(calls().filter((x) => x.stage === 'deploy-batch' && x.argv.includes('--publish')).length, 1, 'one publish batch');
assert.deepEqual(readFileSync(join(P, 'stardust', 'rollout', 'waves', 'w1.publish-paths.txt'), 'utf8').trim().split('\n'), ['/p1'], '(f) the publish roster = the PASS rows only');
assert.match(r.stdout, /held=2/);
// Gates 5–6 in turn: content fixed → held on the readability row (absent → unmeasured → below the bar), then editability
acc('p4', 'pass'); resetCalls(); r = run(['w1', 'roster.txt', '--publish']); assert.equal(state().pages.p4.held, 'ai-readability:ungated', 'no ingested readability row → ungated');
writeCoverage({ p1: gatesOk, p4: { 'ai-readability': { strict: null, code: null, unmeasured: true, min: 98 } } }); r = run(['w1', 'roster.txt', '--publish']); assert.equal(state().pages.p4.held, 'ai-readability:unmeasured', 'unmeasured is never a pass');
writeCoverage({ p1: gatesOk, p4: { 'ai-readability': { strict: 90, code: 95, unmeasured: false, min: 98 } } }); r = run(['w1', 'roster.txt', '--publish']); assert.equal(state().pages.p4.held, 'ai-readability:fail', 'below the bar → held');
writeCoverage({ p1: gatesOk, p4: { 'ai-readability': gatesOk['ai-readability'], editability: { authored: 3, editable: 2, dead: 1, duplicated: 0, unmeasured: false } } }); r = run(['w1', 'roster.txt', '--publish']); assert.equal(state().pages.p4.held, 'editability:fail');
writeCoverage({ p1: gatesOk, p4: gatesOk }); resetCalls(); r = run(['w1', 'roster.txt', '--publish']);
assert.equal(state().pages.p4.published, true, '(f) every gate read → p4 publishes'); assert.equal(state().pages.p4.held, undefined, 'the hold clears');
assert.deepEqual(readFileSync(join(P, 'stardust', 'rollout', 'waves', 'w1.publish-paths.txt'), 'utf8').trim().split('\n'), ['/p4']);
assert.ok(!calls().some((x) => x.stage === 'deploy-batch' && !x.argv.includes('--publish')), 'a held row is never re-PUT (it stays previewed)');
// unit: the hold reads, never re-judges
assert.equal(publishHold({ gateReport: null, coverageRow: null, acceptance: null }, '/x'), 'gate:ungated');
assert.equal(publishHold({ gateReport: { pages: { '/index': gr(true, 'pass') } }, coverageRow: { delivery: { gates: gatesOk } }, acceptance: { verdict: 'pass' } }, '/'), null, 'the home page is looked up under deploy-batch\'s /index key too');
assert.equal(publishHold({ gateReport: { pages: { '/x': gr(false, 'unmeasured') } }, coverageRow: null, acceptance: null }, '/x'), 'gate:unmeasured');
assert.equal(publishHold({ gateReport: { pages: { '/x': gr(true, 'pass') } }, coverageRow: null, acceptance: { verdict: 'unmeasured' } }, '/x'), 'content:unmeasured');
// the template bar (publish-gate.md § Coverage regime) is read by both halves of Gate 8: a PASS row of a template not at the bar is HELD here, so deploy-batch never has to hold it (and wave never parks it `publish`)
assert.equal(publishHold({ gateReport: { templates: { program: { atBar: false } }, pages: { '/x': { ...gr(true, 'pass'), template: 'program' } } }, coverageRow: { delivery: { gates: gatesOk } }, acceptance: { verdict: 'pass' } }, '/x'), 'gate:template-not-at-bar');
assert.equal(publishHold({ gateReport: { templates: { program: { atBar: true } }, pages: { '/x': { ...gr(true, 'pass'), template: 'program' } } }, coverageRow: { delivery: { gates: gatesOk } }, acceptance: { verdict: 'pass' } }, '/x'), null, 'at the bar → publishable');
assert.equal(publishHold({ gateReport: { templates: { untyped: { atBar: false } }, pages: { '/x': gr(true, 'pass') } }, coverageRow: { delivery: { gates: gatesOk } }, acceptance: { verdict: 'pass' } }, '/x'), 'gate:template-not-at-bar', 'a template-less page takes the untyped group bar');
assert.match(holdNext('gate:template-not-at-bar', { slug: 'x', path: '/x' }, { previewOrigin: 'https://p' }), /gate-publish\.mjs --slug x/, 'the re-drive is the gate');
rmSync(join(P, 'stardust', 'rollout', 'coverage'), { recursive: true, force: true }); rmSync(join(P, 'stardust', 'rollout', 'gate-report.json'));
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

// ---- (k) --stage never skips an earlier hard stage ---------------------------------------------------------------------
writeFileSync(join(P, 'roster-p1.txt'), 'p1|landing|https://www.larkspurmutual.example/p1/\n');
setPark({ lintFail: ['p1'] }); setMode({ mode: 'ok' }); resetCalls();
r = run(['w3', 'roster-p1.txt', '--stage', 'deploy']);
assert.equal(r.status, 0, r.stderr); assert.equal(calls().length, 0, '(k) --stage deploy on an unlinted page runs NOTHING (before the fix: deploy-batch PUT it)');
assert.match(r.stderr, /p1 not ready for deploy — at build; the earlier hard stages run first \(no flag skips a hard stage\)/, 'the content stage (Gate 7) is a hard stage too');
assert.match(r.stdout, /SUMMARY wave .* notready=1 wave=w3/, 'the SUMMARY line counts the not-ready page');
let st3 = json(join(P, 'stardust', 'rollout', 'waves', 'w3.state.json'));
assert.equal(st3.pages.p1.stage, 'build', 'the satisfied earlier stages are recorded, content and lint are not'); assert.equal(st3.pages.p1.deployed, undefined); assert.equal(st3.pages.p1.contentHash, undefined);
assert.ok(!existsSync(join(P, 'stardust', 'rollout', 'waves', 'w3.deploy-paths.txt')), 'no paths file written');
assert.match(readFileSync(join(P, 'stardust', 'rollout', 'waves', 'w3.report.md'), 'utf8'), /not ready for --stage deploy \(earlier hard stages first\): p1/);
resetCalls(); r = run(['w3', 'roster-p1.txt', '--stage', 'lint']);
assert.equal(calls().length, 0, '(k) --stage lint before the content stage ran: not ready'); assert.match(r.stderr, /not ready for lint — at build/);
r = run(['w3', 'roster-p1.txt', '--stage', 'content']); assert.equal(r.status, 0, r.stderr); assert.equal(json(join(P, 'stardust', 'rollout', 'waves', 'w3.state.json')).pages.p1.contentOk, true, '(k) Gate 7 recorded for p1');
resetCalls(); r = run(['w3', 'roster-p1.txt', '--stage', 'lint']);
assert.equal(r.status, 1, 'the lint stage itself runs and parks the failing page'); assert.deepEqual(calls().map((c) => c.stage), ['lint']); assert.equal(json(join(P, 'stardust', 'rollout', 'waves', 'w3.state.json')).pages.p1.parked, 'lint');
setPark({}); resetCalls(); r = run(['w3', 'roster-p1.txt', '--unpark', 'lint', '--stage', 'lint']);
assert.equal(r.status, 0, r.stderr); assert.deepEqual(calls().map((c) => c.stage), ['lint']); assert.ok(json(join(P, 'stardust', 'rollout', 'waves', 'w3.state.json')).pages.p1.contentHash, 'lint pass recorded');
resetCalls(); r = run(['w3', 'roster-p1.txt', '--stage', 'deploy']);
assert.equal(calls().length, 0, '(k) still not ready: the local gate has not run'); assert.match(r.stderr, /not ready for deploy — at lint/);
resetCalls(); r = run(['w3', 'roster-p1.txt', '--stage', 'local-gate']); assert.deepEqual(calls().map((c) => c.stage), ['local-gate']);
resetCalls(); r = run(['w3', 'roster-p1.txt', '--stage', 'deploy']);
assert.equal(r.status, 0, r.stderr); assert.deepEqual(calls().map((c) => c.stage), ['deploy-batch'], '(k) lint + local gate passed → the deploy stage runs'); assert.doesNotMatch(r.stdout, /notready/);
st3 = json(join(P, 'stardust', 'rollout', 'waves', 'w3.state.json')); assert.equal(st3.pages.p1.deployed, true); assert.equal(st3.pages.p1.stage, 'deploy');
assert.deepEqual(readFileSync(join(P, 'stardust', 'rollout', 'waves', 'w3.deploy-paths.txt'), 'utf8').trim().split('\n'), ['/p1']);
assert.equal(run(['w3', 'roster-p1.txt', '--stage', 'nope']).status, 2, 'unknown stage → exit 2');

// ---- (l) close: update-coverage --from-ledger → verify --paths <deployed pages> → dashboard (overridable, logged, never a park)
mkdirSync(join(P, 'stardust', 'rollout', 'coverage'), { recursive: true });
writeFileSync(join(P, 'stardust', 'rollout', 'coverage', 'pages.json'), JSON.stringify({ pages: pages.map(([slug, path]) => ({ slug, path, title: slug, templateId: 'landing', source: { sourceHash: 'h' }, blocks: [], delivery: { status: 'pending' } })) }));
writeFileSync(join(P, 'stardust', 'rollout', 'coverage', 'blocks.json'), JSON.stringify({ blocks: [] }));
writeFileSync(join(P, 'stardust', 'rollout', 'coverage', 'templates.json'), JSON.stringify({ templates: [{ id: 'landing', representativeSlug: 'p1', pages: pages.map(([s]) => s) }] }));
assert.match(CLOSE_STEPS[0].cmd, /verify\.mjs --paths \{pathsFile\} --base \{previewOrigin\}/, 'default close: verify.mjs --paths over the wave against the preview origin'); assert.match(CLOSE_STEPS[1].cmd, /dashboard\.mjs/);
const closeOverride = JSON.stringify({ verify: { cmd: `${stub('stub-close.mjs')} verify --paths {pathsFile} --base {previewOrigin} --out {rolloutDir} --report {reportDir}` }, dashboard: { cmd: `${stub('stub-close.mjs')} dashboard --out {rolloutDir}` } });
setPark({}); setMode({ mode: 'ok' }); setClose({ verify: 1 }); resetCalls();
writeFileSync(join(P, 'content', 'p1.html'), `<body><main><div><h1>p1 v4</h1><p>${'copy '.repeat(40)}</p></div></main></body>`);
r = run(['w1', 'roster.txt', '--unpark', 'all', '--stages', closeOverride]);
assert.equal(r.status, 0, `(l) every page deployed → exit 0; a failing close step never changes the verdict\n${r.stderr}\n${r.stdout}`);
c = calls();
const ver = c.find((x) => x.stage === 'verify'); assert.ok(ver, '(l) verify ran at close');
assert.deepEqual(ver.argv.slice(0, 8), ['--paths', 'stardust/rollout/waves/w1.verify-paths.txt', '--base', 'https://main--site--acme.aem.page', '--out', 'stardust/rollout', '--report', 'stardust/rollout/waves/w1.verify']);
assert.deepEqual(readFileSync(join(P, 'stardust', 'rollout', 'waves', 'w1.verify-paths.txt'), 'utf8').trim().split('\n').sort(), ['/p1', '/p2', '/p3', '/p4'], '(l) the verify list = the wave\'s deployed pages (deploy-batch keys)');
assert.ok(c.some((x) => x.stage === 'dashboard' && x.argv.join(' ') === '--out stardust/rollout'), '(l) dashboard ran at close');
assert.ok(c.indexOf(ver) > c.findLastIndex((x) => x.stage === 'deploy-batch'), 'close steps run after the stages');
assert.match(readFileSync(join(P, 'stardust', 'rollout', 'waves', 'w1.report.md'), 'utf8'), /close verify: exit 1 — SUMMARY verify ok=0 failed=1 exit=1/, '(l) the close step\'s own SUMMARY line is quoted in the report');
assert.match(r.stderr, /close step verify exit 1 \(logged in the report; a close step never parks\)/);
assert.ok(Object.values(state().pages).every((p) => !p.parked && p.deployed), 'no page parked by a close step');
assert.equal(json(join(P, 'stardust', 'rollout', 'coverage', 'pages.json')).pages.find((p) => p.slug === 'p1').delivery.status, 'deployed', '(l) update-coverage --from-ledger reconciled the ledger into coverage');
resetCalls(); r = run(['w1', 'roster.txt', '--stages', closeOverride]);
assert.equal(calls().length, 0, '(l) an idempotent re-run makes no stage AND no close-step invocation');
writeFileSync(join(P, 'content', 'p2.html'), `<body><main><div><h1>p2 v4</h1><p>${'copy '.repeat(40)}</p></div></main></body>`);
resetCalls(); r = run(['w1', 'roster.txt', '--stages', JSON.stringify({ ...JSON.parse(closeOverride), verify: { cmd: null } })]);
assert.deepEqual(calls().filter((x) => ['verify', 'dashboard'].includes(x.stage)).map((x) => x.stage), ['dashboard'], '(l) cmd null disables one close step');
resetCalls(); r = run(['w1', 'roster.txt', '--stage', 'lint', '--stages', closeOverride]);
assert.ok(!calls().some((x) => ['verify', 'dashboard'].includes(x.stage)), '(l) a --stage run closes nothing');

// ---- (m) the content stage (Gate 7): exit 2 parks `content`, exit 1 = no verdict, the default command names --slug/--target ---
{
  const contentStage = STAGES.find((x) => x.name === 'content');
  assert.equal(STAGES.map((x) => x.name).slice(0, 4).join(' > '), 'capture > build > content > convert', 'Gate 7 sits between build and convert');
  assert.equal(contentStage.cls, 'hard'); assert.match(contentStage.cmd, /content-acceptance\.mjs --slug \{slug\} --target \{migrated\}$/); assert.deepEqual(contentStage.noVerdict, [1]);
  const cfg = { ...rolloutJson, waves: { stages: { ...rolloutJson.waves.stages, content: { cmd: `${stub('stub-content.mjs')} {slug} {migrated}` } } } };
  writeFileSync(join(P, 'stardust', 'rollout', 'rollout.json'), JSON.stringify(cfg));
  writeFileSync(join(P, 'roster-c.txt'), ['p1', 'p2', 'p4'].map((sl) => `${sl}|landing|https://www.larkspurmutual.example/${sl}/`).join('\n'));
  setPark({ contentFail: ['p2'], contentUnmeasured: ['p4'] }); setMode({ mode: 'ok' }); resetCalls();
  r = run(['w5', 'roster-c.txt']);
  assert.equal(r.status, 1, r.stderr);
  const s5 = json(join(P, 'stardust', 'rollout', 'waves', 'w5.state.json')).pages;
  assert.equal(s5.p2.parked, 'content', '(m) exit 2 = dropped content → parked content'); assert.match(s5.p2.parkedDetail, /links: 3 → 2/); assert.match(s5.p2.next, /--unpark content/);
  assert.equal(s5.p4.parked, undefined, '(m) unmeasured is never a park'); assert.equal(s5.p4.stage, 'build', '(m) a no-verdict page keeps its stage'); assert.equal(s5.p4.deployed, undefined, 'and never reaches the batch');
  assert.equal(s5.p1.contentOk, true); assert.equal(s5.p1.deployed, true);
  assert.match(r.stdout, /noverdict=1/); assert.doesNotMatch(r.stdout, /FAIL/);
  assert.deepEqual(calls().filter((x) => x.stage === 'content').map((x) => x.target).sort(), ['stardust/migrated/p1/index.html', 'stardust/migrated/p2/index.html', 'stardust/migrated/p4/index.html'], '{migrated} is the migrated document');
  assert.ok(!calls().some((x) => x.stage === 'deploy-batch' && readFileSync(join(P, 'stardust', 'rollout', 'waves', 'w5.deploy-paths.txt'), 'utf8').includes('/p2')), 'a content-parked page never enters the deploy batch');
  resetCalls(); r = run(['w5', 'roster-c.txt']); assert.equal(calls().filter((x) => x.stage === 'content').map((x) => x.slug).join(), 'p4', '(m) idempotent: only the no-verdict page re-runs Gate 7');
  writeFileSync(join(P, 'stardust', 'rollout', 'rollout.json'), JSON.stringify(rolloutJson, null, 2));
  // the real instrument through the default command (state.json-free: --slug + --target) — one page
  writeFileSync(join(P, 'roster-c1.txt'), 'p1|landing|https://www.larkspurmutual.example/p1/\n');
  r = run(['w6', 'roster-c1.txt', '--dry-run']); assert.match(r.stdout, /\[dry-run\] content: node .*content-acceptance\.mjs --slug p1 --target stardust\/migrated\/p1\/index\.html/);
  r = run(['w6', 'roster-c1.txt']); assert.equal(r.status, 0, `(m) the default Gate 7 command runs on a capture + migrated pair\n${r.stderr}\n${r.stdout}`);
  assert.equal(json(join(P, 'stardust', 'migrated', '_acceptance', 'p1.json')).verdict, 'pass');
}

// ---- (n) capture: one instrument at a time on the source host, whatever --concurrency says -------------------------------
{
  const cfg = { ...rolloutJson, waves: { stages: { ...rolloutJson.waves.stages, capture: { cmd: `${stub('stub-capture.mjs')} --url {url} --pages {path}` } } } };
  writeFileSync(join(P, 'stardust', 'rollout', 'rollout.json'), JSON.stringify(cfg));
  for (const sl of ['q1', 'q2', 'q3']) { mkdirSync(join(P, 'stardust', 'migrated', sl), { recursive: true }); writeFileSync(join(P, 'stardust', 'migrated', sl, 'index.html'), `<html><body><main><h1>${sl}</h1></main></body></html>`); writeFileSync(join(P, 'content', `${sl}.html`), `<body><main><div><h1>${sl}</h1><p>${'copy '.repeat(40)}</p></div></main></body>`); }
  writeFileSync(join(P, 'roster-q.txt'), ['q1', 'q2', 'q3'].map((sl) => `${sl}|landing|https://www.larkspurmutual.example/${sl}/`).join('\n'));
  setPark({}); setMode({ mode: 'ok' }); resetCalls(); rmSync(join(T, 'capture.lock'), { force: true });
  r = run(['w7', 'roster-q.txt', '--concurrency', '3']);
  const s7 = json(join(P, 'stardust', 'rollout', 'waves', 'w7.state.json')).pages;
  assert.ok(['q1', 'q2', 'q3'].every((sl) => !s7[sl].parked && existsSync(join(P, 'stardust', 'current', 'pages', `${sl}.html`))), `(n) three captures, no overlap (a parked capture = two crawls in flight)\n${r.stderr}`);
  assert.equal(calls().filter((x) => x.stage === 'capture').length, 3);
  assert.ok(calls().filter((x) => x.stage === 'lint').length >= 3, 'the other per-page stages still run at --concurrency');
  writeFileSync(join(P, 'stardust', 'rollout', 'rollout.json'), JSON.stringify(rolloutJson, null, 2));
}

// ---- (o) rollout.json waves.* are schema keys (the key-walk inventory.test / gate-ingest.test apply to rollout.json) -----
{
  const schema = json(join(HERE, '..', '..', 'schemas', 'rollout-config.schema.json'));
  const walk = (obj, node, at, out) => { if (!node || !node.properties || !obj || typeof obj !== 'object') return; for (const k of Object.keys(obj)) { if (!(k in node.properties)) { out.push(`${at}.${k}`); continue; } walk(obj[k], node.properties[k], `${at}.${k}`, out); } };
  const doc = { _provenance: { writtenBy: 'stardust:rollout', writtenAt: '2026-09-20T00:00:00Z', stardustVersion: '0' }, target: 'aem-eds', site: { sourceUrl: 'https://www.larkspurmutual.example/', da: { org: 'acme', site: 'site', ref: 'main' } }, waves: { ...rolloutJson.waves, ledger: 'content/.deploy-ledger.json', content: 'content', previewOrigin: 'https://main--site--acme.aem.page', close: ['node x {rolloutDir}'] } };
  const unknown = []; walk(doc, schema, 'rollout.json', unknown);
  assert.deepEqual(unknown, [], `(o) a rollout.json configured per waves.md uses only schema keys (unknown: ${unknown})`);
  assert.equal(schema.properties.waves.additionalProperties, false); assert.deepEqual(Object.keys(schema.properties.waves.properties.stages.additionalProperties.properties), ['cmd', 'class']);
  assert.ok(STAGES.every((x) => new RegExp(`\\b${x.name}\\b`).test(schema.properties.waves.properties.stages.description)), 'every driver stage is named in the schema');
}

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
// --json annotates from rollout.json waves.ledger (NEGATIVE: content/.deploy-ledger.json was hard-coded)
mkdirSync(join(R, 'delivery'), { recursive: true }); writeFileSync(join(R, 'delivery', 'ledger.json'), JSON.stringify({ '/news/annual-report-2025': { status: 'previewed', bodyHash: 'abc123', branch: 'main' } }));
writeFileSync(join(R, 'stardust', 'rollout', 'rollout.json'), JSON.stringify({ waves: { ledger: 'delivery/ledger.json' } }));
r = rg(['--files', 'content/news/annual-report-2025.html', '--json']); assert.equal(JSON.parse(r.stdout.trim()).bodyHash, 'abc123', 'regate-list --json reads waves.ledger');

rmSync(T, { recursive: true, force: true });
console.log('wave.test: ok — park/unpark, hash re-gate, token halt, no-verdict, D1/D16 publish order + the Gates 5–8 hold, content stage (Gate 7), capture one-at-a-time, schema keys, home page /index key, close-read stdout, pixel sample, --stage readiness, close steps (verify --paths + dashboard), regate-list (+ waves.ledger)');
