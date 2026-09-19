#!/usr/bin/env node
// Guard: every plugin-internal script or reference path a stardust skill doc
// names must exist in the plugin tree — and, with --installed, every
// impeccable path or command a doc cites must exist in an impeccable checkout.
//
// Why: skill text drifts from the scripts it drives. Field runs (2026-08/09)
// hit the same renamed loader three releases in a row and a gate example that
// pointed at a script living in a sibling skill; each cost an agent a probe,
// a wrong conclusion ("not installed") and a re-read of the doc. Paths are
// checkable — so check them. Cross-plugin: four projects / five sessions paid
// 2–3 rediscovery calls each for impeccable paths that had moved between
// releases (`load-context.mjs`, `teach.md`, the 4.1 → 4.3 launcher swap);
// this repo has no way to see that drift without looking at impeccable's tree.
//
// Internal pass (default) — checked forms (project copies such as
// `stardust/scripts/…` are out of scope):
//   skills/<skill>/scripts/<file>       ../../<skill>/scripts/<file>
//   skills/<skill>/reference/<file>.md  ../<skill>/reference/<file>.md
// (a bare `reference/<file>.md` is not checked: docs use it for sibling and
// impeccable references without a skill prefix, so it cannot be resolved)
//
// Cross-plugin pass (--installed <impeccable-skill-dir>) — checked forms:
//   impeccable's `reference/<x>.md` [and `reference/<y>.md`]  → <dir>/reference/<x>.md
//   scripts/command-metadata.json                            → <dir>/scripts/command-metadata.json
//   scripts/impeccable <sub>  (inside code only)             → <dir>/scripts/impeccable, and <sub>
//                                                              a registry key or launcher verb
//   $impeccable <cmd>         (inside code only)             → <cmd> a registry key or verb
//   npx impeccable <sub>      (inside code only)             → a finding: the npm shim
//                                                              (cli/bin/cli.js) execs the SAME
//                                                              engine but at the npm package's
//                                                              version, not this install's; the
//                                                              message says whether <sub> is a verb
// Launcher verbs are never a hard-coded list: they are the verbs the install's
// own docs (SKILL.md, reference/*.md) cite after `scripts/impeccable` — 22 in
// 4.3.1, from `hooks` to `live-poll` — plus the legacy per-verb scripts
// (4.1: scripts/<verb>.mjs). The three command forms — and the verb scan —
// are read from code only (backtick spans, fenced and indented blocks; a
// stray backtick is a literal, never an opener): "the launcher
// scripts/impeccable resolves the engine" is prose, not a cite, and must
// not yield a verb.
// `--installed` with no value resolves the Claude Code registry's install
// (installed_plugins.json → installPath/skills/impeccable). In CI use a
// checkout of pbakaus/impeccable and pass its `skill/` directory.
// `--docs <dir>` walks that tree instead of skills/ (fixture testing).
// A line containing `script-paths: ignore` is skipped (for genuinely
// hypothetical paths — say so in the line).
//
// Usage: node plugins/stardust/evals/lint/script-paths.mjs                  (exit 1 on findings)
//        node plugins/stardust/evals/lint/script-paths.mjs --installed [<dir>] [--strict] [--docs <dir>]
//                                                          (exit 0 with findings printed as warnings;
//                                                           --strict → exit 1; exit 2 = no install dir)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import os from 'node:os';

const HELP = `usage: node script-paths.mjs [--installed [<impeccable-skill-dir>]] [--strict] [--docs <dir>] [--help]
  (no flags)          internal pass: plugin-internal script/reference paths resolve   exit 1 on findings
  --installed [<dir>] cross-plugin pass: impeccable cites resolve against <dir>       exit 0, findings as warnings
                      (<dir> omitted → Claude Code registry install)                  exit 2 = no dir found
  --strict            with --installed: exit 1 on findings (release checklist)
  --docs <dir>        walk <dir> instead of skills/ (fixtures)`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) { console.log(HELP); process.exit(0); }
