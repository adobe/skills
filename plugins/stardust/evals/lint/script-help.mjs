#!/usr/bin/env node
// Guard: every CLI script a stardust skill ships answers `--help` — exit 0, its usage on
// stdout — before any argument parsing, file/network/browser work or other side effect.
//
// Why: an agent that cannot ask a script for its flags reads the script's source instead
// (recorded in one session: four greps over a single crawler's source to learn what it
// writes, 16 source reads for flags in another), which the reading discipline forbids.
// `--help` is checkable — so check it.
//
// What it does: every skills/*/scripts/*.{mjs,js,sh} (not test/) runs with `--help` in an
// empty scratch cwd under a 15 s deadline. It passes when it exits 0, prints `usage` (any
// case) or its own file name on stdout, and leaves the scratch cwd empty. A script whose
// stderr is ERR_MODULE_NOT_FOUND for a package (playwright, sharp, pixelmatch, pngjs are
// project devDependencies, absent in this checkout) is reported as a skip — verify those in
// an environment that has the module. Pure libraries (exported functions, no CLI) are exempt;
// each entry below says why. Non-script files (e.g. dynamics/scripts/vendors.json) are not
// walked at all — only .mjs/.js/.sh are.
//
// Usage: node plugins/stardust/evals/lint/script-help.mjs  (exit 1 on any failure)
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..', '..', 'skills');
const TIMEOUT_MS = 15000;

// <skill>/scripts/<file> → one-line reason. A library is exempt only when it exports functions
// and has no argv handling of its own; a script that grows a CLI must leave this list.
const EXEMPT = {
  'deploy/scripts/content-inventory.mjs': 'library: role-classified inventory + diff, imported by block-roundtrip and section-schema; no CLI',
  'deploy/scripts/file-lock.mjs': 'library: cross-process lock + atomic merge for the shared deploy ledgers; no CLI',
  'deploy/scripts/diff-profiles.mjs': 'library: stack profiles (eds|generic) for the inventory classifiers; no CLI',
  'diff/scripts/content-inventory.mjs': 'library: the diff skill\'s copy of the inventory classifier, imported by content-diff; no CLI',
  'diff/scripts/diff-profiles.mjs': 'library: the diff skill\'s copy of the stack profiles, imported by content-diff and visual-diff; no CLI',
  'diff/scripts/live-session.mjs': 'library: live-site browser session helpers (UA, stealth launch, overlay dismissal); no CLI',
  'dynamics/scripts/lib.mjs': 'library: shared arg/io/playwright helpers for the dynamics instruments; no CLI',
  'qa/scripts/lib.mjs': 'library: shared helpers for qa.mjs and its checks; no CLI',
  'rollout/scripts/lib.mjs': 'library: shared IO + roll-up helpers for the rollout scripts; no CLI',
};

const scripts = [];
for (const skill of readdirSync(ROOT).sort()) {
  const dir = join(ROOT, skill, 'scripts');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    if (statSync(p).isDirectory() || !/\.(mjs|js|sh)$/.test(f)) continue;
    scripts.push(p);
  }
}

const rel = (p) => relative(ROOT, p);
const failures = [];
let ok = 0;
let skipped = 0;

for (const stale of Object.keys(EXEMPT)) {
  if (!existsSync(join(ROOT, stale))) failures.push(`${stale}: exempt entry names a file that does not exist — prune the list`);
}

for (const p of scripts) {
  const name = rel(p);
  if (EXEMPT[name]) { skipped += 1; console.log(`skip  ${name} (${EXEMPT[name]})`); continue; }
  const cwd = mkdtempSync(join(tmpdir(), 'script-help-'));
  const cmd = p.endsWith('.sh') ? 'bash' : process.execPath;
  const r = spawnSync(cmd, [p, '--help'], { cwd, encoding: 'utf8', timeout: TIMEOUT_MS });
  const wrote = readdirSync(cwd);
  rmSync(cwd, { recursive: true, force: true });
  const out = r.stdout || '';
  const err = r.stderr || '';

  if (r.error && r.error.code === 'ETIMEDOUT') { failures.push(`${name}: did not exit within ${TIMEOUT_MS / 1000} s on --help`); continue; }
  if (r.status !== 0) {
    const missing = err.match(/Cannot find (?:package|module) '([^'./][^']*)'/);
    if (missing && /ERR_MODULE_NOT_FOUND|Cannot find/.test(err)) { skipped += 1; console.log(`skip  ${name} (needs ${missing[1]}; verify in the image)`); continue; }
    failures.push(`${name}: exit ${r.status === null ? `signal ${r.signal}` : r.status} — ${(err.trim().split('\n').find((l) => l.trim()) || 'no stderr').slice(0, 160)}`);
    continue;
  }
  if (!/usage/i.test(out) && !out.includes(basename(p))) { failures.push(`${name}: exit 0 but stdout has neither "Usage" nor "${basename(p)}" (${out.length} chars)`); continue; }
  if (wrote.length) { failures.push(`${name}: --help wrote into the cwd: ${wrote.join(', ')}`); continue; }
  ok += 1;
  console.log(`ok    ${name}`);
}

const summary = `script-help lint: ${ok} scripts answer --help, ${skipped} skipped, ${failures.length} failed`;
if (failures.length) { console.error(`${summary}\n${failures.map((f) => `  FAIL ${f}`).join('\n')}`); process.exit(1); }
console.log(summary);
