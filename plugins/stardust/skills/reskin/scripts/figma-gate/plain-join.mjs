// skills/reskin/scripts/figma-gate/plain-join.mjs — B0 on a deployed preview: the reskin page's data-slot sections
// joined to the sections of the page's authored form (.plain.html). The preview's decorated DOM carries no slot
// marks, so each slot is found by its anchor text, first in the authored form (the page held to mapping.md: modules,
// anchors, order, nothing added) and then in the decorated page, whose `main > div:nth-child(k)` is the section the
// checks measure. The selector comes from the decorated page, never from the authored position: decoration prepends a
// section (stock buildHeroBlock) or drops an empty one, so the two lists need not line up one to one. No browser:
// the authored form is parsed as text, and the decorated sections' text is read by previewTarget's collect.
//   plainSections(html)  → [{ index, text, empty }], one per top-level <div> of <main>: its position, its text (tags
//                          off, entities decoded, whitespace collapsed, lower case) and whether it holds nothing
//   plainJoin({ local, plain, decorated, mapping, anchors, modules })  → { pass, sections, problems, notes },
//                          matchSections' result with each section's selector and index (its position in the
//                          decorated main) taken from the decorated page, and a note for each slot decoration moved
import { matchSections } from './join.mjs';
import { norm } from './mapping.mjs';

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
// A block-level tag ends a word; an inline one does not ("wor<strong>d</strong>s" is one word).
const BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'li', 'main', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul']);
const MEDIA = /<(img|picture|video|audio|svg|iframe|canvas|object|embed)\b/i;
const METADATA = new Set(['metadata', 'section-metadata']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', copy: '©', reg: '®', trade: '™' };

const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e) => {
  if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? whole;
  const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
  return Number.isInteger(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
});

// Comments, scripts and styles can hold tag-like text and are no content.
const bare = (html) => String(html ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '');

// The children of <main>; the whole document when it has none.
function mainOf(html) {
  const open = /<main\b[^>]*>/i.exec(html);
  if (!open) return html;
  const from = open.index + open[0].length;
  const close = html.toLowerCase().lastIndexOf('</main');
  return html.slice(from, close >= from ? close : undefined);
}

// The top-level <div>s of html as offsets { start, innerStart, innerEnd, end, attrs }: only <div> tags are counted, so
// a block's nested rows and cells never split a section, and a div left open runs to the end.
function topDivs(html) {
  const out = [];
  let depth = 0;
  let cur = null;
  for (const m of html.matchAll(TAG)) {
    if (m[2].toLowerCase() !== 'div') continue;
    if (!m[1]) {
      if (!depth) cur = { start: m.index, innerStart: m.index + m[0].length, attrs: m[3] };
      depth += 1;
    } else if (depth) {
      depth -= 1;
      if (!depth) out.push({ ...cur, innerEnd: m.index, end: m.index + m[0].length });
    }
  }
  if (depth) out.push({ ...cur, innerEnd: html.length, end: html.length });
  return out;
}

// The value of the class attribute in a tag's attribute text, read as a browser does: names are case-insensitive, the
// first one wins and a quoted value holds anything (data-class="x" and title="a class=b" are no class attribute).
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const classOf = (attrs) => {
  for (const m of attrs.matchAll(ATTR)) if (m[1].toLowerCase() === 'class') return m[2] ?? m[3] ?? m[4] ?? '';
  return '';
};

// A block's name is its first class, as the EDS decoration reads it.
const blockName = (attrs) => classOf(attrs).trim().split(/\s+/)[0].toLowerCase();

const textOf = (html) => norm(decode(html.replace(TAG, (_, __, name) => (BLOCK.has(name.toLowerCase()) ? ' ' : ''))));

export function plainSections(html) {
  const main = mainOf(bare(html));
  return topDivs(main).map((div, index) => {
    let inner = main.slice(div.innerStart, div.innerEnd);
    // The metadata blocks are no part of the section: EDS applies them and takes them out of the decorated DOM.
    for (const block of topDivs(inner).filter((d) => METADATA.has(blockName(d.attrs))).reverse()) {
      inner = inner.slice(0, block.start) + inner.slice(block.end);
    }
    const text = textOf(inner);
    return { index, text, empty: !text && !MEDIA.test(inner) };
  });
}

const parentOf = (slot) => /^(s\d+)-/.exec(slot)?.[1] ?? null;
const baseOf = (slot) => /^s\d+/.exec(slot)?.[0] ?? slot;

