#!/usr/bin/env node
/**
 * skills/replica/scripts/html-slice.mjs — one element of a captured page
 * (header, footer, main, a component by class or id), attributes stripped to
 * the structural few, scripts/styles/inline SVG removed, output capped.
 *
 * Why: reading a captured page to lift its structure is legitimate; reading
 * the whole 125k-character file is not, and neither is the recorded
 * substitute — `node -e` with indexOf('<header') … indexOf('</header>') and a
 * hand-written attribute stripper, five times in one session (2026-09-18),
 * each pasting 9–17k characters into the agent's context. This is that
 * script, once, bounded.
 *
 * Usage:
 *   node html-slice.mjs <file.html> <selector> [--all] [--text] [--count]
 *                       [--keep-attrs class,id,href,src,alt] [--max-chars <n>=6000]
 *   selector: tag | .class | #id | tag.class      (first match unless --all)
 *
 * --text prints the element's text content only (block boundaries as line
 * breaks). Exit 0 = printed, 2 = no match, 125 = usage (bad selector, unknown
 * flag, or a value flag — --keep-attrs, --max-chars — followed by nothing or
 * by another --flag: the flag is named, never swallowed as the value).
 */

/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HELP = 'Usage: node html-slice.mjs <file.html> <tag|.class|#id|tag.class> [--all] [--text] [--count] [--keep-attrs a,b] [--max-chars <n>]';
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const BLOCK = 'div|section|header|footer|nav|main|article|aside|ul|ol|li|p|h[1-6]|picture|figure|figcaption|table|tr|form|button|blockquote|dl|dt|dd';
export const DEFAULT_KEEP = ['class', 'id', 'href', 'src', 'alt', 'role', 'aria-label', 'type'];

export function parseSelector(sel) {
  const m = String(sel).match(/^([a-zA-Z][\w-]*)?(?:\.([\w-]+))?(?:#([\w-]+))?$/);
  if (!m || !sel) throw new Error(`selector must be tag, .class, #id or tag.class — got "${sel}"`);
  return { tag: m[1] ? m[1].toLowerCase() : null, cls: m[2] || null, id: m[3] || null };
}

function attr(attrs, name) { const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i')); return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null; }

export function findElements(html, { tag, cls, id }, { all = false } = {}) {
  const open = /<([a-zA-Z][\w-]*)\b([^>]*)>/g;
  const found = [];
  let m;
  while ((m = open.exec(html))) {
    const t = m[1].toLowerCase();
    if (tag && t !== tag) continue;
    if (cls && !(attr(m[2], 'class') || '').split(/\s+/).includes(cls)) continue;
    if (id && attr(m[2], 'id') !== id) continue;
    const start = m.index;
    let end;
    if (VOID.has(t) || m[2].trimEnd().endsWith('/')) end = open.lastIndex;
    else {
      const walk = new RegExp(`<(/?)${t}\\b[^>]*>`, 'gi');
      walk.lastIndex = open.lastIndex;
      let depth = 1; let w; end = html.length;
      while ((w = walk.exec(html))) { if (w[1]) depth -= 1; else if (!w[0].trimEnd().endsWith('/>')) depth += 1; if (depth === 0) { end = walk.lastIndex; break; } }
    }
    found.push({ start, end, tag: t, html: html.slice(start, end) });
    if (!all) break;
    open.lastIndex = Math.max(open.lastIndex, m.index + 1);
  }
  return found;
}

export function clean(fragment, { keep = DEFAULT_KEEP, text = false } = {}) {
  let s = fragment
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '<svg/>');
  if (text) return s.replace(new RegExp(`</?(?:${BLOCK}|br)\\b[^>]*>`, 'gi'), '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  s = s.replace(/<([a-zA-Z][\w-]*)\b([^>]*?)(\/?)>/g, (_, t, attrs, slash) => {
    const kept = keep.map((k) => { const v = attr(attrs, k); return v === null ? null : `${k}="${v.length > 80 ? `${v.slice(0, 77)}…` : v}"`; }).filter(Boolean);
    return `<${t}${kept.length ? ` ${kept.join(' ')}` : ''}${slash}>`;
  });
  return s.replace(/\s+/g, ' ').replace(new RegExp(`\\s*<(${BLOCK})\\b`, 'gi'), '\n<$1').replace(new RegExp(`\\s*</(${BLOCK})>`, 'gi'), '</$1>\n').replace(/\n{2,}/g, '\n').trim();
}

function cli(argv) {
  const rest = argv.slice(2);
  if (!rest.length || rest.includes('--help') || rest.includes('-h')) { console.log(HELP); return rest.length ? 0 : 125; }
  const o = { file: null, sel: null, all: false, text: false, count: false, keep: DEFAULT_KEEP, maxChars: 6000 };
  // A value flag followed by nothing or by another --flag is a usage error naming the flag (125).
  const need = (i, flag) => { if (i + 1 >= rest.length || rest[i + 1].startsWith('--')) throw new Error(`${flag} needs a value\n${HELP}`); return rest[i + 1]; };
  try {
    for (let i = 0; i < rest.length; i += 1) {
      const a = rest[i];
      if (a === '--all') o.all = true;
      else if (a === '--text') o.text = true;
      else if (a === '--count') o.count = true;
      else if (a === '--keep-attrs') { o.keep = need(i, a).split(',').map((s) => s.trim()).filter(Boolean); i += 1; }
      else if (a === '--max-chars') { o.maxChars = Number(need(i, a)); i += 1; }
      else if (a.startsWith('--')) throw new Error(`unknown flag ${a}\n${HELP}`);
      else if (!o.file) o.file = a;
      else if (!o.sel) o.sel = a;
      else throw new Error(`unexpected argument ${a}\n${HELP}`);
    }
    if (!o.file || !o.sel) throw new Error(`need <file.html> and a selector\n${HELP}`);
    if (!Number.isFinite(o.maxChars) || o.maxChars < 1) throw new Error('--max-chars needs a positive number');
    const sel = parseSelector(o.sel);
    let html; try { html = readFileSync(o.file, 'utf8'); } catch (e) { console.error(`html-slice: cannot read ${o.file}: ${e.message}`); return 1; }
    const els = findElements(html, sel, { all: o.all || o.count });
    if (o.count) { console.log(`${o.file}: ${els.length} element(s) match ${o.sel}`); return els.length ? 0 : 2; }
    if (!els.length) { console.error(`html-slice: no element matches ${o.sel} in ${o.file} (${html.length} chars)`); return 2; }
    for (const el of els) {
      const out = clean(el.html, { keep: o.keep, text: o.text });
      console.log(`${o.file} <${el.tag}> at ${el.start}–${el.end} (${el.html.length} chars raw, ${out.length} cleaned)`);
      console.log(out.length > o.maxChars ? `${out.slice(0, o.maxChars)}\n… truncated at ${o.maxChars} of ${out.length} chars — narrow the selector, use --text, or raise --max-chars` : out);
    }
    return 0;
  } catch (e) { console.error(`html-slice: ${e.message}`); return 125; }
}

// Main-module guard by REAL path: node resolves the entry's symlinks for import.meta.url but leaves process.argv[1]
// as typed, so a symlinked checkout or temp dir (e.g. /var → /private/var) would otherwise make the CLI a silent no-op.
function isMainModule(metaUrl) {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try { return realpathSync(argv1) === fileURLToPath(metaUrl); } catch { return false; }
}
if (isMainModule(import.meta.url)) process.exitCode = cli(process.argv);
