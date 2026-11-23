/**
 * skills/stardust/scripts/lib/names.mjs — EDS names: block names, the reserved set, and the widget stem/href/code-path
 * contract. Pure library: no I/O, nothing runs on import. Reached through ../contracts.mjs (README.md § Layout).
 *
 * Owns (and replaces): rollout lib.mjs RESERVED / edsName / reservedStem / widgetCodePath / pageWidgets, rollout
 * delivery-lint.mjs's widget stem, qa checks/content.mjs widgetLinks and migrate.mjs widgetHref / widgetsIn. Modelled on
 * deploy block-roundtrip.mjs widgetStem / widgetLinks, which keep their own copy: theirs matches `/widgets/` anywhere in
 * the path (`/a/widgets/x.html` → `x`, here null) and keeps `&amp;` in the href — a divergence for a later commit, pinned
 * by scripts/test/contracts-characterize.test.mjs.
 *
 * The widget contract (deploy SKILL.md § widgets): a page mounts a widget with ONE link `/widgets/<path>/<name>.html?<params>`
 * alone in its paragraph; the loader turns it into a block whose class is the file stem `<name>` verbatim. So:
 *   - a widget stem exists only for a `/widgets/…` href (same origin or another — the origin filter is the caller's,
 *     `widgetLinks({ base })`); any other href is a page link, never a widget (`widgetStem` → null);
 *   - the extension is case-insensitive and `.htm` counts (`/widgets/x.HTML`, `/widgets/x.htm` → `x`);
 *   - a reserved or `-wrapper`/`-container` stem collides with the loader's derived classes: `reservedStem` says so, the
 *     lint rejects it, nothing renames it (a block NAME is sanitised by `edsName`; a widget stem is not).
 */

/** EDS class names a block may not take (#15): the loader and the stock styles own them. */
export const RESERVED = new Set(['section', 'block', 'wrap', 'button', 'widget']);

/** EDS block name from a block id: kebab + guard against reserved classes and the derived -wrapper/-container suffixes. Pure. */
export function edsName(id) {
  let n = String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!n) n = 'block';
  if (RESERVED.has(n)) n = `blk-${n}`;
  // decorateBlock derives .<name>-wrapper/.<name>-container classes, so a block
  // NAMED with one of those suffixes collides with another block's derived class.
  if (/-(wrapper|container)$/.test(n)) n = `${n}-block`;
  return n;
}

/** A widget's file stem becomes its block class verbatim, so a reserved or -wrapper/-container stem collides (#15). Pure. */
export const reservedStem = (n) => RESERVED.has(String(n)) || /-(wrapper|container)$/.test(String(n));

/** The root-relative code path of an href, query and hash dropped (`https://h/widgets/a/b.html?q` → `/widgets/a/b.html`). Pure. */
const barePath = (href) => String(href).replace(/^https?:\/\/[^/]+/i, '').replace(/[?#].*/s, '');

/**
 * File stem of a widget href (`/widgets/search/site-search.html?q=docs` → `site-search`); null when the href is not a
 * widget link — not a string, or its path is not `/widgets/<path>/<name>[.ext]`. Extension case-insensitive, `.htm` included. Pure.
 */
export function widgetStem(href) {
  if (typeof href !== 'string') return null;
  const m = barePath(href).match(/^\/widgets\/(?:[^/]+\/)*([^/]+?)(?:\.[a-z0-9]+)?$/i);
  return m && m[1] ? m[1] : null;
}

/** The mount href a `data-widget="<path>/<name>"` value implies: `/widgets/<path>/<name>.html` (migrate's rule). Pure. */
export const widgetHref = (dataWidget) => `/widgets/${String(dataWidget).trim().replace(/^\/?(?:widgets\/)?/, '').replace(/\.html?$/i, '')}.html`;

/** Code path of a widget from its authored link: `/widgets/<path>/<name>.html?<params>` → `widgets/<path>/<name>.html` (rollout's rule). Pure. */
export const widgetCodePath = (href) => String(href).replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*/, '').replace(/^\//, '');

/**
 * Widget rows of a page from its sidecar's `widgets[]`: `{ id, href }` per entry that has an href AND is a widget — an
 * explicit `id` wins, otherwise the href's stem; an entry whose href is not a `/widgets/…` link is dropped (a page link is
 * never a widget). Pure.
 */
export const pageWidgets = (meta) => (Array.isArray(meta && meta.widgets) ? meta.widgets : [])
  .filter((w) => w && typeof w.href === 'string')
  .map((w) => ({ id: w.id ? String(w.id) : widgetStem(w.href), href: w.href }))
  .filter((w) => w.id);

const unescapeAmp = (s) => s.replace(/&amp;/g, '&');
const attr = (tag, name) => (tag.match(new RegExp(`(?<![\\w-])${name}\\s*=\\s*(["'])(.*?)\\1`, 'is')) || [])[2];

/**
 * Widget mounts authored or served in an HTML string → `[{ name, href, path }]` in document order. `name` is the block
 * class (the stem, or the last segment of `data-widget` when the mount has no widget href), `href` the link as authored
 * (`&amp;` decoded; '' for a `data-widget` mount without href under 'lone-paragraph'), `path` the root-relative code
 * file (`/widgets/<path>/<name>.html`, no query; '' when there is none).
 *   mount: 'lone-paragraph' (default) — a <p> whose only content is one <a> with a `/widgets/` href or a data-widget
 *          attribute: deploy block-roundtrip's rule, the stock auto-block's and dropWidgets'
 *          'any'            — every <a href> whose href is a widget link: qa content's rule for served HTML
 *          'data-widget'    — every <a data-widget>, its href defaulting to widgetHref(data-widget): migrate widgetsIn
 *   base:  an origin; an absolute href on another host is not this site's widget and is skipped (qa content's filter)
 *   dedupeBy: 'href' (default; block-roundtrip, migrate: the same code with other params is another mount) | 'path'
 *          (qa content: one row per code file)
 * Pure.
 */
export function widgetLinks(html, { mount = 'lone-paragraph', base = null, dedupeBy = 'href' } = {}) {
  const out = []; const seen = new Set();
  const host = base ? new URL(base).host.toLowerCase() : null;
  const anchors = [];
  if (mount === 'lone-paragraph') {
    const re = /<p\b[^>]*>\s*(<a\b[^>]*>)(?:(?!<a\b)[\s\S])*?<\/a>\s*<\/p>/gi;
    let m; while ((m = re.exec(html || '')) !== null) anchors.push(m[1]);
  } else {
    for (const m of String(html || '').matchAll(/<a\b[^>]*>/gi)) anchors.push(m[0]);
  }
  for (const a of anchors) {
    const dataWidget = attr(a, 'data-widget');
    if (mount === 'data-widget' && dataWidget === undefined) continue;
    let href = attr(a, 'href');
    href = href === undefined ? '' : unescapeAmp(href).trim();
    if (!href && mount === 'data-widget' && dataWidget !== undefined) href = widgetHref(dataWidget);
    if (mount === 'any' && !href) continue;
    const origin = href.match(/^https?:\/\/([^/]+)/i);
    if (origin && host && origin[1].toLowerCase() !== host) continue;
    const stem = widgetStem(href);
    const name = stem || (dataWidget !== undefined ? (String(dataWidget).trim().split('/').pop() || null) : null);
    if (!name) continue;
    const path = stem ? barePath(href) : '';
    const key = dedupeBy === 'path' ? (path || name) : (href || name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, href, path });
  }
  return out;
}