const val = (n) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null; };
const INSTALLED = args.includes('--installed');
const STRICT = args.includes('--strict');
const ROOT = val('--docs') ? resolve(val('--docs')) : join(import.meta.dirname, '..', '..', 'skills');
const SKILLS = join(import.meta.dirname, '..', '..', 'skills');
const files = [];
(function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.md') && !p.endsWith('IMPROVEMENTS.md')) files.push(p); } })(ROOT);
const rel = (p) => relative(process.cwd(), p);

if (INSTALLED) crossPlugin(); else internal();

function internal() {
  const SKILL = '[a-z][a-z0-9-]*';
  const FILE = '[A-Za-z0-9_.-]+';
  const PATTERNS = [
    { re: new RegExp(`skills/(${SKILL})/scripts/(${FILE}\\.(?:mjs|js|sh|py|json))`, 'g'), to: (m) => `${m[1]}/scripts/${m[2]}` },
    { re: new RegExp(`\\.\\./\\.\\./(${SKILL})/scripts/(${FILE}\\.(?:mjs|js|sh|py|json))`, 'g'), to: (m) => `${m[1]}/scripts/${m[2]}` },
    { re: new RegExp(`skills/(${SKILL})/reference/(${FILE}\\.md)`, 'g'), to: (m) => `${m[1]}/reference/${m[2]}` },
    { re: new RegExp(`(?<![./])\\.\\./(${SKILL})/reference/(${FILE}\\.md)`, 'g'), to: (m) => `${m[1]}/reference/${m[2]}` },
  ];
  const SKIP_SKILLS = new Set(['impeccable']); // impeccable's tree is the --installed pass's job

  const findings = [];
  let checked = 0;
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (line.includes('script-paths: ignore')) return;
      for (const { re, to } of PATTERNS) {
        for (const m of line.matchAll(re)) {
          const r = to(m);
          if (SKIP_SKILLS.has(r.split('/')[0])) continue;
          checked += 1;
          if (!existsSync(join(SKILLS, r))) findings.push(`${rel(f)}:${i + 1}: ${m[0]} → skills/${r} does not exist`);
        }
      }
    });
  }
  const uniq = [...new Set(findings)];
  if (uniq.length) { console.error(`script-paths lint: ${uniq.length} dangling reference(s) in ${files.length} files\n${uniq.join('\n')}`); process.exit(1); }
  console.log(`script-paths lint: ${files.length} files, ${checked} references resolve`);
}

function registryInstall() {
  const home = process.env.CLAUDE_CONFIG_DIR || join(os.homedir(), '.claude');
  let reg; try { reg = JSON.parse(readFileSync(join(home, 'plugins', 'installed_plugins.json'), 'utf8')); } catch { return null; }
  for (const [key, entry] of Object.entries(reg?.plugins || {})) {
    if (!key.startsWith('impeccable@')) continue;
    const list = Array.isArray(entry) ? entry : [entry];
    const pick = list.find((e) => e?.scope === 'user') || list[0];
    if (pick?.installPath) return join(pick.installPath, 'skills', 'impeccable');
  }
  return null;
}

