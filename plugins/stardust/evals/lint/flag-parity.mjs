#!/usr/bin/env node
// Guard: every `--flag` a stardust skill doc passes to one of its scripts has a
// case in that script's argument parser, and a documented default matches the
// parser's default.
//
// Why: flag lists drift from the parsers they describe. The 2026-08 harvest
// found documented flags with no parser case (`--refresh`, `--force` on
// crawl.mjs) and a documented default page cap that was a fifth of the code's;
// each cost a run an "unknown arg" abort or a five-fold larger crawl than the
// user read about. Flags are checkable — so check them.
//
// Checked forms:
//   * a doc line (or a fenced ```-block command with `\` continuations) that
//     invokes `<script>.mjs` — every `--flag` token after the script name must
//     appear in the script's non-comment source as `--x` or as the bare string
//     `'x'` (the evidence every parser style leaves: `=== '--x'`, `arg('x')`,
//     `VALUE_FLAGS.has(…)`). A flag the script never names anywhere is the
//     drift this catches; a flag only named in its help text is not.
//     `--x=mode` counts as `--x`; flags before the first script name on a line
//     are unattributed.
//   * DEFAULTS below: a numeric default the parser sets vs the number the
//     owning SKILL.md quotes for it.
// A line containing `flag-parity: ignore` is skipped (say why in the line).
//
// Usage: node plugins/stardust/evals/lint/flag-parity.mjs  (exit 1 on findings)
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', 'skills');
const rel = (p) => relative(process.cwd(), p);

// numeric defaults the docs quote — `pick` reads the parser, `doc` the prose
const DEFAULTS = [
  { script: 'extract/scripts/crawl.mjs', pick: /\bmax: (\d+)\b/, doc: 'extract/SKILL.md', re: /default (\d+)(?:-page| pages)\b/g, label: 'default page cap' },
];

