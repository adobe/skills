/**
 * Header Block
 * Supports multiple sections via Section Metadata Style property
 * and advanced mega menus with auto-detection.
 *
 * Base: the migrate-header skill's block (see SOURCE.md); additions listed in CHANGES.md.
 */

import { decorateIcons } from '../../scripts/aem.js';
// eslint-disable-next-line import/no-cycle
import { loadFragment } from '../fragment/fragment.js';

const SECTION_CLASSES = {
  MAIN_NAV: 'main-nav',
  BRAND: 'brand',
};
const SECTION_ROLES = ['brand', 'top-bar', 'utility', 'main-nav'];

/* desktop from this width up; set per site, with the same value in the CSS media queries */
const BREAKPOINT = 1024;

/**
 * Read a section-metadata value. Keys are matched case-insensitively with
 * hyphens treated as spaces, so `scroll-behavior` and `Scroll Behavior`
 * are equivalent.
 * @param {Element} section
 * @param {string} key
 * @returns {string|null}
 */
function getSectionMetadata(section, key) {
  const want = key.toLowerCase().replace(/-/g, ' ');
  // The delivery pipeline turns a section-metadata table into attributes on the section:
  // Style values become classes, other keys become data-<key> attributes. Read those first.
  if (want === 'style' && section.classList.length) return [...section.classList].join(', ');
  const dataKey = want.replace(/\s+(\w)/g, (_, c) => c.toUpperCase());
  if (section.dataset[dataKey] !== undefined) return section.dataset[dataKey];
  const sectionMeta = section.querySelector('.section-metadata');
  if (!sectionMeta) return null;
  const match = [...sectionMeta.querySelectorAll(':scope > div')].find(
    (row) => row.children[0]?.textContent?.trim().toLowerCase().replace(/-/g, ' ') === want,
  );
  return match?.children[1]?.textContent?.trim() ?? null;
}

/**
 * Get section style (role) from section metadata
 * @param {Element} section - The section element
 * @returns {string|null} - The role, or the first style value
 */
function getSectionStyle(section) {
  const values = (getSectionMetadata(section, 'style') || '').split(',')
    .map((v) => v.trim().toLowerCase()).filter(Boolean);
  return values.find((v) => SECTION_ROLES.includes(v)) || values[0] || null;
}

/**
 * Get mobile style from section metadata
 * @param {Element} section - The section element
 * @returns {string} - The mobile style (accordion|slide-in|fullscreen)
 */
function getMobileStyle(section) {
  return getSectionMetadata(section, 'mobile style')?.toLowerCase() || 'accordion';
}

/**
 * Check if viewport is desktop
 * @returns {boolean}
 */
function isDesktop() {
  return window.matchMedia(`(min-width: ${BREAKPOINT}px)`).matches;
}

/**
 * Detect if dropdown content is rich (mega) or simple (links only)
 * @param {Element} ul - The nested ul element
 * @returns {boolean} - True if mega menu content
 */
function isMegaContent(ul) {
  const hasImages = ul.querySelector('img, picture') !== null;
  const hasHeadings = ul.querySelector('h1, h2, h3, h4, h5, h6') !== null;
  const hasParagraphs = ul.querySelector('p') !== null;
  const hasBlocks = ul.querySelector('[class*="block"]') !== null;
  const hasNestedLists = ul.querySelector('ul') !== null;

  return hasImages || hasHeadings || hasParagraphs || hasBlocks || hasNestedLists;
}

/**
 * A panel authored as a fragment: the nested list holds a single link to a fragment path.
 * @param {Element} ul
 * @returns {string|null} fragment path
 */
function fragmentPath(ul) {
  const items = ul.querySelectorAll(':scope > li');
  if (items.length !== 1) return null;
  const links = items[0].querySelectorAll('a[href]');
  if (links.length !== 1) return null;
  const { pathname } = new URL(links[0].getAttribute('href'), window.location.href);
  // a site's fragments can sit under its folder: /<site>/fragments/
  return /^\/([^/]+\/)?(fragments|nav)\//.test(pathname) ? pathname : null;
}

let menuId = 0;

/**
 * The trigger of a nav item: its link (bare or wrapped in <p> by the delivery pipeline), or,
 * when the label has no link, a button built from the label text.
 * @param {Element} li
 * @returns {Element|null}
 */
