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
//   * the same with the script named WITHOUT its .mjs token — `chrome-parity
//     --open <sel>`, `update-coverage --from-ledger` — a bare basename of a
//     skills/*/scripts/*.mjs file that OPENS the code span (or the fenced
//     command; an optional `node`/`npx`/`$` before it) and is followed by an
//     argument attributes the flags after it. Only the command position counts:
//     many basenames are ordinary words (plan, verify, inventory, progress,
//     anchor) that prose and tree diagrams use freely, and a basename that is
//     also a skill name (`qa`) is never attributed bare — `$stardust qa …` is
//     the skill. The 2026-09 B2 close found six documented flags that no
//     parser had, every one written without .mjs and every one span-initial.
//   * a lint RULE ID a doc names in backticks (`D-CONST`, `D14-OPTIONS`,
//     `ICON-MISSING` — ALL-CAPS, hyphenated) on a line that talks about a lint,
//     a finding or a rule id, or names a script (`.mjs`, or a span-initial bare
//     command) must be a string some skills/*/scripts source emits (a literal
//     `'D1-EMPTY'`, or a `VEHICLE-${…}` template prefix). A rule only
//     "planned" in prose is a claim the reader acts on. A caps token on a plain
//     prose line (`YYYY-MM-DD`) is not checked.
//   * DEFAULTS below: a numeric default the parser sets vs the number the
//     owning SKILL.md quotes for it.
// Docs scanned: skills/<skill>/*.md and skills/<skill>/reference/*.md.
// A line containing `flag-parity: ignore` is skipped (say why in the line).
// CROSS_LANE_PENDING below suppresses a finding whose fix another lane has landed
// on its own branch (the file is out of this lane's scope); once that edit merges
// the entry no longer suppresses anything and FAILS as stale, like the
// allowlist — delete it in the merge. An entry never outlives its fix.
//
// Usage: node plugins/stardust/evals/lint/flag-parity.mjs [--docs <dir>]
//   exit 0 = every reference resolves; 1 = findings (or a stale allowlist/pending
//   entry); 2 = --docs is not an existing directory
//   --docs <dir>  scan that tree (same <skill>/*.md + <skill>/reference/*.md layout)
//                 instead of skills/ — the scripts still come from skills/ (fixture testing;
//                 evals/lint/flag-parity.test.mjs drives fixtures/flag-parity/)
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  // the leading comment block only — inline comments further down are not help text
  const header = [];
  for (const l of readFileSync(new URL(import.meta.url), 'utf8').split('\n')) {
    if (l.startsWith('#!')) continue;
    if (!l.startsWith('//')) break;
    header.push(l.replace(/^\/\/ ?/, ''));
  }
  console.log(header.join('\n'));
  process.exit(0);
}
const ROOT = join(import.meta.dirname, '..', '..', 'skills');
const docsArg = process.argv.indexOf('--docs');
const DOCS_ROOT = docsArg !== -1 && process.argv[docsArg + 1] ? process.argv[docsArg + 1] : ROOT;
if (!existsSync(DOCS_ROOT) || !statSync(DOCS_ROOT).isDirectory()) { console.error(`flag-parity: --docs needs an existing directory (got ${DOCS_ROOT})`); process.exit(2); }
const rel = (p) => relative(process.cwd(), p);

// numeric defaults the docs quote — `pick` reads the parser, `doc` the prose
const DEFAULTS = [
  { script: 'extract/scripts/crawl.mjs', pick: /\bmax: (\d+)\b/, doc: 'extract/SKILL.md', re: /default (\d+)(?:-page| pages)\b/g, label: 'default page cap' },
];

