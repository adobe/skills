#!/usr/bin/env node
// Guard: every stardust SKILL.md body fits in what Google Antigravity loads.
//
// Why: Antigravity loads only the first 24,000 bytes of the body of a SKILL.md, and an agent there
// gets no sign that the rest is missing (#665). Detail belongs in the skill's reference/ files, with
// a line in SKILL.md that names the file and says when to read it.
//
// Checked: skills/*/SKILL.md. The body is counted the way `agy plugin validate` counts it: the
// UTF-8 bytes after the line that closes the frontmatter, without leading and trailing whitespace.
// A body above MAX_BYTES is a finding. A SKILL.md without frontmatter is counted whole.
//
// Usage: node plugins/stardust/evals/lint/skill-size.mjs  (exit 1 on findings)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', 'skills');
const MAX_BYTES = 24000;

const bodyBytes = (text) => {
  const front = text.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  return Buffer.byteLength((front ? text.slice(front[0].length) : text).trim());
};

const sizes = [];
for (const skill of readdirSync(ROOT).sort()) {
  const file = join(ROOT, skill, 'SKILL.md');
  if (existsSync(file)) sizes.push({ skill, file, bytes: bodyBytes(readFileSync(file, 'utf8')) });
}
const findings = sizes.filter(({ bytes }) => bytes > MAX_BYTES)
  .map(({ file, bytes }) => `${relative(process.cwd(), file)}: body is ${bytes} bytes, above ${MAX_BYTES} (Antigravity loads only the first ${MAX_BYTES}): move detail to reference/ and point at it`);
if (findings.length) { console.error(`skill-size lint: ${findings.length} finding(s)\n${findings.join('\n')}`); process.exit(1); }
const largest = sizes.reduce((a, b) => (b.bytes > a.bytes ? b : a), { skill: '-', bytes: 0 });
console.log(`skill-size lint: ${sizes.length} SKILL.md bodies at most ${MAX_BYTES} bytes (largest: ${largest.skill}, ${largest.bytes})`);
