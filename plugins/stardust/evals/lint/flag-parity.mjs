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
//     skills/*/scripts/*.mjs file inside the same code span (or fenced command)
//     attributes the flags that follow it. The 2026-09 B2 close found six
//     documented flags that no parser had, every one written without .mjs.
//   * a lint RULE ID a doc names in backticks (`D-CONST`, `D14-OPTIONS`,
//     `ICON-MISSING` — ALL-CAPS, hyphenated) on a line that talks about a lint,
//     a finding or a script must be a string some skills/*/scripts source
//     emits (a literal `'D1-EMPTY'`, or a `VEHICLE-${…}` template prefix). A
//     rule only "planned" in prose is a claim the reader acts on.
//   * DEFAULTS below: a numeric default the parser sets vs the number the
//     owning SKILL.md quotes for it.
// Docs scanned: skills/<skill>/*.md and skills/<skill>/reference/*.md.
// A line containing `flag-parity: ignore` is skipped (say why in the line).
// CROSS_LANE_PENDING below suppresses a finding another lane owns (its file is
// out of this lane's scope); a resolved entry is reported as a note, not a
// failure, so whichever lane lands first keeps the chain green — remove it then.
//
// Usage: node plugins/stardust/evals/lint/flag-parity.mjs [--docs <dir>]  (exit 1 on findings)
//   --docs <dir>  scan that tree (same <skill>/*.md + <skill>/reference/*.md layout)
//                 instead of skills/ — the scripts still come from skills/ (fixture testing;
//                 evals/lint/flag-parity.test.mjs drives fixtures/flag-parity/)
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
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
// script without .mjs still documents its flags
const BARE_NAME_RE = new RegExp(`(?<![\\w/.-])(${[...byName.keys()].map((n) => n.slice(0, -4).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w./-])`, 'g');
const MENTIONS_SCRIPT_RE = new RegExp(`\\.mjs\\b|${BARE_NAME_RE.source}`);

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
// Findings whose fix (build the flag/rule, or delete the claim) lives in a file
// another remediation lane owns. Same key shape (`<doc>:<flag-or-rule>:<script
// or "rule">`); value: the owning lane and the edit. Suppressed while the claim
// stands; once it is resolved the entry is printed as a note to remove, exit 0.
const CROSS_LANE_PENDING = {
  // T30.1 (deploy-harness lane): build 🟡 D-CONST / D14-OPTIONS in davids-model-lint.mjs tree mode, or delete the "planned lint" claims
  'deploy/reference/block-js-scaffold.md:D-CONST:rule': 'deploy-harness — T30.1: build D-CONST or reword EW5 (a) to "a site-wide string (encode-contract § Site-wide strings), not an exemption"',
  'deploy/reference/encode-contract.md:D-CONST:rule': 'deploy-harness — T30.1: build D-CONST or drop the "Planned tree-mode lint" sentence',
  'deploy/reference/encode-contract.md:D14-OPTIONS:rule': 'deploy-harness — T30.1: build D14-OPTIONS or drop the "Planned tree-mode lint" sentence',
  // T18.3 (replica-capture lane): chrome-parity --open <sel> is not a parser case — build it or say "open the trigger by hand in the Playwright re-probe"
  'deploy/reference/checklist.md:--open:chrome-parity.mjs': 'replica-capture — T18.3: build --open or delete the "(`chrome-parity --open <sel>`; until that flag ships, …)" parenthetical',
  'deploy/reference/chrome.md:--open:chrome-parity.mjs': 'replica-capture — T18.3: build --open or delete the parenthetical',
  'rollout/SKILL.md:--open:chrome-parity.mjs': 'replica-capture — T18.3: build --open or write "opened by hand in the Playwright re-probe"',
  // T06.1 (deploy-batch lane): update-coverage --from-ledger is cited but not built
  'rollout/reference/coverage-model.md:--from-ledger:update-coverage.mjs': 'deploy-batch — T06.1: build --from-ledger or cite `update-coverage <slug> --status` / `inventory --redirects` only',
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
  // bare names count only in a span that names no `.mjs` at all — `block-lint.mjs
  // blocks/ --styles` keeps its flags on block-lint, not on rollout's blocks.mjs
  const marks = [...span.matchAll(SCRIPT_RE)].map((m) => ({ at: m.index, script: pick(m, docSkill) })).filter((x) => x.script);
  if (!marks.length) marks.push(...[...span.matchAll(BARE_NAME_RE)].map((m) => ({ at: m.index, script: pick([m[0], undefined, `${m[1]}.mjs`], docSkill) })).filter((x) => x.script));
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
const notes = [];
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
    // rule ids: a backticked ALL-CAPS hyphenated id on a lint/finding/script line
    if (LINT_CONTEXT_RE.test(line) || MENTIONS_SCRIPT_RE.test(line)) {
      for (const m of line.matchAll(/`([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)+)`/g)) {
        checked += 1;
        if (ruleKnown(m[1])) continue;
        report(`${relative(DOCS_ROOT, path)}:${m[1]}:rule`, `${rel(path)}:${i + 1}: rule id \`${m[1]}\` is emitted by no skills/*/scripts source — build the rule or delete the claim`);
      }
    }
    if (!MENTIONS_SCRIPT_RE.test(line)) continue;
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
for (const k of Object.keys(CROSS_LANE_PENDING)) if (!pendingUsed.has(k)) notes.push(`resolved CROSS_LANE_PENDING entry "${k}" — remove it`);
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
for (const n of notes) console.log(`flag-parity lint: note — ${n}`);
console.log(`flag-parity lint: ${docs.length} docs, ${scripts.length} scripts, ${checked} flag/rule-id references resolve${pendingUsed.size ? ` (${pendingUsed.size} cross-lane pending)` : ''}`);
