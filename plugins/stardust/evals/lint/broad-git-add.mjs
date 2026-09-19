#!/usr/bin/env node
// Guard: no stardust skill text or script tells an agent to stage everything.
//
// Why: `git add -A` / `git add .` / `git add --all` on a shared checkout swept
// foreign work into a stardust commit (master § Hands-off mode, commit bullet:
// name the files, never a broad add). The rule lives in stardust/SKILL.md;
// this lint keeps every SKILL.md, reference/*.md and scripts/* free of the
// broad forms so the prohibition is not quietly contradicted elsewhere.
//
// A line that also contains `never` is the prohibition itself and passes.
// A line containing `broad-git-add: ignore` is skipped (say why in the line).
//
// Usage: node plugins/stardust/evals/lint/broad-git-add.mjs  (exit 1 on findings)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', 'skills');
const BROAD = /git add (-A|--all|\.)(?![\w\/-])/;
const rel = (p) => relative(process.cwd(), p);

const files = [];
for (const skill of readdirSync(ROOT)) {
  const dir = join(ROOT, skill);
  if (!statSync(dir).isDirectory()) continue;
  const skillMd = join(dir, 'SKILL.md');
  if (existsSync(skillMd)) files.push(skillMd);
  for (const sub of ['reference', 'scripts']) {
    const d = join(dir, sub);
    if (!existsSync(d)) continue;
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isFile() && (sub === 'scripts' || e.endsWith('.md'))) files.push(p);
    }
  }
}

const findings = [];
for (const f of files) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (!BROAD.test(line) || line.includes('broad-git-add: ignore') || /\bnever\b/i.test(line)) return;
    findings.push(`${rel(f)}:${i + 1}: broad add (\`${line.match(BROAD)[0]}\`) — name the files to stage (stardust/SKILL.md § Hands-off mode, commit bullet)`);
  });
}
if (findings.length) { console.error(`broad-git-add lint: ${findings.length} finding(s)\n${findings.join('\n')}`); process.exit(1); }
console.log(`broad-git-add lint: ${files.length} files, no broad \`git add\``);
