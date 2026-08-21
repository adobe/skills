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
 *
 * Ported from assets/substrate/scripts/overlay-engine.js — keep in sync.
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

/* =========================================================================
 * Prototype interaction layer (URL / pasted-HTML prototypes).
 *
 * page-forge captures the full *rendered* DOM, so multi-slide content
 * (carousels, auto-rotating marquees) and tab/accordion panels are all
 * present in the template — just frozen, because the source block JS that
 * wired them isn't running on the snowflake'd page. This adds a small,
 * dependency-free behaviour layer driven by an explicit contract the
 * generate step emits, so the prototype feels alive WITHOUT depending on
 * any real Milo block. Block-agnostic by design: snowflake never has to
 * understand these structures — it just carries the contract markup
 * through, and this runs at runtime after the overlay injects <main>.
 *
 * IMPORTANT — capture-mode limitation: Figma-sourced prototypes converge
 * to a single static reference image, so only the visible slide exists.
 * There is nothing to cycle and the generate step emits no contract markup,
 * so this layer is a deliberate no-op for them.
 *
 * Contract (all opt-in via the proto-* classes):
 *   carousel:  .proto-carousel > .proto-carousel-track > .proto-slide+
 *              [data-proto-autoplay="<ms>"]
 *   marquee:   .proto-marquee  > .proto-marquee-slide+   [data-proto-interval="<ms>"]
 *              optional nav: .proto-marquee-nav-item+ (anywhere inside)
 *   tabs:      .proto-tabs     > .proto-tablist > .proto-tab+ ; sibling .proto-tabpanel+
 *   accordion: .proto-accordion> .proto-acc-item ( .proto-acc-trigger + .proto-acc-panel )+
 * ========================================================================= */

