#!/usr/bin/env node
// Guard: stardust skill docs must stay small enough to be read whole.
//
// Why: an agent loads a SKILL.md in one Read; past a ~25k-token cap the tail
// is silently truncated and the skill runs on half its procedure. Reference
// files are read on demand and get a looser cap. Every SKILL.md is always-on
// once its skill triggers, so the sum of all SKILL.md bytes is the budget a
// routing session can end up paying — printed here so it is watched.
//
// Rules (bytes on disk):
//   skills/*/SKILL.md            > SKILL_MAX            → finding
//   skills/<s>/SKILL.md          > CORE_LIMIT[<s>]      → finding (skills whose
//                                  body is meant to be a thin core over reference/)
//   skills/*/reference/*.md      > REF_MAX              → finding
//   skills/*/SKILL.md without a `## Operator card` heading before its first
//   phase/procedure heading (## Phase…, ## Procedure, ## Setup, ## Run…) → finding
//
// TEMPORARY_ALLOWLIST (file → reason) suppresses findings for files known to
// violate today. It MUST shrink with every release: an entry that no longer
// suppresses anything is reported as stale and fails the lint, so it cannot
// linger once the underlying fix lands.
//
// Set DOC_SIZE_BASE=<git ref> to print the per-skill delta against that ref
// instead of the last `stardust-v*` tag.
//
// Usage: node plugins/stardust/evals/lint/doc-size.mjs  (exit 1 on findings)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..', '..', 'skills');

const SKILL_MAX = 100_000;
const REF_MAX = 60_000;
// Skills whose SKILL.md is a thin always-on core; the rest lives in reference/.
const CORE_LIMIT = { deploy: 40_000 };
const PHASE_HEADING = /^##\s+(Phase\b|Procedure\b|Setup\b|Run\b|Step\b)/;
const CARD_HEADING = /^##\s+Operator card\b/;

// TEMPORARY — shrink per release. Key: path relative to skills/. Value: why.
const TEMPORARY_ALLOWLIST = {
  'deploy/SKILL.md': 'core/reference split in progress; no operator card yet',
  'audit/SKILL.md': 'operator card not written yet',
  'diff/SKILL.md': 'operator card not written yet',
  'direct/SKILL.md': 'operator card not written yet',
  'dynamics/SKILL.md': 'operator card not written yet',
  'extract/SKILL.md': 'operator card not written yet',
  'migrate/SKILL.md': 'operator card not written yet',
  'prepare-migration/SKILL.md': 'operator card not written yet',
  'prototype/SKILL.md': 'operator card not written yet',
  'qa/SKILL.md': 'operator card not written yet',
  'replica/SKILL.md': 'operator card not written yet',
  'reskin/SKILL.md': 'operator card not written yet',
  'rollout/SKILL.md': 'operator card not written yet',
  'stardust/SKILL.md': 'operator card not written yet',
  'uplift/SKILL.md': 'operator card not written yet',
};

const kb = (n) => `${(n / 1000).toFixed(1)}k`;
const rel = (p) => relative(ROOT, p);
const show = (p) => relative(process.cwd(), p);

const skills = readdirSync(ROOT).filter((s) => statSync(join(ROOT, s)).isDirectory()).sort();
const findings = []; // { file, msg }
let alwaysOn = 0;
const sizes = {};

for (const s of skills) {
  const skillMd = join(ROOT, s, 'SKILL.md');
  let size = 0;
  try { size = statSync(skillMd).size; } catch { continue; }
  sizes[s] = size;
  alwaysOn += size;
  if (size > SKILL_MAX) findings.push({ file: rel(skillMd), msg: `${show(skillMd)}: ${kb(size)} exceeds SKILL_MAX ${kb(SKILL_MAX)}` });
  else if (CORE_LIMIT[s] && size > CORE_LIMIT[s]) findings.push({ file: rel(skillMd), msg: `${show(skillMd)}: ${kb(size)} exceeds CORE_LIMIT ${kb(CORE_LIMIT[s])} (always-on core)` });

  const lines = readFileSync(skillMd, 'utf8').split('\n');
  const card = lines.findIndex((l) => CARD_HEADING.test(l));
  const phase = lines.findIndex((l) => PHASE_HEADING.test(l));
  if (card < 0) findings.push({ file: rel(skillMd), msg: `${show(skillMd)}: no \`## Operator card\` heading` });
  else if (phase >= 0 && card > phase) findings.push({ file: rel(skillMd), msg: `${show(skillMd)}:${card + 1}: \`## Operator card\` comes after first phase heading (line ${phase + 1})` });

  const refDir = join(ROOT, s, 'reference');
  let refs = [];
  try { refs = readdirSync(refDir).filter((f) => f.endsWith('.md')); } catch { /* no reference dir */ }
  for (const f of refs) {
    const p = join(refDir, f);
    const n = statSync(p).size;
    if (n > REF_MAX) findings.push({ file: rel(p), msg: `${show(p)}: ${kb(n)} exceeds REF_MAX ${kb(REF_MAX)}` });
  }
}

// Split findings into live vs allowlisted; flag stale allowlist entries.
const live = [];
const suppressed = [];
const used = new Set();
for (const f of findings) {
  if (TEMPORARY_ALLOWLIST[f.file]) { used.add(f.file); suppressed.push(f); } else live.push(f);
}
for (const file of Object.keys(TEMPORARY_ALLOWLIST)) {
  if (!used.has(file)) live.push({ file, msg: `skills/${file}: stale TEMPORARY_ALLOWLIST entry — remove it (${TEMPORARY_ALLOWLIST[file]})` });
}

// Always-on total and delta versus the last release tag (best effort).
console.log(`doc-size lint: ${skills.length} skills, always-on total ${kb(alwaysOn)} (${alwaysOn} bytes)`);
const git = (...args) => { const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };
const base = process.env.DOC_SIZE_BASE
  || (git('tag', '-l', 'stardust-v*') || '').split('\n').filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
const top = base && git('rev-parse', '--show-toplevel');
if (!top) console.log('  delta: skipped (no git, or no stardust-v* tag; set DOC_SIZE_BASE=<ref> to compare)');
else {
  const prefix = relative(top, ROOT);
  const deltas = skills.filter((s) => s in sizes).map((s) => {
    const was = git('cat-file', '-s', `${base}:${prefix}/${s}/SKILL.md`);
    const d = was === null ? sizes[s] : sizes[s] - Number(was);
    return { s, d, isNew: was === null };
  }).filter((x) => x.d !== 0);
  const total = deltas.reduce((a, x) => a + x.d, 0);
  console.log(`  delta vs ${base}: ${total >= 0 ? '+' : ''}${kb(total)} always-on` + (deltas.length ? '' : ' (no change)'));
  for (const { s, d, isNew } of deltas) console.log(`    ${s}: ${d >= 0 ? '+' : '-'}${kb(Math.abs(d))}${isNew ? ' (new)' : ''}`);
}

if (suppressed.length) {
  console.log(`  ${suppressed.length} finding(s) allowlisted (TEMPORARY — shrink per release):`);
  for (const f of suppressed) console.log(`    ${f.msg}`);
}
if (live.length) { console.error(`doc-size lint: ${live.length} finding(s)\n` + live.map((f) => f.msg).join('\n')); process.exit(1); }
console.log(`doc-size lint: clean (${Object.keys(TEMPORARY_ALLOWLIST).length} allowlisted files)`);
