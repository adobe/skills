#!/usr/bin/env node
// Guard: abolished wording cannot return. "pass with an asterisk" named the
// pre-T15.3 state (over-bar breakpoint, residuals cause-only, may ship); the
// rule now reads FAIL → blocked (replica/reference/source-fidelity-gate.md).
// Scans skills/**/*.md and evals/**/*.md (recorded runner/results/ excluded);
// a line containing `forbidden-phrases: ignore` is skipped.
// Usage: node plugins/stardust/evals/lint/forbidden-phrases.mjs  (exit 1 on a hit)
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const ROOT = join(import.meta.dirname, '..', '..');
const FORBIDDEN = /pass with an asterisk/i;
const files = ['skills', 'evals'].flatMap((d) => readdirSync(join(ROOT, d), { recursive: true }).filter((f) => f.endsWith('.md') && !f.startsWith('runner/results/')).map((f) => join(ROOT, d, f)));
const hits = files.flatMap((f) => readFileSync(f, 'utf8').split('\n').flatMap((l, i) => (FORBIDDEN.test(l) && !l.includes('forbidden-phrases: ignore') ? [`${relative(process.cwd(), f)}:${i + 1}: forbidden phrase (${l.match(FORBIDDEN)[0]})`] : [])));
if (hits.length) { console.error(`forbidden-phrases lint: ${hits.length} hit(s)\n${hits.join('\n')}`); process.exit(1); }
console.log(`forbidden-phrases lint: ${files.length} files clean`);
