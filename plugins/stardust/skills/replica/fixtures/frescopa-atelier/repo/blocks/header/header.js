import { getMetadata } from '../../scripts/aem.js';
import { loadFragment } from '../fragment/fragment.js';
import inlineIcons from '../../scripts/inline-icons.js';

/**
 * Header — template-slotted from the gated prototype's chrome (replica C0).
 *
 * Authored `/nav` document, by section:
 *   1. brand: a link paragraph (home) + the light logo image + the dark logo image
 *   2. nav: one list of links
 *   3. tools: one list, each item `:icon: Label`
 * Behaviour (as observed on the source): solid ground after 12px of scroll, hides when
 * scrolling down past 480px and returns on scroll-up; below 901px the nav is an
 * off-canvas drawer toggled by the menu button (Escape / link click close it).
 *
 * @ew-exempt "Skip to content", "Menu", "Primary": fixed accessibility labels of block-owned
 *   controls (the source hard-codes them; nothing an author edits).
 */

const DESKTOP = window.matchMedia('(min-width: 901px)');

function el(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}

/** the default-content wrapper of each fragment section (or the section itself) */
function sectionsOf(fragment) {
  return [...fragment.children].map((s) => s.querySelector('.default-content-wrapper') || s);
}

function buildBrand(section) {
  const brand = el('div', 'header-brand');
  if (!section) return brand;
  const link = section.querySelector('a[href]');
  const pictures = [...section.querySelectorAll('picture, img')]
    .filter((p) => p.tagName === 'PICTURE' || !p.closest('picture'));
  if (link) {
    const p = link.closest('p') || link;
    // the link's own text becomes its accessible name, visually hidden (moved, not copied)
    const label = el('span', 'sr-only');
    [...link.childNodes].forEach((n) => label.append(n));
    link.append(label);
    pictures.forEach((pic, i) => {
      // chrome logos are above the fold on every page: never lazy (the source loads them eagerly)
      pic.querySelectorAll('img').forEach((img) => { img.loading = 'eager'; });
      if (pic.tagName === 'IMG') pic.loading = 'eager';
      const slot = el('span', i === 0 ? 'header-logo-light' : 'header-logo-dark');
      // the dark (scrolled) logo is a duplicate of the brand mark: hidden from AT, as on the source
      if (i > 0) pic.querySelectorAll('img').forEach((img) => img.setAttribute('aria-hidden', 'true'));
      const host = pic.closest('p');
      slot.append(pic);
      link.append(slot);
      if (host && !host.children.length && !host.textContent.trim()) host.remove();
    });
    brand.append(p);
  } else {
    pictures.forEach((pic) => brand.append(pic.closest('p') || pic));
  }
  return brand;
}

function buildTools(section) {
  const utils = el('div', 'header-utils');
  const list = section && section.querySelector('ul');
  if (list) {
    [...list.querySelectorAll(':scope > li')].forEach((li, i) => {
      const icon = li.querySelector('.icon');
      const label = el('span', 'sr-only', { id: `header-tool-${i}` });
      [...li.childNodes].filter((n) => n !== icon).forEach((n) => label.append(n));
      const btn = el('button', 'iconbtn', { type: 'button', 'aria-labelledby': label.id });
      if (icon) btn.append(icon);
      li.append(btn, label);
    });
    utils.append(list);
  }
  const toggle = el('button', 'nav-toggle', {
    type: 'button', 'aria-label': 'Menu', 'aria-expanded': 'false', 'aria-controls': 'nav',
  });
  toggle.append(el('span'), el('span'));
  utils.append(toggle);
  return utils;
}

function initDrawer(bar, nav, toggle) {
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
    if (e.key === 'Escape' && nav.classList.contains('is-open')) {
      set(false);
      toggle.focus();
    }
  });
  DESKTOP.addEventListener('change', () => set(false));
}

function initMorph(bar) {
  let last = 0;
  let ticking = false;
  const update = () => {
    const y = window.scrollY;
    bar.classList.toggle('is-scrolled', y > 12);
    if (y > 480 && y > last + 4) bar.classList.add('is-hidden');
    else if (y < last - 4 || y < 480) bar.classList.remove('is-hidden');
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

/**
 * loads and decorates the header
 * @param {Element} block The header block element
 */
export default async function decorate(block) {
  const navMeta = getMetadata('nav');
  const navPath = navMeta ? new URL(navMeta, window.location).pathname : '/nav';
  const fragment = await loadFragment(navPath);
  if (!fragment) return;

  const [brandSection, navSection, toolsSection] = sectionsOf(fragment);

  const inner = el('div', 'container header-inner');
  const nav = el('nav', 'nav', { id: 'nav', 'aria-label': 'Primary' });
  if (navSection) {
    let next = navSection.firstElementChild;
    while (next) {
      const current = next;
      next = current.nextElementSibling;
      nav.append(current);
    }
  }
  const utils = buildTools(toolsSection);
  inner.append(buildBrand(brandSection), nav, utils);

  const main = document.querySelector('main');
  if (main && !main.id) main.id = 'main';
  const skip = el('a', 'skip-link', { href: '#main' });
  skip.textContent = 'Skip to content';

  block.textContent = '';
  block.setAttribute('data-header', '');
  block.append(inner);
  // the skip link sits before the header landmark, as in the source
  if (!document.querySelector('body > .skip-link')) document.body.prepend(skip);
  await inlineIcons(utils, 20);

  initDrawer(block, nav, utils.querySelector('.nav-toggle'));
  initMorph(block);
}
