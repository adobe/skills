#!/usr/bin/env node
// skills/stardust/scripts/replace.mjs — counted, atomic text replacement in project files: every
// occurrence is counted first, and a file is written only when each file holds the expected number.
//
//   node stardust/scripts/stardust/replace.mjs <file>… --from <text> --to <text> [--regex [--flags <imsu>]]
//        [--all | --count <n>] [--files-from <glob>] [--dry-run] [--json]
//
// Why: four recorded hands-off runs wrote about 150 python heredocs that read a tracked HTML or CSS
// file, .replace()d a string or a regex and wrote it back (one page's HTML 17 times, the shared CSS 11
// times). The rule "edit tool, not python" changed nothing: the inline rewrite handles several
// occurrences and regexes in one call without a prior read. This instrument is that convenient and
// safer — it counts before it writes. Default: exactly 1 match per file (--all: at least 1, --count n:
// exactly n); one file off its count leaves every file as it was and prints the matches in context.
//
// Matching. Literal by default (non-overlapping, left to right, --to inserted verbatim); --regex
// compiles `new RegExp(from, 'g' + flags)` and --to uses the engine's replacement syntax. A regex match
// of length 0 is refused — its count would be meaningless.
// Guards (each refused, nothing written): a path outside the project root (the cwd), missing, resolving
// outside it through a symlink, a symlink loop, or not a regular file; a file with a dedicated writer
// (OWNED); a NUL byte or bytes that are not UTF-8. A symlink inside the project is followed and stays a
// link. Real paths come from the native realpath — the on-disk case — so on a case-insensitive file
// system `A.html` and `a.html` are one file and a differently cased owned ledger is still refused.
// Write: per file a sibling temp file, created exclusively, renamed over the real path, mode kept; all
// temp files are written before the first rename. Bytes outside the replaced spans (line endings, a
// BOM) stay as they were.
// Exit codes: 0 replaced / dry run within the expectation / unchanged · 1 I/O error · 2 usage or refusal.
import { closeSync, fchmodSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);

export const FLAGS = ['--from', '--to', '--regex', '--flags', '--all', '--count', '--files-from', '--dry-run', '--json', '--help', '-h'];
const VALUE_FLAGS = ['--from', '--to', '--count', '--files-from', '--flags'];
const KEY = { '--from': 'from', '--to': 'to', '--count': 'count', '--files-from': 'filesFrom', '--flags': 'flags' };
const BOOL_FLAGS = { '--regex': 'regex', '--all': 'all', '--dry-run': 'dryRun', '--json': 'json' };
export const CONTEXT = { matches: 5, around: 2, half: 60, width: 120 };
export const JSON_MATCHES = 20;
const SKIP_DIRS = new Set(['.git', 'node_modules']);

// Project files with a dedicated writer (project-relative; `*` = one path segment).
export const OWNED = [
  { pattern: 'stardust/state.json', writer: 'stardust/state.mjs' },
  { pattern: 'stardust/rollout/progress.json', writer: 'stardust/progress.mjs' },
  { pattern: 'stardust/migrate/progress.json', writer: 'stardust/progress.mjs' },
  { pattern: 'stardust/replica/progress.json', writer: 'stardust/progress.mjs' },
  { pattern: 'stardust/replica/presence.json', writer: 'replica/presence.mjs' },
  { pattern: 'stardust/rollout/foundation-freeze.json', writer: 'replica/foundation-freeze.mjs' },
  { pattern: 'stardust/rollout/coverage/*.json', writer: 'rollout/update-coverage.mjs' },
  { pattern: 'stardust/rollout/rollout.json', writer: 'rollout/update-coverage.mjs' },
  { pattern: 'stardust/rollout/templates.json', writer: 'rollout/update-coverage.mjs' },
  { pattern: 'stardust/migrate/encode/*.json', writer: 'migrate/encode-attempt.mjs' },
  { pattern: 'stardust/status.jsonl', writer: 'stardust/ledger.mjs' },
];

const ownedTable = () => {
  const by = new Map();
  for (const { pattern, writer } of OWNED) by.set(writer, [...(by.get(writer) ?? []), pattern]);
  return [...by].map(([writer, patterns]) => `    ${patterns.join(', ')} → ${writer}`).join('\n');
};

