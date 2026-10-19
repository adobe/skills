#!/usr/bin/env node
/**
 * Fixture test: skills/stardust/scripts/token-ledger.mjs — the advisory usage ledger.
 * Run: node skills/stardust/scripts/test/token-ledger.test.mjs   (exit 1 on failure; no network)
 *
 * Fixture (fixtures/token-ledger/, synthetic — nothing here is a real session):
 *   project/stardust/status.jsonl — four migrate windows (plan 15:20→15:24 · per-page render 15:24→15:39 "6/6 pages
 *     rendered" · assets 15:39:25→15:39:50 · state and report 15:39:52→15:40:02).
 *   transcripts/sess-01.jsonl — a main transcript (cwd /work/example-project, model model-x): requests A and B each
 *     written twice with cumulative usage (→ dedupe by requestId), C once, one human prompt, one bare `continue` ack,
 *     one tool_result, one <system-reminder>, one cost-state line, and a late request D outside every window.
 *   transcripts/sess-01/subagents/agent-a1.jsonl — one subagent request written twice (→ 1 sub request).
 *   project-units/stardust/ — migrate plan + render windows and an open `rollout C-deliver` window; migrate/progress.json
 *     units plan, page (render); rollout/progress.json units foundation, home (archetype), cluster-a / cluster-b
 *     (concurrent: 10:25:10→10:45 and 10:30→10:50), cluster-c (pending, never started), final (running, no endedAt).
 *   transcripts-units/ — one request per unit (one shared by both clusters), one between the windows, a subagent
 *     request inside both clusters, a prompt before C-deliver and a `continue` ack inside cluster-a.
 *   later-session/sess-02.jsonl — a second main session after sess-01: requests E (model-y) and F (model-x, the
 *     newest, 16:40) and two cumulative cost-state lines (USD 0.50, then 1.25 over model-x 0.75 + model-y 0.50).
 *
 * Cases:
 *   (a) --transcripts on project/: windows from status.jsonl (4 + unwindowed), requests de-duplicated by requestId
 *       (4 main, not 6 lines; 1 subagent, not 2), the subagent column separate, prompts 2 / acks 1 (tool_result and
 *       <system-reminder> lines skipped), pages + tokens/page from the end detail, the cost-state line surfaced as
 *       session cost, the unwindowed row reconciling the late request; sessionsCovered { count 1 (the subagent
 *       transcript is not a session), first, last = request D } and the `Written … · sessions covered 1 (last
 *       request …)` line under the heading;
 *   (b) no --transcripts and a HOME with no harness project dir → `usage: unknown (…) → stardust/usage.md (windows
 *       without tokens)`, exit 0, the table written: the 4 windows + unwindowed with from/to, wall min and pages kept and
 *       every token / request cell `unknown` (JSON null, top-level usage "unknown" + unknownReason); sessionsCovered
 *       { count 0, first / last null } and `sessions covered 0 (last request unknown)`; under --dry-run the
 *       bare `usage: unknown (…)` line and nothing written; the same for a --transcripts dir that does not exist;
 *   (c) --json schema keys; (d) a second run with unchanged inputs leaves usage.md and usage.json byte-identical
 *       (writtenAt not bumped, nothing written), --json prints the record as written, the summary says `(unchanged)`;
 *   (e) --dry-run writes nothing; the fixture tree is untouched; (f) a value flag followed by a flag exits 2;
 *   (g) --prices with fewer than four numbers → a note, no NaN; (h) a rollout wave closes the previous one;
 *   (i) harness cost: one session with a cost line (the subagent transcript has none);
 *   (j) unit rows on project-units/: one per started unit, parent = the phase window holding its start, overlaps on
 *       the two concurrent clusters, pages / tokens/page from the unit, md rows directly under their phase row;
 *   (k) Σ phase rows + unwindowed = total — unit rows are a breakdown, never added;
 *   (l) a bare-record progress.json (one archetype's record, no units map) → the note, exit 0, other rows intact;
 *   (m) discovery through HOME/.<dot-dir>/projects/<mangled root>/ with a matching cwd (first in sorted order);
 *       a non-matching cwd → `usage: unknown`;
 *   (n) STARDUST_TRANSCRIPTS names the directory; --transcripts wins over it;
 *   (o) --help in an empty cwd: exit 0 within 15 s, nothing written;
 *   (p) unit timestamps with a +02:00 offset → the same unit rows (counts, parents, overlaps) as the UTC form;
 *       an unparsable startedAt → a `usage:` note, no row;
 *   (q) unreachable transcripts (an empty --transcripts dir: no *.jsonl) + a status.jsonl with two rollout phases + a
 *       rollout progress.json with a done unit and a running one → both phase rows and both unit rows with `unknown`
 *       cells (the running unit's `to` and wall min stay unknown: `—`, not a zero-minute span), usage.json usage
 *       "unknown"; --json keeps stdout the record (the line on stderr); --dry-run writes nothing; no status.jsonl →
 *       the table is one `usage: unknown (…)` row and nothing else; a transcript dir that cannot be listed → unknown
 *       (not readable), exit 0; a re-run with the same unreachable transcripts → `(unchanged)`, byte-identical;
 *   (r) a later session added after the ledger was written (later-session/sess-02.jsonl): the re-run rewrites both
 *       files, writtenAt moves, sessionsCovered { count 2, last = request F }; harness cost = each session's LAST cost
 *       line, summed (USD 3.21 + 1.25 = 4.46, not 4.96), sessions 2, models summed per model across sessions
 *       (model-x 3.96, model-y 0.50 — not the last session's map); a third run is `(unchanged)`.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'token-ledger.mjs');
const FIX = join(here, 'fixtures', 'token-ledger');
const snapshot = (d) => { const out = {}; (function walk(p) { for (const e of readdirSync(p)) { const f = join(p, e); if (statSync(f).isDirectory()) walk(f); else out[relative(d, f)] = readFileSync(f); } })(d); return out; };
const tmp = mkdtempSync(join(tmpdir(), 'token-ledger-'));
const home = join(tmp, 'home');
const proj = join(tmp, 'project');
cpSync(join(FIX, 'project'), proj, { recursive: true });
const baseEnv = { ...process.env, HOME: home }; delete baseEnv.STARDUST_TRANSCRIPTS;
const runIn = (root, env, ...a) => spawnSync(process.execPath, [CLI, '--root', root, ...a], { encoding: 'utf8', env: { ...baseEnv, ...env } });
const run = (...a) => runIn(proj, {}, ...a);
const before = snapshot(FIX);
try {
  // (b) unknown first: no transcripts to read, yet the table is written — windows from status.jsonl, token cells unknown
  const TOKEN_KEYS = ['turns', 'prompts', 'acks', 'fresh', 'cacheWrite', 'cacheWrite1h', 'cacheWrite5m', 'cacheRead', 'output', 'thinking', 'subRequests', 'subRead', 'subOut', 'tokensPerPage', 'estCost'];
  const allNull = (w) => TOKEN_KEYS.every((k) => w[k] === null);
  const U8 = Array(8).fill('unknown').join(' | ');
  let r = run('--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: unknown \(no transcript directory for [^\n]*STARDUST_TRANSCRIPTS\)$/m, 'dry run: the bare unknown line');
  assert.ok(!existsSync(join(proj, 'stardust', 'usage.md')) && !existsSync(join(proj, 'stardust', 'usage.json')), 'unknown --dry-run writes nothing');
  r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: unknown \(no transcript directory for [^\n]*STARDUST_TRANSCRIPTS\) → stardust\/usage\.md \(windows without tokens\)$/m);
  const jk = JSON.parse(readFileSync(join(proj, 'stardust', 'usage.json'), 'utf8'));
  assert.equal(jk.usage, 'unknown'); assert.match(jk.unknownReason, /^no transcript directory for /);
  assert.deepEqual(jk.windows.map((w) => w.label), ['migrate plan', 'migrate per-page render', 'migrate sitewide assets and bundle finalisation', 'migrate state and report', 'unwindowed']);
  assert.ok(jk.windows.every(allNull) && allNull(jk.total), 'every token / request field is null');
  const pk = jk.windows[0];
  assert.deepEqual([pk.from, pk.to, pk.wallMin, pk.pages, pk.secondsPerPage], ['2026-09-10T15:20:00Z', '2026-09-10T15:24:12Z', 4, 6, 40], 'from/to, wall min and pages stay');
  assert.deepEqual([jk.source.main, jk.source.sub, jk.harnessCost, jk.retention], [0, 0, null, null]);
  assert.deepEqual(jk.sessionsCovered, { count: 0, first: null, last: null }, 'no session read, no request timestamp');
  assert.equal(jk.writtenAt, jk.generatedAt);
  const mdk = readFileSync(join(proj, 'stardust', 'usage.md'), 'utf8');
  assert.ok(mdk.startsWith('<!-- stardust:provenance\n'), 'provenance block first');
  assert.ok(mdk.includes(`\n# Usage — project\n\nWritten ${jk.writtenAt} · sessions covered 0 (last request unknown)\n\n`), mdk);
  assert.ok(mdk.includes(`| migrate plan | 2026-09-10T15:20:00Z | 2026-09-10T15:24:12Z | 4 | ${U8} | 6 | unknown |\n`), mdk);
  assert.ok(mdk.includes(`| unwindowed | — | — | — | ${U8} | — | unknown |\n`), 'the unwindowed row keeps the shape');
  assert.ok(mdk.includes(`| **total** | 2026-09-10T15:20:00Z | 2026-09-10T15:40:02Z | — | ${U8} | — | unknown |\n`), 'the total row too');
  assert.match(mdk, /^Usage unknown \(no transcript directory for /m, 'the reason is in the prose');
  rmSync(join(proj, 'stardust', 'usage.md')); rmSync(join(proj, 'stardust', 'usage.json'));
  r = run('--transcripts', join(tmp, 'no-such-dir'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: unknown \(transcript directory [^\n]*no-such-dir does not exist or is not a directory\) → stardust\/usage\.md \(windows without tokens\)$/m);
  assert.equal(JSON.parse(readFileSync(join(proj, 'stardust', 'usage.json'), 'utf8')).windows.length, 5, 'a missing transcripts dir still writes the windows');

  // (a) with the fixture transcripts
  r = run('--transcripts', join(FIX, 'transcripts'), '--prices', '3,3.75,0.3,15');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: 4 window\(s\) \+ unwindowed · 4 requests \(1 subagent\) · fresh 2\.1 k · cache write 45\.0 k · cache read 382\.0 k · output 3\.9 k · est\. USD \d+\.\d\d · harness-reported USD 3\.21 \(session, not per phase\)/m);
  assert.ok(!/^usage: transcripts start/m.test(r.stdout), 'no retention hint on a 10-second gap');
  const j = JSON.parse(readFileSync(join(proj, 'stardust', 'usage.json'), 'utf8'));
  for (const k of ['_provenance', 'writtenAt', 'generatedAt', 'sessionsCovered', 'source', 'windows', 'total', 'harnessCost', 'units']) assert.ok(k in j, `usage.json has ${k}`);
  assert.equal(j.source.harness, 'transcripts-dir');
  assert.deepEqual(j.sessionsCovered, { count: 1, first: '2026-09-10T15:20:31.000Z', last: '2026-09-10T16:05:00.000Z' }, 'one main session; the subagent transcript is not a session; last = request D');
  assert.deepEqual([j.writtenAt, j._provenance.writtenAt], [j.generatedAt, j.generatedAt]);
  assert.deepEqual(j.units, [], 'no progress.json → no unit rows');
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
  assert.ok(md.includes(`\n# Usage — project\n\nWritten ${j.writtenAt} · sessions covered 1 (last request 2026-09-10T16:05:00.000Z)\n\n`), 'the coverage line right under the heading');
  assert.match(md, /^\| migrate plan \| 2026-09-10T15:20:00Z \| 2026-09-10T15:24:12Z \| 4 \| 1 \| 0 \| 0 \| 1\.2 k \| 40\.0 k \(40\.0 k \/ 0\) \| 100\.0 k \| 900 \(50\) \| 0 \/ 0 \/ 0 \| 6 \| 23683 \| /m);
  assert.match(md, /^Harness-reported session cost \(not per phase\): USD 3\.21 over 1 session\(s\), each session's last cost line — model-x 3\.21; 1 cost line\(s\) seen, last 2026-09-10T15:40:10\.000Z \(run after the final session's last cost line, or this is one session short\)\.$/m);
  assert.ok(!md.includes('↳'), 'no unit rows without progress.json');

  // (d) idempotent: unchanged inputs → both files byte-identical, writtenAt not bumped, nothing written
  const md1 = md; const j1 = readFileSync(join(proj, 'stardust', 'usage.json'), 'utf8');
  r = run('--transcripts', join(FIX, 'transcripts'), '--prices', '3,3.75,0.3,15', '--json');
  assert.equal(r.status, 0);
  assert.equal(readFileSync(join(proj, 'stardust', 'usage.md'), 'utf8'), md1, 'usage.md byte-identical');
  assert.equal(readFileSync(join(proj, 'stardust', 'usage.json'), 'utf8'), j1, 'usage.json byte-identical');
  assert.equal(r.stdout, j1, '--json prints the record as written (its writtenAt)');
  assert.equal(JSON.parse(r.stdout).total.turns, 4, '--json prints the record');
  r = run('--transcripts', join(FIX, 'transcripts'), '--prices', '3,3.75,0.3,15');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: 4 window\(s\) \+ unwindowed · 4 requests [^\n]* → [^\n]*usage\.md \(unchanged\)$/m, 'the summary says unchanged');
  assert.equal(readFileSync(join(proj, 'stardust', 'usage.json'), 'utf8'), j1, 'still byte-identical');

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
  r = runIn(waves, {}, '--transcripts', join(FIX, 'transcripts'), '--json');
  assert.equal(r.status, 0, r.stderr);
  const wv = JSON.parse(r.stdout).windows;
  assert.deepEqual(wv.filter((w) => w.label.startsWith('rollout')).map((w) => [w.label, w.to]), [['rollout wave 1', '2026-09-10T15:30:00Z'], ['rollout wave 2', '2026-09-10T15:39:52Z'], ['rollout wave 3', wv[2].to]], 'wave 1 and 2 close when the next wave starts');
  assert.notEqual(wv[2].to, null, 'the open last wave ends at the last request');
  // (i) harness cost: one session (transcript file) with a cost line — the subagent transcript has none
  assert.deepEqual(j.harnessCost, { totalCostUSD: 3.21, sessions: 1, costLinesSeen: 1, lastCostAt: '2026-09-10T15:40:10.000Z', models: { 'model-x': 3.21 } });

  // (j) recorded-unit rows
  const units = join(tmp, 'units');
  cpSync(join(FIX, 'project-units'), units, { recursive: true });
  r = runIn(units, {}, '--transcripts', join(FIX, 'transcripts-units'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: 3 window\(s\) \+ unwindowed \+ 7 unit row\(s\) · 9 requests \(1 subagent\) · /m);
  const ju = JSON.parse(readFileSync(join(units, 'stardust', 'usage.json'), 'utf8'));
  const U = Object.fromEntries(ju.units.map((u) => [u.label, u]));
  assert.deepEqual(ju.units.map((u) => u.label), ['↳ migrate plan', '↳ migrate page', '↳ rollout foundation', '↳ rollout home', '↳ rollout cluster-a', '↳ rollout cluster-b', '↳ rollout final'], 'one row per started unit, by start time; the pending cluster-c has none');
  assert.deepEqual(ju.units.map((u) => u.parent), ['migrate plan', 'migrate render', ...Array(5).fill('rollout C-deliver')]);
  assert.deepEqual(ju.units.map((u) => u.overlaps), [[], [], [], [], ['cluster-b'], ['cluster-a'], []]);
  assert.deepEqual(ju.units.map((u) => u.kind), ['plan', 'render', 'foundation', 'archetype', 'cluster', 'cluster', 'final']);
  const [ca, cb, fd, fin] = ['↳ rollout cluster-a', '↳ rollout cluster-b', '↳ rollout foundation', '↳ rollout final'].map((l) => U[l]);
  assert.deepEqual([ca.turns, ca.subRequests, ca.prompts, ca.acks, ca.pages, ca.tokensPerPage], [2, 1, 1, 1, 2, (50200 + 60300) / 2], 'cluster-a: A1 + the shared request, the subagent request, the ack');
  assert.deepEqual([cb.turns, cb.subRequests, cb.pages, cb.tokensPerPage], [2, 1, 1, 60300 + 70200], 'cluster-b counts the shared request too');
  assert.deepEqual([fd.turns, fd.pages, fd.tokensPerPage], [1, null, null], 'no pages on the unit → no tokens/page');
  assert.deepEqual([fin.status, fin.from, fin.to, fin.turns], ['running', '2026-09-11T10:50:10Z', '2026-09-11T10:55:00Z', 1], 'no endedAt → ends at the last request (shown in UTC)');
  assert.deepEqual([U['↳ migrate plan'].tokensPerPage, U['↳ migrate page'].tokensPerPage], [11300 / 4, 20600 / 4]);
  const mdu = readFileSync(join(units, 'stardust', 'usage.md'), 'utf8');
  const order = mdu.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| window |') && !l.startsWith('| **total**')).map((l) => l.split(' | ')[0].slice(2));
  assert.deepEqual(order, ['migrate plan', '↳ migrate plan', 'migrate render', '↳ migrate page', 'rollout C-deliver', '↳ rollout foundation', '↳ rollout home', '↳ rollout cluster-a (overlaps 1)', '↳ rollout cluster-b (overlaps 1)', '↳ rollout final', 'unwindowed'], 'unit rows directly under their phase row');
  assert.match(mdu, /^ {4}- stardust\/rollout\/progress\.json$/m, 'the progress files are named in the provenance');

  // (k) Σ phase rows + unwindowed = total; unit rows are a breakdown, never added
  for (const k of ['turns', 'prompts', 'acks', 'fresh', 'cacheWrite', 'cacheRead', 'output', 'subRequests', 'subRead', 'subOut']) {
    assert.equal(ju.windows.reduce((a, w) => a + w[k], 0), ju.total[k], `Σ windows ${k} = total`);
  }
  assert.deepEqual([ju.total.turns, ju.total.fresh, ju.total.cacheWrite, ju.total.cacheRead, ju.total.output], [9, 1150, 3000, 365000, 2250], 'the total counts each request once');
  assert.equal(ju.units.reduce((a, u) => a + u.turns, 0), 9, 'unit turns: the shared request counts in both clusters, the unwindowed one in none');
  assert.deepEqual(ju.windows.map((w) => [w.label, w.turns]), [['migrate plan', 1], ['migrate render', 1], ['rollout C-deliver', 6], ['unwindowed', 1]], 'phase windows stay exclusive');

  // (l) a bare record (one archetype's, not the units map) → a printed note; other rows intact
  const bare = join(tmp, 'bare');
  cpSync(join(FIX, 'project-units'), bare, { recursive: true });
  writeFileSync(join(bare, 'stardust', 'rollout', 'progress.json'), JSON.stringify({ status: 'done', kind: 'archetype', templates: ['home'], pages: 1, startedAt: '2026-09-11T10:15:10Z', endedAt: '2026-09-11T10:25:00Z' }));
  r = runIn(bare, {}, '--transcripts', join(FIX, 'transcripts-units'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: stardust\/rollout\/progress\.json has no units map — unit rows skipped$/m);
  const jb = JSON.parse(readFileSync(join(bare, 'stardust', 'usage.json'), 'utf8'));
  assert.deepEqual(jb.units.map((u) => u.label), ['↳ migrate plan', '↳ migrate page'], 'the migrate units still render');
  assert.deepEqual(jb.windows, ju.windows, 'phase rows unchanged');
  r = runIn(bare, {}, '--transcripts', join(FIX, 'transcripts-units'), '--json');
  assert.match(r.stderr, /has no units map/, 'the note goes to stderr under --json');
  assert.deepEqual(JSON.parse(r.stdout).units.length, 2, 'stdout stays the record');
  // (p) unit timestamps written with an offset (`date -Iseconds` → +02:00) count what their UTC form counts;
  //     an unparsable one is noted and gets no row
  const off = join(tmp, 'offset');
  cpSync(join(FIX, 'project-units'), off, { recursive: true });
  const plus2 = (iso) => new Date(Date.parse(iso) + 7_200_000).toISOString().replace(/\.000Z$/, '+02:00');
  for (const f of ['rollout', 'migrate']) {
    const pj = join(off, 'stardust', f, 'progress.json'); const doc = JSON.parse(readFileSync(pj, 'utf8'));
    for (const u of Object.values(doc.units)) for (const k of ['startedAt', 'endedAt']) if (u[k]) u[k] = plus2(u[k]);
    if (f === 'rollout') doc.units.broken = { status: 'running', kind: 'cluster', startedAt: 'after lunch' };
    writeFileSync(pj, JSON.stringify(doc));
  }
  assert.match(readFileSync(join(off, 'stardust', 'rollout', 'progress.json'), 'utf8'), /"startedAt":"2026-09-11T12:25:10\+02:00"/, 'the copy really carries +02:00');
  r = runIn(off, {}, '--transcripts', join(FIX, 'transcripts-units'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: stardust\/rollout\/progress\.json unit broken has a startedAt\/endedAt that is not an ISO timestamp — its row is skipped$/m);
  const jo = JSON.parse(readFileSync(join(off, 'stardust', 'usage.json'), 'utf8'));
  assert.deepEqual(jo.units, ju.units, 'same rows, parents, overlaps and counts as the UTC form; timestamps shown in UTC');
  assert.deepEqual(jo.windows, ju.windows, 'phase rows unchanged');

  // (q) unreachable transcripts (an empty dir: no *.jsonl) + two rollout phases + two rollout units
  const unk = join(tmp, 'unknown-rows');
  const noJsonl = join(tmp, 'empty-transcripts');
  mkdirSync(join(unk, 'stardust', 'rollout'), { recursive: true }); mkdirSync(noJsonl);
  writeFileSync(join(unk, 'stardust', 'status.jsonl'), [
    { ts: '2026-09-12T08:00:00Z', skill: 'stardust:rollout', phase: 'C-plan', event: 'start' },
    { ts: '2026-09-12T08:10:00Z', skill: 'stardust:rollout', phase: 'C-plan', event: 'end', detail: '5 pages in scope' },
    { ts: '2026-09-12T08:10:30Z', skill: 'stardust:rollout', phase: 'C-deliver', event: 'start' },
    { ts: '2026-09-12T09:10:30Z', skill: 'stardust:rollout', phase: 'C-deliver', event: 'end', detail: '5 pages live' },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n');
  writeFileSync(join(unk, 'stardust', 'rollout', 'progress.json'), JSON.stringify({ units: {
    'cluster-a': { status: 'done', kind: 'cluster', pages: 3, startedAt: '2026-09-12T08:20:00Z', endedAt: '2026-09-12T08:50:00Z' },
    final: { status: 'running', kind: 'final', startedAt: '2026-09-12T09:00:00Z' },
  } }));
  const why = `no *.jsonl under ${noJsonl}`;
  r = runIn(unk, {}, '--transcripts', noJsonl, '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `usage: unknown (${why})\n`, 'dry run: only the bare line');
  assert.deepEqual(readdirSync(join(unk, 'stardust')).sort(), ['rollout', 'status.jsonl'], '--dry-run writes nothing');
  r = runIn(unk, {}, '--transcripts', noJsonl, '--json', '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).usage, 'unknown', '--json: stdout stays the record');
  assert.match(r.stderr, /^usage: unknown \(no \*\.jsonl under /m, '--json: the line goes to stderr');
  r = runIn(unk, {}, '--transcripts', noJsonl);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `usage: unknown (${why}) → stardust/usage.md (windows without tokens)\n`);
  const jq = JSON.parse(readFileSync(join(unk, 'stardust', 'usage.json'), 'utf8'));
  assert.deepEqual([jq.usage, jq.unknownReason], ['unknown', why]);
  assert.deepEqual(jq.windows.map((w) => [w.label, w.from, w.to, w.wallMin, w.pages]), [
    ['rollout C-plan', '2026-09-12T08:00:00Z', '2026-09-12T08:10:00Z', 10, 5],
    ['rollout C-deliver', '2026-09-12T08:10:30Z', '2026-09-12T09:10:30Z', 60, 5],
    ['unwindowed', null, null, null, null]]);
  assert.deepEqual(jq.units.map((u) => [u.label, u.parent, u.from, u.to, u.wallMin, u.pages, u.overlaps]), [
    ['↳ rollout cluster-a', 'rollout C-deliver', '2026-09-12T08:20:00Z', '2026-09-12T08:50:00Z', 30, 3, []],
    ['↳ rollout final', 'rollout C-deliver', '2026-09-12T09:00:00Z', null, null, null, []]], 'no endedAt and no requests → the end stays unknown');
  assert.ok([...jq.windows, ...jq.units, jq.total].every(allNull), 'every token / request field is null');
  const mdq = readFileSync(join(unk, 'stardust', 'usage.md'), 'utf8');
  assert.ok(mdq.startsWith('<!-- stardust:provenance\n'), 'provenance block first');
  assert.match(mdq, /^ {4}- stardust\/rollout\/progress\.json$/m);
  const rowsQ = mdq.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| window |'));
  assert.deepEqual(rowsQ, [
    `| rollout C-plan | 2026-09-12T08:00:00Z | 2026-09-12T08:10:00Z | 10 | ${U8} | 5 | unknown |`,
    `| rollout C-deliver | 2026-09-12T08:10:30Z | 2026-09-12T09:10:30Z | 60 | ${U8} | 5 | unknown |`,
    `| ↳ rollout cluster-a | 2026-09-12T08:20:00Z | 2026-09-12T08:50:00Z | 30 | ${U8} | 3 | unknown |`,
    `| ↳ rollout final | 2026-09-12T09:00:00Z | — | — | ${U8} | — | unknown |`,
    `| unwindowed | — | — | — | ${U8} | — | unknown |`,
    `| **total** | 2026-09-12T08:00:00Z | 2026-09-12T09:10:30Z | — | ${U8} | — | unknown |`], 'phase rows, unit rows under their phase, unknown cells');
  r = runIn(unk, {}, '--transcripts', noJsonl);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `usage: unknown (${why}) → stardust/usage.md (windows without tokens) (unchanged)\n`, 'the same unreachable transcripts: nothing written');
  assert.equal(readFileSync(join(unk, 'stardust', 'usage.md'), 'utf8'), mdq, 'usage.md byte-identical');
  // no status.jsonl either: one `usage: unknown (…)` row and nothing else
  const none = join(tmp, 'no-status');
  mkdirSync(join(none, 'stardust'), { recursive: true });
  r = runIn(none, {}, '--transcripts', noJsonl);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `usage: unknown (${why}) → stardust/usage.md (windows without tokens)\n`);
  const mdn = readFileSync(join(none, 'stardust', 'usage.md'), 'utf8');
  assert.ok(mdn.startsWith('<!-- stardust:provenance\n'), 'provenance block first');
  assert.deepEqual(mdn.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| window |')), [`| usage: unknown (${why}) | — | — | — | ${U8} | — | unknown |`], 'a single unknown row');
  const jn = JSON.parse(readFileSync(join(none, 'stardust', 'usage.json'), 'utf8'));
  assert.deepEqual([jn.usage, jn.windows.map((w) => w.label), jn.units], ['unknown', [`usage: unknown (${why})`], []]);
  assert.ok(allNull(jn.windows[0]) && allNull(jn.total));
  // a directory that cannot be listed is unreachable too, never a crash (skipped where permissions do not bind)
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    const locked = join(tmp, 'locked-transcripts'); mkdirSync(locked); chmodSync(locked, 0o000);
    try { r = runIn(none, {}, '--transcripts', locked, '--dry-run'); } finally { chmodSync(locked, 0o755); }
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^usage: unknown \(transcript directory [^\n]*locked-transcripts is not readable \(EACCES\)\)$/m);
  }

  // (m) discovery: HOME/.<dot-dir>/projects/<root, non-alphanumerics as '-'>/ whose transcript carries cwd = root
  const home2 = join(tmp, 'home2');
  const mangled = proj.replace(/[^a-zA-Z0-9]/g, '-');
  const sess = readFileSync(join(FIX, 'transcripts', 'sess-01.jsonl'), 'utf8');
  const plant = (dot, cwd) => { const d = join(home2, dot, 'projects', mangled); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 's.jsonl'), sess.replaceAll('/work/example-project', JSON.stringify(cwd).slice(1, -1))); return d; };
  plant('.aharness', '/work/elsewhere');
  const found = plant('.someharness', proj);
  r = runIn(proj, { HOME: home2 }, '--json', '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  const jd = JSON.parse(r.stdout);
  assert.deepEqual([jd.source.harness, jd.source.dir, jd.total.turns], ['discovered', found, 4], 'the first dot-dir whose transcript carries the root as cwd');
  rmSync(join(home2, '.someharness'), { recursive: true });
  r = runIn(proj, { HOME: home2 }, '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: unknown \(no transcript directory for /, 'a non-matching cwd is not this project');

  // (n) STARDUST_TRANSCRIPTS names the directory; --transcripts wins over it
  r = runIn(proj, { STARDUST_TRANSCRIPTS: join(FIX, 'transcripts') }, '--json', '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual([JSON.parse(r.stdout).source.harness, JSON.parse(r.stdout).total.turns], ['env', 4]);
  r = runIn(proj, { STARDUST_TRANSCRIPTS: join(tmp, 'no-such-dir') }, '--transcripts', join(FIX, 'transcripts'), '--json', '--dry-run');
  assert.equal(JSON.parse(r.stdout).source.harness, 'transcripts-dir');
  r = runIn(proj, { STARDUST_TRANSCRIPTS: join(tmp, 'no-such-dir') }, '--dry-run');
  assert.equal(r.status, 0); assert.match(r.stdout, /^usage: unknown \(transcript directory .*no-such-dir does not exist/);

  // (r) a later session after the ledger was written (a recorded run wrote usage.md before its last two sessions):
  //     the re-run rewrites both files and says what it covered; harness cost = each session's last cost line, summed
  const later = join(tmp, 'later'); const two = join(tmp, 'two-sessions');
  cpSync(join(FIX, 'project'), later, { recursive: true }); cpSync(join(FIX, 'transcripts'), two, { recursive: true });
  r = runIn(later, {}, '--transcripts', two);
  assert.equal(r.status, 0, r.stderr);
  const jl1 = JSON.parse(readFileSync(join(later, 'stardust', 'usage.json'), 'utf8'));
  assert.equal(jl1.sessionsCovered.count, 1);
  cpSync(join(FIX, 'later-session', 'sess-02.jsonl'), join(two, 'sess-02.jsonl'));
  r = runIn(later, {}, '--transcripts', two);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes('(unchanged)'), r.stdout);
  const jl2 = JSON.parse(readFileSync(join(later, 'stardust', 'usage.json'), 'utf8'));
  const mdl2 = readFileSync(join(later, 'stardust', 'usage.md'), 'utf8');
  assert.ok(jl2.writtenAt > jl1.writtenAt, `writtenAt moves (${jl1.writtenAt} → ${jl2.writtenAt})`);
  assert.deepEqual(jl2.sessionsCovered, { count: 2, first: '2026-09-10T15:20:31.000Z', last: '2026-09-10T16:40:00.000Z' }, 'two main sessions; last = request F');
  assert.deepEqual(jl2.harnessCost, { totalCostUSD: 4.46, sessions: 2, costLinesSeen: 3, lastCostAt: '2026-09-10T16:40:30.000Z', models: { 'model-x': 3.96, 'model-y': 0.5 } }, "each session's last cost line (3.21 + 1.25), models summed; 3 cost lines seen across the two sessions");
  assert.ok(mdl2.includes(`\nWritten ${jl2.writtenAt} · sessions covered 2 (last request 2026-09-10T16:40:00.000Z)\n`), mdl2);
  assert.ok(mdl2.includes(`  writtenAt: ${jl2.writtenAt}\n`), 'the provenance carries the same writtenAt');
  assert.match(mdl2, /^Harness-reported session cost \(not per phase\): USD 4\.46 over 2 session\(s\), each session's last cost line — model-x 3\.96, model-y 0\.50; 3 cost line\(s\) seen, last 2026-09-10T16:40:30\.000Z \(run after the final session's last cost line, or this is one session short\)\.$/m);
  r = runIn(later, {}, '--transcripts', two);
  assert.match(r.stdout, /usage\.md \(unchanged\)$/m);
  assert.equal(readFileSync(join(later, 'stardust', 'usage.md'), 'utf8'), mdl2, 'unchanged again: byte-identical');

  // (e) dry-run, fixture untouched
  rmSync(join(proj, 'stardust', 'usage.md')); rmSync(join(proj, 'stardust', 'usage.json'));
  r = run('--transcripts', join(FIX, 'transcripts'), '--dry-run');
  assert.equal(r.status, 0); assert.match(r.stdout, /\(dry run\)$/m);
  assert.ok(!existsSync(join(proj, 'stardust', 'usage.md')), '--dry-run writes nothing');
  // (o) --help in an empty cwd: exit 0 within 15 s, nothing written
  const empty = mkdtempSync(join(tmpdir(), 'token-ledger-help-'));
  const t0 = Date.now();
  r = spawnSync(process.execPath, [CLI, '--help'], { cwd: empty, encoding: 'utf8', env: baseEnv, timeout: 15000 });
  const elapsed = Date.now() - t0; const wrote = readdirSync(empty); rmSync(empty, { recursive: true, force: true });
  assert.equal(r.status, 0); assert.ok(elapsed < 15000, `--help took ${elapsed} ms`); assert.deepEqual(wrote, [], '--help writes nothing');
  assert.match(r.stdout, /Exit codes: 0 always/); assert.match(r.stdout, /2 only for a\nvalue flag followed by another flag/);
  assert.match(r.stdout, /STARDUST_TRANSCRIPTS/); assert.match(r.stdout, /unit rows/i);
  assert.match(r.stdout, /Run it LAST in a hands-off run/); assert.match(r.stdout, /sessionsCovered/); assert.match(r.stdout, /\(unchanged\)/);
  assert.deepEqual(snapshot(FIX), before, 'fixture untouched');
  console.log('token-ledger test: ok (unknown → exit 0, table written with unknown cells, dry-run writes nothing, no status → one row; 4 windows + unwindowed; requestId dedupe 4 main / 1 sub; prompts 2 acks 1; pages + tokens/page; cost-state; sessions covered + written line; idempotent: byte-identical, (unchanged); a later session rewrites; harness cost = last cost line per session, summed; dry-run; unit rows 7 with parents + overlaps; Σ windows = total; bare record noted; offsets normalised; discovery; env; help)');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