function buildTrigger(li) {
  const link = li.querySelector(':scope > a, :scope > p > a');
  if (link) {
    if (link.parentElement.tagName === 'P') link.parentElement.replaceWith(link);
    link.classList.add('header-nav-trigger');
    return link;
  }
  // the label: text before the item's list (a note after the list belongs to the panel)
  const nested = li.querySelector(':scope > ul');
  const kids = [...li.childNodes];
  const before = nested ? kids.slice(0, kids.indexOf(nested)) : kids;
  const labelNodes = before.filter((n) => (n.nodeType === 3 && n.textContent.trim())
    || (n.nodeType === 1 && ['P', 'STRONG', 'SPAN'].includes(n.tagName) && !n.querySelector('a')));
  const text = labelNodes.map((n) => n.textContent.trim()).join(' ').trim();
  if (!text) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'header-nav-trigger';
  button.textContent = text;
  labelNodes.forEach((n) => n.remove());
  li.prepend(button);
  return button;
}

/**
 * Build navigation structure from content
 * @param {Element} content - The nav section content
 * @returns {{ nav: Element, fragments: Promise[] }} - The decorated nav element and the
 *   pending fragment panels
 */
function buildNavigation(content) {
  const nav = document.createElement('nav');
  nav.className = 'header-nav';
  nav.setAttribute('aria-label', 'Main navigation');
  const fragments = [];

  const ul = content.querySelector('ul');
  if (!ul) return { nav, fragments };

  ul.className = 'header-nav-list';

  ul.querySelectorAll(':scope > li').forEach((li) => {
    li.className = 'header-nav-item';

    const nestedUl = li.querySelector(':scope > ul');
    const trigger = buildTrigger(li);

    if (nestedUl && trigger) {
      li.classList.add('has-dropdown');
      menuId += 1;
      const dropdown = document.createElement('div');
      dropdown.id = `header-menu-${menuId}`;
      trigger.setAttribute('aria-haspopup', 'true');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-controls', dropdown.id);

      const path = fragmentPath(nestedUl);
      // other content of the item (a note, a call to action) belongs to its panel
      const extras = [...li.children].filter((c) => c !== trigger && c !== nestedUl);
      if (path) {
        dropdown.className = 'header-dropdown header-dropdown--mega header-dropdown--fragment';
        nestedUl.remove();
        fragments.push(loadFragment(path).then((main) => {
          if (main) dropdown.prepend(...main.childNodes);
        }));
      } else {
        dropdown.className = `header-dropdown header-dropdown--${isMegaContent(nestedUl) ? 'mega' : 'simple'}`;
        dropdown.appendChild(nestedUl);
      }
      if (extras.length) {
        const footer = document.createElement('div');
        footer.className = 'header-dropdown-footer';
        footer.append(...extras);
        dropdown.appendChild(footer);
      }
      li.appendChild(dropdown);
    }
  });

  nav.appendChild(ul);
  return { nav, fragments };
}

/**
 * Build mobile menu toggle button
 * @returns {Element}
 */
function buildMenuToggle() {
  const button = document.createElement('button');
  button.className = 'header-menu-toggle';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', 'Menu');
  button.innerHTML = '<span class="header-menu-icon"></span>';
  return button;
}

/**
 * Build header section wrapper
 * @param {Element} section - The original section
 * @param {string} style - The section style
 * @returns {{ wrapper: Element, fragments: Promise[] }} - The wrapped section
 */
function buildSection(section, style) {
  const wrapper = document.createElement('div');
  wrapper.className = `header-section header-${style}`;

  if (style === SECTION_CLASSES.MAIN_NAV) {
    const content = document.createElement('div');
    content.className = 'header-section-content';

    const children = [...section.children].filter(
      (child) => !child.classList.contains('section-metadata'),
    );

    // the brand: a first paragraph holding an image, picture, svg or icon
    const firstChild = children[0];
    if (firstChild?.tagName === 'P' && firstChild.querySelector('picture, img, svg, .icon')) {
      const brand = document.createElement('div');
      brand.className = 'header-brand-inline';
      brand.appendChild(firstChild.cloneNode(true));
      content.appendChild(brand);
      children.shift();
    }

    // the first list is the navigation; everything else (CTAs, search, more lists) is tools
    const tempContainer = document.createElement('div');
    const remainingElements = [];
    let navList = null;
    children.forEach((child) => {
      if (child.tagName === 'UL' && !navList) {
        navList = child.cloneNode(true);
        tempContainer.appendChild(navList);
      } else {
        remainingElements.push(child);
      }
    });

    const { nav, fragments } = buildNavigation(tempContainer);
    content.appendChild(nav);

    if (remainingElements.length > 0) {
      const tools = document.createElement('div');
      tools.className = 'header-tools-inline';
      remainingElements.forEach((el) => {
        tools.appendChild(el.cloneNode(true));
      });
      content.appendChild(tools);
    }

    const toggle = buildMenuToggle();
    content.appendChild(toggle);

    wrapper.appendChild(content);
    return { wrapper, fragments };
  }

  const content = document.createElement('div');
  content.className = 'header-section-content';

  const children = [...section.children];
  children.forEach((child) => {
    if (!child.classList.contains('section-metadata')) {
      content.appendChild(child.cloneNode(true));
    }
  });

  wrapper.appendChild(content);
  return { wrapper, fragments: [] };
}