const HELP = `Usage:
  node stardust/scripts/stardust/replace.mjs <file>… --from <text> --to <text> [--regex [--flags <imsu>]]
       [--all | --count <n>] [--files-from <glob>] [--dry-run] [--json]
  (run from the project root; every file must lie inside it)

Replaces text in project files, counted before anything is written — never a python or node -e rewrite.
Inputs:
  <file>…              project files, processed in the order given
  --files-from <glob>  more files, after the named ones: a glob relative to the project root — * (within one
                       path segment), ?, ** (zero or more directories), {a,b}; skips .git, node_modules and
                       dot-directories / dot-files unless the pattern segment starts with "."; regular files
                       only (symlinks are not followed); sorted by code point. A file reached twice (same
                       real path) is processed once, at its first position.
  --from <text>        literal text (default): non-overlapping occurrences, left to right; never empty
  --to <text>          the replacement, inserted verbatim ($& and $1 stay literal); --to "" deletes
  --regex              --from is a JavaScript regex (flag g always); --to uses $1, $<name>, $&, $$
  --flags <imsu>       extra regex flags, only with --regex
  (default)            expect exactly 1 match in every file
  --all                expect at least 1 match in every file
  --count <n>          expect exactly n matches in every file (n ≥ 1)
  --dry-run            write nothing; print what would be replaced, with the context
  --json               one JSON object on stdout instead of the text
  Value flags also take --flag=<value>, verbatim (--from=--json). In the space form the next token is the
  value unless it is one of this script's flags, bare or as <flag>=…: --to --json and --to --count=2 are
  forgotten values, while --from --brand-old --to --brand-new renames a CSS custom property.
Expectation: checked per file. Every file is read and counted before the first write; if any file misses
  its expectation, nothing is written to any file.
Output (stdout; <rel> = the path relative to the project root):
  replace <rel>: <n> replaced                          one line per file
  replace <rel>: unchanged (<n> matches, …)            a regex replacement left the text identical; not written
  replace <rel>: <n> would be replaced                 --dry-run, followed by the match context
  On a missed expectation, per file: <rel>: <n> matches (expected exactly 1|at least 1|exactly <n>), then
  the context of up to ${CONTEXT.matches} matches, grep -C${CONTEXT.around} style — "  <line>: <text>", "  <line>> <text>" on a line
  holding a match, groups split by "  --", then "  … <k> more". Lines over ${CONTEXT.width} characters are cut ("…"):
  a matching line to ${CONTEXT.half} characters either side of the match start, any other to its first ${CONTEXT.width}.
  --json: {"ok","dryRun","mode":"literal"|"regex","expect":{"op":"exactly"|"atLeast","n"},"refused":<reason>|null,
  "files":[{"file","count","written","matches":[{"line","column"}],"matchesOmitted"}]} — matches: the first
  ${JSON_MATCHES}, line and column 1-based (column in UTF-16 code units); also printed on a refusal (files [] when it
  came before counting), not on a usage error.
Writes: a sibling temp file (.<name>.<pid>.tmp, created exclusively) renamed over the real path, the file mode
  kept; line endings and a BOM stay byte-for-byte outside the replaced spans. A symlink inside the project
  stays a link; its target is edited. Paths are compared by their on-disk real path (case included).
Refused (exit 2, nothing written, one stderr line "replace: refused — <reason>"): a missed expectation; a
  path outside the project, missing, resolving outside it (a symlink), a symlink loop or not a regular
  file; a NUL byte ("looks binary") or bytes that are not UTF-8; a regex match of length 0; a --files-from
  glob matching nothing; something already at a temp file's name; a file with a dedicated writer — use
  the writer:
${ownedTable()}
Usage errors (exit 2, one stderr line "replace: <message>"): no file and no --files-from; --from missing or
  empty; --to missing; --all with --count; --count not an integer ≥ 1; --flags without --regex or outside
  imsu; a literal --from equal to --to; an invalid regex; an unknown --option; a value flag twice or
  without its value.
Exit codes: 0 replaced / dry run within the expectation / unchanged · 1 I/O error · 2 usage error or refusal.`;

