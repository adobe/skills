#!/usr/bin/env node
// skills/rollout/scripts/test/findings.test.mjs — the informational disposition of findings.mjs: `record
// --fixability out-of-scope` writes `status: informational` (never open) and leaves the health and the open
// counts alone while the scorecard counts it; re-recording it with a scored fixability opens it again;
// `resolve --status informational` is accepted for an out-of-scope finding and refused (exit 1, ledger
// untouched) for a scored one, as is `--status open` for an out-of-scope one; any write migrates an older
// ledger's open/in-progress out-of-scope rows to informational. --help names the status vocabulary and
// writes nothing.
// Run: node plugins/stardust/skills/rollout/scripts/test/findings.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'findings.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const project = () => { const out = join(mkdtempSync(join(tmpdir(), 'findings-')), 'rollout'); mkdirSync(out); return out; };
const cli = (out, args) => spawnSync(process.execPath, [SCRIPT, ...args, '--out', out], { encoding: 'utf8' });
const record = (out, { check: c = 'thin-content', severity = 'P2', fixability = 'platform-migration', ids = 'home' } = {}) =>
  cli(out, ['record', '--source', 'audit:external', '--layer', 'seo', '--check', c, '--severity', severity, '--fixability', fixability, '--scope-ids', ids, '--evidence', 'e']);
const ledger = (out) => JSON.parse(readFileSync(join(out, 'optimize', 'findings.json'), 'utf8'));
const scorecard = (out) => JSON.parse(readFileSync(join(out, 'optimize', 'scorecard.json'), 'utf8')).current;
const idOf = (stdout) => stdout.match(/^recorded (f-[0-9a-f]{10}) /)[1];
const done = (out) => rmSync(dirname(out), { recursive: true, force: true });

check('--help names the status vocabulary and the informational rule, and writes nothing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'findings-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8', cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /open \| in-progress \| fixed \| accepted \| wontfix \| informational/);
  assert.match(r.stdout, /--status fixed\|accepted\|wontfix\|open\|in-progress\|informational/);
  assert.deepEqual(readdirSync(cwd), []);
  rmSync(cwd, { recursive: true, force: true });
});

check('record --fixability out-of-scope is informational: never open, not scored, counted by the scorecard', () => {
  const out = project();
  assert.equal(record(out).status, 0);
  const health = scorecard(out).overall;
  assert.equal(health, 90, 'one scored seo P2');
  const r = record(out, { check: 'hreflang', severity: 'P1', fixability: 'out-of-scope' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^recorded f-[0-9a-f]{10} {2}audit:external seo\/hreflang P1 {2}→ informational {3}\(health 90\/100 · informational 1\)$/m);
  const f = ledger(out).findings.find((x) => x.id === idOf(r.stdout));
  assert.equal(f.status, 'informational');
  const sc = scorecard(out);
  assert.equal(sc.overall, health);
  assert.deepEqual(sc.severity, { P1: 0, P2: 1, P3: 0 });
  assert.deepEqual(sc.informational, { total: 1, P1: 1, P2: 0, P3: 0 });
  done(out);
});

check('re-recording an informational finding with a scored fixability opens it again, scored', () => {
  const out = project();
  const id = idOf(record(out, { check: 'hreflang', severity: 'P1', fixability: 'out-of-scope' }).stdout);
  const r = record(out, { check: 'hreflang', severity: 'P1', fixability: 'platform-migration' });
  assert.equal(idOf(r.stdout), id);
  assert.match(r.stdout, /→ open {3}\(health 75\/100 · informational 0\)$/m);
  const f = ledger(out).findings.find((x) => x.id === id);
  assert.equal(f.status, 'open'); assert.equal(f.firstSeenRun, 'recorded');
  assert.deepEqual(scorecard(out).severity, { P1: 1, P2: 0, P3: 0 });
  assert.equal(scorecard(out).informational.total, 0);
  done(out);
});

check('resolve --status informational is accepted for an out-of-scope finding; refused for a scored one, as is --status open for an out-of-scope one', () => {
  const out = project();
  const info = idOf(record(out, { check: 'hreflang', fixability: 'out-of-scope' }).stdout);
  const scored = idOf(record(out).stdout);
  assert.equal(cli(out, ['resolve', info, '--status', 'accepted']).status, 0);
  const back = cli(out, ['resolve', info, '--status', 'informational']);
  assert.equal(back.status, 0, back.stderr);
  assert.match(back.stdout, new RegExp(`^${info} → informational {3}\\(health 90/100 · informational 1, open P1 0\\)$`, 'm'));
  assert.equal(ledger(out).findings.find((x) => x.id === info).status, 'informational');
  const before = readFileSync(join(out, 'optimize', 'findings.json'), 'utf8');
  const a = cli(out, ['resolve', scored, '--status', 'informational']);
  assert.equal(a.status, 1); assert.match(a.stderr, /not out-of-scope/);
  const b = cli(out, ['resolve', info, '--status', 'open']);
  assert.equal(b.status, 1); assert.match(b.stderr, /out-of-scope/);
  assert.equal(readFileSync(join(out, 'optimize', 'findings.json'), 'utf8'), before, 'a refused resolve writes nothing');
  done(out);
});

check('any write migrates an older ledger: open or in-progress out-of-scope rows become informational and the scorecard agrees', () => {
  const out = project();
  const row = (id, fixability, status, evidence = 'e') => ({ id, source: 'audit:external', layer: 'seo', check: id, severity: 'P2', scope: { level: 'page', ids: ['home'] }, evidence, fixability, recommendedMove: '', status, autofix: null, resolvedBy: null, firstSeenRun: 'run-1' });
  mkdirSync(join(out, 'optimize'));
  writeFileSync(join(out, 'optimize', 'findings.json'), JSON.stringify({ runs: [{ id: 'run-1', at: 'x', layersRun: [] }], findings: [
    row('f-a', 'out-of-scope', 'open', 'source parity: no JSON-LD — the source page has no JSON-LD either'),
    row('f-b', 'out-of-scope', 'in-progress'),
    row('f-c', 'out-of-scope', 'accepted'),
    row('f-d', 'platform-migration', 'informational'),
  ] }));
  assert.equal(record(out, { check: 'unrelated', severity: 'P3' }).status, 0);
  const by = Object.fromEntries(ledger(out).findings.map((f) => [f.id, f]));
  assert.equal(by['f-a'].status, 'informational'); assert.equal(by['f-a'].firstSeenRun, 'run-1');
  assert.equal(by['f-b'].status, 'informational');
  assert.equal(by['f-c'].status, 'accepted', 'human decisions are untouched');
  assert.equal(by['f-d'].status, 'open', 'a scored finding is never informational');
  const sc = scorecard(out);
  assert.deepEqual(sc.informational, { total: 2, P1: 0, P2: 2, P3: 0 });
  assert.deepEqual(sc.severity, { P1: 0, P2: 1, P3: 1 });
  done(out);
});

console.log(failed ? `\nfindings: ${failed} check(s) failed` : '\nfindings: all checks passed');
process.exit(failed ? 1 : 0);
