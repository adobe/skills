// skills/reskin/scripts/figma/eds-map.mjs — a Figma component / module name → the EDS block it becomes.
// The rule is deploy's Step 2 (skills/deploy/SKILL.md § 2. Decide names + reuse), applied mechanically:
//   D1   no repeating units and no bespoke interactive structure → default content (block null): buttons,
//        links, headings, body copy are what aem.js decorates, never a block.
//   D11  a boilerplate or Block Collection pattern → that block's name (accordion, cards, form, …), the
//        Figma name kept as the variant where it tells variants apart (Teaser → cards teaser).
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
  'button', 'buttons', 'btn', 'btns', 'cta-button', 'link', 'links', 'text-link', 'text', 'texts', 'heading', 'headings',
  'title', 'title-text', 'rich-text', 'richtext', 'body-copy', 'copy', 'paragraph', 'block-content', 'content-block', 'email',
  'image', 'picture', 'separator', 'divider',
]);

// [block, exact names, last-token names (the name ends with one: "faq-accordion", "product-card"), variant]
// variant: null | 'name' (the Figma name, unless it is the block's own name) | (slug, tokens) => string|null
//   | 'field': a form field module (input, checkbox, dropdown, …) — the Block Collection form's content model
//     makes field types rows (Label | value | type | state) of the one form block, never classes: variant null.
const heroVariant = (s, t) => t.filter((x) => !['hero', 'home', 'page', 'main'].includes(x)).join('-') || null;
const RULES = [
  ['header', ['header', 'headers', 'site-header', 'global-header', 'nav', 'navigation', 'navbar', 'nav-bar', 'top-bar', 'topbar'], [], null],
  ['footer', ['footer', 'footers', 'site-footer', 'global-footer'], [], null],
  ['accordion', ['accordion', 'accordions', 'q-and-a', 'q-a', 'qa', 'qna', 'q-n-a', 'faq', 'faqs', 'expander', 'expanders', 'expandable', 'collapse', 'collapsible', 'disclosure'], ['accordion', 'faq', 'faqs'], null],
  ['cards', ['cards', 'card', 'teaser', 'teasers', 'tile', 'tiles'], ['card', 'cards', 'teaser', 'teasers', 'tile', 'tiles'], 'name'],
  ['hero', ['hero', 'heroes', 'heros'], [], heroVariant],
  ['table', ['table', 'tables', 'data-table', 'data-tables', 'datatable'], ['table', 'tables'], null],
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

/**
 * edsEquivalent(figmaName, { hasRepeatingUnits, interactive }) → { block, variant, reason }
 * block null = default content (D1). The flags are optional: unknown is treated as "may be a block", so only
 * the default-content names and an explicit { hasRepeatingUnits: false, interactive: false } fall to D1.
 */
export function edsEquivalent(figmaName, { hasRepeatingUnits, interactive } = {}) {
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

/** edsLabel's inverse: "cards (teaser)" → { block: 'cards', variant: 'teaser' }, "default content" → { block: null }, else null. */
export function parseEdsLabel(label) {
  const s = String(label ?? '').replace(/[`*_]/g, '').trim().toLowerCase();
  if (s === 'default content') return { block: null, variant: null };
  const m = /^([a-z][a-z0-9-]*)(?:\s*\(([a-z0-9-]+)\))?$/.exec(s);
  return m ? { block: m[1], variant: m[2] ?? null } : null;
}

/**
 * donor-modules.md → Map(module id → { block, variant }): its EDS block column, else deploy Step 2 on the
 * module's name (a donor-modules.md written before the column). Excluded rows ("—") are absent.
 */
export function donorModulesEds(md) {
  const out = new Map();
  let head = null;
  for (const line of String(md ?? '').split('\n')) {
    if (!line.trim().startsWith('|')) { head = null; continue; }
    const cells = line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').replace(/[`*_]/g, '').trim());
    if (!head) { head = cells.map((c) => c.toLowerCase()); continue; }
    const id = cells[head.indexOf('#')] ?? cells[0];
    if (!/^M\d+$/.test(id ?? '')) continue;
    const col = head.indexOf('eds block');
    const name = cells[head.indexOf('module')] ?? '';
    const eds = col >= 0 ? parseEdsLabel(cells[col]) : edsEquivalent(name);
    if (eds) out.set(id, { block: eds.block, variant: eds.variant ?? null });
  }
  return out;
}

// A block EDS already has (boilerplate or Block Collection): one a page section may map to without a kit block.
export const isEdsBlock = (block) => BOILERPLATE.includes(block) || BLOCK_COLLECTION.includes(block);

// The library page /library/<page> a kit block is shown on: its EDS block (several kit blocks on one EDS block
// share the page), or the kit key for default content (shown as plain sections).
export const edsPage = (eds, key) => (eds?.block ?? key);

// Binding classes: the EDS variant first, then the kit's own classes, without repeats.
export const edsClasses = (eds, classes = []) => [...new Set([eds?.variant, ...classes].filter(Boolean))];
