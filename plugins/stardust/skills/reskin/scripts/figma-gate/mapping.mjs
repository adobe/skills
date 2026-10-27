// skills/reskin/scripts/figma-gate/mapping.mjs — the two reads of the section join that need no browser:
// the slot table of mapping.md and the first-heading anchor of every content-model slot.
import { UsageError } from '../figma/errors.mjs';

const SLOT = /^s\d+(-[a-z0-9-]+)?$/;
export const STATUSES = ['mapped', 'new-module', 'chrome', 'carried-invisible'];
const NONE = new Set(['', '—', '–', '-']);
// Rows of a markdown table: runs of consecutive lines starting with "|". A cell ends at an unescaped "|"; an escaped
// "\\|" (a pipe inside a module name) is cell text, read as "|".
export const cells = (line) => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
const plain = (c) => c.replace(/[`*_]/g, '').trim();
// "M3 (Card Row)": the id, with the module's name after it in parentheses.
const moduleId = (c) => plain(c).replace(/\s*\(.*\)$/, '');
// The page chrome a chrome row stands for, from its slot id, then its Donor module cell (the module's name), then its
// Content, the first word in each that names one: header (header, nav, navigation, masthead) or footer; null for other
// chrome (a banner).
const CHROME_WORD = /\b(header|nav|navigation|masthead|footer)\b/i;
export const chromePart = (...texts) => {
  for (const t of texts) {
    const word = CHROME_WORD.exec(plain(String(t ?? '')).replace(/[-_]/g, ' '))?.[1].toLowerCase();
    if (word) return word === 'footer' ? 'footer' : 'header';
  }
  return null;
};

export const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

// The first table whose header has Status and Donor module (reference/mapping-brief.md § Entry schema).
export function parseMapping(md) {
  const lines = String(md).split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trim().startsWith('|')) continue;
    let end = i;
    while (end < lines.length && lines[end].trim().startsWith('|')) end += 1;
    const head = cells(lines[i]).map((c) => plain(c).toLowerCase());
    const modCol = head.indexOf('donor module');
    const statusCol = head.indexOf('status');
    const contentCol = head.indexOf('content');
    if (modCol >= 0 && statusCol >= 0) {
      const rows = [];
      for (const line of lines.slice(i + 1, end)) {
        const row = cells(line);
        const slot = plain(row[0] ?? '');
        if (!SLOT.test(slot)) continue;
        const module = moduleId(row[modCol] ?? '');
        const status = plain(row[statusCol] ?? '').toLowerCase();
        if (!STATUSES.includes(status)) throw new UsageError(`mapping.md: ${slot} has Status "${status}"; use one of ${STATUSES.join(' | ')}`);
        const entry = { slot, module: NONE.has(module) ? null : module, status };
        if (status === 'chrome') entry.part = chromePart(slot, row[modCol], contentCol >= 0 ? row[contentCol] : '');
        rows.push(entry);
      }
      return rows;
    }
    i = end;
  }
  throw new UsageError('mapping.md has no slot table: use the table form of reference/mapping-brief.md § Entry schema');
}

const TEXT_KINDS = new Set(['heading', 'text', 'paragraph', 'listItem', 'cta']);

// The text a slot is recognised by: its first heading, else its first ordered text node, else the first
// 60 characters of its visible text.
export function anchors(model) {
  const out = new Map();
  for (const s of model?.sections || []) {
    const heading = s.headings?.find((h) => norm(h.text))?.text;
    const node = s.ordered?.find((n) => TEXT_KINDS.has(n.kind) && norm(n.text))?.text;
    const anchor = norm(heading ?? node ?? norm(s.visibleText).slice(0, 60));
    if (anchor) out.set(s.slot, anchor);
  }
  return out;
}
