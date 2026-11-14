#!/usr/bin/env node
/**
 * skills/replica/scripts/css-rules.mjs — the rule blocks of a stylesheet whose
 * selector matches a regex, each with the @media / @supports condition it
 * sits in, instead of line ranges of the whole sheet.
 *
 * Why: lifting values (recreation-procedure § lifted, not eyeballed) means
 * finding the live rule for a component. In one recorded hands-off session
 * (2026-09-18) that was done as `sed -n 4370,4773p site.pretty.css` and
 * ad-hoc `node -e` scans — 102k + 141k characters of stylesheet in the
 * agent's context for perhaps thirty rules that mattered. This prints the
 * thirty.
 *
 * Usage:
 *   node css-rules.mjs <file.css> "<selector regex>" [--media <regex> | --no-media]
 *                      [--decl <regex>] [--max <n>=40] [--count]
 *
 * Output, one rule per entry:
 *   L2231 .cmp-teaser__title, .cmp-teaser__pretitle   @media (min-width: 1024px)
 *         font-size: 32px; line-height: 40px; margin: 0 0 8px;
 * --media filters on the condition text (`--no-media`: top-level rules only);
 * --decl keeps rules with a matching declaration and shows only those
 * declarations (+N more); --count prints the number of matches. Values longer
 * than 80 characters (data URIs) are cut. Minified sheets get byte offsets
 * (@1234) instead of line numbers. Exit 0 = printed, 2 = no match, 125 = usage
 * (bad regex, unknown flag, or a value flag — --media, --decl, --max — followed
 * by nothing or by another --flag: the flag is named, never swallowed).
 *
 * Also importable: parseCss(text) → [{ selector, body, media[], offset }].
 */

/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HELP = 'Usage: node css-rules.mjs <file.css> "<selector regex>" [--media <regex> | --no-media] [--decl <regex>] [--max <n>] [--count]';
const CONDITIONAL_AT_RULES = new Set(['media', 'supports', 'layer', 'container', 'document', 'scope']);

