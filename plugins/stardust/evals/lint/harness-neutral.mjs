#!/usr/bin/env node
// Guard: stardust skill text must stay harness-neutral.
//
// Fails when a skill file addresses a sibling skill in the Claude Code plugin
// form (`stardust:<name>`) outside a provenance identifier or an explicitly
// marked Claude Code example, or names a Claude-only tool (Skill tool, Explore
// subagent, AskUserQuestion, TodoWrite) on a line that does not say "Claude
// Code". Copilot CLI exposes plugin skills under bare names, so the namespaced
// form is a dangling reference there (verified 2026-09-17).
//
// Usage: node plugins/stardust/evals/lint/harness-neutral.mjs  (exit 1 on findings)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', 'skills');
const KEEP = [
  /writtenBy/, /"skill":\s*"stardust:/, /<!--\s*stardust:/, /^\s*#+\s*stardust:/, /^\s*by:\s/,
  /stardust:tensions/, /stardust:canon/, /stardust:provenance/, /stardust:<[a-z-]+>/,
  /the skill writing the line/, /with a stardust:migrate$/, /\(via stardust:prototype/,
  /Claude Code/,
];
const NAMESPACED = /stardust:[a-z][a-z-]*/;
const CLAUDE_TOOLS = /\bSkill tool\b|\bSkill-tool\b|`Explore` subagent|\bAskUserQuestion\b|\bTodoWrite\b/;

const files = [];
(function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.md') && !p.endsWith('IMPROVEMENTS.md')) files.push(p); } })(ROOT);

const findings = [];
for (const f of files) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (KEEP.some((k) => k.test(line))) return;
    if (NAMESPACED.test(line)) findings.push(`${relative(process.cwd(), f)}:${i + 1}: namespaced skill reference: ${line.trim().slice(0, 120)}`);
    else if (CLAUDE_TOOLS.test(line)) findings.push(`${relative(process.cwd(), f)}:${i + 1}: Claude-only tool name without a "Claude Code" marker: ${line.trim().slice(0, 120)}`);
  });
}
if (findings.length) { console.error(`harness-neutral lint: ${findings.length} finding(s)\n` + findings.join('\n')); process.exit(1); }
console.log(`harness-neutral lint: ${files.length} files clean`);
