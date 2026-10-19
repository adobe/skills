#!/usr/bin/env node
// Guard: no stardust skill doc shows a shell snippet waiting with a bare sleep.
//
// Why: in a recorded hands-off run the lead spent about 73% of wall time inside blind `sleep`
// calls waiting on background units — it wrote `sleep 595`, `sleep 1200`, `sleep 1380`, and the
// tool cap truncated the long ones to 600 s so neither the intended wait nor an early wake
// happened. The skills ship wait instruments (`replica/scripts/run-bg.mjs wait`,
// `stardust/scripts/progress.mjs wait`) that return early via a wake file; a doc that shows a bare
// sleep teaches the idle habit the instruments exist to kill.
//
// What it checks: the same file set as inline-writes — every .md under plugins/stardust/skills/
// (SKILL.md, reference/ and a skill's root docs alike), except below a fixtures/, assets/ or
// scripts/ directory. It looks only inside shell snippets, the way inline-writes finds its units:
//   - a fenced code block (``` or ~~~) whose info string is a shell language (none/bare, sh, bash,
//     shell, zsh, console, shell-session, shellscript); a non-shell block (```python, ```json, …)
//     is ignored; and
//   - an inline backtick span on a prose line.
// Inside a shell snippet a finding is either
//   - a long sleep: `sleep <n>` with n greater than the threshold (default 60 s, `--max-seconds`);
//     or
//   - a poll loop: a `while`/`until` loop with a `sleep` in it (`while … sleep`) — any duration,
//     because the loop is the blind wait.
// Prose outside a shell snippet is never scanned, so a sentence that says "never a `sleep`" or
// "wait, never `while … sleep`" stays clean. A line carrying `<!-- lint: allow-sleep -->` on the
// line just above it — or, for a fenced block, just above the opening fence — is allowed.
//
// Usage: node plugins/stardust/evals/lint/inline-sleeps.mjs [--root <skills-dir>] [--max-seconds <n>]
//   --root <dir>         scan this skills directory instead of plugins/stardust/skills (for tests);
//                        every .md below it, skipping fixtures/, assets/ and scripts/ directories
//   --max-seconds <n>    flag a bare `sleep <n>` only above this many seconds (default 60)
//   -h, --help           print this text
// Output: clean → `inline-sleeps lint: <n> files clean` on stdout. Findings → stderr, a count line,
//   then per finding `<file>:<line>: <reason> (<snippet>) — wait on the instrument instead …` at the
//   sleep's line (file relative to the cwd), files sorted, lines ascending.
// Exit: 0 clean, 1 findings, 2 usage error (unknown argument, --root not a directory, bad --max-seconds).
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = join(dirname(SELF), '..', '..', 'skills');
const DEFAULT_MAX_SECONDS = 60;

const FENCE = /^\s*(`{3,}|~{3,})/;
const NEW_UNIT = /^\s*(?:[-*+]|\d+\.)(?:\s|$)|^\s{0,3}#/;
const closesFence = (line, fence) => new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`).test(line);
// The info string is the first token after the opening fence; a bare fence has none.
const infoString = (line) => line.replace(/^\s*(?:`{3,}|~{3,})/, '').trim().split(/\s+/)[0].toLowerCase();
const SHELL_LANGS = new Set(['', 'sh', 'bash', 'shell', 'shellscript', 'shell-session', 'shellsession', 'sh-session', 'console', 'zsh']);

export const SLEEP_N = /\bsleep\s+(\d+)/;   // a bare sleep with a numeric duration
const SLEEP_TOKEN = /\bsleep\b/;            // a sleep call of any duration (poll loops)
const LOOP = /\b(?:while|until)\b/;         // a condition-driven (blind-poll) loop
const ALLOW = /<!--\s*lint:\s*allow-sleep\s*-->/;
const INLINE_SPAN = /`([^`]+)`/g;

const show = (s) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > 60 ? `${t.slice(0, 59)}…` : t; };

// Split the doc into units exactly as inline-writes does: a fenced code block is one unit (fence to
// fence); outside fences a paragraph is one, a list item or heading starting a new one.
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
    if (f) { flush(); fence = f[1]; cur = { first: i, lines: [line], fenced: true }; return; }
    if (!line.trim()) { flush(); return; }
    if (!cur || NEW_UNIT.test(line)) { flush(); cur = { first: i, lines: [] }; }
    cur.lines.push(line);
  });
  flush();
  return units;
}

