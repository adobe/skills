#!/usr/bin/env node
// Guard: stardust skill text must stay harness-neutral.
//
// Fails when a skill file addresses a sibling skill in the Claude Code plugin
// form (`stardust:<name>`) outside a provenance identifier or an explicitly
// marked Claude Code example, or names a Claude-only tool or setting (Skill
// tool / `Skill {` calls, `impeccable:impeccable`, Explore subagent,
// AskUserQuestion, TodoWrite, run_in_background, promptCacheTtl, WebSearch /
// WebFetch, `mcp__*` tool ids, plan mode, a CLAUDE.md without AGENTS.md) on a
// line that does not say "Claude Code", hard-codes one harness's shell timeout,
// or opens a file with macOS-only `open`. Copilot CLI exposes plugin skills
// under bare names, so the namespaced form is a dangling reference there
// (verified 2026-09-17). reference/harness-notes.md is the one place that maps
// neutral phrases to each harness's tools, so it is exempt.
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
const CLAUDE_TOOLS = /\bSkill tool\b|\bSkill-tool\b|\bSkill \{|impeccable:impeccable|`Explore` subagent|\bAskUserQuestion\b|\bTodoWrite\b|\brun_in_background\b|\bpromptCacheTtl\b|\bWeb(?:Search|Fetch)\b|\bmcp__[a-z]|\bplan mode\b|CLAUDE\.md(?!.*AGENTS\.md)(?<!AGENTS\.md.*)/;
const HARNESS_FACTS = /\b\d+-minute default timeout|(?:^|[`\s])open [^\s`]+\.(?:html|png)\b/;

const files = [];
(function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.md') && !p.endsWith('IMPROVEMENTS.md') && !p.endsWith('harness-notes.md')) files.push(p); } })(ROOT);

const findings = [];
for (const f of files) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (KEEP.some((k) => k.test(line))) return;
    if (NAMESPACED.test(line)) findings.push(`${relative(process.cwd(), f)}:${i + 1}: namespaced skill reference: ${line.trim().slice(0, 120)}`);
    else if (CLAUDE_TOOLS.test(line)) findings.push(`${relative(process.cwd(), f)}:${i + 1}: Claude-only tool name without a "Claude Code" marker: ${line.trim().slice(0, 120)}`);
    else if (HARNESS_FACTS.test(line)) findings.push(`${relative(process.cwd(), f)}:${i + 1}: one harness's fact (shell timeout, macOS open) — point at reference/harness-notes.md: ${line.trim().slice(0, 120)}`);
  });
}
if (findings.length) { console.error(`harness-neutral lint: ${findings.length} finding(s)\n` + findings.join('\n')); process.exit(1); }
console.log(`harness-neutral lint: ${files.length} files clean`);
