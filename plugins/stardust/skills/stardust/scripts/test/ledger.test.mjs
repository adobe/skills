#!/usr/bin/env node
// skills/stardust/scripts/test/ledger.test.mjs — the ledger.mjs contract: run-status.md line
// shape and key order, skill normalisation, file/dir creation on first write, append-only with
// newline repair, unknown skill/phase warning vs --strict refusal, blocked-without-detail, tail
// and last output, --next / --owner, the value-flag swallow rule, an explicit --dir that must exist,
// usage errors, the start guard (an end needs an open start: warning, or exit 2 under --strict with
// nothing written) and the journal check on end (a journal.md without a "## " heading naming the
// phase warns, never changes the exit code). Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASES, buildLine, canonicalPhase, checkJournalSection, checkOpenStart, checkPhase, normaliseSkill, formatTail } from '../ledger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'ledger.mjs');
const root = mkdtempSync(join(tmpdir(), 'ledger-test-'));
const dir = join(root, 'stardust');
const run = (...args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args, '--dir', dir], { encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const lines = () => readFileSync(join(dir, 'status.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// ---- pure helpers -------------------------------------------------------------------------------
check('normaliseSkill: with or without prefix, case-folded, rejects junk', () => {
  assert.equal(normaliseSkill('extract'), 'stardust:extract');
  assert.equal(normaliseSkill('stardust:extract'), 'stardust:extract');
  assert.equal(normaliseSkill('Stardust:Rollout'), 'stardust:rollout');
  assert.throws(() => normaliseSkill('$stardust extract'), /not a skill name/);
  assert.throws(() => normaliseSkill(''), /not a skill name/);
});
check('buildLine: key order ts,skill,phase,event,detail,artifact; detail collapsed to one line; blanks dropped', () => {
  const l = buildLine({ skill: 'migrate', phase: 'render', event: 'end', detail: '12 pages\n  rendered', artifact: ' stardust/migrated/ ' });
  assert.deepEqual(Object.keys(l), ['ts', 'skill', 'phase', 'event', 'detail', 'artifact']);
  assert.match(l.ts, ISO_UTC); assert.equal(l.detail, '12 pages rendered'); assert.equal(l.artifact, 'stardust/migrated/');
  const bare = buildLine({ skill: 'migrate', phase: 'render', event: 'start', detail: '  ', artifact: '' });
  assert.deepEqual(Object.keys(bare), ['ts', 'skill', 'phase', 'event']);
  assert.throws(() => buildLine({ skill: 'migrate', phase: 'render', event: 'done' }), /event must be one of start\|end\|blocked/);
  assert.throws(() => buildLine({ skill: 'migrate', phase: 'per page', event: 'start' }), /single token/);
});
check('checkPhase: canonical and alias forms pass case-insensitively; unknown skill/phase name the known set', () => {
  assert.equal(checkPhase('stardust:migrate', 'render'), null);
  assert.equal(checkPhase('stardust:migrate', 'per-page-render'), null);
  assert.equal(checkPhase('stardust:rollout', 'C-deliver'), null);
  assert.equal(checkPhase('stardust:rollout', 'c-deliver'), null);
  assert.equal(checkPhase('stardust:rollout', 'I-dashboard'), null);
  assert.equal(checkPhase('stardust:replica', 'source-fidelity-gate'), null);
  assert.equal(checkPhase('stardust:dynamics', 'triage'), null);
  assert.equal(checkPhase('stardust:deploy', '7-blocks'), null);
  assert.equal(checkPhase('stardust:prototype', 'approval'), null);
  assert.equal(checkPhase('stardust:extract', 'discovery'), null);
  assert.equal(checkPhase('stardust:stardust', 'setup'), null);
  assert.match(checkPhase('stardust:migrate', 'paint'), /unknown phase "paint" for stardust:migrate \(known: plan, render, assets, state-and-report\)/);
  assert.match(checkPhase('stardust:nope', 'x'), /unknown skill stardust:nope \(known: stardust, extract/);
});
check('PHASES: every requested skill is present, rollout uses the <Letter>-<word> form, no duplicate alias collides with a canonical name', () => {
  for (const s of ['stardust', 'replica', 'rollout', 'dynamics', 'extract', 'migrate', 'deploy', 'prototype']) assert.ok(PHASES[s], `missing ${s}`);
  for (const k of Object.keys(PHASES.rollout)) assert.match(k, /^[A-I]\d?-[a-z][a-z-]*$/, k);
  for (const [skill, table] of Object.entries(PHASES)) {
    const canon = new Set(Object.keys(table).map((k) => k.toLowerCase()));
    for (const [k, aliases] of Object.entries(table)) for (const a of aliases) assert.ok(!canon.has(a.toLowerCase()), `${skill}: alias ${a} of ${k} shadows a canonical phase`);
  }
});

// ---- CLI: writing ---------------------------------------------------------------------------------
check('an explicit --dir that does not exist is a usage error (exit 2) and creates nothing', () => {
  assert.ok(!existsSync(dir));
  const r = run('migrate', 'render', 'start');
  assert.equal(r.code, 2); assert.equal(r.out, ''); assert.match(r.err, /--dir .*stardust is not an existing directory/);
  assert.ok(!existsSync(dir), 'no directory grown for a mistyped --dir');
  for (const cmd of [['tail'], ['last']]) { const t = run(...cmd); assert.equal(t.code, 2, cmd.join(' ')); assert.match(t.err, /not an existing directory/); }
});
check('first write into an existing --dir creates the file, prints the line it wrote', () => {
  mkdirSync(dir);
  const r = run('migrate', 'render', 'start');
  assert.equal(r.code, 0, r.err); assert.equal(r.err, '');
  const printed = JSON.parse(r.out.trim());
  assert.deepEqual(lines(), [printed]);
  assert.deepEqual(Object.keys(printed), ['ts', 'skill', 'phase', 'event']);
  assert.equal(printed.skill, 'stardust:migrate'); assert.equal(printed.phase, 'render'); assert.equal(printed.event, 'start'); assert.match(printed.ts, ISO_UTC);
});
check('prefixed skill, --detail and --artifact land in the line; the file is append-only', () => {
  const r = run('stardust:migrate', 'render', 'end', '--detail', '12 pages rendered', '--artifact', 'stardust/migrated/');
  assert.equal(r.code, 0, r.err);
  const all = lines(); assert.equal(all.length, 2);
  assert.equal(all[0].event, 'start', 'earlier line untouched');
  assert.deepEqual(all[1], { ts: all[1].ts, skill: 'stardust:migrate', phase: 'render', event: 'end', detail: '12 pages rendered', artifact: 'stardust/migrated/' });
});
check('--next and --owner land in the line after artifact; an end line without --next is accepted', () => {
  const r = run('migrate', 'assets', 'end', '--detail', 'bundle final', '--next', 'state-and-report:\n  advance pages', '--owner', 'migrate');
  assert.equal(r.code, 0, r.err);
  const l = lines().at(-1);
  assert.deepEqual(Object.keys(l), ['ts', 'skill', 'phase', 'event', 'detail', 'next', 'owner']);
  assert.equal(l.next, 'state-and-report: advance pages', 'collapsed to one line'); assert.equal(l.owner, 'migrate');
  const b = buildLine({ skill: 'migrate', phase: 'render', event: 'end', artifact: 'x', next: ' ', owner: 'me' });
  assert.deepEqual(Object.keys(b), ['ts', 'skill', 'phase', 'event', 'artifact', 'owner'], 'a blank --next is dropped');
  assert.equal(run('migrate', 'render', 'end').code, 0, 'end without --next is fine');
});
check('a value flag followed by another flag is a usage error naming the flag, nothing written', () => {
  const before = lines().length;
  for (const args of [['migrate', 'render', 'start', '--detail', '--strict'], ['migrate', 'render', 'start', '--artifact', '--detail', 'x'], ['migrate', 'render', 'start', '--next', '--owner', 'me'], ['migrate', 'render', 'start', '--owner', '-n'], ['tail', '-n', '--dir'], ['migrate', 'render', 'start', '--detail']]) {
    const r = run(...args);
    assert.equal(r.code, 2, args.join(' ')); assert.equal(r.out, ''); assert.match(r.err, /^ledger: (--detail|--artifact|--next|--owner|-n) needs a value/, args.join(' '));
  }
  assert.match(run('migrate', 'render', 'start', '--detail', '--strict').err, /--detail needs a value \(got --strict, which is a flag\)/);
  assert.equal(lines().length, before);
});
check('rollout letter-phase and blocked with a reason', () => {
  const r = run('rollout', 'C-deliver', 'blocked', '--detail', 'token expired (401) — checkpointed, awaiting re-auth');
  assert.equal(r.code, 0, r.err); assert.equal(r.err, '');
  assert.equal(lines().at(-1).phase, 'C-deliver');
});
check('unknown phase: warning on stderr, line still written (exit 0); phase written as given', () => {
  const before = lines().length;
  const r = run('extract', 'Paint', 'start');
  assert.equal(r.code, 0); assert.match(r.err, /warning: unknown phase "Paint" for stardust:extract \(known: discovery, /);
  assert.equal(lines().length, before + 1); assert.equal(lines().at(-1).phase, 'Paint');
});
check('unknown skill: warning, still written', () => {
  const r = run('reskin', 'tokens', 'start');
  assert.equal(r.code, 0); assert.match(r.err, /warning: unknown skill stardust:reskin/); assert.equal(lines().at(-1).skill, 'stardust:reskin');
});
check('--strict refuses an unknown phase with exit 2 and writes nothing', () => {
  const before = lines().length;
  const r = run('extract', 'paint', 'start', '--strict');
  assert.equal(r.code, 2); assert.match(r.err, /strict: unknown phase "paint".*nothing written/); assert.equal(r.out, '');
  assert.equal(lines().length, before);
});
check('blocked without --detail warns; under --strict it is refused', () => {
  const before = lines().length;
  const w = run('dynamics', 'detect', 'blocked');
  assert.equal(w.code, 0); assert.match(w.err, /blocked without --detail/); assert.equal(lines().length, before + 1);
  const s = run('dynamics', 'detect', 'blocked', '--strict');
  assert.equal(s.code, 2); assert.equal(lines().length, before + 1);
});
check('a last line missing its newline is repaired before appending (no fused records)', () => {
  const file = join(dir, 'status.jsonl');
  writeFileSync(file, readFileSync(file, 'utf8').trimEnd() + '\n{"ts":"2026-01-01T00:00:00Z","skill":"stardust:qa","phase":"sweep","event":"start"}');
  const before = lines().length;
  const r = run('prototype', 'render', 'start');
  assert.equal(r.code, 0, r.err);
  const all = lines(); assert.equal(all.length, before + 1); assert.equal(all.at(-2).skill, 'stardust:qa'); assert.equal(all.at(-1).skill, 'stardust:prototype');
});
check('usage errors exit 2: wrong arity, bad event, unknown option, missing value, no args; --help exits 0', () => {
  assert.equal(run('migrate', 'render').code, 2);
  assert.equal(run('migrate', 'render', 'finish').code, 2);
  assert.equal(run('migrate', 'render', 'start', '--bogus').code, 2);
  assert.equal(run('migrate', 'render', 'start', '--detail').code, 2);
  const none = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' }); assert.equal(none.status, 2); assert.match(none.stderr, /Usage:/);
  const h = run('--help'); assert.equal(h.code, 0); assert.match(h.out, /node ledger\.mjs <skill> <phase> <start\|end\|blocked>/); assert.match(h.out, /Known skills: stardust, extract, prototype, migrate, replica, dynamics, rollout, deploy/);
  assert.match(h.out, /\[--next "…"\] \[--owner "…"\]/); assert.match(h.out, /explicit --dir must already exist/);
});
check('--help prints the phase table: every ledger-form phase and every alias of every skill, one line per skill', () => {
  const h = run('--help');
  for (const [skill, table] of Object.entries(PHASES)) {
    const line = h.out.split('\n').find((l) => l.startsWith(`  ${skill}: `));
    assert.ok(line, `no "${skill}:" line in --help`);
    for (const [canon, aliases] of Object.entries(table)) {
      assert.ok(line.includes(canon), `${skill}: ${canon} missing`);
      for (const a of aliases) assert.ok(line.includes(`(${aliases.join(', ')})`), `${skill}: alias ${a} missing`);
    }
  }
  assert.match(h.out, /rollout: .*I-dashboard/); // the runner-matched spelling, case intact
});

// ---- CLI: reading ---------------------------------------------------------------------------------
check('tail prints the last n lines compactly: <ts> <skill> <phase> <event> <detail head>', () => {
  const r = run('tail', '-n', '2');
  assert.equal(r.code, 0, r.err);
  const out = r.out.trimEnd().split('\n'); assert.equal(out.length, 2);
  assert.match(out[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z stardust:qa sweep start$/);
  assert.match(out[1], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z stardust:prototype render start$/);
  const d = run('tail', '-n', '9').out; assert.match(d, /stardust:rollout C-deliver blocked token expired \(401\) — checkpointed, awaiting re-auth$/m);
  assert.equal(run('tail').out.trimEnd().split('\n').length, 5, 'default n is 5');
  assert.equal(formatTail({ ts: 't', skill: 's', phase: 'p', event: 'e', detail: 'x'.repeat(100) }).length, 't s p e '.length + 72, 'long detail is cut to a head with an ellipsis');
});
check('last prints the last line as JSON; last <skill> filters; no match says so on stderr and exits 0', () => {
  const r = run('last'); assert.equal(r.code, 0); assert.equal(JSON.parse(r.out).skill, 'stardust:prototype');
  const m = run('last', 'migrate'); assert.equal(m.code, 0); const l = JSON.parse(m.out); assert.equal(l.skill, 'stardust:migrate'); assert.equal(l.event, 'end');
  const p = run('last', 'stardust:rollout'); assert.equal(JSON.parse(p.out).phase, 'C-deliver');
  const none = run('last', 'deploy'); assert.equal(none.code, 0); assert.equal(none.out, ''); assert.match(none.err, /no lines for stardust:deploy/);
});
check('malformed lines are skipped with a count on stderr; an absent ledger reads as empty', () => {
  const file = join(dir, 'status.jsonl');
  writeFileSync(file, `${readFileSync(file, 'utf8')}not json\n\n`);
  const r = run('tail', '-n', '1'); assert.equal(r.code, 0); assert.match(r.err, /1 malformed line\(s\) skipped/); assert.match(r.out, /stardust:prototype render start/);
  const empty = join(root, 'empty'); mkdirSync(empty);
  const e = spawnSync(process.execPath, [SCRIPT, 'tail', '--dir', empty], { encoding: 'utf8' }); assert.equal(e.status, 0); assert.equal(e.stdout, ''); assert.match(e.stderr, /no lines in/);
  const e2 = spawnSync(process.execPath, [SCRIPT, 'last', '--dir', empty], { encoding: 'utf8' }); assert.equal(e2.status, 0); assert.equal(e2.stdout, '');
});

check('a known phase is written in the table\'s own form — aliases and case normalised, unknown names pass through', () => {
  assert.equal(canonicalPhase('stardust:rollout', 'i-dashboard'), 'I-dashboard');
  assert.equal(canonicalPhase('stardust:rollout', 'I-DASHBOARD'), 'I-dashboard');
  assert.equal(canonicalPhase('stardust:replica', 'gate'), 'source-fidelity-gate');
  assert.equal(canonicalPhase('stardust:migrate', 'per-page-render'), 'render');
  assert.equal(canonicalPhase('stardust:replica', 'interaction-parity'), 'interaction-parity', 'unknown phase unchanged');
  assert.equal(canonicalPhase('stardust:nosuch', 'x'), 'x', 'unknown skill unchanged');
  const r = run('rollout', 'i-dashboard', 'end', '--detail', 'dashboard written');
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).phase, 'I-dashboard', 'the printed line carries the canonical form');
  assert.match(r.err, /phase "i-dashboard" written as "I-dashboard"/);
  assert.doesNotMatch(r.err, /unknown phase/);
  assert.equal(JSON.parse(run('last', 'rollout').out).phase, 'I-dashboard', 'the written line carries the canonical form');
  const g = run('replica', 'GATE', 'start'); assert.equal(g.code, 0); assert.equal(JSON.parse(g.out).phase, 'source-fidelity-gate');
  const u = run('replica', 'interaction-parity', 'end', '--detail', 'x'); assert.equal(u.code, 0);
  assert.equal(JSON.parse(u.out).phase, 'interaction-parity'); assert.match(u.err, /unknown phase/);
  assert.equal(run('rollout', 'I-dashboard', 'start').code, 0);
  const s = run('rollout', 'i-dashboard', 'end', '--strict', '--detail', 'x'); assert.equal(s.code, 0, `a normalised known phase with an open start passes --strict: ${s.err}`);
});

// ---- the start guard (an end needs an open start) and the journal check on end ---------------------
const gdir = join(root, 'guard'); mkdirSync(gdir);
const runIn = (d, ...args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args, '--dir', d], { encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const linesIn = (d) => readFileSync(join(d, 'status.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
check('checkOpenStart: no lines, a start consumed by a later end, a new start reopens, blocked keeps it open, another skill or phase does not count, alias and case forms pair, junk lines skipped', () => {
  const L = (skill, phase, event) => ({ ts: 't', skill, phase, event });
  assert.match(checkOpenStart([], 'stardust:rollout', 'C-deliver'), /^end for stardust:rollout C-deliver has no matching start .*node ledger\.mjs rollout C-deliver start$/);
  assert.equal(checkOpenStart([L('stardust:rollout', 'C-deliver', 'start')], 'stardust:rollout', 'C-deliver'), null);
  assert.match(checkOpenStart([L('stardust:rollout', 'C-deliver', 'start'), L('stardust:rollout', 'C-deliver', 'end')], 'stardust:rollout', 'C-deliver'), /no matching start/);
  assert.equal(checkOpenStart([L('stardust:rollout', 'C-deliver', 'start'), L('stardust:rollout', 'C-deliver', 'end'), L('stardust:rollout', 'C-deliver', 'start')], 'stardust:rollout', 'C-deliver'), null, 'a new start after the end reopens the phase');
  assert.equal(checkOpenStart([L('stardust:rollout', 'C-deliver', 'start'), L('stardust:rollout', 'C-deliver', 'blocked')], 'stardust:rollout', 'C-deliver'), null, 'blocked keeps the start open');
  assert.match(checkOpenStart([L('stardust:migrate', 'plan', 'start')], 'stardust:prototype', 'plan'), /end for stardust:prototype plan has no matching start/, 'another skill\'s start does not count');
  assert.match(checkOpenStart([L('stardust:rollout', 'D-site', 'start')], 'stardust:rollout', 'C-deliver'), /no matching start/, 'another phase\'s start does not count');
  assert.equal(checkOpenStart([L('stardust:replica', 'gate', 'start')], 'stardust:replica', 'source-fidelity-gate'), null, 'a hand-written alias pairs with the canonical end');
  assert.equal(checkOpenStart([L('stardust:rollout', 'i-dashboard', 'start')], 'stardust:rollout', 'I-dashboard'), null, 'case-folded');
  assert.equal(checkOpenStart([null, { ts: 't' }, L('stardust:migrate', 'render', 'start')], 'stardust:migrate', 'render'), null, 'junk lines are skipped');
});
check('an end without a start: --strict exits 2 with ONE stderr line naming the missing start command and writes nothing (no ledger created); plain mode warns and still writes', () => {
  const s = runIn(gdir, 'rollout', 'C-deliver', 'end', '--strict', '--detail', '27 pages');
  assert.equal(s.code, 2); assert.equal(s.out, '');
  assert.equal(s.err.trim().split('\n').length, 1, s.err);
  assert.match(s.err.trimEnd(), /^ledger: strict: end for stardust:rollout C-deliver has no matching start \(no earlier start line for this skill and phase without a later end\) — the start line is the FIRST command of a phase, before any script runs: node ledger\.mjs rollout C-deliver start — nothing written$/);
  assert.ok(!existsSync(join(gdir, 'status.jsonl')), 'nothing written, no file created');
  const p = runIn(gdir, 'rollout', 'C-deliver', 'end', '--detail', '27 pages');
  assert.equal(p.code, 0, p.err); assert.match(p.err, /^ledger: warning: end for stardust:rollout C-deliver has no matching start/m);
  assert.equal(linesIn(gdir).length, 1); assert.equal(JSON.parse(p.out).event, 'end');
});
check('start then end passes --strict; a second end of the same phase is refused until a new start; blocked between start and end keeps it open; alias and case forms pair; another skill\'s start does not count; --help names the guard', () => {
  assert.equal(runIn(gdir, 'rollout', 'D-site', 'start', '--strict').code, 0);
  const e = runIn(gdir, 'rollout', 'd-site', 'end', '--strict', '--detail', 'assembled'); assert.equal(e.code, 0, e.err); assert.doesNotMatch(e.err, /matching start/);
  const again = runIn(gdir, 'rollout', 'D-site', 'end', '--strict', '--detail', 'x'); assert.equal(again.code, 2); assert.match(again.err, /no matching start/);
  assert.equal(runIn(gdir, 'rollout', 'D-site', 'start', '--strict').code, 0);
  assert.equal(runIn(gdir, 'rollout', 'D-site', 'end', '--strict', '--detail', 'x').code, 0, 'a new start reopens the phase');
  assert.equal(runIn(gdir, 'replica', 'gate', 'start', '--strict').code, 0);
  assert.equal(runIn(gdir, 'replica', 'source-fidelity-gate', 'blocked', '--detail', 'waiting', '--strict').code, 0);
  const g = runIn(gdir, 'replica', 'GATE', 'end', '--strict', '--detail', 'ok'); assert.equal(g.code, 0, g.err); assert.doesNotMatch(g.err, /matching start/);
  assert.equal(runIn(gdir, 'migrate', 'plan', 'start', '--strict').code, 0);
  const other = runIn(gdir, 'prototype', 'plan', 'end', '--strict', '--detail', 'x'); assert.equal(other.code, 2); assert.match(other.err, /end for stardust:prototype plan has no matching start/);
  assert.ok(runIn(gdir, '--help').out.includes('An end needs an open start'), '--help names the guard');
});
check('journal check on end: no journal → silent; "## " headings that do not name the phase → one warning, exit unchanged even under --strict, line still written; a heading naming it (any case, dash or space, anywhere in the heading) → silent; ### headings and body text do not count; start is never checked', () => {
  const jdir = join(root, 'journal'); mkdirSync(jdir);
  assert.equal(runIn(jdir, 'replica', 'extract', 'start', '--strict').code, 0);
  const none = runIn(jdir, 'replica', 'extract', 'end', '--strict', '--detail', '36 pages'); assert.equal(none.code, 0, none.err); assert.equal(none.err, '', 'no journal, no warning');
  writeFileSync(join(jdir, 'journal.md'), '# Journal — site\n\n## 2026-09-22T10:00:00Z — Session 2 resumed\n\n### Preserve-direction notes\n\nbody text naming preserve-direction and extract\n\n---\n');
  assert.equal(runIn(jdir, 'replica', 'preserve-direction', 'start', '--strict').code, 0, 'start is not checked against the journal');
  const w = runIn(jdir, 'replica', 'preserve-direction', 'end', '--strict', '--detail', 'promoted');
  assert.equal(w.code, 0, w.err); assert.equal(linesIn(jdir).length, 4, 'the end line is still written');
  assert.equal(w.err.trim().split('\n').length, 1, w.err);
  assert.match(w.err.trimEnd(), /^ledger: warning: .*journal\.md has no "## " section naming preserve-direction — a journal section is part of every phase end: "## preserve-direction — <what happened> \(<date>\)"$/);
  assert.match(checkJournalSection(jdir, 'extract'), /no "## " section naming extract/, 'a ### heading and body text do not count');
  assert.equal(checkJournalSection(join(root, 'nowhere'), 'extract'), null, 'absent journal → null');
  appendFileSync(join(jdir, 'journal.md'), '\n## Preserve direction — target spec promoted verbatim (2026-09-22)\n\n---\n\n## 2026-09-22T12:00:00Z — EXTRACT: 36 pages captured\n\n---\n');
  assert.equal(checkJournalSection(jdir, 'preserve-direction'), null, 'space for dash, capitalised');
  assert.equal(checkJournalSection(jdir, 'extract'), null, 'the phase named after a timestamp, upper-case');
  assert.match(checkJournalSection(jdir, 'recreate'), /no "## " section naming recreate/);
  assert.equal(runIn(jdir, 'replica', 'preserve-direction', 'start').code, 0);
  const ok = runIn(jdir, 'replica', 'preserve-direction', 'end', '--strict', '--detail', 'x'); assert.equal(ok.code, 0, ok.err); assert.equal(ok.err, '');
  assert.equal(runIn(jdir, 'replica', 'extract', 'start').code, 0);
  const ok2 = runIn(jdir, 'replica', 'Extract', 'end', '--detail', 'x'); assert.equal(ok2.code, 0, ok2.err); assert.doesNotMatch(ok2.err, /journal\.md|matching start/);
});

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nledger: all checks passed');
process.exit(failed ? 1 : 0);