export class UsageError extends Error { constructor(msg, code = 2) { super(msg); this.code = code; } }
/** A refusal: printed as "replace: refused — <reason>", exit 2. */
export class Refusal extends UsageError {}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 'es'}`;
const toPosix = (p) => p.split(sep).join('/');
const isInside = (p, dir) => { const r = relative(dir, p); return r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r); };

// ---- pure helpers (exported for tests) ---------------------------------------------------------
export function parseArgs(argv) {
  const o = { files: [], from: null, to: null, regex: false, flags: null, all: false, count: null, filesFrom: null, dryRun: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { o.files.push(a); continue; }
    const eq = a.indexOf('=');
    const name = eq > 0 ? a.slice(0, eq) : a;
    if (VALUE_FLAGS.includes(name)) {
      if (o[KEY[name]] !== null) throw new UsageError(`${name} given twice`);
      if (eq > 0) { o[KEY[name]] = a.slice(eq + 1); continue; }
      // Only this script's own flags (bare or <flag>=…) count as a forgotten value: `--to --brand-new` is a value.
      const next = argv[i + 1];
      if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
      const nextEq = next.indexOf('=');
      if (FLAGS.includes(next) || (nextEq > 0 && FLAGS.includes(next.slice(0, nextEq)))) {
        throw new UsageError(`${a} needs a value (got ${next}, which is a flag)`);
      }
      i += 1;
      o[KEY[name]] = argv[i];
    } else if (eq < 0 && Object.hasOwn(BOOL_FLAGS, a)) o[BOOL_FLAGS[a]] = true;
    else throw new UsageError(`unknown option ${a}`);
  }
  if (!o.files.length && o.filesFrom === null) throw new UsageError('no file — name one or more files, or --files-from <glob> (--help)');
  if (!o.from) throw new UsageError('--from <text> is required and must not be empty');
  if (o.to === null) throw new UsageError('--to <text> is required (--to "" deletes)');
  if (o.all && o.count !== null) throw new UsageError('--all and --count exclude each other');
  if (o.count !== null && (!/^\d+$/.test(o.count) || !Number.isSafeInteger(Number(o.count)) || Number(o.count) < 1)) {
    throw new UsageError(`--count needs an integer ≥ 1, got "${o.count}"`);
  }
  if (o.flags !== null && !o.regex) throw new UsageError('--flags applies to --regex only');
  if (o.flags !== null && !/^[imsu]*$/.test(o.flags)) throw new UsageError(`--flags takes i, m, s, u only, got "${o.flags}"`);
  o.flags ??= '';
  if (!o.regex && o.from === o.to) throw new UsageError('--from and --to are the same text — nothing to replace');
  if (o.regex) {
    try { new RegExp(o.from, `g${o.flags}`); } catch (e) { throw new UsageError(String(e.message).split('\n')[0]); }
  }
  o.expect = o.all ? { op: 'atLeast', n: 1 } : { op: 'exactly', n: o.count === null ? 1 : Number(o.count) };
  return o;
}

/**
 * Every match of `spec` ({ from, regex?, flags? }) in `text` → [{ index, length, line, column }], left to
 * right, non-overlapping; line and column 1-based (a leading BOM is not a column). A regex match of length
 * 0 throws a Refusal.
 */
export function findMatches(text, spec) {
  if (!spec.from) throw new UsageError('--from must not be empty');
  const out = [];
  if (spec.regex) {
    const re = new RegExp(spec.from, `g${spec.flags || ''}`);
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m[0].length === 0) throw new Refusal('--from matches the empty string');
      out.push({ index: m.index, length: m[0].length });
    }
  } else {
    for (let i = text.indexOf(spec.from); i !== -1; i = text.indexOf(spec.from, i + spec.from.length)) out.push({ index: i, length: spec.from.length });
  }
  const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  let lineStart = 0;
  let nl = text.indexOf('\n');
  for (const m of out) {
    while (nl !== -1 && nl < m.index) { line += 1; lineStart = nl + 1; nl = text.indexOf('\n', lineStart); }
    m.line = line;
    m.column = Math.max(1, m.index - lineStart + 1 - (line === 1 ? bom : 0));
  }
  return out;
}

/** `text` with every match of `spec` ({ from, to, regex?, flags? }) replaced → { text, count }. */
export function applyReplace(text, spec, matches = findMatches(text, spec)) {
  if (spec.regex) return { text: text.replace(new RegExp(spec.from, `g${spec.flags || ''}`), spec.to), count: matches.length };
  let out = '';
  let at = 0;
  for (const m of matches) { out += text.slice(at, m.index) + spec.to; at = m.index + m.length; }
  return { text: out + text.slice(at), count: matches.length };
}

const cut = (line, anchor) => {
  const cps = Array.from(line);
  if (cps.length <= CONTEXT.width) return line;
  if (anchor === null) return `${cps.slice(0, CONTEXT.width).join('')}…`;
  const at = Array.from(line.slice(0, anchor)).length;
  const from = Math.max(0, at - CONTEXT.half);
  const to = Math.min(cps.length, at + CONTEXT.half);
  return `${from > 0 ? '…' : ''}${cps.slice(from, to).join('')}${to < cps.length ? '…' : ''}`;
};

/**
 * grep -C2 context for the first CONTEXT.matches `matches` (from findMatches) → lines: "  <n>: <text>",
 * "  <n>> <text>" on a line holding (part of) any match, "  --" between groups, "  … <k> more".
 */
export function contextLines(text, matches) {
  if (!matches.length) return [];
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  const total = text.endsWith('\n') ? starts.length - 1 : starts.length;
  const lineOf = (idx) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const marked = new Set();
  const anchor = new Map();
  const spans = matches.map((m) => {
    const first = lineOf(m.index);
    const last = lineOf(m.index + m.length - 1);
    for (let l = first; l <= last; l += 1) marked.add(l);
    if (!anchor.has(first)) anchor.set(first, m.index - starts[first - 1] - (first === 1 ? bom : 0));
    return [first, last];
  });
  const groups = [];
  for (const [first, last] of spans.slice(0, CONTEXT.matches)) {
    const s = Math.max(1, first - CONTEXT.around);
    const e = Math.min(total, last + CONTEXT.around);
    const prev = groups.at(-1);
    if (prev && s <= prev[1] + 1) prev[1] = Math.max(prev[1], e); else groups.push([s, e]);
  }
  const shown = (l) => {
    let t = text.slice(starts[l - 1], l < starts.length ? starts[l] - 1 : text.length);
    if (t.endsWith('\r')) t = t.slice(0, -1);
    if (l === 1 && bom) t = t.slice(1);
    const hit = marked.has(l);
    return `  ${l}${hit ? '>' : ':'} ${cut(t, hit ? Math.max(0, anchor.get(l) ?? 0) : null)}`;
  };
  const out = [];
  groups.forEach(([s, e], g) => {
    if (g) out.push('  --');
    for (let l = s; l <= e; l += 1) out.push(shown(l));
  });
  if (matches.length > CONTEXT.matches) out.push(`  … ${matches.length - CONTEXT.matches} more`);
  return out;
}

/** {a,b} alternation (nested groups too) → the brace-free patterns, in order; an unbalanced brace stays literal. */
export function expandBraces(pattern) {
  let depth = 0;
  let open = -1;
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i] === '{') { if (depth === 0) open = i; depth += 1; } else if (pattern[i] === '}' && depth > 0) {
      depth -= 1;
      if (depth > 0) continue;
      const alts = [];
      let d = 0;
      let from = open + 1;
      for (let j = open + 1; j < i; j += 1) {
        if (pattern[j] === '{') d += 1;
        else if (pattern[j] === '}') d -= 1;
        else if (pattern[j] === ',' && d === 0) { alts.push(pattern.slice(from, j)); from = j + 1; }
      }
      alts.push(pattern.slice(from, i));
      const head = pattern.slice(0, open);
      const tail = pattern.slice(i + 1);
      return [...new Set(alts.flatMap((alt) => expandBraces(head + alt + tail)))];
    }
  }
  return [pattern];
}

/** One glob path segment → RegExp: * any run, ? one character; a leading "." must be matched literally. */
export function segmentRegExp(segment) {
  let re = segment.startsWith('.') ? '' : '(?!\\.)';
  for (const ch of segment) re += ch === '*' ? '[^/]*' : ch === '?' ? '[^/]' : ch.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
  return new RegExp(`^${re}$`, 'u');
}

const entries = (dir) => {
  try { return readdirSync(dir, { withFileTypes: true }); } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return [];
    throw e;
  }
};

function walk(abs, rel, segs, out) {
  const [seg, ...rest] = segs;
  if (seg === '**') {
    if (!rest.length) { walk(abs, rel, ['**', '*'], out); return; }
    walk(abs, rel, rest, out);
    for (const e of entries(abs)) {
      if (e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) walk(join(abs, e.name), `${rel}${e.name}/`, segs, out);
    }
    return;
  }
  const re = segmentRegExp(seg);
  for (const e of entries(abs)) {
    if (!re.test(e.name)) continue;
    if (!rest.length) { if (e.isFile()) out.add(`${rel}${e.name}`); } else if (e.isDirectory() && !SKIP_DIRS.has(e.name)) walk(join(abs, e.name), `${rel}${e.name}/`, rest, out);
  }
}

const byCodePoint = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

/** The project-relative regular files matching `pattern` under `root`, sorted by code point. */
export function expandGlob(pattern, root = process.cwd()) {
  const base = realpathSync.native(root);
  const found = new Set();
  for (const p of expandBraces(pattern)) walk(base, '', p.replace(/^(?:\.\/)+/, '').split('/'), found);
  return [...found].sort(byCodePoint);
}

/** The dedicated writer of a project-relative path, or null. */
export function ownedBy(rel) {
  const path = toPosix(rel);
  const hit = OWNED.find(({ pattern }) => new RegExp(`^${pattern.split('*').map((s) => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')).join('[^/]*')}$`).test(path));
  return hit ? hit.writer : null;
}

/**
 * `file` (as given) inside the project `root` → { abs, real, rel, realRel }: `rel` as typed, `realRel` the
 * on-disk path (native realpath, the file system's case) relative to realpath(root). Refuses (Refusal,
 * exit 2) a path whose lexical resolution is outside the root, a missing file, a symlink loop, a realpath
 * outside realpath(root), a non-file.
 */
export function resolveInside(file, root = process.cwd()) {
  const logical = resolve(root);
  const base = realpathSync.native(logical);
  const abs = resolve(logical, file);
  const lexical = isInside(abs, logical) ? logical : isInside(abs, base) ? base : null;
  if (lexical === null) throw new Refusal(`${file} is outside the project (${base})`);
  let real;
  try { real = realpathSync.native(abs); } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') throw new Refusal(`no such file ${file}`);
    if (e.code === 'ELOOP') throw new Refusal(`${file}: symlink loop`);
    throw e;
  }
  if (!isInside(real, base)) throw new Refusal(`${file} resolves outside the project (${real})`);
  if (!statSync(real).isFile()) throw new Refusal(`${file} is not a regular file`);
  return { abs, real, rel: toPosix(relative(lexical, abs)), realRel: toPosix(relative(base, real)) };
}

