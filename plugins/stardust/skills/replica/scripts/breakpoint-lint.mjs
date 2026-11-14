#!/usr/bin/env node
/**
 * skills/replica/scripts/breakpoint-lint.mjs — every layout switch in the delivered code sits on
 * a target breakpoint (replica `--target-breakpoints`, persisted in DESIGN.json
 * `extensions.breakpoints.target`).
 *
 * Why: blocks reused from a boilerplate or library carry its steps while blocks recreated from
 * the source copy the source's, because the gate rewards matching them — a recorded run ended
 * with about 20 distinct breakpoint values in one codebase, and new blocks and per-page fixes
 * reintroduce source values unless something fails on them.
 *
 * Usage:
 *   node stardust/scripts/replica/breakpoint-lint.mjs [--root <dir>] [--design <DESIGN.json>]
 *        [--target 600,900,1200] [--dirs blocks,templates,styles,scripts]
 *   node stardust/scripts/replica/breakpoint-lint.mjs --inventory <file|dir>…
 *
 *   lint (default)  scan .css/.js/.mjs/.html under --dirs (relative to --root, default `.`; missing dirs
 *            are skipped; node_modules, dot-entries and *.min.* are not walked). Target =
 *            --target, else `extensions.breakpoints.target` in --design (default ./DESIGN.json,
 *            the project root's). No target → `breakpoint-lint: no target set — skipped`, exit 0,
 *            so the script can sit in `npm run lint` unconditionally.
 *            One line per off-target switch: `<file>:<line>  <source text>  → switches at <N>px`,
 *            then `breakpoint-lint: <n> off-target in <f> files (target …)`, exit 1; clean →
 *            `breakpoint-lint: clean — <k> switches in <f> files, all on …`, exit 0.
 *            A prototype dir: `--root stardust/prototypes --dirs .`.
 *   --inventory  the distinct switch points in the given files/dirs (same file types — e.g.
 *            the fetched live stylesheets), one line each: `<N>px  ×<count>  min <a> / max <b>
 *            <file:line> <source text>` — the input of replica's breakpoint-map.md. Exit 0.
 *
 * What is read, normalised to the SWITCH POINT — the first width at which the min-side applies:
 *   CSS  @media / @custom-media / @import preludes, plus `media="…"` attributes in .html — never
 *        declarations (a `max-width` declaration is not a query):
 *        (min-width: N) and (width >= N) → N; (max-width: N) and (width <= N) → N+1;
 *        (width < N) → N; (width > N) → N+1; reversed and range forms alike; em/rem × 16.
 *        So `max-width: 899px` passes on a 900 step and `max-width: 900px` does not (it
 *        switches at 901), and a complementary 840/841 pair is ONE switch point.
 *   JS   parenthesised media features in any string (`matchMedia('(min-width: 900px)')`, a
 *        constant, a template, a `<source media>`) and innerWidth / outerWidth /
 *        documentElement.clientWidth / screen.width
 *        comparisons with a number. A media feature built by interpolation (`${BP}px`) cannot be
 *        resolved: it prints as `?` — advisory, never a failure; resolve it by hand.
 *   Comments are blanked first; zero-width switches (`min-width: 0`) are ignored.
 * Exit codes: 0 clean / skipped / inventory · 1 off-target switches · 2 usage or unreadable input
 * (one stderr line). --help / -h prints this usage and reads nothing.
 */

/* eslint-disable no-restricted-syntax, no-continue, max-len */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DIRS = ['blocks', 'templates', 'styles', 'scripts'];
const EXT = new Set(['.css', '.js', '.mjs', '.html']);
const SELF = fileURLToPath(import.meta.url);

// Replace comment bodies with spaces (newlines kept, so offsets and line numbers survive).
// Strings are skipped intact; `js` adds `//` line comments and template literals.
export function blankComments(text, js = false) {
  const out = text.split('');
  const n = text.length;
  let i = 0;
  const blank = (a, b) => { for (let k = a; k < b; k += 1) if (out[k] !== '\n') out[k] = ' '; };
  while (i < n) {
    const c = text[i];
    if (c === '"' || c === "'" || (js && c === '`')) {
      i += 1;
      while (i < n && text[i] !== c) { if (text[i] === '\\') i += 1; else if (!js && text[i] === '\n') break; i += 1; }
      i += 1;
    } else if (c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; blank(i, end); i = end;
    } else if (js && c === '/' && text[i + 1] === '/') {
      const e = text.indexOf('\n', i); const end = e < 0 ? n : e; blank(i, end); i = end;
    } else i += 1;
  }
  return out.join('');
}

