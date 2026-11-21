import { getMetadata } from '../../scripts/aem.js';
import { loadFragment } from '../fragment/fragment.js';

/**
 * Fréscopa header — template-slotted from the authored /nav document:
 * section 1 = brand (home link + light logo + dark logo), section 2 = link list,
 * section 3 = utility list (search, account, cart) rendered as icon buttons.
 * Behaviour (source shared/app.js): is-scrolled past 12px, hidden while scrolling
 * down past 480px, off-canvas mobile nav below 900px.
 * @ew-exempt <li> utility labels (section 3) — rendered as icon-button aria-labels
 */

const ICONS = {
  search: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" '
    + 'stroke-width="1.6" aria-hidden="true"><circle cx="11" cy="11" r="7"/>'
    + '<path d="m20 20-3.2-3.2" stroke-linecap="round"/></svg>',
  account: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" '
    + 'stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="8" r="4"/>'
    + '<path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" stroke-linecap="round"/></svg>',
  cart: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" '
    + 'stroke-width="1.6" aria-hidden="true"><path d="M6 8h12l-1 11H7L6 8Z"/>'
    + '<path d="M9 8a3 3 0 0 1 6 0" stroke-linecap="round"/></svg>',
};

function iconFor(label) {
  const key = Object.keys(ICONS).find((k) => label.toLowerCase().includes(k));
  return ICONS[key] || ICONS.search;
}

function el(tag, cls, attrs = {}) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  return n;
}

function buildBrand(section) {
  const brand = el('div', 'header-brand');
  if (!section) return brand;
  const link = section.querySelector('a');
  const pictures = [...section.querySelectorAll('picture, img')]
    .filter((p) => !(p.tagName === 'IMG' && p.closest('picture')));
  const host = link || el('a', '', { href: '/' });
  if (link) {
    host.setAttribute('aria-label', link.textContent);
    [...host.childNodes].forEach((node) => {
      const span = el('span', 'header-brand-text');
      node.replaceWith(span);
      span.append(node);
    });
  }
  pictures.forEach((pic, i) => {
    const slot = el('span', `header-logo ${i === 0 ? 'header-logo-light' : 'header-logo-dark'}`);
    if (i > 0) slot.setAttribute('aria-hidden', 'true');
    slot.append(pic);
    host.append(slot);
  });
  brand.append(host);
  return brand;
}

function buildUtils(section, toggle) {
  const utils = el('div', 'header-utils');
  const items = section ? [...section.querySelectorAll('li')] : [];
  items.forEach((li) => {
    const label = li.textContent.trim();
    const btn = el('button', 'iconbtn', { type: 'button', 'aria-label': label });
    btn.innerHTML = iconFor(label);
    utils.append(btn);
  });
  utils.append(toggle);
  return utils;
}

function initScroll(block) {
  let last = 0;
  let ticking = false;
  const update = () => {
    const y = window.scrollY;
    block.classList.toggle('is-scrolled', y > 12);
    if (y > 480 && y > last + 4) block.classList.add('is-hidden');
    else if (y < last - 4 || y < 480) block.classList.remove('is-hidden');
    last = y;
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });
  update();
}

function initToggle(toggle, nav) {
  const set = (open) => {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.documentElement.classList.toggle('nav-open', open);
  };
  toggle.addEventListener('click', () => set(!nav.classList.contains('is-open')));
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) set(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') set(false);
  });
}

/**
 * loads and decorates the header
 * @param {Element} block The header block element
 */
export default async function decorate(block) {
  const navMeta = getMetadata('nav');
  const navPath = navMeta ? new URL(navMeta, window.location).pathname : '/nav';
  const fragment = await loadFragment(navPath);
  block.textContent = '';
  if (!fragment) return;

  const [brandSec, linksSec, toolsSec] = fragment.querySelectorAll(':scope > .section');

  const inner = el('div', 'container header-inner');
  const nav = el('nav', 'nav', { id: 'primary-nav', 'aria-label': 'Primary' });
  const list = linksSec && linksSec.querySelector('ul');
  if (list) {
    list.querySelectorAll(':scope > li > p').forEach((p) => p.replaceWith(...p.childNodes));
    nav.append(list);
  }

  const toggle = el('button', 'nav-toggle', {
    type: 'button',
    'aria-label': 'Menu',
    'aria-expanded': 'false',
    'aria-controls': 'primary-nav',
  });
  toggle.append(el('span'), el('span'));

  inner.append(buildBrand(brandSec), nav, buildUtils(toolsSec, toggle));
  block.append(inner);

  initScroll(block);
  initToggle(toggle, nav);
}
