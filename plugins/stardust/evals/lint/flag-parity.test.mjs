#!/usr/bin/env node
// Fixture test: evals/lint/flag-parity.mjs — the bare-script-name and rule-id forms
// (B2 defect 12). A doc that writes `chrome-parity --open` or `anchor --x` (no .mjs
// token, command position) or names a lint rule id no script emits (`D-NOPE`) is a
// finding; `.mjs`-named commands keep their attribution (a `blocks/` path is not
// rollout's blocks.mjs); a `flag-parity: ignore` line is skipped. Silent: a basename
// used as a word (plan, inventory, anchor mid-line), a caps token on such a line, a
// skill invocation (`$stardust qa --x`), a bare name that does not open its span
// (`make verify --x`) — the false positives the B2 review probed. A CROSS_LANE_PENDING
// entry whose doc no longer carries the claim is stale (exit 1). A clean tree exits 0.
// Before each fix the claims were silent or the false positives fired.
//
// Usage: node plugins/stardust/evals/lint/flag-parity.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const LINT = join(import.meta.dirname, 'flag-parity.mjs');
const FIX = join(import.meta.dirname, 'fixtures', 'flag-parity');
const run = (...args) => spawnSync(process.execPath, [LINT, ...args], { encoding: 'utf8' });

// claims: exactly four findings, each on the line that makes the claim
{
  const r = run('--docs', join(FIX, 'claims'));
  assert.equal(r.status, 1, `claims tree → exit 1\n${r.stdout}${r.stderr}`);
  const lines = r.stderr.trim().split('\n').filter((l) => /lint\.md:\d+:/.test(l));
  assert.equal(lines.length, 4, `four findings, got:\n${r.stderr}`);
  assert.ok(lines.some((l) => /lint\.md:9: --no-such-flag is not a parser case in .*replica\/scripts\/anchor\.mjs$/.test(l)), `span-initial unhyphenated bare name: ${r.stderr}`);
  assert.ok(lines.some((l) => /lint\.md:3: --open is not a parser case in .*replica\/scripts\/chrome-parity\.mjs$/.test(l)), `bare-name flag: ${r.stderr}`);
  assert.ok(lines.some((l) => /lint\.md:4: --no-such-flag is not a parser case in .*rollout\/scripts\/delivery-lint\.mjs$/.test(l)), `.mjs flag still checked: ${r.stderr}`);
  assert.ok(lines.some((l) => /lint\.md:5: rule id `D-NOPE` is emitted by no skills\/\*\/scripts source/.test(l)), `unknown rule id: ${r.stderr}`);
  assert.ok(!/allow-no-h1|D1-EMPTY|YYYY-MM-DD|--styles|lint\.md:8/.test(r.stderr), `known flag, known rule id, non-lint caps token, blocks/ path and the ignore line are silent: ${r.stderr}`);
}

// clean: bare names + known rule ids (literal and template-prefixed) resolve; the
// false-positive shapes (word-basenames, caps token, skill invocation, non-initial
// bare name, tree diagram inside a fence) are silent
{
  const r = run('--docs', join(FIX, 'clean'));
  assert.equal(r.status, 0, `clean tree → exit 0 (no false positive)\n${r.stderr}`);
  assert.match(r.stdout, /references resolve/);
}

// stale pending: an entry whose doc is scanned but carries no claim any more fails
{
  const src = readFileSync(LINT, 'utf8');
  const keys = [...src.matchAll(/^\s+'([^']+:[^']+:[^']+)':/gm)].map((m) => m[1]).filter((k) => !/TEMPORARY/.test(k));
  const block = src.slice(src.indexOf('const CROSS_LANE_PENDING'), src.indexOf('};', src.indexOf('const CROSS_LANE_PENDING')));
  const pending = keys.filter((k) => block.includes(`'${k}'`));
  if (!pending.length) console.log('flag-parity.test: no CROSS_LANE_PENDING entries — stale case has nothing to drive');
  else {
    const tmp = mkdtempSync(join(tmpdir(), 'flag-parity-stale-'));
    const doc = join(tmp, pending[0].split(':')[0]);
    mkdirSync(dirname(doc), { recursive: true });
    writeFileSync(doc, '# the owning lane removed the claim this entry suppressed\n');
    const r = run('--docs', tmp);
    rmSync(tmp, { recursive: true, force: true });
    assert.equal(r.status, 1, `a resolved pending entry is stale → exit 1\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, new RegExp(`stale CROSS_LANE_PENDING entry "${pending[0].replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}"`));
  }
}

// usage
assert.equal(run('--docs', join(FIX, 'nope')).status, 2, 'missing --docs dir → exit 2');
{
  const h = run('--help');
  assert.equal(h.status, 0, '--help → exit 0');
  assert.ok(!/CROSS_LANE_PENDING = |SHARED_HELPERS/.test(h.stdout), '--help prints the header block only, not inline comments');
  assert.match(h.stdout, /2 = --docs is not an existing directory/, '--help states exit 2');
}

console.log('flag-parity.test: ok (bare script name + --flag, unhyphenated command, unknown rule id, .mjs attribution kept, ignore marker, word-basename / caps-token / skill-invocation / non-initial silence, stale pending, clean tree, usage, help)');