const scripts = []; // { skill, name, path, tokens:Set<'--x'>, bare:Set<'x'> }
const docs = [];
const RULE_IDS = new Set(); // 'D1-EMPTY', 'ICON-MISSING' — literals any script source emits
const RULE_PREFIXES = new Set(); // 'VEHICLE-' — template-built ids (`VEHICLE-${key}`)
const RULE_ID = /(?<![\w-])([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)+)(?![\w-])/g;
for (const skill of readdirSync(ROOT)) {
  const dir = join(ROOT, skill);
  if (!statSync(dir).isDirectory()) continue;
  const sdir = join(dir, 'scripts');
  if (existsSync(sdir)) {
    for (const f of readdirSync(sdir)) {
      if (/\.(mjs|js|sh)$/.test(f)) {
        for (const line of readFileSync(join(sdir, f), 'utf8').split('\n')) {
          if (/^\s*(\/\/|\*|\/\*|#)/.test(line)) continue;
          for (const m of line.matchAll(RULE_ID)) RULE_IDS.add(m[1]);
          for (const m of line.matchAll(/(?<![\w-])([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-)\$\{/g)) RULE_PREFIXES.add(m[1]);
        }
      }
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
}
for (const skill of readdirSync(DOCS_ROOT)) {
  const dir = join(DOCS_ROOT, skill);
  if (!statSync(dir).isDirectory()) continue;
  const md = [...readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => join(dir, f)), ...(existsSync(join(dir, 'reference')) ? readdirSync(join(dir, 'reference')).filter((f) => f.endsWith('.md')).map((f) => join(dir, 'reference', f)) : [])];
  for (const f of md) if (existsSync(f)) docs.push({ skill, path: f });
}
const byName = new Map();
for (const s of scripts) byName.set(s.name, [...(byName.get(s.name) || []), s]);
// bare basenames (`chrome-parity`, `update-coverage`) — a doc that names the
// script without .mjs still documents its flags, but only in command position:
// the name opens the span (after an optional `node`/`npx`/`$`) and an argument
// follows. A basename that is also a skill name (`qa`) is the skill, never the script.
const SKILL_NAMES = new Set(readdirSync(ROOT).filter((d) => statSync(join(ROOT, d)).isDirectory()));
const bareNames = [...byName.keys()].map((n) => n.slice(0, -4)).filter((n) => !SKILL_NAMES.has(n));
const BARE_CMD_RE = new RegExp(`^\\s*(?:(?:node|npx|\\$)\\s+)?(${bareNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=\\s+\\S)`);
const spansOf = (line, fenced) => (fenced ? [line] : [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
const bareCommand = (line, fenced) => spansOf(line, fenced).some((sp) => BARE_CMD_RE.test(sp));
const mentionsScript = (line, fenced) => /\.mjs\b/.test(line) || bareCommand(line, fenced);

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
// Findings whose fix (build the flag/rule, or delete the claim) another
// remediation lane has ALREADY landed on its branch, in a file this lane does not
// edit. Same key shape (`<doc>:<flag-or-rule>:<script or "rule">`); value: the
// landing commit and the edit. Suppressed while the claim stands on this branch;
// once the fix merges the entry is stale and fails — delete it in that merge.
// (A --docs fixture tree that reuses an entry's doc path is read as that doc.)
const CROSS_LANE_PENDING = {
  // empty at b2r-integration: every B2 cross-lane fix has merged (T30.1, T18.3/T18.4, T06.1)
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
  // a bare name counts only in a span that names no `.mjs` at all — `block-lint.mjs
  // blocks/ --styles` keeps its flags on block-lint, not on rollout's blocks.mjs —
  // and only in command position (BARE_CMD_RE): `make verify --x` names no script
  const marks = [...span.matchAll(SCRIPT_RE)].map((m) => ({ at: m.index, script: pick(m, docSkill) })).filter((x) => x.script);
  if (!marks.length) {
    const m = span.match(BARE_CMD_RE);
    const script = m && pick([m[0], undefined, `${m[1]}.mjs`], docSkill);
    if (script) marks.push({ at: m.index + m[0].length - m[1].length, script });
  }
  const pairs = [];
  for (const f of span.matchAll(FLAG_RE)) {
    const owner = marks.filter((x) => x.at < f.index).at(-1);
    if (owner) pairs.push({ script: owner.script, flag: f[1] });
  }
  return pairs;
}
function accepts(s, flag) {
  if (s.tokens.has(flag) || s.bare.has(flag.slice(2))) return true;
  const src = s.union ? '' : readFileSync(s.path, 'utf8');
  return SHARED_HELPERS.some(([re, flags]) => flags.includes(flag) && re.test(src));
}

const findings = [];
const used = new Set();
const pendingUsed = new Set();
let checked = 0;
const report = (allowKey, text) => {
  if (TEMPORARY_ALLOWLIST[allowKey]) { used.add(allowKey); return; }
  if (CROSS_LANE_PENDING[allowKey]) { pendingUsed.add(allowKey); return; }
  findings.push(text);
};
const ruleKnown = (id) => RULE_IDS.has(id) || [...RULE_PREFIXES].some((p) => id.startsWith(p));
const LINT_CONTEXT_RE = /\blint|\bfinding|\brule id|\.mjs\b/i;
for (const { skill, path } of docs) {
  const lines = readFileSync(path, 'utf8').split('\n');
  let fenced = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (line.includes('flag-parity: ignore')) continue;
    // rule ids: a backticked ALL-CAPS hyphenated id on a lint/finding/script line —
    // a prose line that happens to use a basename as a word (plan, inventory) is not one
    if (LINT_CONTEXT_RE.test(line) || bareCommand(line, fenced)) {
      for (const m of line.matchAll(/`([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)+)`/g)) {
        checked += 1;
        if (ruleKnown(m[1])) continue;
        report(`${relative(DOCS_ROOT, path)}:${m[1]}:rule`, `${rel(path)}:${i + 1}: rule id \`${m[1]}\` is emitted by no skills/*/scripts source — build the rule or delete the claim`);
      }
    }
    if (!mentionsScript(line, fenced)) continue;
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
        report(`${relative(DOCS_ROOT, path)}:${flag}:${script.name}`, `${rel(path)}:${i + 1}: ${flag} is not a parser case in ${script.union ? `any ${script.name}` : rel(script.path)}`);
      }
    }
  }
}
for (const k of Object.keys(TEMPORARY_ALLOWLIST)) if (!used.has(k)) findings.push(`stale TEMPORARY_ALLOWLIST entry "${k}" — remove it`);
// a pending entry whose doc is in the scanned tree but no longer needs it: the
// owning lane's edit has merged — the entry is stale and fails until deleted
for (const k of Object.keys(CROSS_LANE_PENDING)) if (!pendingUsed.has(k) && existsSync(join(DOCS_ROOT, k.split(':')[0]))) findings.push(`stale CROSS_LANE_PENDING entry "${k}" — its fix landed (${CROSS_LANE_PENDING[k]}); remove it`);
for (const d of DEFAULTS) {
  const src = readFileSync(join(ROOT, d.script), 'utf8');
  const code = (src.match(d.pick) || [])[1];
  if (!code) { findings.push(`${d.script}: cannot read the ${d.label} (${d.pick})`); continue; }
  const docPath = join(DOCS_ROOT, d.doc);
  if (!existsSync(docPath)) continue; // --docs fixture trees need not carry it
  readFileSync(docPath, 'utf8').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(d.re)) {
      checked += 1;
      if (m[1] !== code) findings.push(`${rel(docPath)}:${i + 1}: ${d.label} reads ${m[1]} but ${d.script} sets ${code} (D6: the doc follows the code)`);
    }
  });
}
const uniq = [...new Set(findings)];
if (uniq.length) { console.error(`flag-parity lint: ${uniq.length} finding(s) across ${docs.length} docs / ${scripts.length} scripts\n${uniq.join('\n')}`); process.exit(1); }
console.log(`flag-parity lint: ${docs.length} docs, ${scripts.length} scripts, ${checked} flag/rule-id references resolve${pendingUsed.size ? ` (${pendingUsed.size} cross-lane pending)` : ''}`);
