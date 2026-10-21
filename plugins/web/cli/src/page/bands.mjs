// A page sliced into bands from its visual tree, with no model: siblings stacked top to bottom,
// siblings sharing a vertical range one band with parts side by side, consecutive text
// elements one run. A cut passes between elements, through at most the 8 px where neighbours
// overlap (negative margins, borders): cutting there beats merging the two. Ported from the
// migration pipeline's structure.mjs (`siblings`, `stack`, `runs`, `cut`), where it is the cut
// of every depth, measured on 70 pages of seven sites; two rules differ, noted where they are.

export const MIN_PART_WIDTH = 120; // narrower parts beside a wide one are decoration, not columns
// Side by side: two wide parts mostly clear of each other across — a grid's columns may
// overlap by a margin, a layer lies over most of what is under it.
export const SIDE_OVERLAP = 0.25;
export const MAX_DEPTH = 12; // a guard: every cut goes strictly inside, the tree ends sooner
// Prose: in EDS, default content is a run of these. Lists, links and spans are not here: they
// can be a nav, tabs or cards.
export const TEXT_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'PRE',
  'BLOCKQUOTE',
  'PICTURE',
  'IMG',
  'HR',
  'EM',
  'STRONG',
  'CODE',
  'FIGURE',
]);

/**
 * The level of the tree at which a range's parts are siblings: from the node, through
 * wrapper chains (one child inside the range, or one child covering it with only slivers
 * beside it or over it) to the first node with two or more children inside the range.
 */
export function siblings(tree, range) {
  const inside = (n) =>
    n.bounds.y + n.bounds.height > range.top + 2 && n.bounds.y < range.bottom - 2;
  let node = tree;
  for (let i = 0; i < MAX_DEPTH; i += 1) {
    const kids = (node.children ?? []).filter((k) => k.bounds.height > 0 && inside(k));
    if (kids.length === 0) return [node];
    if (kids.length === 1) {
      [node] = kids;
      continue;
    }
    const big = kids.filter((k) => k.bounds.height >= 0.95 * (range.bottom - range.top));
    const kept = (k) => beside(k, big[0]) || stacked(k, big[0]);
    if (big.length === 1 && kids.length <= 3 && !kids.some(kept)) {
      [node] = big;
      continue;
    }
    return kids;
  }
  return [node];
}

// Beside a child as tall as the range: clear of it across and more than a sliver (a side
// column, not a layer over it or a skip link).
function beside(k, big) {
  const a = k.bounds;
  const b = big.bounds;
  return (
    k !== big &&
    a.width * a.height >= 0.05 * b.width * b.height &&
    (a.x >= b.x + b.width - 8 || a.x + a.width <= b.x + 8)
  );
}

// Above or below a child as tall as the range: a band of its own (a header over a long main),
// never passed through. Unlike the pipeline, whose body range left the header out.
function stacked(k, big) {
  const a = k.bounds;
  const b = big.bounds;
  return k !== big && (a.y + a.height <= b.y + 8 || a.y >= b.y + b.height - 8);
}

const dedupeX = (parts) =>
  parts
    .sort((p, q) => p.x - q.x)
    .filter((p, j, all) => !all.slice(0, j).some((q) => Math.abs(q.x - p.x) < 40));
const partOf = (n) => ({ x: n.bounds.x, w: n.bounds.width, selector: n.selector });
const extentOf = (nodes) => ({
  left: Math.min(...nodes.map((n) => n.bounds.x)),
  right: Math.max(...nodes.map((n) => n.bounds.x + n.bounds.width)),
});

/**
 * Nodes stacked into slices within a range: those sharing a vertical range form one slice
 * with parts side by side; the others stack. Gaps belong to the slice above; the first starts
 * at the range's top, the last ends at its bottom.
 */
export function stack(nodes, range) {
  const sorted = [...nodes].sort((a, b) => a.bounds.y - b.bounds.y);
  const out = [];
  for (const n of sorted) {
    const y0 = Math.max(range.top, n.bounds.y);
    const y1 = Math.min(range.bottom, n.bounds.y + n.bounds.height);
    if (y1 - y0 < 4) continue;
    const last = out.at(-1);
    // An overlap of 8 px or less is cut through, not merged: see the module comment.
    if (last && y0 < last.bottom - 8) {
      last.bottom = Math.max(last.bottom, y1);
      last.nodes.push(n);
    } else out.push({ top: y0, bottom: y1, nodes: [n] });
  }
  for (let i = 1; i < out.length; i += 1) out[i - 1].bottom = out[i].top;
  if (out.length) {
    out[0].top = range.top;
    out.at(-1).bottom = range.bottom;
  }
  return out.map((b) => ({
    top: b.top,
    bottom: b.bottom,
    ...extentOf(b.nodes),
    parts: dedupeX(b.nodes.map(partOf)),
    nodes: b.nodes,
  }));
}

// Text elements side by side are columns (a row of images), not a run of prose.
const isText = (c) => c.nodes.every((n) => TEXT_TAGS.has(n.tag)) && !sideBySide(c);

// Consecutive runs of text elements are one slice.
function runs(slices) {
  const out = [];
  for (const c of slices) {
    const last = out.at(-1);
    if (last && isText(last) && isText(c)) {
      last.bottom = c.bottom;
      last.nodes.push(...c.nodes);
      Object.assign(last, extentOf(last.nodes));
      last.parts = dedupeX([...last.parts, ...c.parts]);
    } else out.push({ ...c, nodes: [...c.nodes], parts: [...c.parts] });
  }
  return out.map((c) => (isText(c) ? { ...c, text: true } : c));
}

