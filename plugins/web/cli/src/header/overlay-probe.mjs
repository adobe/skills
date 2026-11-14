/**
 * In-page source of `() => [...]`: cookie / consent layers still visible in the viewport after the
 * capture hid what it knew. Each hit is { selector, text, rect }. Run right before a screenshot:
 * the pre-flight aborts on any hit (an SEO blog's menus were once captured under the dialog).
 * A hit is a known CMP root, or a fixed / sticky / dialog layer whose text reads like consent.
 */
/**
 * In-page source of `(element) => selector`: a selector matching only this element, stable across
 * loads when the page gives one (id, then a class used once, else an nth-of-type path). Hide rules
 * built from it are reused in fresh sessions; a bare "div" would hide the whole page.
 */
export const SELECTOR_OF = `(el) => {
  const one = (s) => { try { return document.querySelectorAll(s).length === 1; } catch { return false; } };
  const selectorOf = (e) => {
    if (e.id && one('#' + CSS.escape(e.id))) return '#' + CSS.escape(e.id);
    const tag = e.tagName.toLowerCase();
    const cls = [...e.classList].map((c) => tag + '.' + CSS.escape(c)).find(one);
    if (cls) return cls;
    const up = e.parentElement;
    const nth = [...up.children].filter((c) => c.tagName === e.tagName).indexOf(e) + 1;
    return (up === document.body ? 'body' : selectorOf(up)) + ' > ' + tag + ':nth-of-type(' + nth + ')';
  };
  return selectorOf(el);
}`;

export const VISIBLE_OVERLAYS = `() => {
  const CMP = ['#onetrust-banner-sdk', '#onetrust-consent-sdk', '#CybotCookiebotDialog',
    '#usercentrics-root', '#usercentrics-cmp-ui', '#didomi-host', '#didomi-popup', '.fc-consent-root',
    '#qc-cmp2-container', '#truste-consent-track', '#ch2-dialog', '#ch2-container',
    '[id^="sp_message_container"]', '.cky-consent-container', '#cookie-law-info-bar',
    '#moove_gdpr_cookie_info_bar', '.osano-cm-window', '#cmpbox', '#cookiescript_injected'];
  const WORDS = /cookie|consent|gdpr|rgpd|datenschutz|tout accepter|accept all|alle akzeptieren/i;
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return r.width >= 2 && r.height >= 2 && r.bottom > 0 && r.top < innerHeight
      && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05;
  };
  // a layer is only visible if its ancestors are too (display:none on a parent hides it)
  const shown = (e) => vis(e) && e.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  const layer = (e) => {
    const cs = getComputedStyle(e);
    return cs.position === 'fixed' || cs.position === 'sticky' || e.matches('[role=dialog], [role=alertdialog], [aria-modal=true], dialog[open]');
  };
  // the page itself, not a layer over it: a sticky header with a "Cookie settings" link, a fixed app shell
  const page = (e) => e.matches('header, nav, [role=navigation]') || e.querySelector('header, nav, [role=navigation]')
    || (e.innerText || '').length >= 0.3 * document.body.innerText.length;
  const hits = [];
  for (const e of document.querySelectorAll(CMP.join(','))) if (shown(e)) hits.push(e);
  for (const e of document.querySelectorAll('body *')) {
    if (hits.some((h) => h.contains(e) || e.contains(h)) || !layer(e) || !shown(e) || page(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.width * r.height < 0.02 * innerWidth * innerHeight) continue;
    if (WORDS.test(e.innerText || '')) hits.push(e);
  }
  // a layer inside an open shadow root (a WordPress site's consent plugin): its zero-height host is the hit
  for (const host of document.querySelectorAll('body *')) {
    if (!host.shadowRoot || hits.some((h) => h.contains(host))) continue;
    const inner = [...host.shadowRoot.querySelectorAll('*')].find((e) => layer(e) && shown(e)
      && WORDS.test(e.innerText || ''));
    if (inner) hits.push(host);
  }
  const selectorOf = ${SELECTOR_OF};
  return hits.map((e) => {
    const r = e.getBoundingClientRect();
    return { selector: selectorOf(e),
      text: (e.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
  });
}`;
