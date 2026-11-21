import { getMetadata } from '../../scripts/aem.js';
import { loadFragment } from '../fragment/fragment.js';

/**
 * Fréscopa footer — template-slotted from the authored /footer document:
 * section 1 = logo, tagline, newsletter label; section 2 = link columns (h3 + ul each);
 * section 3 = social link list + legal line. The newsletter form is inert, as on the
 * source (dynamic-features f-form-signup).
 */

const SOCIAL = {
  instagram: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    + 'stroke-width="1.5" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/>'
    + '<circle cx="12" cy="12" r="4"/><circle cx="17" cy="7" r="1" fill="currentColor" stroke="none"/></svg>',
  pinterest: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    + 'stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8c-2 0-3 1.4-3 '
    + '3 0 1 .5 2 1.3 2.4M12 8c1.8 0 3 1.1 3 2.8 0 2-1.2 3.4-2.8 3.4-.8 0-1.4-.5-1.2-1.3l.6-2.4M10.8 '
    + '17l1-4" stroke-linecap="round"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    + 'stroke-width="1.5" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="4"/>'
    + '<path d="m10 9 5 3-5 3V9Z" fill="currentColor" stroke="none"/></svg>',
};

function el(tag, cls, attrs = {}) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  return n;
}

function wrap(node, cls, tag = 'div') {
  const w = el(tag, cls);
  if (node) w.append(node);
  return w;
}

function buildBrand(section) {
  const col = el('div', 'footer-brand');
  if (!section) return col;
  const paras = [...section.querySelectorAll('p')];
  const logo = paras.find((p) => p.querySelector('picture, img'));
  const texts = paras.filter((p) => p !== logo);
  if (logo) col.append(wrap(logo, 'footer-logo'));
  const [tag, label] = texts;
  if (tag) col.append(wrap(tag, 'footer-tag'));

  const form = el('form', 'signup', { action: '#' });
  const labelEl = el('label', 'signup-label', { for: 'footer-email' });
  if (label) labelEl.append(label);
  const row = el('div', 'signup-row');
  const input = el('input', 'signup-input', {
    id: 'footer-email',
    type: 'email',
    placeholder: 'you@example.com',
    autocomplete: 'email',
  });
  const submit = el('button', 'signup-submit', { type: 'submit' });
  submit.textContent = 'Sign up';
  row.append(input, submit);
  form.append(labelEl, row);
  form.addEventListener('submit', (e) => e.preventDefault());
  col.append(form);
  return col;
}

function buildCols(section) {
  const cols = el('nav', 'footer-cols', { 'aria-label': 'Footer' });
  if (!section) return cols;
  section.querySelectorAll('h2, h3, h4').forEach((heading) => {
    const col = el('div', 'footer-col');
    const list = heading.nextElementSibling;
    col.append(heading);
    if (list && list.tagName === 'UL') col.append(list);
    cols.append(col);
  });
  return cols;
}

function buildLegal(section) {
  const legal = el('div', 'container footer-legal');
  if (!section) return legal;
  const list = section.querySelector('ul');
  if (list) {
    list.querySelectorAll('a').forEach((a) => {
      const key = Object.keys(SOCIAL).find((k) => a.textContent.toLowerCase().includes(k));
      a.setAttribute('aria-label', a.textContent);
      [...a.childNodes].forEach((node) => {
        const span = el('span', 'footer-sr');
        node.replaceWith(span);
        span.append(node);
      });
      if (key) a.insertAdjacentHTML('afterbegin', SOCIAL[key]);
    });
    legal.append(wrap(list, 'footer-social'));
  }
  const meta = section.querySelector('p');
  if (meta) legal.append(wrap(meta, 'footer-meta'));
  return legal;
}

/**
 * loads and decorates the footer
 * @param {Element} block The footer block element
 */
export default async function decorate(block) {
  const footerMeta = getMetadata('footer');
  const footerPath = footerMeta ? new URL(footerMeta, window.location).pathname : '/footer';
  const fragment = await loadFragment(footerPath);
  block.textContent = '';
  if (!fragment) return;

  const [brandSec, colsSec, legalSec] = fragment.querySelectorAll(':scope > .section');
  const inner = el('div', 'container footer-inner');
  inner.append(buildBrand(brandSec), buildCols(colsSec));
  block.append(inner, buildLegal(legalSec));
}