// ---- I/O ---------------------------------------------------------------------------------------
const tempPath = (real) => join(dirname(real), `.${basename(real)}.${process.pid}.tmp`);

function collect(o, root) {
  const seen = new Set();
  const items = [];
  const add = (file) => {
    const r = resolveInside(file, root);
    if (seen.has(r.real)) return;
    seen.add(r.real);
    for (const rel of [r.rel, r.realRel]) {
      const writer = ownedBy(rel);
      if (writer) throw new Refusal(`${rel} is written by ${writer} — use it`);
    }
    items.push(r);
  };
  for (const f of o.files) add(f);
  if (o.filesFrom !== null) {
    const globbed = expandGlob(o.filesFrom, root);
    if (!globbed.length) throw new Refusal(`--files-from ${o.filesFrom} matches no file`);
    for (const f of globbed) add(f);
  }
  for (const it of items) {
    const buf = readFileSync(it.real);
    if (buf.includes(0)) throw new Refusal(`${it.rel} looks binary`);
    const text = buf.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(buf)) throw new Refusal(`${it.rel} is not UTF-8 text`);
    it.text = text;
    it.mode = statSync(it.real).mode & 0o7777;
  }
  for (const it of items) {
    try { it.matches = findMatches(it.text, o); } catch (e) {
      if (e instanceof Refusal) throw new Refusal(`${e.message} (in ${it.rel})`);
      throw e;
    }
  }
  return items;
}

