/*
 * Inline icon SVGs — chrome icons must follow currentcolor through the header morph and on hover,
 * as the source's inline <svg> glyphs do. decorateIcons() leaves an <img> in each .icon span;
 * this swaps it for the same /icons/<name>.svg parsed inline (fetched once per name).
 */

const cache = new Map();

function fetchIcon(name) {
  if (!cache.has(name)) {
    const url = `${window.hlx.codeBasePath}/icons/${name}.svg`;
    cache.set(name, fetch(url).then((r) => (r.ok ? r.text() : '')).catch(() => ''));
  }
  return cache.get(name);
}

/**
 * Replaces the icon <img> of every `.icon` span under root with the inline SVG.
 * @param {Element} root container
 * @param {number} [size] rendered width/height in px
 */
export default async function inlineIcons(root, size = 24) {
  const spans = [...root.querySelectorAll('span.icon')];
  await Promise.all(spans.map(async (span) => {
    const name = [...span.classList].find((c) => c.startsWith('icon-'))?.substring(5);
    if (!name || span.querySelector('svg')) return;
    const text = await fetchIcon(name);
    if (!text) return;
    const svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
    if (svg.nodeName.toLowerCase() !== 'svg') return;
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    span.replaceChildren(document.importNode(svg, true));
  }));
}
