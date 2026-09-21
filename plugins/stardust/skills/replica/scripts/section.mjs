#!/usr/bin/env node
/**
 * skills/replica/scripts/section.mjs — read one section of a Markdown document,
 * or its outline, instead of the whole file.
 *
 * Why: everything a step prints stays in the agent's context for the rest of
 * the session and is re-read on every model call. In one recorded hands-off
 * session (2026-09-18) three reference documents were `cat`ed at once; each
 * overflowed the step's output limit and was then read again in full — 157k
 * characters for text the agent had already paid for once. A reference doc
 * is 30–40k characters; the section a phase needs is 2–4k.
 *
 * Usage:
 *   node section.mjs <file.md> --list                 # outline: level, line, title, length
 *   node section.mjs <file.md> "<heading regex>"      # the first matching heading + its body
 *       [--level <n>]      only headings of this level (2 = "##")
 *       [--max-lines <n>]  cap the body (default 400; the rest is named by line range)
 *       [--all]            every matching section, not just the first
 *                          more than one section → the printed total is capped at 20 KB: the
 *                          sections that fit print, one final NOTE names the omitted ones with
 *                          their sizes — request those one at a time. One section is never cut.
 *
 * The body runs to the next heading of the same or a higher level. Headings
 * inside fenced code blocks are ignored. Exit 0 = printed, 2 = no match
 * (the outline is printed so the next call can hit), 125 = usage.
 */

/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HELP = 'Usage: node section.mjs <file.md> (--list | "<heading regex>") [--level <n>] [--max-lines <n>] [--all]  (--all: 20 KB cap over more than one section; a NOTE names the rest)';
const MULTI_CAP = 20 * 1024; // printed characters when --all shows more than one section

export function outline(text) {
  const lines = text.split('\n');
  const out = [];
  let fence = null;
  lines.forEach((line, i) => {
    const f = line.match(/^\s*(```+|~~~+)/);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; return; }
    if (fence) return;
    const m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (m) out.push({ level: m[1].length, line: i + 1, title: m[2] });
  });
  out.forEach((h, k) => {
    let end = lines.length;
    for (let j = k + 1; j < out.length; j += 1) if (out[j].level <= h.level) { end = out[j].line - 1; break; }
    h.end = end; h.length = end - h.line + 1;
  });
  return out;
}

export function section(text, headingRe, { level = null, maxLines = 400 } = {}) {
  const heads = outline(text).filter((h) => (level ? h.level === level : true) && headingRe.test(h.title));
  if (!heads.length) return null;
  const lines = text.split('\n');
  return heads.map((h) => {
    const body = lines.slice(h.line - 1, h.end);
    const shown = body.slice(0, maxLines);
    const note = body.length > maxLines ? `… ${body.length - maxLines} more lines (L${h.line + maxLines}–L${h.end}); pass --max-lines or a narrower heading` : null;
    return { ...h, text: shown.join('\n'), note };
  });
}

export function formatOutline(heads, file) {
  const rows = heads.map((h) => `L${String(h.line).padStart(4)} ${'  '.repeat(h.level - 1)}${'#'.repeat(h.level)} ${h.title}  (${h.length} lines)`);
  return [`${file}: ${heads.length} headings`, ...rows].join('\n');
}

function cli(argv) {
  const rest = argv.slice(2);
  if (!rest.length || rest.includes('--help') || rest.includes('-h')) { console.log(HELP); return rest.length ? 0 : 125; }
  let file = null; let pattern = null; let list = false; let level = null; let maxLines = 400; let all = false;
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--list') list = true;
    else if (a === '--all') all = true;
    else if (a === '--level') level = Number(rest[++i]);
    else if (a === '--max-lines') maxLines = Number(rest[++i]);
    else if (a.startsWith('--')) { console.error(`section: unknown flag ${a}\n${HELP}`); return 125; }
    else if (!file) file = a;
    else if (!pattern) pattern = a;
    else { console.error(`section: unexpected argument ${a}\n${HELP}`); return 125; }
  }
  if (!file || (!list && !pattern)) { console.error(`section: need a file and --list or a heading regex\n${HELP}`); return 125; }
  let text; try { text = readFileSync(file, 'utf8'); } catch (e) { console.error(`section: cannot read ${file}: ${e.message}`); return 1; }
  const heads = outline(text);
  if (list) { console.log(formatOutline(heads, file)); return 0; }
  let re; try { re = new RegExp(pattern, 'i'); } catch (e) { console.error(`section: bad regex ${pattern}: ${e.message}`); return 125; }
  const found = section(text, re, { level, maxLines });
  if (!found) { console.error(`section: no heading matches /${pattern}/i in ${file} — outline:\n${formatOutline(heads, file)}`); return 2; }
  const show = all ? found : found.slice(0, 1);
  // More than one section: cap the printed total. A recorded session asked for five sections in one
  // call and carried 82 KB in its context for 160 turns. The sections that fit print in document
  // order; the rest are named with their sizes in one final NOTE. One section is never cut here.
  const blocks = show.map((s) => [`${file} L${s.line}–L${s.end} (${s.length} lines)`, s.text, s.note].filter(Boolean).join('\n'));
  const omitted = []; let used = 0;
  blocks.forEach((b, k) => {
    if (blocks.length > 1 && used + b.length > MULTI_CAP) { omitted.push(`${show[k].title} ${(b.length / 1024).toFixed(1)} KB`); return; }
    used += b.length + 1; console.log(b);
  });
  if (omitted.length) console.log(`NOTE: ${omitted.length} section(s) omitted (${omitted.join(', ')}) — request them one at a time`);
  if (!all && found.length > 1) console.log(`\nalso matches: ${found.slice(1).map((h) => `L${h.line} ${'#'.repeat(h.level)} ${h.title}`).join(' | ')}  (--all for every one)`);
  return 0;
}

// Main-module guard by REAL path: node resolves the entry's symlinks for import.meta.url but leaves process.argv[1]
// as typed, so a symlinked checkout or temp dir (e.g. /var → /private/var) would otherwise make the CLI a silent no-op.
function isMainModule(metaUrl) {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try { return realpathSync(argv1) === fileURLToPath(metaUrl); } catch { return false; }
}
if (isMainModule(import.meta.url)) process.exitCode = cli(process.argv);
