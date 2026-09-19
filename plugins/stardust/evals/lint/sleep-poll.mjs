#!/usr/bin/env node
// Guard: no stardust skill text teaches the sleep-then-poll snippet.
//
// Why: the harvest counted 711 `sleep N; tail|grep -c|cat|pgrep` commands (≈ 54 h
// requested) polling a driver's log by hand. The drivers now write a progress
// JSON and end with one SUMMARY line (skills/stardust/scripts/progress.mjs;
// master § Wait discipline), so any doc line that still shows the snippet
// re-teaches the gap. A line that also says `never` is the prohibition itself
// and passes; a line containing `sleep-poll: ignore` is skipped (say why).
//
// Tier: 🟡 advisory in this release (findings print, exit 0); `--strict` exits 1
// on a finding — the release checklist flips it once the docs have been clean
// for a release. `--self-test` runs the rule over lint/fixtures/sleep-poll/
// (bad.md must fire, good.md must stay silent) before the live scan and exits 1
// when the fixture verdicts are wrong — the rule's own negative fixture.
//
// Usage: node plugins/stardust/evals/lint/sleep-poll.mjs [--strict] [--self-test] [--dir <skills-dir>]
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', 'skills');
const FIXTURES = join(import.meta.dirname, 'fixtures', 'sleep-poll');
export const SLEEP_POLL = /\bsleep\s+\d+[smh]?\s*(?:;|&&|\|\|)\s*(?:tail|grep\s+-c|cat|pgrep|wc\s+-l)\b/;

export function scan(text) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    if (!SLEEP_POLL.test(line) || line.includes('sleep-poll: ignore') || /\bnever\b/i.test(line)) return;
    hits.push({ line: i + 1, snippet: line.match(SLEEP_POLL)[0] });
  });
  return hits;
}

function mdFiles(dir) { return readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.md') && !f.endsWith('IMPROVEMENTS.md')).map((f) => join(dir, f)); }

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i !== -1 ? argv[i + 1] : null; };
const strict = argv.includes('--strict');
const rel = (p) => relative(process.cwd(), p);

if (argv.includes('--self-test')) {
  const bad = scan(readFileSync(join(FIXTURES, 'bad.md'), 'utf8'));
  const good = scan(readFileSync(join(FIXTURES, 'good.md'), 'utf8'));
  const problems = [];
  if (bad.length < 3) problems.push(`bad.md: expected ≥ 3 findings, got ${bad.length}`);
  if (good.length) problems.push(`good.md: expected 0 findings, got ${good.length} (${good.map((h) => `line ${h.line}: ${h.snippet}`).join('; ')})`);
  if (problems.length) { console.error(`sleep-poll self-test: FAIL\n${problems.join('\n')}`); process.exit(1); }
  console.log(`sleep-poll self-test: ok (bad.md ${bad.length} findings, good.md 0)`);
}

const dir = arg('--dir') || ROOT;
const files = mdFiles(dir);
const findings = files.flatMap((f) => scan(readFileSync(f, 'utf8')).map((h) => `${rel(f)}:${h.line}: 🟡 sleep-then-poll snippet (\`${h.snippet}\`) — point at the driver's progress file + SUMMARY line instead (stardust/SKILL.md § Wait discipline)`));
if (findings.length) {
  console[strict ? 'error' : 'log'](`sleep-poll lint: ${findings.length} finding(s)${strict ? '' : ' — advisory 🟡 (--strict to fail)'}\n${findings.join('\n')}`);
  process.exit(strict ? 1 : 0);
}
console.log(`sleep-poll lint: ${files.length} files clean`);