function crossPlugin() {
  const dir = val('--installed') ? resolve(val('--installed')) : registryInstall();
  if (!dir || !existsSync(dir)) { console.error(`script-paths --installed: no impeccable skill directory (${dir || 'none in installed_plugins.json'}) — pass --installed <dir>`); process.exit(2); }
  let registry = null;
  try { const j = JSON.parse(readFileSync(join(dir, 'scripts', 'command-metadata.json'), 'utf8')); if (j && typeof j === 'object' && !Array.isArray(j)) registry = new Set(Object.keys(j)); } catch { /* reported per cite */ }
  const has = (r) => existsSync(join(dir, r));
  const verbs = launcherVerbs(dir);
  const hasLauncher = has('scripts/impeccable');
  const knownCmd = (c) => (registry ? registry.has(c) : true) || verbs.has(c);
  const verbNote = `(${verbs.size} verbs named by the install's own docs and scripts)`;
  const FILE = '[A-Za-z0-9_.-]+\\.md';
  // [regex, finding(match) → messages]; TEXT checks run over the whole file, CODE checks over code segments only
  const TEXT_CHECKS = [
    [new RegExp(`impeccable'?s\\s+\`reference/(${FILE})\`(?:,?\\s+(?:and|or)\\s+\`reference/(${FILE})\`)?`, 'g'),
      (m) => [m[1], m[2]].filter(Boolean).filter((x) => !has(`reference/${x}`)).map((x) => `impeccable's reference/${x} does not exist in ${dir}`)],
    [/scripts\/command-metadata\.json/g, () => (has('scripts/command-metadata.json') ? [] : [`scripts/command-metadata.json does not exist in ${dir}`])],
  ];
  const CODE_CHECKS = [
    // a missing launcher is the finding; its verbs belong to the launcher that is not there
    [/scripts\/impeccable["']?\s+([a-z][a-z-]*)/g,
      (m) => (!hasLauncher ? [`scripts/impeccable launcher does not exist in ${dir} (older install: scripts/hook-admin.mjs)`]
        : knownCmd(m[1]) ? [] : [`scripts/impeccable ${m[1]}: "${m[1]}" is neither a registry command nor a launcher verb ${verbNote}`])],
    [/\$impeccable\s+([a-z][a-z-]*)/g, (m) => (knownCmd(m[1]) ? [] : [`$impeccable ${m[1]}: "${m[1]}" is not in ${dir}/scripts/command-metadata.json ${verbNote}`])],
    [/npx\s+impeccable(?:\s+([a-z][a-z-]*))?/g,
      (m) => [`\`npx impeccable\` is the npm shim of the same engine — it fetches the npm package's engine, not this install's${m[1] ? (knownCmd(m[1]) ? ` (${m[1]} is a verb)` : `, and "${m[1]}" is not a verb the install names ${verbNote}`) : ''}; cite \`"<state.json#impeccable.skillDir>/scripts/impeccable" <sub>\``]],
  ];
  const findings = [];
  let checked = 0;
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const lineOf = (idx) => text.slice(0, idx).split('\n').length;
    const lines = text.split('\n');
    const record = (m, ln, check) => {
      if (lines[ln - 1].includes('script-paths: ignore')) return;
      checked += 1;
      for (const msg of check(m)) findings.push({ file: rel(f), line: ln, msg: `${m[0].replace(/\s+/g, ' ')} → ${msg}` });
    };
    for (const [re, check] of TEXT_CHECKS) for (const m of text.matchAll(re)) record(m, lineOf(m.index), check);
    for (const seg of codeSegments(text)) for (const [re, check] of CODE_CHECKS) for (const m of seg.text.matchAll(re)) record(m, seg.line, check);
  }
  const uniq = [...new Map(findings.map((x) => [`${x.file}:${x.line}:${x.msg}`, x])).values()];
  const head = `script-paths --installed: ${files.length} files, ${checked} impeccable cites checked against ${dir} (${registry ? `${registry.size} registry commands` : 'no registry'}, ${verbs.size} launcher verbs)`;
  if (!uniq.length) { console.log(`${head} — all resolve`); return; }
  console.error(`${head} — ${uniq.length} drift finding(s)${STRICT ? '' : ' (advisory; --strict to fail)'}`);
  for (const x of uniq) {
    console.error(`${x.file}:${x.line}: ${x.msg}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning file=${x.file},line=${x.line}::impeccable drift: ${x.msg}`);
  }
  process.exit(STRICT ? 1 : 0);
}