const triggerOf = (item) => item.querySelector(':scope > .header-nav-trigger');

/**
 * Open or close a nav item, keeping the trigger's aria-expanded in sync
 * @param {Element} item
 * @param {boolean} open
 */
function setOpen(item, open) {
  item.classList.toggle('is-open', open);
  triggerOf(item)?.setAttribute('aria-expanded', String(open));
}

/**
 * Setup desktop interactions
 * @param {Element} nav - The navigation element
 * @param {{ trigger: string, delayMs: number }} opts - hover|click, hover intent delay
 */
function setupDesktopInteractions(nav, opts) {
  const items = nav.querySelectorAll('.header-nav-item.has-dropdown');
  const closeAll = (except) => {
    items.forEach((item) => {
      if (item !== except) setOpen(item, false);
    });
  };

  items.forEach((item) => {
    const trigger = triggerOf(item);
    // a label without a link is a button: it toggles in either mode
    if (opts.trigger === 'click' || trigger?.tagName === 'BUTTON') {
      trigger?.addEventListener('click', (e) => {
        if (!isDesktop()) return;
        e.preventDefault();
        const open = !item.classList.contains('is-open');
        setOpen(item, open);
        if (open) closeAll(item);
      });
    }
    if (opts.trigger === 'click') return;

    let hoverTimeout;
    item.addEventListener('mouseenter', () => {
      if (!isDesktop()) return;
      hoverTimeout = setTimeout(() => {
        setOpen(item, true);
        closeAll(item);
      }, opts.delayMs);
    });
    item.addEventListener('mouseleave', () => {
      clearTimeout(hoverTimeout);
      if (isDesktop()) setOpen(item, false);
    });
  });

  document.addEventListener('click', (e) => {
    if (isDesktop() && !nav.contains(e.target)) closeAll(null);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isDesktop()) closeAll(null);
  });
}

/**
 * Setup mobile menu toggle: opens the drawer, traps focus in the header while it is open,
 * and closes on Escape with focus back on the toggle
 * @param {Element} section - The main-nav section
 */
