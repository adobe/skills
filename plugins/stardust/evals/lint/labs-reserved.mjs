#!/usr/bin/env node
// Guard: no stardust skill text or script names a file of its own under stardust/.labs/.
//
// Why: stardust/.labs/ is the runner's directory — it writes run.json there, appends wake, and the
// skills only read those (progress.mjs, run-bg.mjs, presence.mjs seed). In recorded standalone runs
// agents put their scratch there — page lists, probe scripts, CSS dumps — harmless until the runner
// treats the directory as its own. A session's scratch goes to stardust/.work/<skill>/ (master skill
// § Artifacts, the write boundary); a doc or script that names another .labs/ path teaches the
// collision, and that is checkable.
//
// What it checks: every .md under plugins/stardust/skills/ except below a fixtures/, assets/ or
// scripts/ directory (the inline-writes file set), and every .mjs/.js under skills/*/scripts/ except
// below test/. Each `stardust/.labs/<name>` token is a finding unless <name> is one of the runner's
// files (wake, run.json, boundary-request.json) or absent — the directory named as such, as the
// reservation sentence does.
//
// Usage: node plugins/stardust/evals/lint/labs-reserved.mjs [--root <skills-dir>]
//   --root <dir>  scan this skills directory instead of plugins/stardust/skills (for tests)
//   -h, --help    print this text
// Output: clean → `labs-reserved lint: <n> files clean` on stdout. Findings → stderr, a count line,
//   then per token `<file>:<line>: stardust/.labs/<name> — the runner's directory; a session's scratch
//   goes to stardust/.work/<skill>/` (file relative to the cwd), files sorted, lines ascending.
// Exit: 0 clean, 1 findings, 2 usage error (unknown argument, --root not a directory).
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = join(dirname(SELF), '..', '..', 'skills');

// The runner's own files under stardust/.labs/ — the only names a skill may spell out.
export const RUNNER_FILES = ['wake', 'run.json', 'boundary-request.json'];
const TOKEN = /stardust\/\.labs\/([A-Za-z0-9_.<>-]*)/g;

/** Every token naming a file of its own under stardust/.labs/: [{ line, name }], lines ascending. */
export function scanText(text) {
  const findings = [];
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(TOKEN)) {
      const name = m[1];
      if (!name || RUNNER_FILES.includes(name)) continue;
      findings.push({ line: i + 1, name });
    }
  });
  return findings;
}

// Test fixtures, vendored assets and script trees are not skill docs; scripts are walked separately.
const SKIP_DIRS = new Set(['fixtures', 'assets', 'scripts']);

function collect(root) {
  const files = [];
  (function docs(d) {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(e)) docs(p); } else if (e.endsWith('.md')) files.push(p);
    }
  })(root);
  for (const skill of readdirSync(root).sort()) {
    const dir = join(root, skill, 'scripts');
    let isDir = false;
    try { isDir = statSync(dir).isDirectory(); } catch { /* no scripts */ }
    if (!isDir) continue;
    (function code(d) {
      for (const e of readdirSync(d).sort()) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) { if (e !== 'test' && e !== 'node_modules') code(p); } else if (/\.(mjs|js)$/.test(e)) files.push(p);
      }
    })(dir);
  }
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
  const usage = (msg) => { console.error(`labs-reserved lint: ${msg} (see --help)`); return 2; };
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
  const files = collect(realpathSync(root));
  const findings = [];
  for (const f of files) {
    if (f === SELF) continue;
    for (const x of scanText(readFileSync(f, 'utf8'))) {
      findings.push(`${relative(process.cwd(), f)}:${x.line}: stardust/.labs/${x.name} — the runner's directory; a session's scratch goes to stardust/.work/<skill>/`);
    }
  }
  if (findings.length) { console.error(`labs-reserved lint: ${findings.length} finding(s)\n${findings.join('\n')}`); return 1; }
  console.log(`labs-reserved lint: ${files.length} files clean`);
  return 0;
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && safeRealpath(SELF) === safeRealpath(process.argv[1])) process.exitCode = main(process.argv.slice(2));
