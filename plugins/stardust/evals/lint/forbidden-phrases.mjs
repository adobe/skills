#!/usr/bin/env node
// Guard: wording that cannot return. "pass with an asterisk" named the
// pre-T15.3 state (over-bar breakpoint, residuals cause-only, may ship); the
// rule now reads FAIL → blocked (replica/reference/source-fidelity-gate.md).
// `grep -E … \|` is a vacuous pass bar on a stock macOS toolchain (BSD grep
// reads `\|` under -E as a literal pipe, so "prints nothing" holds with the
// references still present) — alternation is written `|` or repeated `-e`.
// Scans skills/**/*.{md,mjs,sh} and evals/**/*.md (recorded runner/results/
// excluded — a script header comment is as much drift as a doc line); a line
// containing `forbidden-phrases: ignore` is skipped.
// Usage: node plugins/stardust/evals/lint/forbidden-phrases.mjs  (exit 1 on a hit)
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const ROOT = join(import.meta.dirname, '..', '..');
const RULES = [
  { re: /pass with an asterisk/i, why: 'forbidden phrase' },
  { re: /grep\b[^\n`]*\s-[a-zA-Z]*E[a-zA-Z]*\s[^\n`]*\\\|/, why: 'BSD grep: `\\|` under -E is a literal pipe — write `|` or repeated -e' },
];
const EXT = { skills: /\.(md|mjs|sh)$/, evals: /\.md$/ };
const files = Object.entries(EXT).flatMap(([d, ext]) => readdirSync(join(ROOT, d), { recursive: true }).filter((f) => ext.test(f) && !f.startsWith('runner/results/')).map((f) => join(ROOT, d, f)));
const hits = files.flatMap((f) => readFileSync(f, 'utf8').split('\n').flatMap((l, i) => (l.includes('forbidden-phrases: ignore') ? [] : RULES.filter((r) => r.re.test(l)).map((r) => `${relative(process.cwd(), f)}:${i + 1}: ${r.why} (${l.match(r.re)[0].slice(0, 80)})`))));
if (hits.length) { console.error(`forbidden-phrases lint: ${hits.length} hit(s)\n${hits.join('\n')}`); process.exit(1); }
console.log(`forbidden-phrases lint: ${files.length} files clean`);