// A shell snippet is scanned here; returns findings {offset, snippet, reason} keyed to the snippet's
// own lines (offset = 0-based line within the snippet). maxSeconds gates the long-sleep case. The
// poll shape needs the loop body keyword `do` as well as `while`/`until`, so prose that merely spells
// out the forbidden pattern (`while … sleep`, no `do`) is not mistaken for a real loop.
const DO = /\bdo\b/;
function scanSnippet(lines, maxSeconds) {
  const found = [];
  const pollShape = LOOP.test(lines.join('\n')) && DO.test(lines.join('\n'));
  let loopAt = -1;
  lines.forEach((line, k) => {
    if (loopAt < 0 && LOOP.test(line)) loopAt = k;
    const long = SLEEP_N.exec(line);
    if (long && Number(long[1]) > maxSeconds) { found.push({ offset: k, snippet: long[0], reason: 'a shell snippet waits with a long sleep' }); return; }
    if (pollShape && loopAt >= 0 && SLEEP_TOKEN.test(line)) {
      const s = SLEEP_N.exec(line) || SLEEP_TOKEN.exec(line);
      found.push({ offset: k, snippet: `while … ${s[0]}`, reason: 'a shell snippet polls with sleep' });
    }
  });
  return found;
}

// One finding per offending sleep, at its line; prose and non-shell blocks are skipped, and an
// allow marker on the line above the sleep (or above a block's opening fence) suppresses it.
export function scanText(text, maxSeconds = DEFAULT_MAX_SECONDS) {
  const lines = text.split('\n');
  const hasAllowAbove = (oneBasedLine) => oneBasedLine >= 2 && ALLOW.test(lines[oneBasedLine - 2]);
  const findings = [];
  for (const u of splitUnits(text)) {
    if (u.fenced) {
      if (!SHELL_LANGS.has(infoString(u.lines[0]))) continue;
      const fenceLine = u.first + 1;
      const inner = u.lines.map((l, k) => ({ l, k })).filter(({ l, k }) => k > 0 && !closesFence(l, u.lines[0].match(FENCE)[1]));
      for (const f of scanSnippet(inner.map((x) => x.l), maxSeconds)) {
        const line = u.first + inner[f.offset].k + 1;
        if (hasAllowAbove(line) || hasAllowAbove(fenceLine)) continue;
        findings.push({ line, snippet: show(f.snippet), reason: f.reason });
      }
      continue;
    }
    u.lines.forEach((line, k) => {
      const spans = [];
      let m;
      INLINE_SPAN.lastIndex = 0;
      while ((m = INLINE_SPAN.exec(line))) spans.push(m[1]);
      if (!spans.length) return;
      for (const f of scanSnippet(spans, maxSeconds)) {
        const at = u.first + k + 1;
        if (hasAllowAbove(at)) continue;
        findings.push({ line: at, snippet: show(f.snippet), reason: f.reason });
      }
    });
  }
  return findings.sort((a, b) => a.line - b.line);
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

const TAIL = 'wait on the instrument instead (run-bg.mjs wait for jobs, progress.mjs wait for units; both wake early via the wake file), never a bare sleep';

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(help()); return 0; }
  const usage = (msg) => { console.error(`inline-sleeps lint: ${msg} (see --help)`); return 2; };
  let root = DEFAULT_ROOT;
  let maxSeconds = DEFAULT_MAX_SECONDS;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') {
      if (i + 1 >= argv.length) return usage('--root needs a directory');
      root = resolve(argv[i += 1]);
    } else if (argv[i] === '--max-seconds') {
      if (i + 1 >= argv.length) return usage('--max-seconds needs a number');
      const n = Number(argv[i += 1]);
      if (!Number.isInteger(n) || n < 0) return usage(`--max-seconds ${argv[i]} is not a non-negative integer`);
      maxSeconds = n;
    } else {
      return usage(`unknown argument ${argv[i]}`);
    }
  }
  let isDir = false;
  try { isDir = statSync(root).isDirectory(); } catch { /* reported below */ }
  if (!isDir) return usage(`--root ${root} is not a directory`);
  // The cwd is a real path; a symlinked root (a temp dir on macOS) would print ../-laden paths.
  const files = collect(realpathSync(root));
  const findings = [];
  for (const f of files) {
    for (const x of scanText(readFileSync(f, 'utf8'), maxSeconds)) {
      findings.push(`${relative(process.cwd(), f)}:${x.line}: ${x.reason} (${x.snippet}) — ${TAIL}`);
    }
  }
  if (findings.length) { console.error(`inline-sleeps lint: ${findings.length} finding(s)\n${findings.join('\n')}`); return 1; }
  console.log(`inline-sleeps lint: ${files.length} files clean`);
  return 0;
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && safeRealpath(SELF) === safeRealpath(process.argv[1])) process.exitCode = main(process.argv.slice(2));
