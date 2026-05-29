/**
 * snowflake — Milo substrate overlay block.
 *
 * The Milo-flavor counterpart to the EDS substrate's `applyTemplateOverlay`
 * engine (assets/substrate/scripts/scripts.js). On an EDS boilerplate repo
 * that engine lives in a replaced scripts.js and runs in loadEager. On a
 * Milo repo we must NOT replace Milo's scripts.js / head.html (that would
 * rip out the runtime that loads the live global-navigation + footer from
 * page metadata). So the same overlay logic ships as a normal Milo block
 * instead: Milo loads it from the project's codeRoot, runs decorate(), and
 * keeps ownership of the chrome.
 *
 * Page shape (DA-authored), one snowflake block per page:
 *   main > div(section) > div.snowflake
 *     row: template | <template-name>          (optional; falls back to <meta name="template">)
 *     row: <section-class> | <slot-name> | <html>   (optional slot overrides)
 *
 * What it does:
 *   1. Resolve the template name (block row or <meta name="template">).
 *   2. Fetch /templates/<template>.html (the captured 1:1 <main> with
 *      [data-slot] markers + default content).
 *   3. Lift the template's top-level <link>s into <head> (typekit, etc).
 *   4. Inject /styles/<template>.css.
 *   5. Apply any DA slot overrides onto the template (authorability).
 *      With no overrides, the template's default content renders 1:1.
 *   6. Replace <main>'s content with the populated template.
 *
 * It never touches <header>/<footer> — Milo loads the live gnav/footer
 * from gnav-source/footer-source metadata. It does not toggle body.appear
 * or load fonts — Milo owns that lifecycle.
 */

/** Resolve the code origin base. Milo may not set window.hlx; templates and
 *  per-template CSS are committed to the code origin (same host on a branch),
 *  so an origin-relative path is correct. */
function codeBase() {
  return (window.hlx && window.hlx.codeBasePath) || '';
}

/** Inject a stylesheet once. */
function loadCSS(href) {
  if (document.querySelector(`link[rel="stylesheet"][href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

/** Parse an HTML fragment string and return the first matching element. */
function parseFirst(value, selector) {
  const tmp = document.createElement('div');
  tmp.innerHTML = value;
  return tmp.querySelector(selector);
}

/**
 * Read slot overrides from the snowflake block's own rows.
 * Each authorable row is 3 cells: section-class | slot-name | value.
 * A 2-cell row whose first cell is "template" sets the template name.
 * Returns { templateName, slots: { sectionClass: { slotName: html } } }.
 */
function readBlockConfig(block) {
  const slots = {};
  let templateName = null;
  block.querySelectorAll(':scope > div').forEach((row) => {
    const cells = [...row.querySelectorAll(':scope > div')];
    if (cells.length === 2) {
      const key = cells[0].textContent.trim().toLowerCase();
      if (key === 'template') templateName = cells[1].textContent.trim();
      return;
    }
    if (cells.length >= 3) {
      const sectionClass = cells[0].textContent.trim().split(/\s+/)[0];
      const slotName = cells[1].textContent.trim();
      if (!sectionClass || !slotName) return;
      slots[sectionClass] = slots[sectionClass] || {};
      slots[sectionClass][slotName] = cells[2].innerHTML.trim();
    }
  });
  return { templateName, slots };
}

/**
 * Write a slot value into a template element. Element-typed, ported
 * verbatim from the EDS substrate's writeSlot (5 cases).
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
  // Background-image slot on <a> handled before the link branch so the
  // link writer doesn't wipe nested [data-slot] children.
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
  if (el.style && el.style.backgroundImage) {
    const img = parseFirst(value, 'img');
    if (img) el.style.backgroundImage = `url("${img.getAttribute('src')}")`;
    return;
  }
  // Heading slots: unwrap a same-tag inner heading to avoid the parser's
  // auto-close splitting it into an empty heading + orphan sibling.
  if (/^H[1-6]$/.test(tagName)) {
    const tmp = document.createElement('div');
    tmp.innerHTML = value;
    const inner = tmp.querySelector(tagName.toLowerCase());
    el.innerHTML = inner ? inner.innerHTML : value;
    return;
  }
  el.innerHTML = value;
}

/** Walk template sections, match first-class to slots, write [data-slot]s. */
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

/** Lift the template's top-level <link>s into <head>, deduped. */
function liftTemplateLinks(templateDoc) {
  const existing = [...document.head.querySelectorAll('link')];
  templateDoc.body.querySelectorAll(':scope > link').forEach((link) => {
    const clone = link.cloneNode(true);
    if (existing.some((l) => l.href === clone.href && l.rel === clone.rel)) return;
    document.head.appendChild(clone);
    existing.push(clone);
  });
}

export default async function decorate(block) {
  const main = document.querySelector('main');
  if (!main || main.dataset.overlay) return; // idempotent

  const { templateName: rowTemplate, slots } = readBlockConfig(block);
  const metaTemplate = document.querySelector('meta[name="template"]')?.content;
  const templateName = rowTemplate || metaTemplate;
  if (!templateName) {
    // eslint-disable-next-line no-console
    console.warn('[snowflake] no template name (block row or <meta name="template">)');
    return;
  }

  const base = codeBase();
  loadCSS(`${base}/styles/${templateName}.css`);

  let templateHtml;
  try {
    const resp = await fetch(`${base}/templates/${templateName}.html`);
    if (!resp.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[snowflake] template not found: ${templateName} (${resp.status})`);
      return;
    }
    templateHtml = await resp.text();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[snowflake] template fetch failed: ${templateName}`, e);
    return;
  }

  const doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html><body>${templateHtml}</body></html>`,
    'text/html',
  );
  liftTemplateLinks(doc);

  const newMain = doc.body.querySelector('main');
  if (!newMain) {
    // eslint-disable-next-line no-console
    console.warn(`[snowflake] template "${templateName}" has no <main>`);
    return;
  }

  applySlotsToTemplate(newMain, slots);

  // Replace the live <main> body with the populated template. Milo keeps
  // <header>/<footer> (live gnav/footer) and the <head> metadata untouched.
  main.innerHTML = newMain.innerHTML;
  main.dataset.overlay = templateName;
}
