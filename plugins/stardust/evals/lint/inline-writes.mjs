#!/usr/bin/env node
// Guard: no stardust skill doc shows an inline interpreter writing a file.
//
// Why: four recorded hands-off runs wrote 238 python heredocs; ~150 of them read a tracked HTML
// or CSS file, replaced a string and wrote it back — whole-file rewrites no reviewer sees as a
// change. A doc that shows the habit teaches it; the edit tool, replace.mjs and json-edit.mjs
// are the reviewable ways.
//
// What it checks: every .md under plugins/stardust/skills/ (SKILL.md, reference/ and the docs at a
// skill's root alike), except files below a fixtures/, assets/ or scripts/ directory. Each fenced
// code block (``` or ~~~, fence to fence) is one unit; outside fences each paragraph is one — a
// run of non-blank lines, where a list item (`- `, `* `, `+ `, `<n>. `) or a heading (`#`) starts
// a new unit. A unit is a finding when it holds both
//   - an inline interpreter: python / python3 / python3.x with -c, a lone - (stdin program) or a
//     heredoc <<; node (optionally after --input-type=<x>) with -e, --eval, -p, --print, a lone -
//     or a heredoc << — not `python3 -m …`, not `node <file>.mjs`; and
//   - a file-write call: open(…) with a mode holding w, a, x or + (positional or mode=),
//     .write_text(, .write_bytes(, json.dump( (not json.dumps), writeFileSync, appendFileSync,
//     writeFile(, createWriteStream.
// A read-only probe or a prohibition that names `node -e` without a write call stays clean.
//
// Usage: node plugins/stardust/evals/lint/inline-writes.mjs [--root <skills-dir>]
//   --root <dir>  scan this skills directory instead of plugins/stardust/skills (for tests);
//                 every .md below it, skipping fixtures/, assets/ and scripts/ directories
//   -h, --help    print this text
// Output: clean → `inline-writes lint: <n> files clean` on stdout. Findings → stderr, a count
//   line, then per unit `<file>:<line>: inline interpreter writes a file (<marker> … <write>) — …`
//   at the write call's line (file relative to the cwd), files sorted, lines ascending.
// Exit: 0 clean, 1 findings, 2 usage error (unknown argument, --root not a directory).
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = join(dirname(SELF), '..', '..', 'skills');

const PY_FLAGS = '(?:\\s+-[bBdEiIOqsSuv]+)*';
export const MARKERS = [
  new RegExp(`\\bpython(?:3(?:\\.\\d+)?)?${PY_FLAGS}(?:\\s+(?:-[bBdEiIOqsSuv]*c|-)(?![\\w-])|\\s*<<)`),
  /\bnode(?:\s+--input-type=\S+)?(?:\s+(?:-e|--eval|-p|--print|-)(?![\w-])|\s*<<)/,
];

// A mode string literal (optionally shell-escaped quotes) holding w, a, x or +, ending an argument.
const MODE = `\\\\?(['"])[rbtU]*[wax+][rwxabtU+]*\\\\?\\1(?=\\s*[,)])`;
// Call arguments up to two levels of nested parentheses, never past the call's own closing one.
const ARGS = '(?:[^()]|\\((?:[^()]|\\([^()]*\\))*\\))*';
export const WRITES = [
  new RegExp(`\\bopen\\(${ARGS}?,\\s*(?:mode\\s*=\\s*)?${MODE}(?:${ARGS}\\))?`),
  new RegExp(`\\.open\\(\\s*(?:mode\\s*=\\s*)?${MODE}(?:${ARGS}\\))?`),
  /\.write_text\(/,
  /\.write_bytes\(/,
  /\bjson\.dump\(/,
  /\bwriteFileSync\b/,
  /\bappendFileSync\b/,
  /\bwriteFile\(/,
  /\bcreateWriteStream\b/,
];

const FENCE = /^\s*(`{3,}|~{3,})/;
const NEW_UNIT = /^\s*(?:[-*+]|\d+\.)(?:\s|$)|^\s{0,3}#/;
const closesFence = (line, fence) => new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`).test(line);

function splitUnits(text) {
  const units = [];
  let cur = null;
  let fence = null;
  const flush = () => { if (cur) units.push(cur); cur = null; };
  text.split('\n').forEach((line, i) => {
    if (fence) {
      cur.lines.push(line);
      if (closesFence(line, fence)) { flush(); fence = null; }
      return;
    }
    const f = line.match(FENCE);
    if (f) { flush(); fence = f[1]; cur = { first: i, lines: [line] }; return; }
    if (!line.trim()) { flush(); return; }
    if (!cur || NEW_UNIT.test(line)) { flush(); cur = { first: i, lines: [] }; }
    cur.lines.push(line);
  });
  flush();
  return units;
}

const firstMatch = (list, s) => {
  let best = null;
  for (const re of list) { const m = re.exec(s); if (m && (!best || m.index < best.index)) best = m; }
  return best;
};
const show = (s) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > 60 ? `${t.slice(0, 59)}…` : t; };

// One finding per unit holding both a marker and a write call, at the first write call's line.
export function scanText(text) {
  const findings = [];
  for (const u of splitUnits(text)) {
    const body = u.lines.join('\n');
    const marker = firstMatch(MARKERS, body);
    const write = marker && firstMatch(WRITES, body);
    if (!write) continue;
    const line = u.first + 1 + (body.slice(0, write.index).match(/\n/g) || []).length;
    findings.push({ line, marker: show(marker[0]), write: show(write[0].replace(/\($/, '')) });
  }
  return findings;
}

// Test fixtures, vendored assets and script trees are not skill docs.
const SKIP_DIRS = new Set(['fixtures', 'assets', 'scripts']);

function collect(root) {
  const files = [];
  (function walk(d) {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(e)) walk(p); } else if (e.endsWith('.md')) files.push(p);
    }
  })(root);
  return files.sort();
}

function help() {
  const lines = readFileSync(SELF, 'utf8').split('\n');
  const out = [];
  for (const l of lines.slice(lines[0].startsWith('#!') ? 1 : 0)) { if (!l.startsWith('//')) break; out.push(l.replace(/^\/\/ ?/, '')); }
  return out.join('\n');
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(help()); return 0; }
  const usage = (msg) => { console.error(`inline-writes lint: ${msg} (see --help)`); return 2; };
  let root = DEFAULT_ROOT;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--root') return usage(`unknown argument ${argv[i]}`);
    if (i + 1 >= argv.length) return usage('--root needs a directory');
    i += 1;
    root = resolve(argv[i]);
  }
  let isDir = false;
  try { isDir = statSync(root).isDirectory(); } catch { /* reported below */ }
  if (!isDir) return usage(`--root ${root} is not a directory`);
  // The cwd is a real path; a symlinked root (a temp dir on macOS) would print ../-laden paths.
  const files = collect(realpathSync(root));
  const findings = [];
  for (const f of files) {
    for (const x of scanText(readFileSync(f, 'utf8'))) {
      findings.push(`${relative(process.cwd(), f)}:${x.line}: inline interpreter writes a file (${x.marker} … ${x.write}) — show the edit tool, replace.mjs or json-edit.mjs instead`);
    }
  }
  if (findings.length) { console.error(`inline-writes lint: ${findings.length} finding(s)\n${findings.join('\n')}`); return 1; }
  console.log(`inline-writes lint: ${files.length} files clean`);
  return 0;
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && safeRealpath(SELF) === safeRealpath(process.argv[1])) process.exitCode = main(process.argv.slice(2));
