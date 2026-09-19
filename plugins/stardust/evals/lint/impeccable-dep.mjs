#!/usr/bin/env node
// Guard: every stardust skill declares its impeccable dependency level, and
// its docs match the declaration.
//
// Why: one byte-identical "requires impeccable" clause on all 15 skills made
// every sub-skill session pay the locate / version-hint / registry-parse calls
// and inherit stop-if-missing, even for skills that never issue an impeccable
// command. The level now lives in each SKILL.md frontmatter
// (`metadata.impeccable: required | optional | none`) and the master's Setup
// step 1 gates on it. This lint keeps declaration and text consistent.
//
// Rules (per skills/<skill>/):
//   SKILL.md frontmatter has `metadata:` → `impeccable: required|optional|none`
//   `none`     ⇒ no invocation line in any .md under the skill dir
//                (invocation = `$impeccable <cmd>` or `impeccable:<cmd>`; a line
//                or a fenced block whose opening fence carries
//                `impeccable-dep: ignore` is exempt — for user-facing next-steps)
//   `required` ⇒ at least one invocation line under the skill dir
//   compatibility: `none` never names impeccable; `optional` says
//                "optionally the impeccable skill"; `required` names it without "optionally"
//
// Usage: node plugins/stardust/evals/lint/impeccable-dep.mjs  (exit 1 on findings)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', 'skills');
const LEVELS = new Set(['required', 'optional', 'none']);
const MARK = 'impeccable-dep: ignore';
const INVOKE = /\$impeccable\s+[a-z<]|(?<![\w/])impeccable:[a-z]/;
const SCHEMA_COMMENT = /<!--\s*impeccable:/;

const skills = readdirSync(ROOT).filter((s) => statSync(join(ROOT, s)).isDirectory()).sort();
const findings = [];
const show = (p) => relative(process.cwd(), p);

function mdFiles(dir) {
  const out = [];
  (function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.md') && !p.endsWith('IMPROVEMENTS.md')) out.push(p); } })(dir);
  return out;
}

function invocations(file) {
  const hits = [];
  let inFence = false; let fenceIgnored = false;
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      if (!inFence) { inFence = true; fenceIgnored = line.includes(MARK); } else { inFence = false; fenceIgnored = false; }
      return;
    }
    if (fenceIgnored || line.includes(MARK) || SCHEMA_COMMENT.test(line)) return;
    if (INVOKE.test(line)) hits.push(`${show(file)}:${i + 1}: ${line.trim().slice(0, 100)}`);
  });
  return hits;
}

const summary = [];
for (const s of skills) {
  const skillMd = join(ROOT, s, 'SKILL.md');
  let text; try { text = readFileSync(skillMd, 'utf8'); } catch { continue; }
  const fm = text.startsWith('---\n') ? text.slice(4, text.indexOf('\n---', 4)) : '';
  const level = fm.match(/^metadata:\n(?:[ \t]+.*\n)*?[ \t]+impeccable:[ \t]*(\S+)/m)?.[1];
  if (!level || !LEVELS.has(level)) { findings.push(`${show(skillMd)}: frontmatter lacks metadata.impeccable (required | optional | none)`); continue; }
  const compat = fm.match(/^compatibility:\s*(.*)$/m)?.[1] || '';
  const names = /impeccable/i.test(compat);
  const optional = /optionally the impeccable/i.test(compat);
  if (level === 'none' && names) findings.push(`${show(skillMd)}: level none but compatibility names impeccable`);
  if (level === 'optional' && !optional) findings.push(`${show(skillMd)}: level optional but compatibility does not say "optionally the impeccable skill"`);
  if (level === 'required' && (!names || optional)) findings.push(`${show(skillMd)}: level required but compatibility does not name impeccable as required`);
  const hits = mdFiles(join(ROOT, s)).flatMap(invocations);
  if (level === 'none' && hits.length) findings.push(`${show(skillMd)}: level none but ${hits.length} invocation line(s):\n    ${hits.join('\n    ')}`);
  if (level === 'required' && !hits.length) findings.push(`${show(skillMd)}: level required but no impeccable invocation under skills/${s}/`);
  summary.push(`${s}=${level}(${hits.length})`);
}
if (findings.length) { console.error(`impeccable-dep lint: ${findings.length} finding(s)\n` + findings.join('\n')); process.exit(1); }
console.log(`impeccable-dep lint: ${skills.length} skills declare a level — ${summary.join(' ')}`);