/**
 * Stage every item ({ rel, real, next, mode }) as a sibling temp file, then rename each over its real path.
 * A temp file is created exclusively: anything already at its name (a planted symlink included) is never
 * written through or removed — a Refusal, nothing written. On a failure the temp files this run created
 * are removed.
 */
export function writeAll(items) {
  const staged = [];
  let renamed = 0;
  let current = null;
  try {
    for (const it of items) {
      current = it;
      const tmp = tempPath(it.real);
      const fd = openSync(tmp, 'wx', it.mode);
      staged.push(tmp);
      try { writeFileSync(fd, it.next); fchmodSync(fd, it.mode); } finally { closeSync(fd); }
    }
    for (const it of items) { current = it; renameSync(staged[renamed], it.real); renamed += 1; }
  } catch (e) {
    for (const tmp of staged.slice(renamed)) rmSync(tmp, { force: true });
    if (e.code === 'EEXIST' && !renamed) {
      throw new Refusal(`${current.rel}: ${tempPath(current.real)} already exists (not created by this run) — nothing written`);
    }
    const done = renamed ? `${renamed} file(s) already replaced: ${items.slice(0, renamed).map((x) => x.rel).join(', ')}` : 'nothing written';
    throw new Error(`could not write ${current?.rel}: ${String(e.message).split('\n')[0]} — ${done}`);
  }
}

