/* Browser-side: injected into the source and the EDS page. Defines
   window.__plgToggles(): the top navigation's menu toggles (elements that open a menu), and
   window.__plgVisibleLinks(): how many links are visible in the viewport. The same rules on both
   sides, so an open state can be compared label by label. */
(() => {
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) return false;
    const s = getComputedStyle(el);
    // ancestors count too: a closed dropdown hidden by its panel's opacity (a WordPress site) is not shown
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05
      && el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  };
  const label = (el) => (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ');
  // a toggle: in the top bar, visible, and it either says it expands (aria) or owns a hidden submenu
  window.__plgToggles = () => {
    const cands = [...document.querySelectorAll('header button, header a, header [role="button"], nav button, nav a, nav [role="button"]')]
      .filter((el) => shown(el) && el.getBoundingClientRect().top < 200);
    const out = [];
    for (const el of cands) {
      const text = label(el);
      if (!text || text.length > 40) continue;
      const aria = el.hasAttribute('aria-expanded') || el.getAttribute('aria-haspopup') === 'true';
      const li = el.closest('li');
      const sub = li && [...li.querySelectorAll('ul, [role="menu"], div')].some((m) => m !== el && !m.contains(el) && !shown(m) && m.querySelector('a'));
      if ((aria || sub) && !out.some((o) => o.label === text)) out.push({ label: text });
    }
    return out.slice(0, 8);
  };
  window.__plgVisibleLinks = () => [...document.querySelectorAll('a[href]')].filter(shown).length;
  // waits (up to `ms`) until more links are visible than `before`: a site that delays its JS until
  // the first interaction replays the click ~1.5 s later (a WordPress site's mobile menu)
  window.__plgWaitReveal = async (before, ms = 5000) => {
    for (let t = 0; t < ms; t += 100) {
      if (window.__plgVisibleLinks() > before) return true;
      await new Promise((r) => { setTimeout(r, 100); });
    }
    return false;
  };

  // remember the links visible with every menu closed, to find what an opened menu revealed
  window.__plgMarkVisibleLinks = () => {
    window.__plgClosed = new Set([...document.querySelectorAll('a[href]')].filter(shown));
  };

  // the opened panel: the smallest visible element holding most newly revealed links, with
  // the styles a header template needs (background, shadow, padding, radius, box)
  window.__plgOpenPanel = () => {
    const fresh = [...document.querySelectorAll('a[href]')].filter((a) => shown(a)
      && !(window.__plgClosed || new Set()).has(a));
    if (!fresh.length) return null;
    let el = fresh[0].parentElement;
    const need = Math.ceil(fresh.length * 0.8);
    while (el && el !== document.body && fresh.filter((a) => el.contains(a)).length < need) el = el.parentElement;
    // the whole panel: climb while the ancestor is still only the panel (it does not hold the
    // closed-state links, i.e. the bar) and is not the page
    let box = el;
    for (let x = el.parentElement; x && x !== document.body; x = x.parentElement) {
      const holdsBar = [...(window.__plgClosed || [])].some((a) => x.contains(a));
      const xr = x.getBoundingClientRect();
      const br = box.getBoundingClientRect();
      // an ancestor that does not contain the panel's box is a positioning parent (the menu item)
      const contains = xr.left <= br.left + 2 && xr.top <= br.top + 2 && xr.right >= br.right - 2 && xr.bottom >= br.bottom - 2;
      if (holdsBar || !contains || xr.height > innerHeight * 1.5) break;
      box = x;
    }
    document.querySelectorAll('[data-plg-panel]').forEach((x) => x.removeAttribute('data-plg-panel'));
    box.setAttribute('data-plg-panel', '');
    const cs = getComputedStyle(box);
    const r = box.getBoundingClientRect();
    return {
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      background: cs.backgroundColor, shadow: cs.boxShadow, padding: cs.padding,
      radius: cs.borderRadius, border: cs.borderTopWidth === '0px' ? 'none' : `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
      links: fresh.length,
      // what the menu holds, for whoever rebuilds it: every revealed link, and the panel's text
      // in reading order (column titles, descriptions)
      items: fresh.map((a) => ({ text: a.innerText.trim().replace(/\s+/g, ' '), href: a.href })),
      text: box.innerText.trim(),
    };
  };

  // the innermost shown element whose text is the label: not only text-only leaves, since a
  // trigger often holds its label next to an icon (a payments site: <button>Produits<svg/></button>)
  const labelEl = (label) => [...document.querySelectorAll('body *')]
    .find((n) => n.textContent.trim() === label && shown(n)
      && ![...n.children].some((c) => c.textContent.trim() === label));
  // the bar holding a nav label: its widest ancestor (at least 90 % of the viewport)
  const barOf = (label) => {
    const el = labelEl(label);
    if (!el) return null;
    let bar = el;
    for (let x = el; x && x !== document.body; x = x.parentElement) {
      if (x.getBoundingClientRect().width >= innerWidth * 0.9) { bar = x; break; }
    }
    return bar;
  };
  window.__plgLabelVisible = (label) => {
    if (!label) return true;
    return !!labelEl(label);
  };

  // scroll behaviour of the bar: static (scrolls away), sticky (stays), hide-on-scroll (hides
  // while scrolling down, comes back when scrolling up)
  window.__plgScrollProbe = async (label) => {
    const bar = barOf(label);
    if (!bar) return { behavior: null };
    const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
    const onTop = () => { const r = bar.getBoundingClientRect(); return r.bottom > 0 && r.top < 200 && shown(bar); };
    scrollTo(0, 1200); await wait(400);
    scrollTo(0, 1600); await wait(400);
    const down = onTop();
    scrollTo(0, 1400); await wait(500);
    const up = onTop();
    scrollTo(0, 0); await wait(200);
    let behavior = 'static';
    if (down) behavior = 'sticky';
    else if (up) behavior = 'hide-on-scroll';
    return { behavior, barHeight: Math.round(bar.getBoundingClientRect().height) };
  };

  // the mobile menu toggle: named like one, else one that says it expands, else the rightmost
  // header button (a promo bar's close button is a header button too)
  window.__plgMobileToggle = () => {
    const vis = [...document.querySelectorAll('header button, header [role=button], header [aria-controls], header [aria-expanded], button[aria-label]')]
      .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < 200; });
    const named = (b) => /menu|navigation|nav-toggle|hamburger|burger/i.test([b.getAttribute('aria-label'), b.className, b.title, b.parentElement?.className].join(' '));
    return vis.find(named) || vis.find((b) => b.hasAttribute('aria-expanded') || b.hasAttribute('aria-controls'))
      || vis.sort((x, y) => y.getBoundingClientRect().right - x.getBoundingClientRect().right)[0] || null;
  };
})();
