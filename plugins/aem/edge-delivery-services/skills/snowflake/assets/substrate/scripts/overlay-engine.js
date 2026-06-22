import { getMetadata, loadCSS } from './aem.js';

/* =====================================================================
   STATIC-TO-EDS OVERLAY ENGINE
   Extracted from scripts.js so snowflake no longer ships a frozen copy
   of Adobe's boilerplate engine. See knowledge/architecture.md.
   ===================================================================== */

/**
 * Read block-table content from a DA-shaped main element.
 * Block layout (post-pipeline):
 *   main > div(section) > div.blockname > div(row) > div(cell)
 * Returns { blockClassName: { slotName: htmlString, ... } }.
 */
function readBlockSlots(main) {
  const slots = {};
  main.querySelectorAll(':scope > div > div').forEach((block) => {
    const blockName = block.className.trim().split(/\s+/)[0];
    if (!blockName) return;
    slots[blockName] = slots[blockName] || {};
    block.querySelectorAll(':scope > div').forEach((row) => {
      const cells = row.querySelectorAll(':scope > div');
      if (cells.length >= 2) {
        const name = cells[0].textContent.trim();
        if (name) slots[blockName][name] = cells[1].innerHTML.trim();
      }
    });
  });
  return slots;
}

/**
 * Parse an HTML fragment string and return the first matching element,
 * or null if none. Used to lift element-typed values out of DA cells.
 */
function parseFirst(value, selector) {
  const tmp = document.createElement('div');
  tmp.innerHTML = value;
  return tmp.querySelector(selector);
}

/**
 * Write a slot value into a template element. Behavior is element-typed.
 */
function writeSlot(el, value) {
  const { tagName } = el;
  if (tagName === 'IMG') {
    const img = parseFirst(value, 'img');
    if (img) {
      el.src = img.getAttribute('src');
      if (img.alt) el.alt = img.alt;
    }
    return;
  }
  if (tagName === 'PICTURE') {
    const newPic = parseFirst(value, 'picture');
    if (newPic) el.replaceWith(newPic);
    return;
  }
  // Background-image slots on <a> must be handled before the link branch —
  // otherwise the link writer replaces the inner tile structure with just
  // the DA cell's <img>, wiping nested [data-slot] children (e.g. tile labels).
  if (tagName === 'A' && !(el.style && el.style.backgroundImage)) {
    const a = parseFirst(value, 'a');
    if (a) {
      el.href = a.getAttribute('href');
      el.innerHTML = a.innerHTML;
    } else {
      el.innerHTML = value;
    }
    return;
  }
  // Background-image slot: target element has an inline
  // style="background-image:url(...)". DA cell carries an <img>;
  // extract its src and replace just the background-image URL,
  // preserving any other inline styles on the element. Lets pages
  // with CSS-driven photos (hero backdrops, card tiles where the
  // image is the container's background) expose those images as DA
  // slots without restructuring source markup.
  if (el.style && el.style.backgroundImage) {
    const img = parseFirst(value, 'img');
    if (img) {
      const newSrc = img.getAttribute('src');
      // Double-quote — URLs more commonly contain ' than " (which
      // would have to be percent-encoded), so " is the safer wrap.
      el.style.backgroundImage = `url("${newSrc}")`;
    }
    return;
  }
  // Heading slots: if the DA cell value is wrapped in a same-tag heading
  // (e.g. <h1>...</h1> for a <h1 data-slot>), setting innerHTML directly
  // triggers the browser's auto-close — the parser ends the outer <h1>
  // before opening the inner one, producing an empty template <h1>
  // followed by an orphaned <h1> sibling. Unwrap the inner heading's
  // content and use that as innerHTML to keep a single clean heading.
  if (/^H[1-6]$/.test(tagName)) {
    const tmp = document.createElement('div');
    tmp.innerHTML = value;
    const inner = tmp.querySelector(tagName.toLowerCase());
    el.innerHTML = inner ? inner.innerHTML : value;
    return;
  }
  // Default: text / inline-HTML slot
  el.innerHTML = value;
}

/**
 * Walk template sections, match each section's first class to a block
 * in `slots`, and write slot values into [data-slot] markers.
 */
function applySlotsToTemplate(templateMain, slots) {
  templateMain.querySelectorAll('section[class]').forEach((section) => {
    const blockName = section.className.trim().split(/\s+/)[0];
    const blockSlots = slots[blockName];
    if (!blockSlots) return;
    section.querySelectorAll('[data-slot]').forEach((el) => {
      const slotName = el.getAttribute('data-slot');
      if (slotName in blockSlots) writeSlot(el, blockSlots[slotName]);
    });
  });
}

/**
 * Resolve the template name from page metadata, body[data-template], or
 * null if no overlay applies.
 */
function resolveTemplateName() {
  const meta = getMetadata('template');
  if (meta) return meta;
  return document.body.getAttribute('data-template') || null;
}

/**
 * Apply the static-page overlay to main.
 * Returns true if the overlay ran, false otherwise.
 */
async function applyTemplateOverlay(main) {
  const templateName = resolveTemplateName();
  if (!templateName) return false;

  const slots = readBlockSlots(main);

  // Load template-scoped CSS in parallel with the template HTML so
  // styles arrive before body.appear paints. `head.html` no longer
  // hardcodes a per-template stylesheet — each template ships its
  // own at /styles/<template>.css.
  const cssLoaded = loadCSS(`${window.hlx.codeBasePath}/styles/${templateName}.css`);

  const resp = await fetch(`${window.hlx.codeBasePath}/templates/${templateName}.html`);
  if (!resp.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[overlay] template not found: ${templateName}`);
    return false;
  }
  const templateHtml = await resp.text();

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<!DOCTYPE html><html><body>${templateHtml}</body></html>`, 'text/html');
  const newMain = doc.body.querySelector('main');
  if (!newMain) {
    // eslint-disable-next-line no-console
    console.warn(`[overlay] template "${templateName}" has no <main>`);
    return false;
  }

  // Lift any top-level <link> resources the template declares into
  // <head>. Lets a template self-describe its head needs (font
  // preconnects, Google Fonts stylesheet, etc) without forcing those
  // links into the shared head.html for every page. Dedupe by the
  // resolved href + rel string so a template doesn't double-load a
  // resource that head.html already brings in.
  const existingLinks = [...document.head.querySelectorAll('link')];
  doc.body.querySelectorAll(':scope > link').forEach((link) => {
    const clone = link.cloneNode(true);
    if (existingLinks.some((l) => l.href === clone.href && l.rel === clone.rel)) return;
    document.head.appendChild(clone);
    existingLinks.push(clone);
  });

  applySlotsToTemplate(newMain, slots);

  main.innerHTML = newMain.innerHTML;
  main.dataset.overlay = templateName;

  await cssLoaded;
  return true;
}

export { applyTemplateOverlay };