// The verbs the launcher answers, read from the install itself: every `scripts/impeccable <verb>`
// (or the source template's `{{scripts_path}}/impeccable <verb>`) its own SKILL.md / reference/*.md
// cite IN CODE (backtick spans and fences — "the launcher scripts/impeccable\nresolves the engine"
// is prose and must not make "resolves" a verb), the `impeccable <verb>` entries of an upstream
// checkout's docs/CLI-CONTRACT.md when it sits beside the skill dir, plus legacy per-verb scripts
// (scripts/<verb>.mjs).
function launcherVerbs(dir) {
  const verbs = new Set();
  const docs = [join(dir, 'SKILL.md'), join(dir, 'SKILL.src.md')];
  try { for (const f of readdirSync(join(dir, 'reference'))) if (f.endsWith('.md')) docs.push(join(dir, 'reference', f)); } catch { /* no reference dir */ }
  for (const f of docs) {
    let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const seg of codeSegments(text)) for (const m of seg.text.matchAll(/(?:scripts|scripts_path\}\})\/impeccable["']?[ \t]+([a-z][a-z-]*)/g)) verbs.add(m[1]);
  }
  try {
    const contract = readFileSync(join(dir, '..', 'docs', 'CLI-CONTRACT.md'), 'utf8');
    for (const m of contract.matchAll(/`impeccable ([a-z][a-z|-]*)`/g)) for (const v of m[1].split('|')) verbs.add(v);
  } catch { /* not an upstream checkout */ }
  try { for (const f of readdirSync(join(dir, 'scripts'))) if (f.endsWith('.mjs')) verbs.add(f.slice(0, -4)); } catch { /* no scripts dir */ }
  return verbs;
}

// Backtick spans of one line, paired the CommonMark way: an opening run closes at the next run of
// the SAME length; a run with no partner is a literal backtick, not an opener. Returns the spans
// and the unmatched runs (as {index, len}) so a paragraph can decide whether a span wraps.
function lineSpans(text, from = 0) {
  const runs = [...text.slice(from).matchAll(/`+/g)].map((m) => ({ index: from + m.index, len: m[0].length }));
  const spans = [];
  const loose = [];
  for (let i = 0; i < runs.length; i += 1) {
    const j = runs.findIndex((r, k) => k > i && r.len === runs[i].len);
    if (j < 0) { loose.push(runs[i]); continue; }
    spans.push(text.slice(runs[i].index + runs[i].len, runs[j].index));
    i = j;
  }
  return { spans, loose };
}

// Code segments of a markdown file, with the 1-based line each starts on: every line of a fenced
// block, every line of an indented code block (4 spaces / a tab after a blank line — a 4-space
// line that continues a paragraph or list item is prose), and each inline backtick span. Spans
// are paired line by line first; a span wraps onto the next line only when BOTH lines are left
// with an unpaired run of the same length, so a stray backtick in one line ("a ` typo") stays a
// literal instead of swallowing the next line's real span. Command cites live here; prose does not.
function codeSegments(text) {
  const out = [];
  let fence = false;
  let para = [];
  const flush = () => {
    let carry = null; // { len, line } — an unpaired run at the end of the previous line
    for (const { text: l, line } of para) {
      let from = 0;
      if (carry) {
        const first = l.match(/`+/);
        const { loose } = lineSpans(l);
        if (first && loose.length && first[0].length === carry.len) {
          out.push({ text: `${carry.tail}\n${l.slice(0, first.index)}`, line: carry.line });
          from = first.index + first[0].length;
        }
        carry = null;
      }
      const { spans, loose } = lineSpans(l, from);
      for (const sp of spans) out.push({ text: sp, line });
      const last = loose[loose.length - 1];
      if (last) carry = { len: last.len, line, tail: l.slice(last.index + last.len) };
    }
    para = [];
  };
  text.split('\n').forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) { flush(); fence = !fence; return; }
    if (fence) out.push({ text: l, line: i + 1 });
    else if (!l.trim()) flush();
    else if (!para.length && /^(?: {4,}|\t)/.test(l)) out.push({ text: l, line: i + 1 });
    else para.push({ text: l, line: i + 1 });
  });
  flush();
  return out;
}
