#!/usr/bin/env node
// Guard: the scripts index (skills/stardust/reference/scripts-index.md) names every shipped
// script exactly once, names nothing that does not exist, and stays small enough to read at
// session start.
//
// Why: a recorded hands-off run called --help 78 times across its sessions to recover flags the
// cards had already named. An index the agent consults first is only worth reading while it is
// complete and current — and that is checkable, so check it.
//
// Checked: every skills/*/scripts/*.{mjs,js,sh} (not test/, not subdirectories — the same walk
// as script-help.mjs) has exactly one index line of the form "- `<skill>/<file>` — …"; every
// such line names an existing script; the file stays under MAX_BYTES. Lines that do not start
// with "- `" (title, intro) are not index lines.
//
// Usage: node plugins/stardust/evals/lint/scripts-index.mjs  (exit 1 on findings)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', 'skills');
const INDEX = join(ROOT, 'stardust', 'reference', 'scripts-index.md');
const MAX_BYTES = 12 * 1024;
const LINE = /^- `([a-z][a-z0-9-]*\/[A-Za-z0-9_.-]+\.(?:mjs|js|sh))` — \S/;

const scripts = new Set();
for (const skill of readdirSync(ROOT).sort()) {
  const dir = join(ROOT, skill, 'scripts');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir).sort()) {
    if (!statSync(join(dir, f)).isDirectory() && /\.(mjs|js|sh)$/.test(f)) scripts.add(`${skill}/${f}`);
  }
}

const rel = relative(process.cwd(), INDEX);
const findings = [];
if (!existsSync(INDEX)) { console.error(`scripts-index lint: ${rel} is missing`); process.exit(1); }
const text = readFileSync(INDEX, 'utf8');
const seen = new Map();
text.split('\n').forEach((line, i) => {
  if (!line.startsWith('- `')) return;
  const m = line.match(LINE);
  if (!m) { findings.push(`${rel}:${i + 1}: index line is not "- \`<skill>/<script>\` — <what> — <flags>": ${line.slice(0, 80)}`); return; }
  seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  if (!scripts.has(m[1])) findings.push(`${rel}:${i + 1}: ${m[1]} names no script directly under skills/${m[1].split('/')[0]}/scripts/`);
});
for (const s of scripts) if (!seen.has(s)) findings.push(`${s}: shipped script has no index line in ${rel}`);
for (const [s, n] of seen) if (n > 1) findings.push(`${s}: ${n} index lines (exactly one expected)`);
const bytes = Buffer.byteLength(text);
if (bytes > MAX_BYTES) findings.push(`${rel}: ${bytes} bytes, above the ${MAX_BYTES}-byte cap — shorten lines, never drop a script`);

if (findings.length) { console.error(`scripts-index lint: ${findings.length} finding(s)\n${findings.join('\n')}`); process.exit(1); }
console.log(`scripts-index lint: ${scripts.size} scripts, ${seen.size} index lines, ${bytes} bytes`);
