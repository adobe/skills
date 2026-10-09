/*
 * String-based reader for Personalization blocks in delivered EDS HTML.
 *
 * Used by the edge worker and by the skill's validator, so both read rows the
 * same way the browser runtime does. EDS markup for a block is regular:
 * <div class="personalization"><div><div>key</div><div>value</div></div>...</div>
 */

const DIV_TAG = /<(\/?)div\b[^>]*>/gi;
const COMMENT = /<!--[\s\S]*?-->/g;
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
};

/**
 * @param {string} text
 * @returns {string}
 */
export function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (match, name) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

/**
 * @param {string} value
 * @returns {string}
 */
export function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * @param {string} html fragment
 * @returns {string} text content, whitespace collapsed
 */
export function textContent(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} attrs raw attribute string of a tag
 * @param {string} name
 * @returns {string|undefined}
 */
export function getAttr(attrs, name) {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  if (!match) return undefined;
  return decodeEntities(match[1] ?? match[2] ?? match[3]);
}

/** Direct child divs of the range [start, end). */
function childDivs(html, start, end) {
  const re = new RegExp(DIV_TAG.source, 'gi');
  re.lastIndex = start;
  const children = [];
  let depth = 0;
  let current;
  let match = re.exec(html);
  while (match && match.index < end) {
    if (!match[1]) {
      if (depth === 0) current = { start: match.index, openEnd: match.index + match[0].length };
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0 && current) {
        current.closeStart = match.index;
        current.end = match.index + match[0].length;
        children.push(current);
        current = undefined;
      }
      if (depth < 0) break;
    }
    match = re.exec(html);
  }
  return children;
}

function findClose(html, from) {
  const re = new RegExp(DIV_TAG.source, 'gi');
  re.lastIndex = from;
  let depth = 1;
  let match = re.exec(html);
  while (match) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return { closeStart: match.index, end: match.index + match[0].length };
    match = re.exec(html);
  }
  return null;
}

/** Blanks out comments, keeping offsets, so commented markup is never read. */
function withoutComments(html) {
  return String(html).replace(COMMENT, (match) => ' '.repeat(match.length));
}

/**
 * Sections of a page: the top-level divs of <main>, or of the whole document
 * for .plain.html.
 * @param {string} html
 * @returns {{start: number, end: number}[]}
 */
export function sections(source) {
  const html = withoutComments(source);
  const main = /<main\b[^>]*>/i.exec(html);
  const start = main ? main.index + main[0].length : 0;
  const close = main ? html.indexOf('</main>', start) : -1;
  return childDivs(html, start, close === -1 ? html.length : close);
}

/**
 * Reads a value cell the way the browser runtime does.
 * @param {string} inner cell inner HTML
 * @returns {{value: string, href?: string, inline: boolean}}
 */
export function readCell(inner) {
  const value = textContent(inner);
  const anchors = [...inner.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  const href = anchors.length === 1 && textContent(anchors[0][2]) === value
    ? getAttr(anchors[0][1], 'href') : undefined;
  const paragraphs = (inner.match(/<p\b/gi) || []).length;
  const other = /<[a-z]/i.test(inner.replace(/<\/?p\b[^>]*>/gi, ''));
  return { value, href, inline: !href && (paragraphs > 1 || other) };
}

/**
 * Finds every block with the given class and reads its rows.
 * @param {string} html
 * @param {string} [name]
 * @returns {{start: number, openEnd: number, end: number, attrs: string,
 *   rows: {key: string, value: string, href?: string, inline: boolean, html: string}[]}[]}
 */
export function findBlocks(source, name = 'personalization') {
  const html = withoutComments(source);
  const open = /<div\b([^>]*)>/gi;
  const blocks = [];
  let match = open.exec(html);
  while (match) {
    const classes = (getAttr(match[1], 'class') || '').split(/\s+/);
    if (classes.includes(name)) {
      const openEnd = match.index + match[0].length;
      const close = findClose(html, openEnd);
      if (!close) break;
      const rows = childDivs(html, openEnd, close.closeStart).map((row) => {
        const cells = childDivs(html, row.openEnd, row.closeStart);
        const cellHtml = (cell) => (cell ? html.slice(cell.openEnd, cell.closeStart) : '');
        const valueHtml = cellHtml(cells[1]);
        return { key: textContent(cellHtml(cells[0])), ...readCell(valueHtml), html: valueHtml };
      });
      blocks.push({
        start: match.index, openEnd, end: close.end, attrs: match[1], classes, rows,
      });
      open.lastIndex = close.end;
    }
    match = open.exec(html);
  }
  return blocks;
}

/**
 * Returns the block's opening tag with data-pzn-* attributes replaced.
 * @param {{attrs: string}} block
 * @param {object} data name (without data-pzn-) -> value
 * @returns {string}
 */
export function openingTag(block, data) {
  const kept = block.attrs.replace(/\s+data-pzn-[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  const added = Object.entries(data)
    .map(([key, value]) => ` data-pzn-${key}="${escapeAttr(value)}"`).join('');
  return `<div${kept}${added}>`;
}

/**
 * Applies non-overlapping replacements.
 * @param {string} html
 * @param {{start: number, end: number, text: string}[]} edits
 * @returns {string}
 */
export function applyEdits(html, edits) {
  return [...edits].sort((a, b) => b.start - a.start)
    .reduce((out, edit) => out.slice(0, edit.start) + edit.text + out.slice(edit.end), html);
}

/**
 * Inserts markup right before </head>.
 * @param {string} html
 * @param {string} markup
 * @returns {string}
 */
export function injectHead(html, markup) {
  const index = html.search(/<\/head>/i);
  return index === -1 || !markup ? html : html.slice(0, index) + markup + html.slice(index);
}