function setupMobileToggle(section) {
  const toggle = section.querySelector('.header-menu-toggle');
  const nav = section.querySelector('.header-nav');

  if (!toggle || !nav) return;

  const setMenu = (open) => {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.style.overflow = open ? 'hidden' : '';
  };
  toggle.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));

  section.addEventListener('keydown', (e) => {
    if (isDesktop() || !nav.classList.contains('is-open')) return;
    if (e.key === 'Escape') {
      setMenu(false);
      toggle.focus();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [toggle, ...nav.querySelectorAll('a[href], button')]
      .filter((el) => el.offsetParent !== null);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // leaving the mobile layout closes the drawer
  window.matchMedia(`(min-width: ${BREAKPOINT}px)`).addEventListener('change', () => setMenu(false));
}

/**
 * Setup mobile dropdown behavior
 * @param {Element} nav - The navigation element
 * @param {string} mobileStyle - The mobile style (accordion|slide-in|fullscreen)
 */
function setupMobileDropdowns(nav, mobileStyle) {
  const items = nav.querySelectorAll('.header-nav-item.has-dropdown');

  items.forEach((item) => {
    const trigger = triggerOf(item);
    if (!trigger) return;

    trigger.addEventListener('click', (e) => {
      if (!isDesktop()) {
        e.preventDefault();

        if (mobileStyle === 'accordion') {
          const open = !item.classList.contains('is-expanded');
          item.classList.toggle('is-expanded', open);
          trigger.setAttribute('aria-expanded', String(open));
        } else {
          item.classList.add('is-expanded');
          trigger.setAttribute('aria-expanded', 'true');
          nav.classList.add('has-expanded-item');
        }
      }
    });
  });

  if (mobileStyle !== 'accordion') {
    items.forEach((item) => {
      const dropdown = item.querySelector('.header-dropdown');
      if (dropdown) {
        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'header-dropdown-back';
        backBtn.textContent = 'Back';
        backBtn.addEventListener('click', () => {
          item.classList.remove('is-expanded');
          triggerOf(item)?.setAttribute('aria-expanded', 'false');
          nav.classList.remove('has-expanded-item');
          triggerOf(item)?.focus();
        });
        dropdown.prepend(backBtn);
      }
    });
  }
}

/**
 * Setup keyboard navigation
 * @param {Element} nav - The navigation element
 */
function setupKeyboardNavigation(nav) {
  const items = [...nav.querySelectorAll('.header-nav-item')];

  items.forEach((item, index) => {
    const trigger = item.querySelector(':scope > .header-nav-trigger, :scope > a');
    if (!trigger) return;

    trigger.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'ArrowRight': {
          e.preventDefault();
          const nextItem = items[index + 1] || items[0];
          nextItem.querySelector(':scope > .header-nav-trigger, :scope > a')?.focus();
          break;
        }

        case 'ArrowLeft': {
          e.preventDefault();
          const prevItem = items[index - 1] || items[items.length - 1];
          prevItem.querySelector(':scope > .header-nav-trigger, :scope > a')?.focus();
          break;
        }

        case 'ArrowDown':
          if (item.classList.contains('has-dropdown')) {
            e.preventDefault();
            setOpen(item, true);
            item.querySelector('.header-dropdown a, .header-dropdown button')?.focus();
          }
          break;

        case 'Enter':
        case ' ':
          // a link trigger keeps its navigation on Enter; Space (and a button) toggle the panel
          if (item.classList.contains('has-dropdown') && isDesktop()
            && (e.key === ' ' || trigger.tagName === 'BUTTON')) {
            e.preventDefault();
            setOpen(item, !item.classList.contains('is-open'));
          }
          break;

        default:
          break;
      }
    });
  });

  nav.querySelectorAll('.header-dropdown').forEach((dropdown) => {
    dropdown.addEventListener('keydown', (e) => {
      const links = [...dropdown.querySelectorAll('a[href], button')]
        .filter((el) => el.offsetParent !== null);
      const i = links.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' && i >= 0) {
        e.preventDefault();
        (links[i + 1] || links[0]).focus();
      } else if (e.key === 'ArrowUp' && i >= 0) {
        e.preventDefault();
        (links[i - 1] || links[links.length - 1]).focus();
      } else if (e.key === 'Escape') {
        const navItem = dropdown.closest('.header-nav-item');
        setOpen(navItem, false);
        triggerOf(navItem)?.focus();
      }
    });
  });
}

/**
 * Header tools on mobile: kept in the bar, moved into the drawer, or hidden.
 * @param {Element} mainNav
 * @param {string} placement - bar|drawer|hidden
 */
function setupMobileTools(mainNav, placement) {
  mainNav.dataset.mobileTools = placement;
  const tools = mainNav.querySelector('.header-tools-inline');
  const nav = mainNav.querySelector('.header-nav');
  if (!tools || !nav || placement !== 'drawer') return;
  const drawerTools = tools.cloneNode(true);
  drawerTools.className = 'header-tools-drawer';
  nav.appendChild(drawerTools);
}

/**
 * A skip link to the main content, first in the header
 * @param {Element} block
 */
function addSkipLink(block) {
  const main = document.querySelector('main');
  if (!main) return;
  if (!main.id) main.id = 'main';
  const skip = document.createElement('a');
  skip.className = 'header-skip-link';
  skip.href = `#${main.id}`;
  skip.textContent = 'Skip to main content';
  block.prepend(skip);
}

/**
 * Scroll-state engine. Toggles `is-scrolled` past the threshold and, for
 * `hide-on-scroll`, `is-hidden` while scrolling down. `static` opts out of
 * the default sticky positioning via the `header-static` class.
 * @param {Element} header - The <header> element wrapping the block
 * @param {string} behavior - static|sticky|hide-on-scroll
 * @param {number} threshold - px
 */