const sideBySide = (c) => {
  const wide = c.parts.filter((p) => p.w >= MIN_PART_WIDTH);
  return wide.some((p, i) =>
    wide
      .slice(i + 1)
      .some(
        (q) =>
          Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) <= SIDE_OVERLAP * Math.min(p.w, q.w),
      ),
  );
};

// A side-by-side slice's columns: its nodes by x, each column its own range.
function columns(c) {
  const cols = [];
  for (const n of [...c.nodes].sort((a, b) => a.bounds.x - b.bounds.x)) {
    const col = cols.find((k) => Math.abs(k[0].bounds.x - n.bounds.x) < 40);
    if (col) col.push(n);
    else cols.push([n]);
  }
  return cols.map((nodes) => ({
    top: Math.max(c.top, Math.min(...nodes.map((n) => n.bounds.y))),
    bottom: Math.min(c.bottom, Math.max(...nodes.map((n) => n.bounds.y + n.bounds.height))),
    ...extentOf(nodes),
    parts: dedupeX(nodes.map(partOf)),
    nodes,
  }));
}

const weight = (n) => 1 + (n.children ?? []).reduce((s, k) => s + weight(k), 0);

/**
 * What is inside a slice, one level down: its columns when its parts sit side by side; else
 * its nodes stacked; else, for one node, through the wrapper chains to its siblings. Layers
 * (a background under its content) are passed through into the one with most content.
 * `side` tells which; `kids` is empty when the tree ends.
 */
export function cut(c) {
  if (sideBySide(c)) return { side: true, kids: columns(c) };
  let level = c.nodes.length > 1 ? c.nodes : null;
  let [node] = c.nodes;
  let carry = [];
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    if (!level) {
      const below = siblings(node, c);
      const leaf = below.length === 1 && !(below[0].children ?? []).length;
      if (leaf && !carry.length) return { side: false, kids: [] };
      level = [...carry, ...(leaf ? [] : below)];
    }
    let inner = stack(level, c);
    if (inner.length === 1 && carry.length) {
      // The layers carried along still lie over the content: the content alone.
      level = level.filter((n) => !carry.includes(n));
      inner = stack(level, c);
    }
    carry = [];
    if (inner.length !== 1) return { side: false, kids: runs(inner) };
    const [only] = inner;
    if (sideBySide(only)) return { side: true, kids: columns(only) };
    // One slice, one column: layers over each other, or a wrapper — into the one with most
    // content, the other layers carried along once to be stacked with its children.
    const next = only.nodes.reduce((a, n) => (weight(n) > weight(a) ? n : a));
    if (next === node && level.length === 1) return { side: false, kids: [] };
    carry = only.nodes.filter((n) => n !== next);
    node = next;
    level = null;
  }
  return { side: false, kids: [] };
}

const selectorsOf = (c) =>
  (c.text ? [...new Set(c.nodes.map((n) => n.selector))] : c.parts.map((p) => p.selector)).filter(
    Boolean,
  );

function toBand(c, id, { all, level }) {
  const inner = c.text ? { side: false, kids: [] } : cut(c);
  const band = {
    id,
    top: c.top,
    bottom: c.bottom,
    left: c.left,
    right: c.right,
    side: inner.side,
    text: Boolean(c.text),
    selectors: selectorsOf(c),
  };
  if (all && inner.kids.length && level < MAX_DEPTH) {
    band.children = inner.kids.map((k, i) =>
      toBand(k, `${id}.${i + 1}`, { all, level: level + 1 }),
    );
  }
  return band;
}

/** The page's extent: its root, or further down when content overflows the root. */
function pageRange(tree) {
  const bottoms = [tree, ...(tree.children ?? [])].map((n) => n.bounds.y + n.bounds.height);
  return { top: tree.bounds.y, bottom: Math.max(...bottoms) };
}

/**
 * Slice a visual tree into bands. Level 1 spans the page's width; `depth: 'all'` slices every
 * band again until nothing is left to cut.
 * @param {object} tree the `tree` of `page tree` (captureVisualTree's data)
 * @param {{ range?: { top: number, bottom: number }, depth?: '1' | 'all' | 1 }} [opts]
 */
export function bands(tree, { range = pageRange(tree), depth = 1 } = {}) {
  const width = { left: tree.bounds.x, right: tree.bounds.x + tree.bounds.width };
  const all = depth === 'all';
  // page-tree lifts fixed elements to the root: they float over the page, not in its flow.
  const flow = { ...tree, children: (tree.children ?? []).filter((k) => !k.fixed) };
  return runs(stack(siblings(flow, range), range)).map((c, i) =>
    toBand({ ...c, ...width }, `B${i + 1}`, { all, level: 1 }),
  );
}

/** The fixed elements floating over the page (a fixed header, a curtain), at scroll 0. */
export function fixedLayers(tree) {
  return (tree.children ?? [])
    .filter((k) => k.fixed)
    .map(({ selector, bounds: b }) => ({
      selector,
      top: b.y,
      bottom: b.y + b.height,
      left: b.x,
      right: b.x + b.width,
    }));
}

const MAX_SELECTORS = 2;

/** One line per band, indented by depth: `B3  800-3800  side  div.article, aside.side`. */
export function bandsText(list, indent = '') {
  return list
    .flatMap((b) => {
      const more = b.selectors.length > MAX_SELECTORS ? ', …' : '';
      const flags = [b.side && 'side', b.text && 'text'].filter(Boolean);
      const line = [
        `${indent}${b.id}`,
        `${b.top}-${b.bottom}`,
        ...flags,
        b.selectors.slice(0, MAX_SELECTORS).join(', ') + more,
      ].join('  ');
      return [line, ...(b.children ? [bandsText(b.children, `${indent}  `)] : [])];
    })
    .join('\n');
}
