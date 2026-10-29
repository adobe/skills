// skills/reskin/scripts/figma/eds-map.mjs — a Figma component / module name → the EDS block it becomes.
// The rule is deploy's Step 2 (skills/deploy/SKILL.md § 2. Decide names + reuse), applied mechanically:
//   D1   no repeating units and no bespoke interactive structure → default content (block null): buttons,
//        a text link, headings, body copy are what aem.js decorates, never a block (a kit's "Links" is a link
//        list: it keeps its name).
//   D11  a boilerplate or Block Collection pattern → that block's name (accordion, cards, form, …), the
//        Figma name kept as the variant where it tells variants apart (Teaser → cards teaser); a pattern
//        word anywhere in the name counts too (Accordion Item → accordion, Table – Striped → table striped,
//        Image Top Columns → columns image-top).
//   else the Figma name, kebab-cased and kept off the reserved EDS classes: an invented block only when
//        nothing in EDS matches (Chips → chips).
// A Figma kit is a proposal; this module is the one place a Figma name becomes an EDS name. Pure.

export const BOILERPLATE = ['cards', 'columns', 'footer', 'fragment', 'header', 'hero'];
export const BLOCK_COLLECTION = ['accordion', 'breadcrumbs', 'carousel', 'embed', 'form', 'modal', 'quote', 'search', 'table', 'tabs', 'video'];
export const RESERVED = ['section', 'block', 'wrap', 'button'];
export const STEP2 = 'deploy Step 2';

