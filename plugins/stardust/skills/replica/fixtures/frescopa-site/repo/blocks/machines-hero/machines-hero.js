/**
 * machines-hero — product-catalog hero with breadcrumb (prototype section.machines-hero),
 * template-slotted. Schema: stardust/eds-schema/frescopa-atelier-machines-html.json.
 *
 * Authored (one cell, any order the pipeline keeps):
 *   breadcrumb <ul> (Home link, current page) → <h1> → lede <p>
 * The list is one editable unit (EW5 breadcrumb shape); the "/" separators are generated
 * aria-hidden spans.
 */

function wrapNode(node, className) {
  const w = document.createElement('div');
  w.className = className;
  w.append(node);
  return w;
}

const isHeading = (el) => /^H[1-6]$/.test(el.tagName);

export default function decorate(block) {
  const nodes = [...block.querySelectorAll(':scope > div > div > *')];
  const container = document.createElement('div');
  container.className = 'container';
  nodes.forEach((n) => {
    if (n.matches('ul, ol')) {
      const nav = document.createElement('nav');
      nav.className = 'breadcrumb';
      nav.setAttribute('aria-label', 'Breadcrumb');
      const items = [...n.querySelectorAll(':scope > li')];
      const last = items[items.length - 1];
      if (last && !last.querySelector('a')) last.setAttribute('aria-current', 'page');
      // the trail separator: a separate aria-hidden element (never edits the authored text)
      items.slice(1).forEach((li) => {
        if (li.querySelector('.breadcrumb-sep') || /^\s*\//.test(li.textContent)) return;
        const sep = document.createElement('span');
        sep.className = 'breadcrumb-sep';
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = '/';
        li.prepend(sep);
      });
      nav.append(n);
      container.append(nav);
    } else if (isHeading(n)) {
      container.append(wrapNode(n, 'machines-hero-title'));
    } else {
      container.append(wrapNode(n, 'machines-hero-lede'));
    }
  });
  block.replaceChildren(container);
}
