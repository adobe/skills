// skills/reskin/scripts/figma-gate/plain-join.mjs — B0 on a deployed preview: the reskin page's data-slot sections
// joined to the sections of the page's authored form (.plain.html). The preview's decorated DOM carries no slot
// marks, so each slot is found by its anchor text in the authored form, and the section the check measures is the
// decorated child `main > div:nth-child(k)` of the same position. No browser: the authored form is parsed as text.
//   plainSections(html)  → [{ index, text, empty }], one per top-level <div> of <main>: its position, its text (tags
//                          off, entities decoded, whitespace collapsed, lower case) and whether it holds nothing
//   plainJoin({ local, plain, mapping, anchors, modules })  → { pass, sections, problems }, matchSections' result
//                          with each section's selector and index taken from the authored form
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

// A block's name is its first class, as the EDS decoration reads it.
const blockName = (attrs) => {
  const m = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim().split(/\s+/)[0].toLowerCase();
};

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

// local is localAttributes.collect on the reskin page. The page is joined to mapping.md as on a local run (matchSections:
// modules, anchors, order); then each rendered slot, in the page's order, takes the first non-empty plain section after
// the previous slot's whose text holds its anchor (a split sub-slot has its parent's, and may share the previous
// sub-slot's section). A slot with no such section, a slot found only before the previous one, and a non-empty plain
// section no slot took are section drift. sections carry the decorated position: selector main > div:nth-child(index + 1).
export function plainJoin({ local, plain, mapping, anchors: anchorOf, modules }) {
  const matched = matchSections({ dom: local, mapping, anchors: anchorOf, modules });
  const problems = [...matched.problems];
  const drift = (msg) => problems.push(`section drift: ${msg}`);
  const found = new Map();
  const claimed = new Set();
  let last = null;
  for (const s of [...matched.sections].sort((x, y) => x.index - y.index)) {
    const anchor = anchorOf.get(s.slot) ?? (parentOf(s.slot) && anchorOf.get(parentOf(s.slot)));
    if (!anchor) { drift(`${s.slot} has no anchor text in content-model.json: it cannot be found in .plain.html`); continue; }
    const holding = plain.filter((p) => !p.empty && p.text.includes(anchor));
    const shares = last && parentOf(s.slot) === baseOf(last.slot);
    const from = last ? last.index + (shares ? 0 : 1) : 0;
    const hit = holding.find((p) => p.index >= from);
    if (hit) {
      found.set(s.slot, hit.index);
      claimed.add(hit.index);
      last = { slot: s.slot, index: hit.index };
    } else if (holding.length) {
      const [early] = holding;
      claimed.add(early.index);
      drift(early.index === last.index
        ? `${s.slot} shares plain section ${early.index} with ${last.slot}: one plain section per slot`
        : `${s.slot} before ${last.slot} in .plain.html: its text is in plain section ${early.index}, ${last.slot} is in plain section ${last.index}`);
    } else {
      drift(`${s.slot}: anchor "${anchor}" not in any .plain.html section`);
    }
  }
  for (const p of plain) if (!p.empty && !claimed.has(p.index)) drift(`plain section ${p.index} matches no slot`);

  const sections = matched.sections.filter((s) => found.has(s.slot)).map((s) => {
    const index = found.get(s.slot);
    return { ...s, selector: `main > div:nth-child(${index + 1})`, index };
  });
  return { pass: problems.length === 0, sections, problems };
}
