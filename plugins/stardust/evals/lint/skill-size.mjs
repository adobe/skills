#!/usr/bin/env node
// Guard: every SKILL.md body stays small enough for every target harness to load whole.
//
// Why: harnesses cap what they inline — Grok Build loads a skill body only up to its first
// 25k tokens, Hermes warns past 24k characters, agentskills.io advises < 500 lines — and a
// truncated card silently drops the steps at its end. deploy/SKILL.md had reached 196 KB
// (~49k tokens). Step bodies belong in the skill's reference/, read when the card points there.
//
// Checks: each skills/*/SKILL.md ≤ 80 KB (~20k tokens at the docs' ~4 bytes per token).
//
// Usage: node plugins/stardust/evals/lint/skill-size.mjs  (exit 1 on findings)
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', 'skills');
const CAP = 80 * 1024;
const sizes = readdirSync(ROOT).map((d) => join(ROOT, d, 'SKILL.md')).filter((p) => existsSync(p)).map((p) => [p, statSync(p).size]);
const over = sizes.filter(([, b]) => b > CAP);
if (over.length) { console.error(`skill-size lint: ${over.length} finding(s)\n` + over.map(([p, b]) => `${p}: ${b} bytes, above the ${CAP}-byte cap — move step bodies to reference/`).join('\n')); process.exit(1); }
const [maxP, maxB] = sizes.reduce((m, s) => (s[1] > m[1] ? s : m));
console.log(`skill-size lint: ${sizes.length} SKILL.md files ≤ ${CAP} bytes (largest ${maxP.split('/').slice(-2, -1)[0]}, ${maxB})`);
