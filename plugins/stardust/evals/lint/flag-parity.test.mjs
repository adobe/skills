#!/usr/bin/env node
// Fixture test: evals/lint/flag-parity.mjs — the bare-script-name and rule-id forms
// (B2 defect 12). A doc that writes `chrome-parity --open` (no .mjs token) or names a
// lint rule id no script emits (`D-NOPE`) is a finding; `.mjs`-named commands keep their
// attribution (a `blocks/` path is not rollout's blocks.mjs); a `flag-parity: ignore`
// line is skipped; a clean tree exits 0. Before the fix the same claims were silent.
//
// Usage: node plugins/stardust/evals/lint/flag-parity.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const LINT = join(import.meta.dirname, 'flag-parity.mjs');
const FIX = join(import.meta.dirname, 'fixtures', 'flag-parity');
const run = (...args) => spawnSync(process.execPath, [LINT, ...args], { encoding: 'utf8' });

// claims: exactly three findings, each on the line that makes the claim
{
  const r = run('--docs', join(FIX, 'claims'));
  assert.equal(r.status, 1, `claims tree → exit 1\n${r.stdout}${r.stderr}`);
  const lines = r.stderr.trim().split('\n').filter((l) => /lint\.md:\d+:/.test(l));
  assert.equal(lines.length, 3, `three findings, got:\n${r.stderr}`);
  assert.ok(lines.some((l) => /lint\.md:3: --open is not a parser case in .*replica\/scripts\/chrome-parity\.mjs$/.test(l)), `bare-name flag: ${r.stderr}`);
  assert.ok(lines.some((l) => /lint\.md:4: --no-such-flag is not a parser case in .*rollout\/scripts\/delivery-lint\.mjs$/.test(l)), `.mjs flag still checked: ${r.stderr}`);
  assert.ok(lines.some((l) => /lint\.md:5: rule id `D-NOPE` is emitted by no skills\/\*\/scripts source/.test(l)), `unknown rule id: ${r.stderr}`);
  assert.ok(!/allow-no-h1|D1-EMPTY|YYYY-MM-DD|--styles|lint\.md:8/.test(r.stderr), `known flag, known rule id, non-lint caps token, blocks/ path and the ignore line are silent: ${r.stderr}`);
}

// clean: bare names + known rule ids (literal and template-prefixed) resolve
{
  const r = run('--docs', join(FIX, 'clean'));
  assert.equal(r.status, 0, `clean tree → exit 0\n${r.stderr}`);
  assert.match(r.stdout, /references resolve/);
}

// usage
assert.equal(run('--docs', join(FIX, 'nope')).status, 2, 'missing --docs dir → exit 2');
assert.equal(run('--help').status, 0, '--help → exit 0');

console.log('flag-parity.test: ok (bare script name + --flag, unknown rule id, .mjs attribution kept, ignore marker, clean tree, usage)');
