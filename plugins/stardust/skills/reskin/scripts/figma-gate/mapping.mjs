// skills/reskin/scripts/figma-gate/mapping.mjs — the two reads of the section join that need no browser:
// the slot table of mapping.md and the first-heading anchor of every content-model slot.
import { UsageError } from '../figma/errors.mjs';

const SLOT = /^s\d+(-[a-z0-9-]+)?$/;
const NONE = new Set(['', '—', '–', '-']);
// Rows of a markdown table: runs of consecutive lines starting with "|".
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const plain = (c) => c.replace(/[`*_]/g, '').trim();
// "M3 (Card Row)": the id, with the module's name after it in parentheses.
const moduleId = (c) => plain(c).replace(/\s*\(.*\)$/, '');

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
    if (modCol >= 0 && statusCol >= 0) {
      const rows = [];
      for (const line of lines.slice(i + 1, end)) {
        const row = cells(line);
        const slot = plain(row[0] ?? '');
        if (!SLOT.test(slot)) continue;
        const module = moduleId(row[modCol] ?? '');
        rows.push({ slot, module: NONE.has(module) ? null : module, status: plain(row[statusCol] ?? '').toLowerCase() });
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