export function parseCss(text) {
  const rules = [];
  const n = text.length;
  let i = 0;
  const skipComment = () => { if (text.startsWith('/*', i)) { const e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; return true; } return false; };
  const skipWs = () => { for (;;) { while (i < n && /\s/.test(text[i])) i += 1; if (!skipComment()) return; } };
  const skipString = () => { const q = text[i]; i += 1; while (i < n && text[i] !== q) { if (text[i] === '\\') i += 1; i += 1; } i += 1; };
  // Read up to a stop character at paren depth 0 (outside strings/comments); returns the text read.
  const readUntil = (stops, braces = false) => {
    const start = i; let paren = 0; let brace = 0;
    while (i < n) {
      const c = text[i];
      if (c === '"' || c === "'") { skipString(); continue; }
      if (text.startsWith('/*', i)) { skipComment(); continue; }
      if (c === '(') paren += 1; else if (c === ')') paren = Math.max(0, paren - 1);
      else if (braces && c === '{') brace += 1;
      else if (braces && c === '}' && brace > 0) brace -= 1;
      else if (paren === 0 && brace === 0 && stops.includes(c)) return text.slice(start, i);
      i += 1;
    }
    return text.slice(start);
  };
  const skipBlock = () => { // i is just after '{'; returns the raw inner text
    const start = i; let depth = 1;
    while (i < n && depth) { if (text.startsWith('/*', i)) { skipComment(); continue; } const c = text[i]; if (c === '"' || c === "'") { skipString(); continue; } if (c === '{') depth += 1; else if (c === '}') depth -= 1; i += 1; }
    return text.slice(start, Math.max(start, i - 1));
  };
  const parseList = (media) => {
    for (;;) {
      skipWs();
      if (i >= n) return;
      if (text[i] === '}') { i += 1; return; }
      const start = i;
      const prelude = readUntil('{;}').trim();
      if (i >= n) return;
      if (text[i] === ';') { i += 1; if (prelude) rules.push({ selector: prelude, body: '', media, offset: start }); continue; }
      if (text[i] === '}') { i += 1; return; }
      i += 1; // '{'
      if (prelude.startsWith('@')) {
        const name = prelude.slice(1).split(/[\s(]/)[0].toLowerCase();
        if (CONDITIONAL_AT_RULES.has(name)) { parseList([...media, prelude]); continue; }
        rules.push({ selector: prelude, body: skipBlock().replace(/\s+/g, ' ').trim(), media, offset: start });
        continue;
      }
      const body = readUntil('}', true);
      i += 1;
      rules.push({ selector: prelude.replace(/\s+/g, ' '), body: body.trim(), media, offset: start });
    }
  };
  parseList([]);
  return rules;
}

export function splitDeclarations(body) {
  const out = []; let cur = ''; let paren = 0; let q = null;
  for (const c of body) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(') paren += 1; else if (c === ')') paren = Math.max(0, paren - 1);
    if (c === ';' && paren === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map((d) => d.replace(/\s+/g, ' ').replace(/^([^:]+):\s*/, '$1: '));
}

const cut = (s, max = 80) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function formatRule(rule, lineOf, declRe) {
  const where = lineOf(rule.offset);
  const media = rule.media.length ? `   ${rule.media.join(' ∧ ')}` : '';
  let decls = splitDeclarations(rule.body);
  let hidden = 0;
  if (declRe) { const kept = decls.filter((d) => declRe.test(d)); hidden = decls.length - kept.length; decls = kept; }
  const body = decls.map((d) => `${cut(d)};`).join(' ') + (hidden ? `  (+${hidden} more)` : '');
  return `${where} ${cut(rule.selector, 160)}${media}\n      ${body || '(no declarations)'}`;
}

export function lineLocator(text) {
  const lineCount = text.split('\n').length;
  const minified = text.length / lineCount > 400; // a pretty-printed sheet averages well under 100 chars a line
  if (minified) return (offset) => `@${offset}`;
  const starts = [0];
  for (let k = 0; k < text.length; k += 1) if (text[k] === '\n') starts.push(k + 1);
  return (offset) => { let lo = 0; let hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; } return `L${lo + 1}`; };
}

function cli(argv) {
  const rest = argv.slice(2);
  if (!rest.length || rest.includes('--help') || rest.includes('-h')) { console.log(HELP); return rest.length ? 0 : 125; }
  let file = null; let pattern = null; let mediaRe = null; let noMedia = false; let declRe = null; let max = 40; let count = false;
  const re = (v, flag) => { try { return new RegExp(v, 'i'); } catch (e) { throw new Error(`bad ${flag} regex ${v}: ${e.message}`); } };
  // A value flag followed by nothing or by another --flag is a usage error naming the flag (125).
  const need = (i, flag) => { if (i + 1 >= rest.length || rest[i + 1].startsWith('--')) throw new Error(`${flag} needs a value\n${HELP}`); return rest[i + 1]; };
  try {
    for (let i = 0; i < rest.length; i += 1) {
      const a = rest[i];
      if (a === '--media') { mediaRe = re(need(i, a), a); i += 1; }
      else if (a === '--no-media') noMedia = true;
      else if (a === '--decl') { declRe = re(need(i, a), a); i += 1; }
      else if (a === '--max') { max = Number(need(i, a)); i += 1; }
      else if (a === '--count') count = true;
      else if (a.startsWith('--')) throw new Error(`unknown flag ${a}\n${HELP}`);
      else if (!file) file = a;
      else if (!pattern) pattern = a;
      else throw new Error(`unexpected argument ${a}\n${HELP}`);
    }
    if (!file || !pattern) throw new Error(`need <file.css> and a selector regex\n${HELP}`);
    const selRe = re(pattern, 'selector');
    let text; try { text = readFileSync(file, 'utf8'); } catch (e) { console.error(`css-rules: cannot read ${file}: ${e.message}`); return 1; }
    const all = parseCss(text);
    const matches = all.filter((r) => selRe.test(r.selector)
      && (!noMedia || r.media.length === 0)
      && (!mediaRe || r.media.some((m) => mediaRe.test(m)))
      && (!declRe || splitDeclarations(r.body).some((d) => declRe.test(d))));
    if (count) { console.log(`${matches.length} of ${all.length} rules match /${pattern}/i in ${file}`); return matches.length ? 0 : 2; }
    if (!matches.length) { console.error(`css-rules: no rule of ${all.length} matches /${pattern}/i${mediaRe ? ` under media /${mediaRe.source}/` : ''}${declRe ? ` with a declaration /${declRe.source}/` : ''} in ${file}`); return 2; }
    const lineOf = lineLocator(text);
    console.log(`${file}: ${matches.length} of ${all.length} rules match /${pattern}/i${matches.length > max ? `, showing ${max}` : ''}`);
    for (const r of matches.slice(0, max)) console.log(formatRule(r, lineOf, declRe));
    if (matches.length > max) console.log(`… ${matches.length - max} more — narrow the selector regex, add --media/--decl, or raise --max`);
    return 0;
  } catch (e) { console.error(`css-rules: ${e.message}`); return 125; }
}

// Main-module guard by REAL path: node resolves the entry's symlinks for import.meta.url but leaves process.argv[1]
// as typed, so a symlinked checkout or temp dir (e.g. /var → /private/var) would otherwise make the CLI a silent no-op.
function isMainModule(metaUrl) {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try { return realpathSync(argv1) === fileURLToPath(metaUrl); } catch { return false; }
}
if (isMainModule(import.meta.url)) process.exitCode = cli(process.argv);