// ---- main --------------------------------------------------------------------------------------
export function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return 0; }
  const o = parseArgs(argv);
  const report = { ok: false, dryRun: o.dryRun, mode: o.regex ? 'regex' : 'literal', expect: o.expect, refused: null, files: [] };
  const refuse = (reason) => {
    report.refused = reason;
    if (o.json) console.log(JSON.stringify(report));
    return new Refusal(reason);
  };
  let items;
  try { items = collect(o, process.cwd()); } catch (e) {
    if (e instanceof Refusal) throw refuse(e.message);
    throw e;
  }

  const { op, n } = o.expect;
  const expectText = `${op === 'exactly' ? 'exactly' : 'at least'} ${n}`;
  const meets = (count) => (op === 'exactly' ? count === n : count >= n);
  for (const it of items) {
    report.files.push({
      file: it.rel,
      count: it.matches.length,
      written: false,
      matches: it.matches.slice(0, JSON_MATCHES).map(({ line, column }) => ({ line, column })),
      matchesOmitted: Math.max(0, it.matches.length - JSON_MATCHES),
    });
  }
  const off = items.filter((it) => !meets(it.matches.length)).length;
  if (off) {
    if (!o.json) {
      for (const it of items) {
        console.log(`${it.rel}: ${plural(it.matches.length, 'match')} (expected ${expectText})`);
        for (const l of contextLines(it.text, it.matches)) console.log(l);
      }
    }
    const files = `${off} of ${items.length} file${items.length === 1 ? '' : 's'} differ${off === 1 ? 's' : ''}`;
    throw refuse(`expected ${expectText} ${n === 1 ? 'match' : 'matches'} per file; ${files}`);
  }

  for (const it of items) {
    it.next = applyReplace(it.text, o, it.matches).text;
    it.changed = it.next !== it.text;
  }
  const line = (it, done) => (it.changed
    ? `replace ${it.rel}: ${it.matches.length} ${done}`
    : `replace ${it.rel}: unchanged (${plural(it.matches.length, 'match')}, the replacement leaves the text identical)`);
  if (o.dryRun) {
    report.ok = true;
    if (o.json) console.log(JSON.stringify(report));
    else {
      for (const it of items) {
        console.log(line(it, 'would be replaced'));
        for (const l of contextLines(it.text, it.matches)) console.log(l);
      }
    }
    return 0;
  }
  try { writeAll(items.filter((it) => it.changed)); } catch (e) {
    if (e instanceof Refusal) throw refuse(e.message);
    throw e;
  }
  items.forEach((it, i) => { report.files[i].written = it.changed; });
  report.ok = true;
  if (o.json) console.log(JSON.stringify(report));
  else for (const it of items) console.log(line(it, 'replaced'));
  return 0;
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) {
  // exitCode, not exit(): a long report on a pipe must flush before the process ends
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) {
    const msg = String(e?.message ?? e).split('\n')[0];
    console.error(e instanceof Refusal ? `replace: refused — ${msg}` : `replace: ${msg}`);
    process.exitCode = e instanceof UsageError ? 2 : 1;
  }
}