const toPx = (num, unit) => Number(num) * (/^r?em$/i.test(unit || '') ? 16 : 1);
// The first integer width at which the min-side of the comparison holds.
function switchPoint(op, px) {
  if (op === '>=') return Math.ceil(px);
  if (op === '>') return Math.floor(px) + 1;
  if (op === '<=') return Math.floor(px) + 1;
  return Math.ceil(px); // '<'
}
const FLIP = { '<': '>', '>': '<', '<=': '>=', '>=': '<=' };
const NUM = '(\\d+(?:\\.\\d+)?)\\s*(px|r?em)?';
const FEATURE = new RegExp(`\\b(min|max)-(?:device-)?width\\s*:\\s*${NUM}`, 'gi');
const RANGE_R = new RegExp(`(?<![\\w-])width\\s*(<=|>=|<|>)\\s*${NUM}`, 'gi');
const RANGE_L = new RegExp(`${NUM.replace('(px|r?em)?', '(px|r?em)')}\\s*(<=|>=|<|>)\\s*width(?![\\w-])`, 'gi');
const JS_WIDTH = '(?:innerWidth|outerWidth|documentElement\\.clientWidth|screen\\.width)';
const JS_R = new RegExp(`${JS_WIDTH}\\s*(<=|>=|<|>)\\s*(\\d+(?:\\.\\d+)?)(?![\\w.])`, 'g');
const JS_L = new RegExp(`(?<![\\w.])(\\d+(?:\\.\\d+)?)\\s*(<=|>=|<|>)\\s*(?:window\\.|document\\.)?${JS_WIDTH}`, 'g');
const JS_UNRESOLVED = /\(\s*(?:(?:min|max)-width\s*:|width\s*[<>]=?)\s*\$\{/g;

// Switch points in one media-condition string; `base` is its offset in the file.
function fromCondition(cond, base) {
  const hits = [];
  for (const m of cond.matchAll(FEATURE)) {
    const op = m[1].toLowerCase() === 'min' ? '>=' : '<=';
    hits.push({ px: switchPoint(op, toPx(m[2], m[3])), form: op === '>=' ? 'min' : 'max', at: base + m.index, text: m[0] });
  }
  for (const m of cond.matchAll(RANGE_R)) {
    hits.push({ px: switchPoint(m[1], toPx(m[2], m[3])), form: m[1][0] === '>' ? 'min' : 'max', at: base + m.index, text: m[0] });
  }
  for (const m of cond.matchAll(RANGE_L)) {
    const op = FLIP[m[3]];
    hits.push({ px: switchPoint(op, toPx(m[1], m[2])), form: op[0] === '>' ? 'min' : 'max', at: base + m.index, text: m[0] });
  }
  return hits;
}

// [{ px, form: 'min'|'max'|'?', line, text }] for one file's text; kind = 'css' | 'js' | 'html'.
export function switchPoints(raw, kind) {
  const js = kind === 'js';
  const text = blankComments(raw, js);
  const hits = [];
  if (js) {
    for (const m of text.matchAll(/\(\s*(?:(?:min|max)-(?:device-)?width\s*:|\d[^()]*?[<>]=?\s*width|width\s*[<>])[^()]*\)/gi)) hits.push(...fromCondition(m[0], m.index));
    for (const m of text.matchAll(JS_R)) hits.push({ px: switchPoint(m[1], Number(m[2])), form: m[1][0] === '>' ? 'min' : 'max', at: m.index, text: m[0] });
    for (const m of text.matchAll(JS_L)) { const op = FLIP[m[2]]; hits.push({ px: switchPoint(op, Number(m[1])), form: op[0] === '>' ? 'min' : 'max', at: m.index, text: m[0] }); }
    for (const m of text.matchAll(JS_UNRESOLVED)) hits.push({ px: null, form: '?', at: m.index, text: m[0] });
  } else {
    for (const m of text.matchAll(/@(?:media|custom-media|import)\b([^{;]*)/gi)) hits.push(...fromCondition(m[1], m.index + m[0].length - m[1].length));
    if (kind === 'html') for (const m of text.matchAll(/\bmedia\s*=\s*["']([^"']*)/gi)) hits.push(...fromCondition(m[1], m.index + m[0].length - m[1].length));
  }
  return hits
    .filter((h) => h.px === null || h.px > 0)
    .sort((a, b) => a.at - b.at)
    .map((h) => ({ px: h.px, form: h.form, line: raw.slice(0, h.at).split('\n').length, text: h.text.replace(/\s+/g, ' ').trim() }));
}

const kindOf = (file) => ({ '.css': 'css', '.html': 'html' }[extname(file)] || 'js');

export function walk(path, exts, out = []) {
  const st = statSync(path);
  if (st.isFile()) { if (exts.has(extname(path))) out.push(path); return out; }
  for (const name of readdirSync(path).sort()) {
    if (name.startsWith('.') || name === 'node_modules' || /\.min\.[^.]+$/.test(name)) continue;
    const p = join(path, name);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.has(extname(name))) out.push(p);
  }
  return out;
}

// { offTarget: [{file, line, px, text}], unresolved: [...], count, files } for the scanned files.
export function lintFiles(files, target, root = '.') {
  const allowed = new Set(target);
  const res = { offTarget: [], unresolved: [], count: 0, files: 0 };
  for (const f of files) {
    const hits = switchPoints(readFileSync(f, 'utf8'), kindOf(f));
    if (hits.length) res.files += 1;
    for (const h of hits) {
      const row = { file: relative(root, f) || f, line: h.line, px: h.px, text: h.text };
      if (h.px === null) { res.unresolved.push(row); continue; }
      res.count += 1;
      if (!allowed.has(h.px)) res.offTarget.push(row);
    }
  }
  return res;
}

export function inventory(files) {
  const by = new Map();
  for (const f of files) {
    for (const h of switchPoints(readFileSync(f, 'utf8'), kindOf(f))) {
      if (h.px === null) continue;
      const e = by.get(h.px) || { px: h.px, count: 0, min: 0, max: 0, first: `${f}:${h.line}  ${h.text}` };
      e.count += 1; e[h.form] += 1; by.set(h.px, e);
    }
  }
  return [...by.values()].sort((a, b) => a.px - b.px);
}

export function parseTarget(value) {
  const list = (Array.isArray(value) ? value : String(value).split(',')).map((v) => Number(String(v).trim()));
  if (!list.length || list.some((v) => !Number.isInteger(v) || v <= 0)) return null;
  return [...new Set(list)].sort((a, b) => a - b);
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(readFileSync(SELF, 'utf8').split('*/')[0].split('\n').slice(2).map((l) => l.replace(/^ \* ?/, '')).join('\n').trim());
    return 0;
  }
  const fail = (msg) => { console.error(`breakpoint-lint: ${msg}`); return 2; };
  const opts = { root: '.', design: null, target: null, dirs: DEFAULT_DIRS.join(','), inventory: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--inventory') { opts.inventory = argv.slice(i + 1); break; }
    const key = { '--root': 'root', '--design': 'design', '--target': 'target', '--dirs': 'dirs' }[a];
    if (!key) return fail(`unknown argument ${a} (--help)`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return fail(`${a} needs a value`);
    opts[key] = v; i += 1;
  }
  try {
    if (opts.inventory) {
      if (!opts.inventory.length) return fail('--inventory needs at least one file or dir');
      const rows = inventory(opts.inventory.flatMap((p) => walk(p, EXT)));
      for (const r of rows) console.log(`${String(r.px).padStart(5)}px  ×${r.count}  min ${r.min} / max ${r.max}  ${r.first}`);
      console.log(`breakpoint-lint: ${rows.length} distinct switch points`);
      return 0;
    }
    let target = null;
    if (opts.target) {
      target = parseTarget(opts.target);
      if (!target) return fail(`--target must be positive integers, comma-separated (got ${opts.target})`);
    } else {
      const design = resolve(opts.design || 'DESIGN.json');
      const raw = existsSync(design) ? JSON.parse(readFileSync(design, 'utf8'))?.extensions?.breakpoints?.target : undefined;
      if (raw !== undefined && raw !== null) {
        target = parseTarget(raw);
        if (!target) return fail(`${design} extensions.breakpoints.target is not a list of positive integers`);
      }
    }
    if (!target) { console.log('breakpoint-lint: no target set — skipped'); return 0; }
    const dirs = opts.dirs.split(',').map((d) => join(opts.root, d.trim())).filter((d) => existsSync(d));
    const res = lintFiles(dirs.flatMap((d) => walk(d, EXT)), target, opts.root);
    for (const r of res.offTarget) console.log(`${r.file}:${r.line}  ${r.text}  → switches at ${r.px}px`);
    for (const r of res.unresolved) console.log(`${r.file}:${r.line}  ${r.text}  → ? interpolated — check by hand (advisory)`);
    const set = target.join(',');
    if (res.offTarget.length) {
      console.log(`breakpoint-lint: ${res.offTarget.length} off-target in ${new Set(res.offTarget.map((r) => r.file)).size} files (target ${set})`);
      return 1;
    }
    console.log(`breakpoint-lint: clean — ${res.count} switches in ${res.files} files, all on ${set}`);
    return 0;
  } catch (e) {
    return fail(e.message);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) process.exitCode = main(process.argv.slice(2));