const REDUCED_MOTION = !!(window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/** Make an element with a class and optional text. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Wire one carousel: single-slide-in-view track + dots + arrows + autoplay + swipe. */
function initCarousel(root) {
  const track = root.querySelector('.proto-carousel-track');
  const slides = track
    ? [...track.children].filter((s) => s.classList.contains('proto-slide'))
    : [];
  if (slides.length < 2) return;

  let index = 0;
  let timer = null;
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

  let dots = [];
  const render = () => {
    track.style.transform = `translateX(-${index * 100}%)`;
    dots.forEach((d, i) => d.setAttribute('aria-selected', String(i === index)));
  };
  const go = (i) => { index = (i + slides.length) % slides.length; render(); };

  let prev = root.querySelector('.proto-carousel-prev');
  let next = root.querySelector('.proto-carousel-next');
  if (!prev) { prev = el('button', 'proto-carousel-prev', '‹'); prev.setAttribute('aria-label', 'Previous'); root.appendChild(prev); }
  if (!next) { next = el('button', 'proto-carousel-next', '›'); next.setAttribute('aria-label', 'Next'); root.appendChild(next); }
  prev.addEventListener('click', () => { stop(); go(index - 1); });
  next.addEventListener('click', () => { stop(); go(index + 1); });

  let dotsWrap = root.querySelector('.proto-carousel-dots');
  if (!dotsWrap) { dotsWrap = el('div', 'proto-carousel-dots'); root.appendChild(dotsWrap); }
  dots = slides.map((_, i) => {
    const d = el('button', 'proto-carousel-dot');
    d.setAttribute('aria-label', `Slide ${i + 1}`);
    d.addEventListener('click', () => { stop(); go(i); });
    dotsWrap.appendChild(d);
    return d;
  });

  const ms = parseInt(root.dataset.protoAutoplay || '', 10);
  const start = () => { if (ms > 0 && !REDUCED_MOTION) timer = setInterval(() => go(index + 1), ms); };
  root.addEventListener('mouseenter', stop);
  root.addEventListener('mouseleave', start);
  root.addEventListener('focusin', stop);

  let x0 = null;
  root.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  root.addEventListener('pointerup', (e) => {
    if (x0 == null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 40) { stop(); go(index + (dx < 0 ? 1 : -1)); }
  });

  render();
  start();
}

/** Wire one auto-rotating marquee: only the active slide is shown. */
function initMarquee(root) {
  const slides = [...root.querySelectorAll(':scope > .proto-marquee-slide')];
  if (slides.length < 2) return;
  const nav = [...root.querySelectorAll('.proto-marquee-nav-item')];

  let index = 0;
  let timer = null;
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  const go = (n) => {
    index = (n + slides.length) % slides.length;
    slides.forEach((s, i) => s.classList.toggle('is-active', i === index));
    nav.forEach((it, i) => it.setAttribute('aria-selected', String(i === index)));
  };
  nav.forEach((it, i) => it.addEventListener('click', () => { stop(); go(i); }));

  const ms = parseInt(root.dataset.protoInterval || '5000', 10);
  const start = () => { if (ms > 0 && !REDUCED_MOTION) timer = setInterval(() => go(index + 1), ms); };
  root.addEventListener('mouseenter', stop);
  root.addEventListener('mouseleave', start);

  go(0);
  start();
}

/** Wire one tab group: .proto-tab buttons toggle matched .proto-tabpanel. */
function initTabs(root) {
  const tabs = [...root.querySelectorAll('.proto-tab')];
  const panels = [...root.querySelectorAll('.proto-tabpanel')];
  if (!tabs.length || tabs.length !== panels.length) return;

  const select = (n) => {
    tabs.forEach((t, i) => t.setAttribute('aria-selected', String(i === n)));
    panels.forEach((p, i) => { p.hidden = i !== n; });
  };
  tabs.forEach((t, i) => {
    t.setAttribute('role', 'tab');
    t.addEventListener('click', () => select(i));
    t.addEventListener('keydown', (e) => {
      let n = -1;
      if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
      if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
      if (n >= 0) { tabs[n].focus(); select(n); }
    });
  });
  const pre = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
  select(pre >= 0 ? pre : 0);
}

/** Wire accordions: each .proto-acc-trigger toggles its .proto-acc-panel. */
function initAccordion(root) {
  root.querySelectorAll('.proto-acc-item').forEach((item) => {
    const trigger = item.querySelector('.proto-acc-trigger');
    const panel = item.querySelector('.proto-acc-panel');
    if (!trigger || !panel) return;
    const open = trigger.getAttribute('aria-expanded') === 'true';
    trigger.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
    trigger.addEventListener('click', () => {
      const isOpen = trigger.getAttribute('aria-expanded') === 'true';
      trigger.setAttribute('aria-expanded', String(!isOpen));
      panel.hidden = isOpen;
    });
  });
}

/** Activate every prototype interaction present in the overlaid <main>. */
function initProtoInteractions(root) {
  try {
    root.querySelectorAll('.proto-carousel').forEach(initCarousel);
    root.querySelectorAll('.proto-marquee').forEach(initMarquee);
    root.querySelectorAll('.proto-tabs').forEach(initTabs);
    root.querySelectorAll('.proto-accordion').forEach(initAccordion);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[snowflake] prototype interactions failed to init', e);
  }
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

  // Reveal the overlay. Milo's styles.css hides every `main > div`
  // ("progressive section appearance": `main > div { display: none }`) until it's
  // decorated into a revealed `.section`. We just replaced Milo's decorated
  // sections with the template's own top-level containers, which Milo never
  // re-decorates — so without this they stay hidden and the page renders blank.
  // Inline `display:block` beats the non-!important rule; block is the section
  // default and avoids pulling in Milo's `.section` padding/max-width.
  main.querySelectorAll(':scope > div').forEach((el) => { el.style.display = 'block'; });

  // Bring frozen interactive content to life (carousels, marquees, tabs,
  // accordions) via the prototype interaction contract. No-op when the
  // template carries no proto-* markup (e.g. Figma-sourced single-frame
  // prototypes), so it's safe to always call.
  initProtoInteractions(main);
}