function setupScrollBehavior(header, behavior, threshold) {
  if (behavior === 'static') {
    header.classList.add('header-static');
    return;
  }
  let lastY = window.scrollY;
  let ticking = false;
  const update = () => {
    const y = window.scrollY;
    header.classList.toggle('is-scrolled', y > threshold);
    if (behavior === 'hide-on-scroll') {
      header.classList.toggle('is-hidden', y > lastY && y > threshold);
    }
    lastY = y;
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }, { passive: true });
  update();
}

/**
 * Decorates the header block
 * @param {Element} block - The header block element
 */
export default async function decorate(block) {
  const navMeta = document.querySelector('meta[name="nav"]');
  const navPath = navMeta?.content || '/nav';

  const resp = await fetch(`${navPath}.plain.html`);
  if (!resp.ok) return;

  const html = await resp.text();

  const parser = new DOMParser();
  const navDoc = parser.parseFromString(html, 'text/html');

  block.textContent = '';
  block.classList.add('header-block');

  let scrollBehavior = 'sticky';
  let scrollThreshold = 50;
  const pending = [];

  const sections = navDoc.querySelectorAll('body > div');
  sections.forEach((section) => {
    const style = getSectionStyle(section);
    if (!style) return;

    const sb = getSectionMetadata(section, 'scroll behavior');
    if (sb) scrollBehavior = sb.toLowerCase();
    const st = parseInt(getSectionMetadata(section, 'scroll threshold') ?? '', 10);
    if (Number.isFinite(st)) scrollThreshold = st;

    const { wrapper: sectionWrapper, fragments } = buildSection(section, style);
    pending.push(...fragments);

    if (style === SECTION_CLASSES.MAIN_NAV) {
      sectionWrapper.dataset.mobileStyle = getMobileStyle(section);
      const trigger = (getSectionMetadata(section, 'dropdown trigger') || 'hover').toLowerCase();
      sectionWrapper.dataset.dropdownTrigger = trigger === 'click' ? 'click' : 'hover';
      const delay = parseInt(getSectionMetadata(section, 'dropdown delay') ?? '', 10);
      sectionWrapper.dataset.dropdownDelay = String(Number.isFinite(delay) ? delay : 100);
      const align = (getSectionMetadata(section, 'dropdown align') || 'trigger').toLowerCase();
      sectionWrapper.dataset.dropdownAlign = ['header', 'full', 'center'].includes(align) ? align : 'trigger';
      const tools = (getSectionMetadata(section, 'mobile tools') || 'drawer').toLowerCase();
      sectionWrapper.dataset.mobileTools = ['bar', 'drawer', 'hidden'].includes(tools) ? tools : 'drawer';
    }

    block.appendChild(sectionWrapper);
  });

  // <span class="icon icon-name"> from nav.plain.html -> append <img src="/icons/name.svg">
  decorateIcons(block);
  addSkipLink(block);

  // the header's actual height, for whatever opens under it (mobile sheet, fixed panels):
  // var(--header-bottom); it moves with a wrapping promo bar, unlike the page's --nav-height.
  // The border box: a padding change moves the bottom too (the content box missed it, s2b v1-5)
  new ResizeObserver(() => {
    block.style.setProperty('--header-bottom', `${block.getBoundingClientRect().height}px`);
  }).observe(block, { box: 'border-box' });

  const header = block.closest('header');
  if (header) setupScrollBehavior(header, scrollBehavior, scrollThreshold);

  // fragment panels (and the blocks inside them) are part of the header: wait for them
  await Promise.all(pending);

  const mainNav = block.querySelector('.header-main-nav');
  if (mainNav) {
    setupMobileTools(mainNav, mainNav.dataset.mobileTools || 'drawer');
    const nav = mainNav.querySelector('.header-nav');
    const mobileStyle = mainNav.dataset.mobileStyle || 'accordion';

    if (nav) {
      setupDesktopInteractions(nav, {
        trigger: mainNav.dataset.dropdownTrigger || 'hover',
        delayMs: parseInt(mainNav.dataset.dropdownDelay || '100', 10),
      });
      setupMobileDropdowns(nav, mobileStyle);
      setupKeyboardNavigation(nav);
    }

    setupMobileToggle(mainNav);
  }
}