// "❖ Q&A" → "q-and-a"; "Checkbox & Radio" → "checkbox-and-radio" (matched loosely below).
export const slugOf = (name) => String(name ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// A block name EDS can carry: kebab, never a reserved runtime class, never a derived -wrapper/-container.
export function safeBlockName(name) {
  let n = slugOf(name) || 'block';
  if (RESERVED.includes(n)) n = `blk-${n}`;
  if (/-(wrapper|container)$/.test(n)) n = `${n}-block`;
  return n;
}

const DEFAULT_CONTENT = new Set([
  'button', 'buttons', 'btn', 'btns', 'cta-button', 'link', 'text-link', 'text', 'texts', 'heading', 'headings',
  'title', 'title-text', 'rich-text', 'richtext', 'body-copy', 'copy', 'paragraph', 'block-content', 'content-block', 'email',
  'image', 'picture', 'separator', 'divider',
]);

// [block, exact names, last-token names (the name ends with one: "faq-accordion", "product-card"), variant]
// variant: null | 'name' (the Figma name, unless it is the block's own name) | (slug, tokens) => string|null
//   | 'field': a form field module (input, checkbox, dropdown, …) — the Block Collection form's content model
//     makes field types rows (Label | value | type | state) of the one form block, never classes: variant null.
const heroVariant = (s, t) => t.filter((x) => !['hero', 'home', 'page', 'main'].includes(x)).join('-') || null;
// The Block Collection table's own variants; any other table name is the plain table.
const TABLE_VARIANTS = ['striped', 'bordered', 'no-header'];
const tableVariant = (s) => TABLE_VARIANTS.find((v) => `-${s}-`.includes(`-${v}-`)) ?? null;
const RULES = [
  ['header', ['header', 'headers', 'site-header', 'global-header', 'nav', 'navigation', 'navbar', 'nav-bar', 'top-bar', 'topbar'], [], null],
  ['footer', ['footer', 'footers', 'site-footer', 'global-footer'], [], null],
  ['accordion', ['accordion', 'accordions', 'q-and-a', 'q-a', 'qa', 'qna', 'q-n-a', 'faq', 'faqs', 'expander', 'expanders', 'expandable', 'collapse', 'collapsible', 'disclosure'], ['accordion', 'faq', 'faqs'], null],
  ['cards', ['cards', 'card', 'teaser', 'teasers', 'tile', 'tiles'], ['card', 'cards', 'teaser', 'teasers', 'tile', 'tiles'], 'name'],
  ['hero', ['hero', 'heroes', 'heros'], [], heroVariant],
  ['table', ['table', 'tables', 'data-table', 'data-tables', 'datatable'], ['table', 'tables'], tableVariant],
  ['breadcrumbs', ['breadcrumb', 'breadcrumbs', 'crumbs'], [], null],
  ['search', ['search', 'search-bar', 'searchbar', 'search-box', 'searchbox', 'search-field', 'search-input'], [], null],
  ['tabs', ['tabs', 'tab', 'tab-group', 'tabset'], ['tabs'], null],
  ['tabs', ['tab-nav', 'tab-navigation', 'tab-bar', 'tabbar', 'tab-menu'], [], () => 'nav'],
  ['form', ['form', 'forms', 'form-fields'], ['form', 'forms'], (s) => (['form', 'forms', 'form-fields'].includes(s) ? null : s)],
  ['form', ['input', 'inputs', 'text-field', 'text-fields', 'textfield', 'text-input', 'textarea', 'text-area', 'checkbox', 'checkboxes',
    'radio', 'radios', 'radio-button', 'radio-buttons', 'checkbox-radio', 'checkbox-and-radio', 'checkboxes-and-radios', 'dropdown',
    'dropdowns', 'select', 'selects', 'toggle', 'toggles', 'switch', 'switches', 'slider', 'sliders', 'range', 'range-slider'], [], 'field'],
  ['form', ['login', 'log-in', 'sign-in', 'signin', 'login-and-registration', 'registration', 'sign-up', 'signup'], [], 'name'],
  ['modal', ['modal', 'modals', 'dialog', 'dialogs', 'overlay', 'overlays', 'popup', 'pop-up', 'lightbox'], [], null],
  ['carousel', ['carousel', 'carousels', 'slideshow', 'slide-show', 'gallery-carousel'], ['carousel'], null],
  ['columns', ['columns', 'column', 'two-column', 'multi-column'], [], null],
  ['quote', ['quote', 'quotes', 'blockquote', 'pull-quote', 'pullquote', 'testimonial', 'testimonials'], [], null],
  ['embed', ['embed', 'embeds', 'iframe'], [], null],
  ['video', ['video', 'videos', 'video-player'], [], null],
  ['fragment', ['fragment', 'fragments'], [], null],
];
const KIND = (block) => (BOILERPLATE.includes(block) ? 'boilerplate' : 'Block Collection');

// Second pass, for names the rules above miss: the pattern word anywhere in the name ("Accordion Item",
// "FAQ Section", "Table – Striped", "Image Top Columns", "3 Columns"). Columns keeps the layout words as
// its variant, image-on-top spellings as image-top, and drops column counts (the columns block derives
// columns-<n>-cols itself).
const IMAGE_TOP = /(^|-)(image|img|media|photo|picture)-(on-)?top(-|$)|(^|-)top-(image|img|media|photo|picture)(-|$)/;
const COLUMN_WORDS = new Set(['column', 'columns', 'col', 'cols', 'layout', 'layouts', 'block', 'grid', 'one', 'two', 'three', 'four', 'multi', 'up']);
const ANYWHERE = [
  ['accordion', (s, t) => t.some((x) => ['accordion', 'accordions', 'faq', 'faqs', 'disclosure', 'disclosures', 'expander', 'expanders', 'collapsible', 'collapsibles'].includes(x))
    || /(^|-)q-(and-)?a(-|$)/.test(s), () => null],
  ['table', (s, t) => t.some((x) => ['table', 'tables', 'datatable'].includes(x)) && !/(^|-)table-of-contents(-|$)/.test(s),
    tableVariant],
  ['columns', (s, t) => t.some((x) => ['column', 'columns', 'col', 'cols'].includes(x)) || IMAGE_TOP.test(s),
    (s, t) => (IMAGE_TOP.test(s) ? 'image-top' : t.filter((x) => !COLUMN_WORDS.has(x) && !/^\d+$/.test(x)).join('-') || null)],
];

/**
 * edsEquivalent(figmaName, { hasRepeatingUnits, interactive, anatomy, blocks }) → { block, variant, reason }
 * block null = default content (D1). The flags are optional: unknown is treated as "may be a block", so only
 * the default-content names and an explicit { hasRepeatingUnits: false, interactive: false } fall to D1.
 * anatomy (the module's slots): a card name whose anatomy is a full-bleed image with copy over it is a hero.
 * blocks (the project's block names): an invented block another block can host is that block's variant.
 */
export function edsEquivalent(figmaName, opts = {}) {
  const e = byName(figmaName, opts);
  const label = String(figmaName ?? '').trim();
  if (e.block === 'cards' && FULL_BLEED.test(opts.anatomy || '') && OVER_IMAGE.test(opts.anatomy || '')) {
    const v = e.variant || slugOf(figmaName);
    return { block: 'hero', variant: v === 'hero' ? null : v, reason: `${STEP2} D11: "${label}" is a full-bleed image with copy over it — the hero block, not a card` };
  }
  const host = variantHost(e.block, opts.blocks);
  if (host) return { block: host, variant: e.block, reason: `${STEP2} D11: "${label}" is a variant of the project's ${host} block (variant-first: no second block)` };
  return e;
}

// A full-bleed image with copy laid over it (the anatomy line of a module).
const FULL_BLEED = /full[- ](bleed|width)|background image|edge[- ]to[- ]edge/i;
const OVER_IMAGE = /overlay|over the image|on the image|over a(n)? (image|photo)/i;
// Invented blocks an existing block hosts as a variant (the same authored rows: a list of links).
export const VARIANT_HOSTS = { links: ['chips', 'chip', 'pills', 'tags', 'tag-list', 'pagination', 'link-list'] };
/** variantHost(block, blocks) → the project block that hosts `block` as a variant, or null. */
export function variantHost(block, blocks) {
  if (!block || !Array.isArray(blocks) || blocks.includes(block)) return null;
  return Object.keys(VARIANT_HOSTS).find((h) => blocks.includes(h) && VARIANT_HOSTS[h].includes(block)) ?? null;
}

function byName(figmaName, { hasRepeatingUnits, interactive } = {}) {
  const slug = slugOf(figmaName);
  const label = String(figmaName ?? '').trim() || slug;
  if (!slug) return { block: null, variant: null, reason: `${STEP2} D1: "${label}" has no name to map — default content` };
  const tokens = slug.split('-');
  const loose = slug.replace(/-and-/g, '-');
  for (const [block, exact, last, variant] of RULES) {
    if (!exact.includes(slug) && !exact.includes(loose) && !last.includes(tokens.at(-1)) && !(block === 'hero' && tokens.includes('hero'))) continue;
    if (variant === 'field') return { block, variant: null, field: true, reason: `${STEP2} D11: "${label}" is field type rows of the Block Collection form, not a variant` };
    let v = null;
    if (variant === 'name') v = slug === block || slug === block.replace(/s$/, '') ? null : slug;
    else if (typeof variant === 'function') v = variant(slug, tokens);
    return { block, variant: v, reason: `${STEP2} D11: "${label}" matches the ${KIND(block)} ${block} block${v ? ` (variant ${v})` : ''}` };
  }
  for (const [block, hit, variant] of ANYWHERE) {
    if (!hit(slug, tokens)) continue;
    const v = variant(slug, tokens);
    return { block, variant: v, reason: `${STEP2} D11: "${label}" matches the ${KIND(block)} ${block} block${v ? ` (variant ${v})` : ''}` };
  }
  const reserved = safeBlockName(slug) !== slug;
  if (DEFAULT_CONTENT.has(slug) || DEFAULT_CONTENT.has(loose)) {
    if (hasRepeatingUnits || interactive) return { block: safeBlockName(slug), variant: null, reason: `${STEP2} D1: "${label}" has ${hasRepeatingUnits ? 'repeating units' : 'interactive structure'} so it is a block; D11: no EDS match — keeps its Figma name` };
    return { block: null, variant: null, reason: `${STEP2} D1: "${label}" is default content (no repeating units, no bespoke interactive structure) — no block` };
  }
  if (hasRepeatingUnits === false && interactive === false) return { block: null, variant: null, reason: `${STEP2} D1: "${label}" has no repeating units and no interactive structure — default content` };
  const block = safeBlockName(slug);
  return { block, variant: null, reason: `${STEP2} D11: "${label}" matches no boilerplate or Block Collection block — keeps its Figma name${reserved ? ` (reserved EDS class, renamed ${block})` : ''}` };
}

// "accordion", "cards (teaser)", "default content" — the short form docs and tables print.
export const edsLabel = (e) => (!e ? '' : e.block === null ? 'default content' : `${e.block}${e.variant ? ` (${e.variant})` : ''}`);

// The plain form block is shared: field modules (and a recorded variant-less form) are rows of the one form.
const sharedForm = (e) => e.field === true || (e.block === 'form' && !e.variant);

/**
 * Several Figma modules → one EDS block: each becomes a variant of it. entries: [{ key, figma, eds }] in kit
 * order; a module whose (block, variant) another already holds takes its Figma slug as the variant, so no
 * two modules render the same block the same way and no block name is ever suffixed. Form field modules are
 * the exception: they all share the plain form block (field type rows, never variants). Returns eds objects.
 */
export function resolveVariants(entries) {
  const seen = new Set();
  return entries.map(({ key, figma, eds }) => {
    if (!eds || eds.block === null || sharedForm(eds)) return eds;
    let out = eds;
    const id = (e) => `${e.block}|${e.variant ?? ''}`;
    if (seen.has(id(out))) {
      const v = slugOf(figma || key);
      out = { ...eds, variant: eds.variant && eds.variant !== v ? `${eds.variant}-${v}` : v, reason: `${eds.reason}; another module already renders ${edsLabel(eds)} — a variant of it` };
      for (let i = 2; seen.has(id(out)); i += 1) out = { ...out, variant: `${v}-${i}` };
    }
    seen.add(id(out));
    return out;
  });
}

// ---- disposition: what a recorded module becomes in the project (deploy Step 2c, Full donor vocabulary) ----
// block | variant (an authored block option, preferred over a new block) | chrome (header/footer) and, with no
// block: section-style (a section-metadata Style value, `name` = the class) | style (global CSS in styles.css:
// form fields, tooltip) | convention (an authoring convention aem.js decorates: strong / em links → buttons) |
// feature (scripts/ behaviour: back-to-top, /modals/ links) |
// default-content (D1). Every included module gets exactly one; deploy builds each, used by a page or not.
export const DISPOSITIONS = ['block', 'variant', 'chrome', 'section-style', 'style', 'convention', 'feature', 'default-content'];
export const BLOCKLESS = ['section-style', 'style', 'convention', 'feature', 'default-content'];
// Every blockless kind says why (what it styles or does, where it lives); a block's why is optional.
export const NEEDS_WHY = BLOCKLESS;
const CHROME = ['header', 'footer'];

/** disposition(eds, why) → { kind, block, variant, name, why }. eds.as names a blockless kind; else derived. */
export function disposition(eds, why = '') {
  const e = eds || { block: null, variant: null };
  const w = String(why ?? '').trim();
  if (e.block) {
    const kind = CHROME.includes(e.block) ? 'chrome' : e.variant ? 'variant' : 'block';
    return { kind, block: e.block, variant: e.variant ?? null, name: null, why: w };
  }
  return { kind: BLOCKLESS.includes(e.as) ? e.as : 'default-content', block: null, variant: null, name: e.name ?? null, why: w };
}

// "variant", "section-style (email): <why>", "feature: <why>" — the donor-modules.md Disposition cell.
export const dispositionLabel = (d) => `${d.kind}${d.name ? ` (${d.name})` : ''}${d.why ? `: ${d.why}` : ''}`;

/** The inverse of dispositionLabel, for a Disposition cell read back from donor-modules.md; null when malformed. */
export function parseDisposition(cell) {
  const m = String(cell ?? '').trim().match(/^([a-z-]+)(?: \(([^)]+)\))?(?::\s*(.*))?$/s);
  if (!m || !DISPOSITIONS.includes(m[1])) return null;
  return { kind: m[1], name: m[2] ?? null, why: (m[3] ?? '').trim() };
}