const scripts = []; // { skill, name, path, tokens:Set<'--x'>, bare:Set<'x'> }
const docs = [];
for (const skill of readdirSync(ROOT)) {
  const dir = join(ROOT, skill);
  if (!statSync(dir).isDirectory()) continue;
  const sdir = join(dir, 'scripts');
  if (existsSync(sdir)) {
    for (const f of readdirSync(sdir)) {
      if (!f.endsWith('.mjs')) continue;
      const src = readFileSync(join(sdir, f), 'utf8');
      // parsers differ (explicit `=== '--x'` cases, `arg('x')` helpers over
      // `indexOf(\`--${name}\`)`, `VALUE_FLAGS.has(a.slice(2))` sets) — the static
      // evidence common to all of them is the flag's name as a string in the
      // source: `--x` or the bare `'x'`, on a non-comment line.
      const tokens = new Set();
      const bare = new Set();
      for (const line of src.split('\n')) {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        for (const m of line.matchAll(/(?<![\w-])(--[a-z][a-z0-9-]*)/g)) tokens.add(m[1]);
        for (const m of line.matchAll(/['"]([a-z][a-z0-9-]*)['"]/g)) bare.add(m[1]);
      }
      scripts.push({ skill, name: f, path: join(sdir, f), tokens, bare });
    }
  }
  const md = [join(dir, 'SKILL.md'), ...(existsSync(join(dir, 'reference')) ? readdirSync(join(dir, 'reference')).filter((f) => f.endsWith('.md')).map((f) => join(dir, 'reference', f)) : [])];
  for (const f of md) if (existsSync(f)) docs.push({ skill, path: f });
}
const byName = new Map();
for (const s of scripts) byName.set(s.name, [...(byName.get(s.name) || []), s]);

// Flags implemented by a shared helper the script calls (the flag name lives in
// live-session.mjs, not in the calling script's source).
const SHARED_HELPERS = [
  [/resolveSiteAuth\(|resolveAuthHeader\(/, ['--auth-header', '--token-env']],
  [/parseHeadedFlag\(/, ['--headed']],
];
// TEMPORARY — shrink per release. Key `<doc relative to skills/>:<flag>:<script>`;
// value: why it is allowed today. An entry that no longer suppresses anything
// is reported as stale and fails the lint.
const TEMPORARY_ALLOWLIST = {
  // empty — every documented flag has a parser case; entries added here must shrink per release
};

// Attribute each `--flag` to the script named in the SAME inline-code span
// (`node a.mjs --x`) or the same fenced command, nearest mention before the
// flag. Prose flags outside a span with a script name are not attributed.
const SCRIPT_RE = /(?:([a-z][a-z0-9-]*)\/scripts\/)?([A-Za-z0-9_.-]+\.mjs)\b/g;
const FLAG_RE = /(?<![\w-])(--[a-z][a-z0-9-]*)/g;
function pick(m, docSkill) {
  const cands = byName.get(m[2]);
  if (!cands) return null;
  return (m[1] && cands.find((c) => c.skill === m[1])) || (cands.length === 1 ? cands[0] : cands.find((c) => c.skill === docSkill))
    || { name: m[2], tokens: new Set(cands.flatMap((c) => [...c.tokens])), bare: new Set(cands.flatMap((c) => [...c.bare])), union: true };
}
function attribute(span, docSkill) {
  const marks = [...span.matchAll(SCRIPT_RE)].map((m) => ({ at: m.index, script: pick(m, docSkill) })).filter((x) => x.script);
  const pairs = [];
  for (const f of span.matchAll(FLAG_RE)) {
    const owner = marks.filter((x) => x.at < f.index).at(-1);
    if (owner) pairs.push({ script: owner.script, flag: f[1] });
  }
  return pairs;
}
const spansOf = (line, fenced) => (fenced ? [line] : [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
function accepts(s, flag) {
  if (s.tokens.has(flag) || s.bare.has(flag.slice(2))) return true;
  const src = s.union ? '' : readFileSync(s.path, 'utf8');
  return SHARED_HELPERS.some(([re, flags]) => flags.includes(flag) && re.test(src));
}

const findings = [];
const used = new Set();
let checked = 0;
for (const { skill, path } of docs) {
  const lines = readFileSync(path, 'utf8').split('\n');
  let fenced = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (line.includes('flag-parity: ignore') || !/\.mjs\b/.test(line)) continue;
    // inside a fence a command may continue over `\`-terminated lines
    let cmd = line;
    let j = i;
    while (fenced && /\\\s*$/.test(lines[j]) && j + 1 < lines.length) { j += 1; cmd += ` ${lines[j]}`; }
    const seen = new Set();
    for (const span of spansOf(cmd, fenced)) {
      for (const { script, flag } of attribute(span, skill)) {
        const key = `${script.path || script.name}\u0000${flag}`;
        if (seen.has(key)) continue;
        seen.add(key);
        checked += 1;
        if (accepts(script, flag)) continue;
        const allow = `${relative(ROOT, path)}:${flag}:${script.name}`;
        if (TEMPORARY_ALLOWLIST[allow]) { used.add(allow); continue; }
        findings.push(`${rel(path)}:${i + 1}: ${flag} is not a parser case in ${script.union ? `any ${script.name}` : rel(script.path)}`);
      }
    }
  }
}
for (const k of Object.keys(TEMPORARY_ALLOWLIST)) if (!used.has(k)) findings.push(`stale TEMPORARY_ALLOWLIST entry "${k}" — remove it`);
for (const d of DEFAULTS) {
  const src = readFileSync(join(ROOT, d.script), 'utf8');
  const code = (src.match(d.pick) || [])[1];
  if (!code) { findings.push(`${d.script}: cannot read the ${d.label} (${d.pick})`); continue; }
  const docPath = join(ROOT, d.doc);
  readFileSync(docPath, 'utf8').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(d.re)) {
      checked += 1;
      if (m[1] !== code) findings.push(`${rel(docPath)}:${i + 1}: ${d.label} reads ${m[1]} but ${d.script} sets ${code} (D6: the doc follows the code)`);
    }
  });
}
const uniq = [...new Set(findings)];
if (uniq.length) { console.error(`flag-parity lint: ${uniq.length} finding(s) across ${docs.length} docs / ${scripts.length} scripts\n${uniq.join('\n')}`); process.exit(1); }
console.log(`flag-parity lint: ${docs.length} docs, ${scripts.length} scripts, ${checked} flag references resolve`);
