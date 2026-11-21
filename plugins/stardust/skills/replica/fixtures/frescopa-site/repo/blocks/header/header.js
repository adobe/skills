import { getMetadata } from '../../scripts/aem.js';
import { loadFragment } from '../fragment/fragment.js';

/**
 * header — the Fréscopa site header, template-slotted from the gated canon chrome
 * (stardust/prototypes/shared/canon.css + canon.js, live `.header` / `.fr-hdr`).
 *
 * Authored /nav document (three sections, the stock contract):
 *   1. brand — one link holding the :frescopa-logo-light: and :frescopa-logo: icons
 *   2. nav   — a list of links (The Atelier, Machines, …)
 *   3. tools — a list of labels (Search, Account, Cart, 0 items) → inert icon buttons
 *
 * Page metadata `Header Style`: (empty) = home (transparent over the hero, is-scrolled past
 * 12px, hides scrolling down past 480px); `solid` = React page types (always scrolled,
 * no morph, no hide); `app` = React page over a dark photo hero (morph, never hides).
 *
 * Behaviour (dynamic-features rows 6, 7): scroll state machine 12 / 480 / ±4px; mobile
 * drawer toggle (≤ 900px), closes on link click and Escape; aria-current on the page link.
 * @ew-exempt all — chrome fragment; labels read as aria-labels of the inert tool buttons
 */

const SVG_OPEN = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" '
  + 'stroke="currentColor" stroke-width="1.6">';
const TOOL_ICONS = {
  search: `${SVG_OPEN}<circle cx="11" cy="11" r="7"/>`
    + '<path d="m20 20-3.2-3.2" stroke-linecap="round"/></svg>',
  account: `${SVG_OPEN}<circle cx="12" cy="8" r="4"/>`
    + '<path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" stroke-linecap="round"/></svg>',
  cart: `${SVG_OPEN}<path d="M6 8h12l-1 11H7L6 8Z"/>`
    + '<path d="M9 8a3 3 0 0 1 6 0" stroke-linecap="round"/></svg>',
};

function normalisePath(path) {
  return path.replace(/\.html$/, '').replace(/\/index$/, '').replace(/\/$/, '') || '/';
}

function buildBrand(section) {
  const brand = (section && section.querySelector('a')) || document.createElement('a');
  if (!brand.getAttribute('href')) brand.href = '/';
  brand.className = 'header-brand';
  brand.removeAttribute('title');
  brand.setAttribute('aria-label', 'Fréscopa home');
  const imgs = section ? [...section.querySelectorAll('img')] : [];
  const light = imgs.find((i) => /light/.test(i.dataset.iconName || i.src)) || imgs[0];
  const dark = imgs.find((i) => i !== light);
  const logos = [];
  [[light, 'light'], [dark, 'dark']].forEach(([img, tone]) => {
    if (!img) return;
    img.className = `header-logo header-logo-${tone}`;
    img.alt = tone === 'light' ? 'Fréscopa' : '';
    img.width = 118;
    img.height = 32;
    img.loading = 'eager';
    logos.push(img);
  });
  brand.replaceChildren(...logos);
  return brand;
}

function buildNav(section) {
  const nav = document.createElement('nav');
  nav.className = 'nav';
  nav.id = 'primary-nav';
  nav.setAttribute('aria-label', 'Primary');
  if (!section) return nav;
  const here = normalisePath(window.location.pathname);
  // the pipeline may wrap each item's link in a <p> (#98): match both shapes
  [...section.querySelectorAll('li > a, li > p > a, p > a')].forEach((a) => {
    if (normalisePath(new URL(a.href, window.location).pathname) === here) {
      a.setAttribute('aria-current', 'page');
    }
    nav.append(a);
  });
  return nav;
}

function buildUtils(section) {
  const utils = document.createElement('div');
  utils.className = 'header-utils';
  const labels = section
    ? [...section.querySelectorAll('li, p')].filter((el) => !el.querySelector('li, p'))
    : [];
  labels.forEach((el) => {
    const label = el.textContent.trim();
    if (!label) return;
    const key = Object.keys(TOOL_ICONS).find((k) => label.toLowerCase().includes(k));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `iconbtn${key === 'cart' ? ' iconbtn-cart' : ''}`;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = TOOL_ICONS[key] || '';
    utils.append(btn);
  });
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'nav-toggle';
  toggle.setAttribute('aria-label', 'Menu');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'primary-nav');
  toggle.append(document.createElement('span'), document.createElement('span'));
  utils.append(toggle);
  return utils;
}

function initScrollState(host, variant) {
  if (variant === 'solid') {
    host.classList.add('is-scrolled');
    return;
  }
  const noHide = variant === 'app';
  let last = 0;
  let ticking = false;
  const update = () => {
    const y = window.scrollY;
    host.classList.toggle('is-scrolled', y > 12);
    if (!noHide && y > 480 && y > last + 4) host.classList.add('is-hidden');
    else if (y < last - 4 || y < 480) host.classList.remove('is-hidden');
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

function initNavToggle(toggle, nav) {
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
  const sections = fragment ? [...fragment.children] : [];
  const [brandSection, navSection, toolsSection] = sections;

  const inner = document.createElement('div');
  inner.className = 'container header-inner';
  const nav = buildNav(navSection);
  const utils = buildUtils(toolsSection);
  inner.append(buildBrand(brandSection), nav, utils);
  block.replaceChildren(inner);

  const host = block.closest('header') || block;
  const variant = (getMetadata('header-style') || '').trim().toLowerCase();
  host.classList.add('site-header');
  if (variant === 'solid' || variant === 'app') host.classList.add(`header-${variant}`);
  host.dataset.header = '';
  initScrollState(host, variant);
  initNavToggle(utils.querySelector('.nav-toggle'), nav);
}
