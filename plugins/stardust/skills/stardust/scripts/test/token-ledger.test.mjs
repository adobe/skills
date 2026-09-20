#!/usr/bin/env node
/**
 * Fixture test: skills/stardust/scripts/token-ledger.mjs — the advisory usage ledger.
 * Run: node skills/stardust/scripts/test/token-ledger.test.mjs   (exit 1 on failure; no network)
 *   (a) --transcripts on evals/lint/fixtures/token-ledger: windows from status.jsonl (4 + unwindowed), requests
 *       de-duplicated by requestId (4 main, not 6 lines; 1 subagent, not 2), the subagent column separate, prompts 2 /
 *       acks 1 (tool_result and <system-reminder> lines skipped), pages + tokens/page from the end detail, the
 *       cost-state line surfaced as session cost, the unwindowed row reconciling the late request;
 *   (b) no --transcripts and a HOME with no ~/.claude/projects → `usage: unknown`, exit 0, nothing written;
 *   (c) --json schema keys; (d) a second run is byte-identical except generatedAt / writtenAt;
 *   (e) --dry-run writes nothing; --help exits 0; the fixture tree is untouched.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'token-ledger.mjs');
const FIX = join(here, '..', '..', '..', '..', 'evals', 'lint', 'fixtures', 'token-ledger');
const snapshot = (d) => { const out = {}; (function walk(p) { for (const e of readdirSync(p)) { const f = join(p, e); if (statSync(f).isDirectory()) walk(f); else out[relative(d, f)] = readFileSync(f); } })(d); return out; };
const tmp = mkdtempSync(join(tmpdir(), 'token-ledger-'));
const home = join(tmp, 'home');
const proj = join(tmp, 'project');
cpSync(join(FIX, 'project'), proj, { recursive: true });
const run = (...a) => spawnSync(process.execPath, [CLI, '--root', proj, ...a], { encoding: 'utf8', env: { ...process.env, HOME: home } });
const strip = (s) => s.replace(/"?(generatedAt|writtenAt)"?: ?"?[^",\n]+"?,?/g, '');
const before = snapshot(FIX);
try {
  // (b) unknown first: nothing to read, nothing written
  let r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: unknown \(no transcript directory for /);
  assert.ok(!existsSync(join(proj, 'stardust', 'usage.md')) && !existsSync(join(proj, 'stardust', 'usage.json')), 'unknown writes nothing');

  // (a) with the fixture transcripts
  r = run('--transcripts', join(FIX, 'transcripts'), '--prices', '3,3.75,0.3,15');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: 4 window\(s\) \+ unwindowed · 4 requests \(1 subagent\) · fresh 2\.1 k · cache write 45\.0 k · cache read 382\.0 k · output 3\.9 k · est\. USD \d+\.\d\d · harness-reported USD 3\.21 \(session, not per phase\)/m);
  assert.ok(!/^usage: transcripts start/m.test(r.stdout), 'no retention hint on a 10-second gap');
  const j = JSON.parse(readFileSync(join(proj, 'stardust', 'usage.json'), 'utf8'));
  for (const k of ['_provenance', 'generatedAt', 'source', 'windows', 'total', 'harnessCost']) assert.ok(k in j, `usage.json has ${k}`);
  assert.equal(j.windows.length, 5, '4 windows + unwindowed');
  assert.equal(j.windows.at(-1).label, 'unwindowed');
  assert.deepEqual([j.total.turns, j.total.subRequests, j.total.prompts, j.total.acks], [4, 1, 2, 1], 'requestId dedupe (6 lines → 4 requests); sub separate (2 lines → 1); prompts/acks classified');
  assert.deepEqual([j.total.fresh, j.total.cacheWrite, j.total.cacheWrite1h, j.total.cacheWrite5m, j.total.cacheRead, j.total.output, j.total.thinking], [2150, 45000, 40000, 5000, 382000, 3920, 450], 'max-per-field per request, summed');
  assert.deepEqual([j.total.subRead, j.total.subOut], [523000, 8000]);
  const plan = j.windows.find((w) => w.label === 'migrate plan');
  assert.deepEqual([plan.turns, plan.pages, plan.tokensPerPage, plan.wallMin, plan.cacheWrite1h], [1, 6, Math.round((1200 + 40000 + 100000 + 900) / 6), 4, 40000]);
  const render = j.windows.find((w) => w.label === 'migrate per-page render');
  assert.deepEqual([render.turns, render.subRequests, render.pages, render.secondsPerPage], [1, 1, 6, 150]);
  const report = j.windows.find((w) => w.label === 'migrate state and report');
  assert.equal(report.tokensPerPage, null, 'no tokens → no tokens/page');
  const unw = j.windows.at(-1);
  assert.deepEqual([unw.turns, unw.prompts, unw.output], [1, 1, 20], 'late request D + the pre-window prompt land in unwindowed');
  assert.equal(j.harnessCost.totalCostUSD, 3.21);
  assert.equal(typeof j.total.estCost, 'number');
  const md = readFileSync(join(proj, 'stardust', 'usage.md'), 'utf8');
  assert.ok(md.startsWith('<!-- stardust:provenance\n'), 'provenance block first');
  assert.match(md, /^\| migrate plan \| 2026-09-10T15:20:00Z \| 2026-09-10T15:24:12Z \| 4 \| 1 \| 0 \| 0 \| 1\.2 k \| 40\.0 k \(40\.0 k \/ 0\) \| 100\.0 k \| 900 \(50\) \| 0 \/ 0 \/ 0 \| 6 \| 23683 \| /m);
  assert.match(md, /^Harness-reported session cost \(not per phase\): USD 3\.21/m);

  // (d) idempotent
  const md1 = strip(md); const j1 = strip(readFileSync(join(proj, 'stardust', 'usage.json'), 'utf8'));
  r = run('--transcripts', join(FIX, 'transcripts'), '--prices', '3,3.75,0.3,15', '--json');
  assert.equal(r.status, 0);
  assert.equal(strip(readFileSync(join(proj, 'stardust', 'usage.md'), 'utf8')), md1, 'usage.md identical except timestamps');
  assert.equal(strip(readFileSync(join(proj, 'stardust', 'usage.json'), 'utf8')), j1, 'usage.json identical except timestamps');
  assert.equal(JSON.parse(r.stdout).total.turns, 4, '--json prints the record');

  // (f) a value flag followed by a flag is usage (exit 2), decided before anything is read
  r = run('--transcripts', '--dry-run');
  assert.equal(r.status, 2, `--transcripts --dry-run exits 2\n${r.stdout}${r.stderr}`); assert.match(r.stderr, /--transcripts needs a value, got --dry-run/);
  // (g) --prices with fewer than four numbers: the column is dropped with a printed note — never NaN
  r = run('--transcripts', join(FIX, 'transcripts'), '--prices', '3,3.75', '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^usage: --prices ignored — needs four numbers/m, 'the note names the shape (stderr under --json)');
  assert.ok(!/NaN/.test(r.stdout) && !/NaN/.test(readFileSync(join(proj, 'stardust', 'usage.md'), 'utf8')), 'no NaN anywhere');
  assert.equal(JSON.parse(r.stdout).total.estCost, null, 'estCost null without valid prices');
  // (h) rollout: a new wave closes the previous one whether status lines say `rollout` or `stardust:rollout`
  //     (before the fix the closing keyed on the literal `stardust:rollout|` prefix, so a bare `rollout` never closed)
  const waves = join(tmp, 'waves');
  cpSync(join(FIX, 'project'), waves, { recursive: true });
  const lines = [
    { ts: '2026-09-10T15:20:00Z', skill: 'rollout', phase: 'wave 1', event: 'start' },
    { ts: '2026-09-10T15:30:00Z', skill: 'stardust:rollout', phase: 'wave 2', event: 'start' },
    { ts: '2026-09-10T15:39:52Z', skill: 'rollout', phase: 'wave 3', event: 'start' },
  ];
  writeFileSync(join(waves, 'stardust', 'status.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  r = spawnSync(process.execPath, [CLI, '--root', waves, '--transcripts', join(FIX, 'transcripts'), '--json'], { encoding: 'utf8', env: { ...process.env, HOME: home } });
  assert.equal(r.status, 0, r.stderr);
  const wv = JSON.parse(r.stdout).windows;
  assert.deepEqual(wv.filter((w) => w.label.startsWith('rollout')).map((w) => [w.label, w.to]), [['rollout wave 1', '2026-09-10T15:30:00Z'], ['rollout wave 2', '2026-09-10T15:39:52Z'], ['rollout wave 3', wv[2].to]], 'wave 1 and 2 close when the next wave starts');
  assert.notEqual(wv[2].to, null, 'the open last wave ends at the last request');
  // (i) harness cost sessions are counted over the same list that is summed (main + subagent cost-state lines)
  assert.equal(j.harnessCost.sessions, 1, 'fixture: one cost-state line in main, none in the subagent');

  // (e) dry-run, help
  rmSync(join(proj, 'stardust', 'usage.md')); rmSync(join(proj, 'stardust', 'usage.json'));
  r = run('--transcripts', join(FIX, 'transcripts'), '--dry-run');
  assert.equal(r.status, 0); assert.match(r.stdout, /\(dry run\)$/m);
  assert.ok(!existsSync(join(proj, 'stardust', 'usage.md')), '--dry-run writes nothing');
  r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stdout, /Exit codes: 0 always/); assert.match(r.stdout, /2 only for a\nvalue flag followed by another flag/);
  assert.deepEqual(snapshot(FIX), before, 'fixture untouched');
  console.log('token-ledger test: ok (unknown → exit 0 no write; 4 windows + unwindowed; requestId dedupe 4 main / 1 sub; prompts 2 acks 1; pages + tokens/page; cost-state; idempotent; dry-run; help)');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
