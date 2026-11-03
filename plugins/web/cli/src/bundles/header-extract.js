/* Browser-side: injected into the source page. Defines window.__plgExtract(), __plgRegionsBySelector(),
 * __plgFindHeader() and __plgHeaderRegions() (web header capture). */
(() => {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META', 'TEMPLATE', 'IFRAME']);
  const STYLE_PROPS = [
    'display', 'position', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap',
    'grid-template-columns', 'width', 'max-width', 'height', 'min-height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
    'text-transform', 'text-align', 'text-decoration-line', 'color',
    'background-color', 'background-image', 'background-size', 'background-position',
    'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius',
    'box-shadow', 'opacity', 'object-fit', 'list-style-type', 'overflow', 'z-index',
    // how glyphs render (s2b: without them a header's text was 1:1 in metrics, not in pixels)
    '-webkit-font-smoothing', 'text-rendering', 'font-feature-settings', 'font-variation-settings',
    'font-kerning',
  ];
  const INHERITED = new Set(['font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
    'letter-spacing', 'text-transform', 'text-align', 'color', 'list-style-type',
    '-webkit-font-smoothing', 'text-rendering', 'font-feature-settings', 'font-variation-settings',
    'font-kerning']);
  const DEFAULTS = {
    position: 'static', 'flex-direction': 'row', 'flex-wrap': 'nowrap', 'justify-content': 'normal',
    'align-items': 'normal', gap: 'normal', 'grid-template-columns': 'none', 'max-width': 'none',
    'min-height': 'auto', 'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none',
    'background-size': 'auto', 'background-position': '0% 0%', 'border-radius': '0px',
    'box-shadow': 'none', opacity: '1', 'object-fit': 'fill', overflow: 'visible', 'z-index': 'auto',
    'text-decoration-line': 'none',
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  };
  const absRect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY),
      w: Math.round(r.width), h: Math.round(r.height) };
  };
  const cssPath = (el) => {
    const parts = [];
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      if (e.id && /^[a-z][\w-]*$/i.test(e.id)) { parts.unshift(`#${e.id}`); break; }
      const sibs = [...e.parentElement.children].filter((c) => c.tagName === e.tagName);
      const idx = sibs.indexOf(e) + 1;
      parts.unshift(`${e.tagName.toLowerCase()}${sibs.length > 1 ? `:nth-of-type(${idx})` : ''}`);
    }
    return parts.length && parts[0].startsWith('#') ? parts.join(' > ') : `body > ${parts.join(' > ')}`;
  };

  const LANDMARKS = new Set(['HEADER', 'FOOTER', 'SECTION', 'NAV', 'ASIDE', 'ARTICLE']);
  function regionsOf(container, vw, vh, depth = 0) {
    const kids = [...container.children].filter((c) => !SKIP.has(c.tagName) && visible(c));
    const out = [];
    let lastBottom = -1;
    for (const k of kids) {
      const r = absRect(k);
      if (r.w < vw * 0.9) continue;
      if (r.y + r.h <= lastBottom + 2) continue;
      const stacked = [...k.children].filter((c) => !SKIP.has(c.tagName) && visible(c)
        && absRect(c).w >= vw * 0.9);
      const isWrapper = !LANDMARKS.has(k.tagName) && depth < 6
        && (stacked.length >= 2 || (stacked.length === 1 && Math.abs(absRect(stacked[0]).h - r.h) < 4));
      const isMain = k.tagName === 'MAIN' && stacked.length >= 2;
      if ((isWrapper || isMain) && r.h > vh * 0.5) {
        out.push(...regionsOf(k, vw, vh, depth + 1));
      } else {
        out.push(k);
      }
      lastBottom = Math.max(lastBottom, r.y + r.h);
    }
    return out;
  }

  function compactProps(props) {
    const map = new Map(props);
    const out = [];
    for (const box of ['margin', 'padding', 'border']) {
      const sides = ['top', 'right', 'bottom', 'left'].map((d) => map.get(`${box}-${d}`));
      if (sides.every((v) => v === undefined)) continue;
      const vals = sides.map((v) => v ?? (box === 'border' ? 'none' : '0px'));
      ['top', 'right', 'bottom', 'left'].forEach((d) => map.delete(`${box}-${d}`));
      if (box === 'border') {
        if (vals.every((v) => v === vals[0])) out.push(`border:${vals[0]}`);
        else ['top', 'right', 'bottom', 'left'].forEach((d, i) => { if (vals[i] !== 'none') out.push(`border-${d}:${vals[i]}`); });
      } else {
        out.push(`${box}:${vals.join(' ')}`);
      }
    }
    if (map.has('font-family')) map.set('font-family', map.get('font-family').split(',')[0]);
    if (map.get('min-height') === '0px') map.delete('min-height');
    return [...[...map].map(([k, v]) => `${k}:${v}`), ...out].join('; ');
  }

  function styleLines(root, maxNodes) {
    const lines = [];
    const rootRect = absRect(root);
    const walk = (el, depth, parentStyle) => {
      if (lines.length >= maxNodes || SKIP.has(el.tagName) || !visible(el)) return;
      const cs = getComputedStyle(el);
      const props = [];
      for (const p of STYLE_PROPS) {
        const v = cs.getPropertyValue(p);
        if (INHERITED.has(p) ? (parentStyle && parentStyle.getPropertyValue(p) === v) : DEFAULTS[p] === v) continue;
        if ((p === 'width' || p === 'height') && el.tagName !== 'IMG' && el.tagName !== 'svg') continue;
        if (p.startsWith('border-') && p !== 'border-radius' && v.startsWith('0px')) continue;
        if (p.startsWith('margin') || p.startsWith('padding')) { if (v === '0px') continue; }
        if (p === 'display' && ['block', 'inline'].includes(v)) continue;
        props.push([p, v.length > 160 ? `${v.slice(0, 160)}…` : v]);
      }
      const compact = compactProps(props);
      const r = absRect(el);
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim())
        .join(' ').replace(/\s+/g, ' ').slice(0, 60);
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)
        .filter((c) => c && !c.startsWith('css-')).slice(0, 3).join('.') : '';
      lines.push(`${'  '.repeat(depth)}${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} `
        + `@${r.x - rootRect.x},${r.y - rootRect.y} ${r.w}x${r.h}${own ? ` "${own}"` : ''} { ${compact} }`);
      if (el.tagName === 'svg') return;
      for (const c of el.children) walk(c, depth + 1, cs);
    };
    walk(root, 0, root.parentElement ? getComputedStyle(root.parentElement) : null);
    return lines;
  }

  function cleanHtml(root) {
    const clone = root.cloneNode(true);
    const live = [root, ...root.querySelectorAll('*')];
    const copies = [clone, ...clone.querySelectorAll('*')];
    copies.forEach((c, i) => {
      const src = live[i];
      if (src && src.tagName === 'IMG' && src.currentSrc) c.setAttribute('src', src.currentSrc);
      if (src && !SKIP.has(src.tagName) && src.nodeType === 1 && src.tagName !== 'svg'
        && !(src instanceof SVGElement) && !visible(src) && src.tagName !== 'BR') c.setAttribute('data-plg-hidden', '');
    });
    clone.querySelectorAll('script,style,noscript,template,link,meta').forEach((n) => n.remove());
    // hidden content (dropdowns, mobile-only items) is kept but marked; nested marks are redundant
    clone.querySelectorAll('[data-plg-hidden] [data-plg-hidden]').forEach((n) => n.removeAttribute('data-plg-hidden'));
    clone.querySelectorAll('[data-plg-hidden]').forEach((n) => {
      n.removeAttribute('data-plg-hidden');
      n.setAttribute('hidden-on-desktop', '');
    });
    clone.querySelectorAll('*').forEach((n) => {
      [...n.attributes].forEach((a) => {
        if (/^(on|data-(?!src))/.test(a.name) || a.name === 'style' || a.name === 'srcset' || a.name === 'sizes') n.removeAttribute(a.name);
        if (a.name === 'class') {
          const keep = a.value.split(/\s+/).filter((c) => c && !c.startsWith('css-')).join(' ');
          if (keep) n.setAttribute('class', keep); else n.removeAttribute('class');
        }
      });
      if (n.tagName === 'A' && n.getAttribute('href')) n.setAttribute('href', n.href);
    });
    return clone.outerHTML.replace(/\s{2,}/g, ' ');
  }

  window.__plgRegionsBySelector = (selectors, maxStyleNodes = 400) => JSON.stringify(
    selectors.map((sel) => {
      const el = document.querySelector(sel);
      if (!el || !visible(el)) return null;
      return { rect: absRect(el), styles: styleLines(el, maxStyleNodes).join('\n') };
    }),
  );

  // the header when none is named: the first of these that is shown at the top of the page and is
  // not most of the viewport (a full-height app shell is not a header)
  const HEADER_CANDIDATES = ['body > header', 'header', '[role=banner]', '#header', '.header'];
  // the bands stacked above it at the top of the page (a promo or top bar outside the <header>):
  // earlier siblings of the header or of an ancestor, shown, at least half the viewport wide,
  // entirely above the header's top
  const bandsAbove = (el, top) => {
    const out = [];
    for (let e = el; e && e.parentElement && e !== document.body; e = e.parentElement) {
      for (let s = e.previousElementSibling; s; s = s.previousElementSibling) {
        if (SKIP.has(s.tagName) || !visible(s)) continue;
        const r = absRect(s);
        if (r.h >= 10 && r.w >= 0.5 * innerWidth && r.y >= 0 && r.y + r.h <= top + 1) out.unshift(s);
      }
    }
    // top first; of bands that overlap (a wrapper and its copy, a placeholder under a fixed bar),
    // the first in the page's order
    let bottom = -Infinity;
    return out
      .sort((a, b) => absRect(a).y - absRect(b).y)
      .filter((s) => {
        const r = absRect(s);
        if (r.y < bottom - 1) return false;
        bottom = r.y + r.h;
        return true;
      });
  };
  // selectors, top first: [bands above..., the header]; [] when none is found
  window.__plgFindHeader = () => {
    for (const sel of HEADER_CANDIDATES) {
      for (const el of document.querySelectorAll(sel)) {
        if (!visible(el)) continue;
        const r = absRect(el);
        if (r.y < 200 && r.h >= 20 && r.h < 0.8 * innerHeight) {
          const above = r.y > 0 ? bandsAbove(el, r.y) : [];
          return [...above, el].map(cssPath);
        }
      }
    }
    return [];
  };

  // one region record per selector (null when the page does not show it), as __plgExtract's
  window.__plgHeaderRegions = (selectors, maxStyleNodes = 400) => JSON.stringify(
    selectors.map((sel, i) => {
      const el = document.querySelector(sel);
      if (!el || !visible(el)) return null;
      const cs = getComputedStyle(el);
      return {
        id: i ? `header-${i + 1}` : 'header',
        tag: el.tagName.toLowerCase(),
        selector: sel,
        rect: absRect(el),
        background: { color: cs.backgroundColor, image: cs.backgroundImage },
        text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 160),
        fullText: el.innerText.replace(/\s+/g, ' ').trim(),
        html: cleanHtml(el),
        styles: styleLines(el, maxStyleNodes).join('\n'),
      };
    }),
  );

  window.__plgExtract = ({ maxStyleNodes = 400 } = {}) => {
    const vw = document.documentElement.clientWidth;
    const vh = innerHeight;
    const regions = regionsOf(document.body, vw, vh).map((el, i) => {
      const rect = absRect(el);
      const cs = getComputedStyle(el);
      return {
        id: `r${i + 1}`,
        tag: el.tagName.toLowerCase(),
        selector: cssPath(el),
        rect,
        background: { color: cs.backgroundColor, image: cs.backgroundImage },
        text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 160),
        fullText: el.innerText.replace(/\s+/g, ' ').trim(),
        html: cleanHtml(el),
        styles: styleLines(el, maxStyleNodes).join('\n'),
      };
    });
    const images = [...document.images].filter(visible).map((img) => ({
      src: img.currentSrc || img.src, alt: img.alt, rect: absRect(img),
      natural: { w: img.naturalWidth, h: img.naturalHeight },
    }));
    const bgImages = [...document.querySelectorAll('body *')].filter(visible).map((el) => {
      const m = getComputedStyle(el).backgroundImage.match(/url\("?([^")]+)"?\)/);
      return m ? { src: new URL(m[1], location.href).href, selector: cssPath(el), rect: absRect(el) } : null;
    }).filter(Boolean);
    const fontFaces = [];
    for (const sheet of document.styleSheets) {
      let rules = [];
      try { rules = [...sheet.cssRules]; } catch { continue; }
      for (const r of rules) {
        if (r instanceof CSSFontFaceRule) {
          fontFaces.push({ css: r.cssText, base: sheet.href || location.href });
        }
      }
    }
    const usedFonts = new Set();
    document.querySelectorAll('body *').forEach((el) => { if (visible(el)) usedFonts.add(getComputedStyle(el).fontFamily); });
    const body = getComputedStyle(document.body);
    // how body's line-height inherits: a child with another font size keeps the px value, or
    // scales it (a unitless ratio, which the computed value no longer shows)
    const probe = document.createElement('span');
    probe.style.fontSize = '10px';
    document.body.append(probe);
    const probeLh = getComputedStyle(probe).lineHeight;
    probe.remove();
    const lineHeightInherited = probeLh === body.lineHeight || probeLh === 'normal' ? body.lineHeight
      : String(+(parseFloat(probeLh) / 10).toFixed(4));
    return JSON.stringify({
      url: location.href, title: document.title,
      meta: [...document.querySelectorAll('meta[name],meta[property]')].map((m) => ({
        name: m.getAttribute('name') || m.getAttribute('property'), content: m.content })),
      viewport: { w: vw, h: vh }, pageHeight: document.documentElement.scrollHeight,
      body: { font: body.fontFamily, size: body.fontSize, color: body.color, bg: body.backgroundColor, lineHeight: body.lineHeight,
        lineHeightInherited,
        // inherited by every text, so never in a region's dump (only where an element resets them)
        fontSmoothing: body.webkitFontSmoothing, textRendering: body.textRendering,
        fontFeatureSettings: body.fontFeatureSettings, fontVariationSettings: body.fontVariationSettings,
        fontKerning: body.fontKerning },
      usedFonts: [...usedFonts], fontFaces, images, bgImages, regions,
    });
  };
})();
