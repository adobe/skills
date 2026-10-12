#!/usr/bin/env node
// skills/stardust/scripts/sync-scripts.mjs — copy every stardust script into the project, once.
//
// Every stardust command runs a project copy under `stardust/scripts/<skill>/`: the skill tree ships
// no node_modules, so a script resolves `playwright` (and pixelmatch, sharp, …) only from a copy
// inside the project, and a harness exposes the skill tree at a different path in every install
// layout (`<plugin>/skills/` in a Claude Code / Copilot / Grok / Cursor plugin, `.agents/skills/` or
// the harness's own dir in a loose `npx skills add` install). Copying once makes every command
// path the same everywhere: `node stardust/scripts/<skill>/<script>.mjs`.
//
//   node <skills-root>/stardust/scripts/sync-scripts.mjs [--project <dir>] [--check]
//
// <skills-root> is the directory that holds this skill's folder and its siblings; this script finds
// it from its own location, so no argument names it. --project defaults to the cwd (run it from the
// project root). Copies <skills-root>/<skill>/scripts/** for the sixteen stardust skills, skipping
// test/ and node_modules/, byte-identical with file modes kept, and writes the stardust version to
// `stardust/scripts/VERSION` (scripts stamp provenance from it). Files whose bytes already match are
// left alone; files a newer stardust no longer ships are left in place and listed. Idempotent.
// --check writes nothing and exits 1 when the copy is missing, stale or diverged (one line each).
// Exit codes: 0 ok / in sync · 1 --check found drift · 2 usage or the skill tree is incomplete.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Kept equal to skills/ by evals/lint/manifests.mjs. A loose install puts other skills beside
// these, so the list — not a directory scan — decides what is stardust's.
export const SKILLS = ['stardust', 'extract', 'direct', 'prototype', 'migrate', 'prepare-migration', 'uplift', 'audit', 'replica', 'reskin', 'deploy', 'rollout', 'diff', 'dynamics', 'qa', 'spec'];
const SKIP = new Set(['test', 'node_modules']);

export function walk(dir, base = dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out); else if (e.isFile()) out.push(relative(base, p));
  }
  return out;
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    console.log(src.split('\n').slice(1).filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n').split('\nExit codes')[0].trim());
    process.exit(0);
  }

  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(`--${n}`); if (i < 0) return null; const v = args[i + 1]; if (!v || v.startsWith('--')) { console.error(`--${n} needs a value`); process.exit(2); } return v; };
  const PROJECT = resolve(opt('project') || process.cwd());
  const CHECK = args.includes('--check');
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const DEST = join(PROJECT, 'stardust', 'scripts');

  const missing = SKILLS.filter((s) => !existsSync(join(ROOT, s, 'SKILL.md')));
  if (missing.length) { console.error(`skill tree at ${ROOT} lacks ${missing.join(', ')} — install all sixteen stardust skills`); process.exit(2); }
  const version = (() => { try { return readFileSync(join(ROOT, 'stardust', 'VERSION'), 'utf8').trim(); } catch { return null; } })();
  if (!version) { console.error(`no ${join(ROOT, 'stardust', 'VERSION')} — the stardust skill is incomplete`); process.exit(2); }

  const drift = [];
  let copied = 0; let same = 0;
  for (const skill of SKILLS) {
    const src = join(ROOT, skill, 'scripts');
    if (!existsSync(src)) continue;
    const shipped = walk(src);
    for (const rel of shipped) {
      const from = join(src, rel); const to = join(DEST, skill, rel);
      const buf = readFileSync(from);
      if (existsSync(to) && readFileSync(to).equals(buf)) { same += 1; continue; }
      if (CHECK) { drift.push(`${existsSync(to) ? 'differs' : 'missing'}  stardust/scripts/${skill}/${rel}`); continue; }
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
      chmodSync(to, statSync(from).mode & 0o777);
      copied += 1;
    }
    const extra = existsSync(join(DEST, skill)) ? walk(join(DEST, skill)).filter((r) => !shipped.includes(r)) : [];
    for (const r of extra) console.log(`not shipped by stardust ${version} (left in place): stardust/scripts/${skill}/${r}`);
  }
  const versionFile = join(DEST, 'VERSION');
  const current = existsSync(versionFile) ? readFileSync(versionFile, 'utf8').trim() : null;
  if (current !== version) {
    if (CHECK) drift.push(`version   stardust/scripts/VERSION ${current ?? 'missing'} → ${version}`);
    else { mkdirSync(DEST, { recursive: true }); writeFileSync(versionFile, `${version}\n`); }
  }

  if (CHECK) {
    if (drift.length) { console.log(drift.join('\n')); console.log(`stardust/scripts out of sync with ${ROOT} (${drift.length}); run without --check`); process.exit(1); }
    console.log(`stardust/scripts in sync with stardust ${version} (${same} files)`);
  } else {
    console.log(`stardust/scripts ← ${ROOT}: ${copied} copied, ${same} unchanged, version ${version}`);
  }
}

const SELF = fileURLToPath(import.meta.url);
if (process.argv[1] && SELF === (() => { try { return realpathSync(process.argv[1]); } catch { return process.argv[1]; } })()) main();
