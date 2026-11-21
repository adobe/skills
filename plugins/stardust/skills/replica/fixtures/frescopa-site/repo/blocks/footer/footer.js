import { getMetadata } from '../../scripts/aem.js';
import { loadFragment } from '../fragment/fragment.js';

/**
 * footer — the Fréscopa site footer, template-slotted from the gated canon chrome
 * (stardust/prototypes/shared/canon.css, live `.footer` / `.fr-ftr`).
 *
 * Authored /footer document (four sections):
 *   1. brand  — the :frescopa-logo-light: icon paragraph, then the tagline paragraph
 *   2. signup — three paragraphs: field label, field placeholder, button label
 *   3. columns — per column an <h3> followed by a list of links
 *   4. legal  — a list of social links (Instagram, Pinterest, YouTube), then the meta line
 *
 * Behaviour (dynamic-features rows 2, 14): the signup form is client-only — submit is
 * handled in place, nothing leaves the page (as the source); the © year is computed on the
 * home template (React page types keep it static, as live).
 * @ew-exempt all — chrome fragment; placeholder and button label are form attributes
 */

const SOCIAL_ICONS = {
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/>'
    + '<circle cx="17" cy="7" r="1" fill="currentColor" stroke="none"/>',
  pinterest: '<circle cx="12" cy="12" r="9"/><path d="M12 8c-2 0-3 1.4-3 3 0 1 .5 2 1.3 2.4M12 8c1.8 '
    + '0 3 1.1 3 2.8 0 2-1.2 3.4-2.8 3.4-.8 0-1.4-.5-1.2-1.3l.6-2.4M10.8 17l1-4" '
    + 'stroke-linecap="round"/>',
  youtube: '<rect x="3" y="6" width="18" height="12" rx="4"/>'
    + '<path d="m10 9 5 3-5 3V9Z" fill="currentColor" stroke="none"/>',
};

function svgIcon(key) {
  const body = SOCIAL_ICONS[key];
  if (!body) return null;
  const wrap = document.createElement('span');
  wrap.className = 'footer-social-icon';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" '
    + `stroke="currentColor" stroke-width="1.5">${body}</svg>`;
  return wrap.firstElementChild;
}

function buildBrand(section) {
  const brand = document.createElement('div');
  brand.className = 'footer-brand';
  if (!section) return brand;
  const logo = section.querySelector('img');
  if (logo) {
    logo.className = 'footer-logo';
    logo.alt = 'Fréscopa';
    logo.width = 147;
    logo.height = 40;
    brand.append(logo);
  }
  const tag = [...section.querySelectorAll('p')].find((p) => !p.querySelector('img') && p.textContent.trim());
  if (tag) {
    const wrap = document.createElement('div');
    wrap.className = 'footer-tag';
    wrap.append(tag);
    brand.append(wrap);
  }
  return brand;
}

function buildSignup(section) {
  const [labelP, placeholderP, buttonP] = section ? [...section.querySelectorAll('p')] : [];
  if (!labelP) return null;
  const form = document.createElement('form');
  form.className = 'signup';
  form.action = '#';
  const label = document.createElement('label');
  label.className = 'signup-label';
  label.htmlFor = 'footer-email';
  label.append(...labelP.childNodes);
  const row = document.createElement('div');
  row.className = 'signup-row';
  const input = document.createElement('input');
  input.id = 'footer-email';
  input.className = 'signup-input';
  input.type = 'email';
  input.autocomplete = 'email';
  if (placeholderP) input.placeholder = placeholderP.textContent.trim();
  const button = document.createElement('button');
  button.className = 'button accent';
  button.type = 'submit';
  if (buttonP) button.append(...buttonP.childNodes);
  row.append(input, button);
  form.append(label, row);
  // source: <form onsubmit="return false"> — the submit is handled in place
  form.addEventListener('submit', (e) => e.preventDefault());
  return form;
}

function buildColumns(section) {
  const cols = document.createElement('nav');
  cols.className = 'footer-cols';
  cols.setAttribute('aria-label', 'Footer');
  if (!section) return cols;
  let col = null;
  [...section.querySelectorAll('h2, h3, h4, a')].forEach((el) => {
    if (/^H\d$/.test(el.tagName)) {
      col = document.createElement('div');
      col.className = 'footer-col';
      col.append(el);
      cols.append(col);
    } else if (col) {
      col.append(el);
    }
  });
  return cols;
}

function buildLegal(section, isApp) {
  const legal = document.createElement('div');
  legal.className = 'container footer-legal';
  if (!section) return legal;
  const social = document.createElement('div');
  social.className = 'footer-social';
  [...section.querySelectorAll('li a, ul a')].forEach((a) => {
    const label = a.textContent.trim();
    const icon = svgIcon(label.toLowerCase());
    a.setAttribute('aria-label', label);
    const sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.append(...a.childNodes);
    a.append(sr);
    if (icon) a.prepend(icon);
    social.append(a);
  });
  legal.append(social);
  const meta = [...section.querySelectorAll('p')].find((p) => !p.closest('li') && p.textContent.trim());
  if (meta) {
    meta.classList.add('footer-meta');
    if (!isApp) {
      // computed year (source app.js initYear): isolate the digits after © in their own span
      const walker = document.createTreeWalker(meta, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const m = node.textContent.match(/©\s*(\d{4})/);
        if (m) {
          const start = m.index + m[0].length - 4;
          const yearNode = node.splitText(start);
          yearNode.splitText(4);
          const span = document.createElement('span');
          span.dataset.year = '';
          yearNode.replaceWith(span);
          span.append(yearNode);
          yearNode.textContent = String(new Date().getFullYear());
          break;
        }
        node = walker.nextNode();
      }
    }
    legal.append(meta);
  }
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
  const sections = fragment ? [...fragment.children] : [];
  const [brandSection, signupSection, colsSection, legalSection] = sections;
  const isApp = document.body.classList.contains('app');

  const inner = document.createElement('div');
  inner.className = 'container footer-inner';
  const brand = buildBrand(brandSection);
  const signup = buildSignup(signupSection);
  if (signup) brand.append(signup);
  inner.append(brand, buildColumns(colsSection));
  block.replaceChildren(inner, buildLegal(legalSection, isApp));

  const host = block.closest('footer');
  if (host) host.classList.add('site-footer');
}
