import { getMetadata } from '../../scripts/aem.js';
import { loadFragment } from '../fragment/fragment.js';
import inlineIcons from '../../scripts/inline-icons.js';

/**
 * Footer — template-slotted from the gated prototype's chrome (replica C0).
 *
 * Authored `/footer` document, by section:
 *   1. brand: the logo image + the tagline paragraph
 *   2. signup: one paragraph, the newsletter invitation (becomes the field's label)
 *   3. columns: per column a heading followed by a list of links
 *   4. legal: a list of social links (`:icon: Name`) + the legal paragraph
 * The newsletter form is block-built (no script in authored content); submit is inert, as on
 * the source.
 *
 * @ew-exempt the copyright year digits are kept current by script, as on the source.
 * @ew-exempt "Sign up", "you@example.com", "Footer": the submit label, the input placeholder
 *   and the nav landmark label are fixed control strings of the block-built form (the source
 *   hard-codes them).
 */

function el(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}

/** moves every child of `from` into `to`, capturing the next sibling before each move */
function moveChildren(from, to) {
  if (!from) return;
  let next = from.firstElementChild;
  while (next) {
    const current = next;
    next = current.nextElementSibling;
    to.append(current);
  }
}

function buildBrand(brandSection, signupSection) {
  const brand = el('div', 'footer-brand');
  moveChildren(brandSection, brand);

  const form = el('form', 'signup', { action: '#' });
  const label = el('div', 'signup-label', { id: 'footer-signup-label' });
  moveChildren(signupSection, label);
  const row = el('div', 'signup-row');
  const input = el('input', 'signup-input', {
    id: 'footer-signup-email',
    type: 'email',
    placeholder: 'you@example.com',
    autocomplete: 'email',
    'aria-labelledby': label.id,
  });
  const submit = el('button', 'button accent', { type: 'submit' });
  submit.textContent = 'Sign up';
  row.append(input, submit);
  form.append(label, row);
  form.addEventListener('submit', (e) => e.preventDefault());
  label.addEventListener('click', () => input.focus());
  brand.append(form);
  return brand;
}

/** reconstructive: one column per heading, consuming everything up to the next heading */
function buildColumns(section) {
  const cols = el('nav', 'footer-cols', { 'aria-label': 'Footer' });
  if (!section) return cols;
  let col = null;
  let next = section.firstElementChild;
  while (next) {
    const current = next;
    next = current.nextElementSibling;
    if (/^H[1-6]$/.test(current.tagName) || !col) {
      col = el('div', 'footer-col');
      cols.append(col);
    }
    col.append(current);
  }
  return cols;
}

/**
 * The source keeps the copyright year current (`<span data-year>` set by its script): wrap the
 * authored year in that span (the text node is split, never rewritten) and set it.
 */
function markYear(p) {
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const m = /(©\s*)(\d{4})/.exec(node.nodeValue);
    if (m) {
      const yearNode = node.splitText(m.index + m[1].length);
      yearNode.splitText(4);
      const span = el('span', null, { 'data-year': '' });
      yearNode.replaceWith(span);
      span.append(yearNode);
      yearNode.nodeValue = String(new Date().getFullYear());
      return;
    }
    node = walker.nextNode();
  }
}

function buildLegal(section) {
  const legal = el('div', 'container footer-legal');
  if (!section) return legal;
  const social = el('div', 'footer-social');
  const meta = el('div', 'footer-meta');
  let next = section.firstElementChild;
  while (next) {
    const current = next;
    next = current.nextElementSibling;
    if (current.matches('ul, ol')) {
      // social links: keep the authored name as the link's visually hidden accessible name
      current.querySelectorAll('a').forEach((a) => {
        const name = el('span', 'sr-only');
        [...a.childNodes].filter((n) => !(n.classList && n.classList.contains('icon')))
          .forEach((n) => name.append(n));
        a.append(name);
      });
      social.append(current);
    } else {
      meta.append(current);
      markYear(current);
    }
  }
  legal.append(social, meta);
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
  if (!fragment) return;

  const sections = [...fragment.children]
    .map((s) => s.querySelector('.default-content-wrapper') || s);
  const [brandSection, signupSection, colsSection, legalSection] = sections;

  const inner = el('div', 'container footer-inner');
  inner.append(buildBrand(brandSection, signupSection), buildColumns(colsSection));

  block.textContent = '';
  const legal = buildLegal(legalSection);
  block.append(inner, legal);
  await inlineIcons(legal, 18);
}