// Each slot, in the page's order, takes the first non-empty section of `list` at or after the previous slot's whose text
// holds the slot's anchor (a split sub-slot has its parent's anchor and may share the previous sub-slot's section).
// slots = [{ slot, anchor }]; the second argument phrases the problems for the list (where it is, what a section is
// called). → { found: Map(slot → section index), claimed: Set of the indexes of the sections a slot took or was found
// in too early, problems }. A slot found nowhere, only before the previous slot's, or in the section of a slot it is no
// sub-slot of, is a problem.
function place(slots, list, { where, missing, at, unit }) {
  const found = new Map();
  const claimed = new Set();
  const problems = [];
  let last = null;
  for (const { slot, anchor } of slots) {
    const holding = list.filter((s) => !s.empty && s.text.includes(anchor));
    const shares = last && parentOf(slot) === baseOf(last.slot);
    const from = last ? last.index + (shares ? 0 : 1) : 0;
    const hit = holding.find((s) => s.index >= from);
    if (hit) {
      found.set(slot, hit.index);
      claimed.add(hit.index);
      last = { slot, index: hit.index };
    } else if (holding.length) {
      const [early] = holding;
      claimed.add(early.index);
      problems.push(early.index === last.index
        ? `${slot} shares ${at(early.index)} with ${last.slot}: one ${unit} per slot`
        : `${slot} before ${last.slot} in ${where}: its text is in ${at(early.index)}, ${last.slot} is in ${at(last.index)}`);
    } else {
      problems.push(`${slot}: anchor "${anchor}" not in any ${missing}`);
    }
  }
  return { found, claimed, problems };
}

const AUTHORED = { where: '.plain.html', missing: '.plain.html section', at: (i) => `plain section ${i}`, unit: 'plain section' };
const DECORATED = { where: 'the decorated main', missing: 'decorated main > div', at: (i) => `main > div:nth-child(${i + 1})`, unit: 'decorated section' };

// local is localAttributes.collect on the reskin page; decorated is the innerText of each `main > div` of the opened
// preview. The page is joined to mapping.md as on a local run (matchSections: modules, anchors, order). Then each
// rendered slot is placed twice (see place). In the authored form a slot found nowhere, out of order or sharing a
// section, and a non-empty plain section no slot took, are section drift. In the decorated page the slot's anchor fixes
// the selector, `main > div:nth-child(k)` of the decorated div holding it, and index = k - 1; a slot found nowhere
// there, out of order or sharing a div (two slots would be measured in one section) is drift too. Decoration may add
// or drop whole sections, so k need not be the authored position: each slot where it differs gets a note. A slot the
// authored form lacks is reported once and not looked for in the decorated page.
export function plainJoin({ local, plain, decorated, mapping, anchors: anchorOf, modules }) {
  const matched = matchSections({ dom: local, mapping, anchors: anchorOf, modules });
  const problems = [...matched.problems];
  const drift = (msg) => problems.push(`section drift: ${msg}`);
  const slots = [];
  for (const s of [...matched.sections].sort((x, y) => x.index - y.index)) {
    const anchor = anchorOf.get(s.slot) ?? (parentOf(s.slot) && anchorOf.get(parentOf(s.slot)));
    if (anchor) slots.push({ slot: s.slot, anchor });
    else drift(`${s.slot} has no anchor text in content-model.json: it cannot be found in .plain.html`);
  }
  const authored = place(slots, plain, AUTHORED);
  authored.problems.forEach(drift);
  for (const p of plain) if (!p.empty && !authored.claimed.has(p.index)) drift(`plain section ${p.index} matches no slot`);

  const decoratedSections = decorated.map((raw, index) => {
    const text = norm(raw);
    return { index, text, empty: !text };
  });
  const rendered = place(slots.filter((s) => authored.found.has(s.slot)), decoratedSections, DECORATED);
  rendered.problems.forEach(drift);

  const notes = [];
  const sections = matched.sections.filter((s) => rendered.found.has(s.slot)).map((s) => {
    const index = rendered.found.get(s.slot);
    const wrote = authored.found.get(s.slot);
    if (index !== wrote) notes.push(`${s.slot}: decoration moved plain section ${wrote} to main > div:nth-child(${index + 1}): the selector follows the decorated page`);
    return { ...s, selector: `main > div:nth-child(${index + 1})`, index };
  });
  return { pass: problems.length === 0, sections, problems, notes };
}
