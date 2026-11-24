/*
 * String-based reader for EDS HTML: sections and their attributes.
 *
 * Used by the edge worker and by the skill's scripts, so both read sections
 * the same way the browser runtime does. EDS markup is regular: sections are
 * the top-level divs of <main>, a block is
 * <div class="name"><div><div>key</div><div>value</div></div>...</div>.
 * renderSectionMetadata() turns source content (DA, content/*.html) into what
 * the pipeline delivers, for scripts that read local content.
 */

// Quote-aware: `>` may appear inside attribute values (data-personalization-rule-x="...>...").
const ATTRS = '((?:[^>"\']|"[^"]*"|\'[^\']*\')*)';
const DIV_TAG = new RegExp(`<(\\/?)div\\b${ATTRS}>`, 'gi');
const DIV_OPEN = new RegExp(`<div\\b${ATTRS}>`, 'gi');
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
  // eslint-disable-next-line no-use-before-define
  const found = parseAttrs(attrs).find(([key]) => key === name.toLowerCase());
  return found ? found[1] : undefined;
}

/**
 * All attributes of a tag, in document order, names lowercased.
 * @param {string} attrs raw attribute string of a tag
 * @returns {[string, string][]}
 */
export function parseAttrs(attrs) {
  const out = [];
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match = re.exec(attrs || '');
  while (match) {
    const name = match[1].toLowerCase();
    if (!out.some(([key]) => key === name)) out.push([name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')]);
    match = re.exec(attrs);
  }
  return out;
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
 * @returns {{start: number, openEnd: number, closeStart: number, end: number}[]}
 */
export function sections(source) {
  const html = withoutComments(source);
  const main = /<main\b[^>]*>/i.exec(html);
  const start = main ? main.index + main[0].length : 0;
  const close = main ? html.indexOf('</main>', start) : -1;
  return childDivs(html, start, close === -1 ? html.length : close);
}

/**
 * Sections with their attributes, as the browser sees them before
 * decoration.
 * @param {string} html delivered page or .plain.html
 * @returns {{start: number, openEnd: number, closeStart: number, end: number,
 *   attrs: string, attributes: [string, string][], classes: string[]}[]}
 */
export function findSections(source) {
  const html = withoutComments(source);
  return sections(html).map((section) => {
    const attrs = new RegExp(DIV_OPEN.source, 'i').exec(html.slice(section.start, section.openEnd))?.[1] || '';
    const attributes = parseAttrs(attrs);
    const classes = (attributes.find(([name]) => name === 'class')?.[1] || '').split(/\s+/).filter(Boolean);
    return {
      ...section, attrs, attributes, classes,
    };
  });
}

// helix-html-pipeline utils/modifiers.js toMetaName
const toMetaName = (text) => text.replace(/[^0-9a-zA-Z:_-]/g, '-').toLowerCase();
const toClassNames = (text) => {
  const index = text.lastIndexOf('(');
  const names = index >= 0 ? [text.slice(0, index), ...text.slice(index + 1).split(',')] : [text];
  return names.map((name) => name.toLowerCase().replace(/[^0-9a-z]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean);
};

/**
 * A Section Metadata value as the pipeline extracts it: image srcs and link
 * hrefs (absolute), and text split on commas, joined with ",".
 * @param {string} inner cell inner HTML
 * @param {string} base page URL the pipeline resolves relative links against
 * @returns {string}
 */
export function metadataValue(inner, base = 'https://localhost/') {
  const items = [];
  const absolute = (url) => {
    try {
      return url.startsWith('https://') ? url : new URL(url, base).href;
    } catch (e) {
      return url;
    }
  };
  const re = /<(\/?)([a-z][a-z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/gi;
  let skipping = 0;
  let match = re.exec(inner);
  while (match) {
    const [, closing, tag, attrs, text] = match;
    const name = tag?.toLowerCase();
    if (skipping) {
      if (name === 'a') skipping += closing ? -1 : 1;
    } else if (text !== undefined) {
      items.push(...decodeEntities(text).split(',').map((part) => part.trim()).filter(Boolean));
    } else if (!closing && name === 'img' && getAttr(attrs, 'src')) {
      items.push(absolute(getAttr(attrs, 'src')));
    } else if (!closing && name === 'a' && getAttr(attrs, 'href')) {
      items.push(absolute(getAttr(attrs, 'href')));
      skipping = 1;
    }
    match = re.exec(inner);
  }
  return items.join(',');
}

/**
 * Renders source content (DA, content/*.html) the way the pipeline delivers
 * it (extract-section-metadata, rendering v2): every Section Metadata row
 * becomes a data-<name> attribute of its section, in authoring order (a
 * repeated name keeps its first position and takes the later value), `style`
 * adds classes, and the block is removed.
 * @param {string} source page HTML
 * @param {object} [options]
 * @param {string} [options.base] page URL, for relative links
 * @returns {{html: string, sections: {index: number, attributes: [string, string][],
 *   rows: {name: string, key: string, html: string, paragraphs: number}[], repeated: string[]}[]}}
 */
export function renderSectionMetadata(source, { base } = {}) {
  const html = withoutComments(source);
  const edits = [];
  const found = [];
  sections(html).forEach((section, index) => {
    // eslint-disable-next-line no-use-before-define
    const metadata = findBlocks(html.slice(section.openEnd, section.closeStart), 'section-metadata')[0];
    if (!metadata) return;
    const attrs = new RegExp(DIV_OPEN.source, 'i').exec(html.slice(section.start, section.openEnd))?.[1] || '';
    const attributes = parseAttrs(attrs);
    const classes = (attributes.find(([name]) => name === 'class')?.[1] || '').split(/\s+/).filter(Boolean);
    const data = new Map(attributes.filter(([name]) => name !== 'class'));
    const rows = [];
    const repeated = [];
    metadata.rows.forEach((row) => {
      const name = toMetaName(row.key);
      if (!name) return;
      rows.push({
        name, key: row.key, html: row.html, paragraphs: (row.html.match(/<p\b/gi) || []).length,
      });
      if (name === 'style') {
        classes.push(...textContent(row.html.replace(/<br\b[^>]*>/gi, ',')).split(',').flatMap(toClassNames));
      } else if (name === 'id') {
        data.set('id', toClassNames(textContent(row.html))[0] || '');
      } else {
        if (data.has(`data-${name}`)) repeated.push(row.key);
        data.set(`data-${name}`, metadataValue(row.html, base));
      }
    });
    const rendered = [...(classes.length ? [['class', classes.join(' ')]] : []), ...data];
    found.push({
      index, attributes: rendered, rows, repeated,
    });
    const open = `<div${rendered.map(([name, value]) => ` ${name}="${escapeAttr(value)}"`).join('')}>`;
    edits.push({ start: section.start, end: section.openEnd, text: open });
    edits.push({
      start: section.openEnd + metadata.start, end: section.openEnd + metadata.end, text: '',
    });
  });
  // eslint-disable-next-line no-use-before-define
  return { html: applyEdits(html, edits), sections: found };
}

/**
 * Finds every block with the given class and reads its key/value rows.
 * @param {string} html
 * @param {string} name block class, e.g. section-metadata
 * @returns {{start: number, openEnd: number, end: number, attrs: string,
 *   classes: string[], rows: {key: string, html: string}[]}[]}
 */
export function findBlocks(source, name) {
  const html = withoutComments(source);
  const open = new RegExp(DIV_OPEN.source, 'gi');
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
        return { key: textContent(cellHtml(cells[0])), html: cellHtml(cells[1]) };
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
 * Returns the section's opening tag with data-pzn-* attributes replaced.
 * @param {{attrs: string}} section
 * @param {object} data name (without data-pzn-) -> value
 * @returns {string}
 */
export function openingTag(section, data) {
  const kept = section.attrs.replace(/\s+data-pzn-[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
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
