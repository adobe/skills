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
//   scripts/impeccable <sub>  (code span continues)          → <dir>/scripts/impeccable, and <sub>
//                                                              a registry key or launcher verb
//   $impeccable <cmd>                                        → <cmd> a registry key
//   npx impeccable …                                         → always a finding: the installed
//                                                              skill ships no npm form; cite
//                                                              "<skillDir>/scripts/impeccable" <sub>
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
  // verbs the 4.3 launcher answers that the registry does not list
  const LAUNCHER_VERBS = new Set(['detect', 'context', 'hooks', 'doctor', 'engine-probe', 'help', 'version']);
  const has = (r) => existsSync(join(dir, r));
  const knownCmd = (c) => (registry ? registry.has(c) : true) || LAUNCHER_VERBS.has(c);
  const FILE = '[A-Za-z0-9_.-]+\\.md';
  // [regex over the whole file, finding(match) → message | null]
  const CHECKS = [
    [new RegExp(`impeccable'?s\\s+\`reference/(${FILE})\`(?:,?\\s+(?:and|or)\\s+\`reference/(${FILE})\`)?`, 'g'),
      (m) => [m[1], m[2]].filter(Boolean).filter((x) => !has(`reference/${x}`)).map((x) => `impeccable's reference/${x} does not exist in ${dir}`)],
    [/scripts\/command-metadata\.json/g, () => (has('scripts/command-metadata.json') ? [] : [`scripts/command-metadata.json does not exist in ${dir}`])],
    [/scripts\/impeccable(?!`)["']?\s+([a-z][a-z-]*)/g,
      (m) => [...(has('scripts/impeccable') ? [] : [`scripts/impeccable launcher does not exist in ${dir} (older install: scripts/hook-admin.mjs)`]),
        ...(knownCmd(m[1]) ? [] : [`scripts/impeccable ${m[1]}: "${m[1]}" is neither a registry command nor a launcher verb`])]],
    [/\$impeccable\s+([a-z][a-z-]*)/g, (m) => (knownCmd(m[1]) ? [] : [`$impeccable ${m[1]}: "${m[1]}" is not in ${dir}/scripts/command-metadata.json`])],
    [/npx\s+impeccable\b/g, () => ['`npx impeccable …` is not a form the installed skill ships — cite `"<state.json#impeccable.skillDir>/scripts/impeccable" <sub>`']],
  ];
  const findings = [];
  let checked = 0;
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const lineOf = (idx) => text.slice(0, idx).split('\n').length;
    const lines = text.split('\n');
    for (const [re, check] of CHECKS) {
      for (const m of text.matchAll(re)) {
        const ln = lineOf(m.index);
        if (lines[ln - 1].includes('script-paths: ignore')) continue;
        checked += 1;
        for (const msg of check(m)) findings.push({ file: rel(f), line: ln, msg: `${m[0].replace(/\s+/g, ' ')} → ${msg}` });
      }
    }
  }
  const uniq = [...new Map(findings.map((x) => [`${x.file}:${x.line}:${x.msg}`, x])).values()];
  const head = `script-paths --installed: ${files.length} files, ${checked} impeccable cites checked against ${dir}${registry ? ` (${registry.size} registry commands)` : ' (no registry)'}`;
  if (!uniq.length) { console.log(`${head} — all resolve`); return; }
  console.error(`${head} — ${uniq.length} drift finding(s)${STRICT ? '' : ' (advisory; --strict to fail)'}`);
  for (const x of uniq) {
    console.error(`${x.file}:${x.line}: ${x.msg}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning file=${x.file},line=${x.line}::impeccable drift: ${x.msg}`);
  }
  process.exit(STRICT ? 1 : 0);
}
