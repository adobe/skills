#!/usr/bin/env node
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-console, no-continue, no-nested-ternary, no-plusplus, no-underscore-dangle, object-property-newline */
/**
 * skills/diff/scripts/chrome-explore.mjs — the header's BEHAVIOUR, recorded by using it. Pixel and
 * style gates see the header at rest (pointer parked, motion frozen); a header can pass them with
 * every menu wrong. This explorer opens what a visitor opens and writes it down, so the source's
 * header is a contract and the build is checked against it with the same instrument
 * (chrome-compare.mjs).
 *
 * Per width: every control in the header root (buttons, disclosure triggers, nav links, inputs,
 * the hamburger) is hovered (desktop), clicked and opened from the keyboard (focus + Enter). Each
 * action that reveals content is a STATE: the revealed links, headings, images and inputs, the
 * panel's crop, aria-expanded, focus, scroll lock and the transitions/animations that ran. Each
 * state's close paths are tried (Escape + focus return, click outside, toggle, mouse leave) and
 * its own controls explored depth-first (mega-menu tabs, flyouts, drawer drill-downs), within a
 * budget; hitting it is reported, never silent. Inputs get the probe term typed (typeahead) and
 * submitted (the submit URL). The header's position is sampled at top / scrolled down / up /
 * back. Navigations are answered 204 so the page never leaves.
 *
 * The run paces itself and keeps a per-width request budget, because a source edge rate-limits bursts
 * from one address: routing disables the browser cache, so every reload refetches the whole page, and a
 * typeahead fires once per keystroke. Between controls the page is closed the way it was opened (Escape,
 * the trigger again, a click outside) and reloaded only when the header is not back at rest; the probe
 * term is entered in one go; reaching the budget ends the width, reported as TRUNCATED at request-budget.
 * The budget counts every request to the site's host, subresources included — an image-heavy page spends a
 * few hundred on its first load alone, so the default leaves room for the exploration after it.
 *
 * Usage: node skills/diff/scripts/chrome-explore.mjs <url> <out.json> [options]
 *   --width <w,…>        viewport widths (default 1440,390; below 768 is touch: no hover)
 *   --root <sel>         header root (default: first visible header, [role=banner], .header)
 *   --max-states <n>     states per width (default 400)   --max-depth <n>  nesting (default 4)
 *   --probe <term>       search term (default: spec knowledge's first probe, else a nav label word)
 *   --shots <dir>        open-state crops (default stardust/.work/chrome/<out name>)
 *   --plain              bundled Chromium instead of the window-free real-Chrome tier
 *   --warmup <url>       visit first (bot-managed sites)   --locale <tag>  default en-US
 *   --pace-ms <n>        pause after each control open / close (default 400; 0 = none)
 *   --reload-pause-ms <n>  pause before each page reload (default 1500; 0 = none)
 *   --max-requests <n>   requests to the site's host per width — documents and subresources alike (images,
 *                        CSS, scripts, fonts, XHR), first load included (default 600; 0 = unlimited)
 *   --max-typeahead <n>  inputs probed per width (default 2); the rest are listed, not typed into
 * Exit: 0 written · 1 error · 3 bot challenge. `summarize`, `controlKind`, `normName`, `parseArgs`,
 * `requestBudget`, `sameSite`, `siteHost` are exported.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOUCH_BELOW = 768;

/** Lower-case, collapse whitespace, strip punctuation: the pairing key of a control. Pure. */
export const normName = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

const KINDS = [
  ['search', /\b(search|buscar|busca|recherche|rechercher|suche|suchen|cerca|zoeken|sök|haku|szukaj|検索|搜索|검색)\b/i],
  ['cart', /\b(cart|bag|basket|panier|warenkorb|carrello|carrito|winkelwagen|cesta)\b/i],
  ['account', /\b(account|sign in|log ?in|sign up|profile|my [a-z]+|konto|compte|cuenta|anmelden|connexion)\b/i],
  ['locale', /\b(language|languages|locale|country|region|lang|sprache|langue|idioma)\b/i],
  ['drawer', /\b(menu|navigation|hamburger|open nav|toggle nav)\b/i],
];
/** The control's family from its name, role and attributes. Pure. */
export function controlKind({ name = '', role = '', type = '', hint = '' }) {
  if (role === 'input' && /search/i.test(`${type} ${hint} ${name}`)) return 'search';
  // class names say "menu" on every nav toggle: only a control NAMED menu is the drawer
  for (const [k, re] of KINDS) if (re.test(k === 'drawer' ? name : `${name} ${hint}`)) return k;
  return role === 'link' ? 'link' : role === 'input' ? 'input' : 'menu';
}

/** One line per width: controls, states, distinct links, depth, kinds, truncation. Pure. */
export function summarize(doc) {
  return Object.entries(doc.widths || {}).map(([w, d]) => {
    const links = new Set(); let states = 0; let depth = 0; const kinds = {};
    const opens = (c) => c.search || Object.values(c.actions || {}).some((s) => s && s.opened);
    const walk = (cs, lvl) => {
      for (const c of cs) {
        if (lvl === 1 && opens(c)) kinds[c.kind] = (kinds[c.kind] || 0) + 1;
        for (const s of Object.values(c.actions || {})) {
          if (!s || !s.opened) continue;
          states += 1; depth = Math.max(depth, lvl);
          for (const l of s.panel.links) links.add(`${normName(l.text)} ${l.href}`);
        }
        walk(c.children || [], lvl + 1);
      }
    };
    walk(d.controls || [], 1);
    const k = Object.entries(kinds).map(([n, c]) => `${c} ${n}`).join(', ');
    const spent = d.requests == null ? '' : `, ${d.requests}${d.maxRequests ? `/${d.maxRequests}` : ''} requests`;
    const capped = d.inputsSkipped ? `, ${d.inputsSkipped} input(s) past --max-typeahead` : '';
    return `${w}: ${(d.controls || []).filter(opens).length} controls (${k || 'none'}), ${states} states, ${links.size} links, depth ${depth}${spent}${capped}${d.truncated ? `, TRUNCATED at ${d.truncated}` : ''}`;
  });
}

const DEFAULTS = { width: '1440,390', 'max-states': 400, 'max-depth': 4, 'pace-ms': 400, 'reload-pause-ms': 1500, 'max-requests': 600, 'max-typeahead': 2, locale: 'en-US' };
/** argv → options. A number flag that is missing, negative or not a number takes its default. Pure. */
export function parseArgs(argv) {
  const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
  const num = (k) => { const v = Number(arg(k, DEFAULTS[k])); return Number.isFinite(v) && v >= 0 ? v : DEFAULTS[k]; };
  const bare = ['--plain', '--help', '-h'];
  const [url, out] = argv.filter((a, i) => !a.startsWith('-') && !(i > 0 && argv[i - 1].startsWith('--') && !bare.includes(argv[i - 1])));
  return {
    help: argv.includes('--help') || argv.includes('-h'), url, out,
    widths: String(arg('width', DEFAULTS.width)).split(',').map(Number).filter(Boolean),
    rootSel: arg('root', null), maxStates: num('max-states'), maxDepth: num('max-depth'), probe: arg('probe', null), shots: arg('shots', null),
    plain: argv.includes('--plain'), warmup: arg('warmup', null), locale: arg('locale', DEFAULTS.locale),
    paceMs: num('pace-ms'), reloadPauseMs: num('reload-pause-ms'), maxRequests: num('max-requests'), maxTypeahead: num('max-typeahead'),
  };
}

/** The host a URL belongs to, lower-case, `www.` aside; '' when it is not a URL. Pure. */
export const siteHost = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
/** Does a request to `url` go to the site at `host`? Its host, or a subdomain of it (a search API on api.<host>). Pure. */
export const sameSite = (host, url) => { const h = siteHost(url); return !!host && !!h && (h === host || h.endsWith(`.${host}`)); };
/** The per-width request budget: `spend(url)` counts a request leaving for the site (true when it did), `exhausted()` once `max`
 * is reached (0 = unlimited), `rebase(url)` follows a redirect to another host without losing the count. Pure. */
export function requestBudget(siteUrl, max = DEFAULTS['max-requests']) {
  const b = { host: siteHost(siteUrl), max, count: 0 };
  b.spend = (url) => { if (!sameSite(b.host, url)) return false; b.count += 1; return true; };
  b.exhausted = () => max > 0 && b.count >= max;
  b.rebase = (url) => { const h = siteHost(url); if (h && !sameSite(b.host, url)) b.host = h; };
  return b;
}

// ---- in-page library (installed once per document; ONE argument object per call) ------------------
function installInPage({ rootSel }) {
  if (window.__sdtc) return true;
  const ATOMS = 'a[href],button,input:not([type=hidden]),select,textarea,summary,h1,h2,h3,h4,h5,h6,[role=heading],[role=button],[role=tab],[role=menuitem],[role=option],img,label';
  const CTRL = 'button,summary,input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,[role=button],[role=tab],[role=menuitem],[role=switch],[role=combobox],[aria-expanded],[aria-haspopup],[aria-controls],label[for],a[href]';
  const root = () => [...document.querySelectorAll(rootSel || 'header,[role=banner],.header')].find((e) => e.getBoundingClientRect().height > 0) || null;
  const clipped = (el, r) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      // only hidden / clip overflow hides content; what a scroll container holds is reachable by scrolling
      if (!/hidden|clip/.test(`${cs.overflowX} ${cs.overflowY}`)) continue;
      const q = p.getBoundingClientRect();
      const w = Math.min(r.right, q.right) - Math.max(r.left, q.left); const h = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
      if (w <= 0 || h <= 0 || (w * h) < 0.5 * r.width * r.height) return true;
    }
    return false;
  };
  const vis = (el) => {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    if (r.bottom < 0 || r.right < 0 || r.left > innerWidth) return false;
    return !clipped(el, r);
  };
  const skip = (el) => { const m = el.closest('main,footer,[role=contentinfo]'); const rt = root(); return m && !(rt && m.contains(rt)); };
  const atoms = () => [...document.querySelectorAll(ATOMS)].filter((el) => !skip(el));
  // visible text minus icons (svg, aria-hidden, icon-font ligatures): what pairs a control across source and build
  const ICON_FONT = /icon|symbol|awesome|glyph|ligature/i;
  const text = (el) => {
    const parts = []; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const p = n.parentElement;
      const cs = p && getComputedStyle(p);
      if (!p || p.closest('svg,[aria-hidden=true],script,style') || ICON_FONT.test(cs.fontFamily) || /transparent/.test(cs.fontFamily) || cs.color === 'rgba(0, 0, 0, 0)') continue;
      if (p.closest('[hidden]') || getComputedStyle(p).display === 'none') continue;
      parts.push(n.nodeValue);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  };
  const nameOf = (el) => {
    const lb = el.getAttribute('aria-labelledby');
    const byId = lb && lb.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(text).join(' ');
    const img = el.querySelector && el.querySelector('img[alt],svg title');
    // the visible label pairs best (sites put icon words in aria-label) unless it is only a glyph (☰, ⌕); then the label, then hidden text
    const shown = text(el);
    return ((/[\p{L}\p{N}]/u.test(shown) ? shown : '') || el.getAttribute('aria-label') || byId || el.textContent || el.getAttribute('title') || (img && (img.getAttribute('alt') || img.textContent)) || el.getAttribute('placeholder') || el.getAttribute('value') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  };
  const cssPath = (el) => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e !== document.documentElement; e = e.parentElement) {
      if (e.id && /^[A-Za-z][\w-]*$/.test(e.id) && document.querySelectorAll(`#${e.id}`).length === 1) { parts.unshift(`#${e.id}`); break; }
      const sib = [...e.parentElement.children].filter((x) => x.tagName === e.tagName);
      parts.unshift(`${e.tagName.toLowerCase()}${sib.length > 1 ? `:nth-of-type(${sib.indexOf(e) + 1})` : ''}`);
    }
    return parts.join('>');
  };
  const realHref = (el) => { const h = el.getAttribute('href') || ''; return h && !/^(#|javascript:)/i.test(h); };
  const roleOf = (el) => (/^(input|select|textarea)$/i.test(el.tagName) && !/^(submit|button|reset|image)$/i.test(el.getAttribute('type') || '') ? 'input' : el.tagName === 'A' && realHref(el) && !el.hasAttribute('aria-expanded') && !el.hasAttribute('aria-haspopup') && !el.hasAttribute('aria-controls') && !/^(tab|button|menuitem)$/.test(el.getAttribute('role') || '') ? 'link' : 'toggle');
  // a link inside a panel is explored only when it looks like a trigger: aria, or a hidden list beside it
  const hasHiddenSibling = (el) => { const li = el.closest('li'); return !!(li && [...li.querySelectorAll('ul,ol,div,section')].some((x) => !x.contains(el) && x.querySelector('a') && !vis(x))); };
  const linkOf = (a) => ({ text: (text(a) || a.getAttribute('aria-label') || '').slice(0, 120), href: a.href || a.getAttribute('href') || '' });
  // the aria state a closed panel can leave behind unseen (a mega menu's selected tab, a pressed toggle); absent ≡ false
  const ARIA_STATE = ['aria-selected', 'aria-expanded', 'aria-pressed', 'aria-checked', 'aria-current'];
  const ariaState = (el) => ARIA_STATE.map((a) => { const v = el.getAttribute(a); return v === null || v === 'false' ? '' : v; }).join('|');
  let rootBase = new Map(); let rootState = new Map(); let base = new Map(); let motion = []; let listening = false;
  const lib = {
    root: () => { const r = root(); return r ? cssPath(r) : null; },
    // `root` = the closed page (reset compares against it); the current baseline is what a state is measured from
    snapshot({ root: r = false } = {}) { base = new Map(atoms().map((el) => [el, vis(el)])); if (r) { rootBase = base; rootState = new Map(atoms().map((el) => [el, ariaState(el)])); } return base.size; },
    diff() {
      const now = atoms(); const appeared = now.filter((el) => vis(el) && base.get(el) !== true);
      const gone = [...base.entries()].filter(([el, v]) => v && !vis(el)).length;
      return { appeared, gone };
    },
    // atoms not as the page loaded: shown or hidden differently, or (for the ones it loaded with) in another aria state
    changed() { return atoms().filter((el) => vis(el) !== (rootBase.get(el) === true) || (rootState.has(el) && rootState.get(el) !== ariaState(el))).length; },
    controls({ scope }) {
      const rt = root();
      const pool = scope === 'root' ? (rt ? [...rt.querySelectorAll(CTRL)] : []) : lib.diff().appeared.flatMap((el) => [el, ...el.querySelectorAll(CTRL)]).filter((el) => el.matches(CTRL));
      const seen = new Set(); const out = [];
      // aria-expanded on a container (a <nav>) does not make it a control: it must take focus or a pointer itself
      const interactive = (el) => el.matches('a[href],button,summary,input,select,textarea,label[for],[role=button],[role=tab],[role=menuitem],[role=switch],[role=combobox]') || el.tabIndex >= 0;
      for (const el of pool) {
        if (seen.has(el) || !vis(el) || !interactive(el)) continue; seen.add(el);
        const role = roleOf(el);
        if (scope !== 'root' && role === 'link' && !hasHiddenSibling(el)) continue;
        if (el.tagName === 'LABEL' && !el.htmlFor) continue;
        const r = el.getBoundingClientRect();
        out.push({ sel: cssPath(el), name: nameOf(el), role, type: el.getAttribute('type') || '', hint: `${el.className || ''} ${el.id || ''} ${el.getAttribute('aria-controls') || ''}`.slice(0, 160), href: role === 'link' ? linkOf(el).href : '', expanded: el.getAttribute('aria-expanded'), rect: [r.x, r.y, r.width, r.height].map(Math.round) });
      }
      return out;
    },
    state({ sel }) {
      const { appeared, gone } = lib.diff();
      const content = appeared.filter((el) => el.matches('a[href],button,input,select,textarea,h1,h2,h3,h4,h5,h6,[role=heading],img,[role=option]'));
      if (!content.length && gone < 2) return null;
      const t = document.querySelector(sel);
      let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
      for (const el of appeared) { const r = el.getBoundingClientRect(); x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); }
      let lca = appeared[0] || null;
      while (lca && !appeared.every((el) => lca.contains(el))) lca = lca.parentElement;
      // the crop is the panel's own box: climb from the common parent to the last ancestor that does not hold the trigger
      while (lca && lca.parentElement && lca.parentElement !== document.body && t && !lca.parentElement.contains(t)) lca = lca.parentElement;
      if (lca && lca !== document.body && lca !== document.documentElement) {
        const r = lca.getBoundingClientRect();
        if (r.width * r.height < 0.95 * innerWidth * innerHeight || r.height < innerHeight) { x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); }
      }
      const clip = appeared.length ? [Math.max(0, x0), Math.max(0, y0), Math.min(innerWidth, x1), Math.min(innerHeight, y1)] : null;
      const ae = document.activeElement;
      const lock = [document.documentElement, document.body].some((e) => { const cs = getComputedStyle(e); return cs.overflow === 'hidden' || cs.overflowY === 'hidden' || cs.position === 'fixed'; });
      return {
        opened: appeared.length > 0, hidden: gone,
        panel: {
          links: appeared.filter((el) => el.matches('a[href]')).map(linkOf),
          headings: appeared.filter((el) => el.matches('h1,h2,h3,h4,h5,h6,[role=heading]')).map((el) => text(el).slice(0, 120)).filter(Boolean),
          images: appeared.filter((el) => el.matches('img')).length,
          inputs: appeared.filter((el) => el.matches('input,select,textarea')).map((el) => el.getAttribute('type') || el.tagName.toLowerCase()),
          buttons: appeared.filter((el) => el.matches('button,[role=button]')).map(nameOf).filter(Boolean),
          options: appeared.filter((el) => el.matches('[role=option]')).length,
          rect: clip && [clip[0], clip[1], clip[2] - clip[0], clip[3] - clip[1]].map(Math.round),
        },
        expanded: t ? t.getAttribute('aria-expanded') : null,
        focus: !ae || ae === document.body ? 'body' : t && (ae === t || t.contains(ae)) ? 'trigger' : appeared.some((el) => el === ae || el.contains(ae)) ? 'panel' : 'elsewhere',
        scrollLock: lock,
      };
    },
    // a trigger worth re-acting: still visible and not saying it is closed already
    visible({ sel }) { const t = document.querySelector(sel); return !!t && vis(t) && t.getAttribute('aria-expanded') !== 'false'; },
    focusReturned({ sel }) { const t = document.querySelector(sel); const ae = document.activeElement; return !!(t && ae && (ae === t || t.contains(ae))); },
    focusIn() { const ae = document.activeElement; return !!ae && lib.diff().appeared.some((el) => el === ae || el.contains(ae)); },
    focus({ sel }) { const t = document.querySelector(sel); if (!t) return false; t.focus(); return document.activeElement === t || t.contains(document.activeElement); },
    blur() { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); return true; },
    center({ sel }) { const t = document.querySelector(sel); if (!t) return null; t.scrollIntoView({ block: 'nearest' }); const r = t.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; },
    outsidePoint() {
      const { appeared } = lib.diff(); const rt = root();
      for (const [x, y] of [[innerWidth / 2, innerHeight - 12], [12, innerHeight - 12], [innerWidth - 12, innerHeight / 2], [innerWidth / 2, innerHeight * 0.75]]) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || appeared.some((el) => el.contains(hit) || hit.contains(el)) || (rt && rt.contains(hit)) || hit.closest('a,button,input,select,textarea,label,[role=button]')) continue;
        return { x, y };
      }
      return null;
    },
    motionStart() {
      motion = [];
      if (!listening) {
        listening = true;
        const rec = (e, kind) => {
          const t = e.target; if (!(t instanceof Element)) return;
          const a = (t.getAnimations ? t.getAnimations() : []).find((x) => (kind === 'transition' ? x.transitionProperty === e.propertyName : x.animationName === e.animationName));
          const tm = a && a.effect ? a.effect.getComputedTiming() : null;
          motion.push({ kind, prop: kind === 'transition' ? e.propertyName : e.animationName, ms: tm ? Math.round(Number(tm.duration) || 0) : null, delay: tm ? Math.round(tm.delay || 0) : null, easing: tm ? tm.easing : null, target: `${t.tagName.toLowerCase()}${t.classList.length ? `.${t.classList[0]}` : ''}` });
        };
        document.addEventListener('transitionrun', (e) => rec(e, 'transition'), true);
        document.addEventListener('animationstart', (e) => rec(e, 'animation'), true);
      }
      return true;
    },
    async motionSettle({ maxMs }) {
      const t0 = performance.now();
      await new Promise((r) => { setTimeout(r, 80); });
      for (;;) {
        const running = document.getAnimations().filter((a) => a.playState === 'running' && a.effect && Number(a.effect.getComputedTiming().endTime) !== Infinity);
        if (!running.length || performance.now() - t0 > maxMs) break;
        await new Promise((r) => { setTimeout(r, 60); });
      }
      const seen = new Set();
      return motion.filter((m) => { const k = `${m.kind}|${m.prop}|${m.target}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 40);
    },
    header() {
      const rt = root(); if (!rt) return null;
      const r = rt.getBoundingClientRect(); const cs = getComputedStyle(rt);
      let pos = cs.position; for (let p = rt.parentElement; p && pos === 'static'; p = p.parentElement) { const q = getComputedStyle(p).position; if (q === 'fixed' || q === 'sticky') pos = q; }
      return { y: Math.round(scrollY), top: Math.round(r.top), height: Math.round(r.height), position: pos, inView: r.bottom > 1 && r.top < innerHeight };
    },
  };
  window.__sdtc = lib;
  return true;
}

async function loadPlaywright() {
  const norm = (m) => (m.chromium ? m : m.default);
  try { const req = createRequire(join(process.cwd(), 'package.json')); return norm(await import(pathToFileURL(req.resolve('playwright')).href)); } catch { /* fall through */ }
  return norm(await import('playwright'));
}

// null = the document was replaced (a navigation slipped through) or is being replaced
const call = async (page, fn, arg = {}) => { try { return await page.evaluate(async ({ f, a }) => (window.__sdtc ? { v: await window.__sdtc[f](a) } : null), { f: fn, a: arg }); } catch { return null; } };

/** Explore one width. `probe` is the term or an async (page) => term resolved on first use (saves a load).
 * Returns { root, controls[], scroll[], truncated, states, loads, requests, maxRequests, inputsSkipped, probe }. */
export async function exploreWidth(page, { url, width, rootSel, maxStates, maxDepth, probe, shotsDir, settleMs = 250, visitOpts = {}, gotoFn, paceMs = DEFAULTS['pace-ms'], reloadPauseMs = DEFAULTS['reload-pause-ms'], maxRequests = DEFAULTS['max-requests'], maxTypeahead = DEFAULTS['max-typeahead'] }) {
  const touch = width < TOUCH_BELOW;
  const vh = page.viewportSize().height;
  let nav = null; let armed = true; let states = 0; let truncated = null; let shotN = 0; let typeaheads = 0; let inputsSkipped = 0;
  let submitting = false; let followed = false; // a search POST is the one navigation let through (where it lands is the record)
  // every request that leaves for the site counts against the width's budget: the first load, each reload (routing disables
  // the browser cache, so a reload refetches the whole page), typeahead and submit; the navigations answered 204 do not
  const budget = requestBudget(url, maxRequests);
  await page.route('**/*', (route) => {
    const r = route.request();
    if (armed && r.isNavigationRequest() && r.frame() === page.mainFrame()) {
      nav = r.url();
      if (submitting && r.method() !== 'GET') { followed = true; armed = false; budget.spend(r.url()); return route.fallback(); }
      return route.fulfill({ status: 204, body: '' });
    }
    if (followed && !r.isNavigationRequest()) return route.abort(); // the results page is left at once: its assets are not fetched
    budget.spend(r.url());
    return route.fallback();
  });
  const overBudget = () => { if (!budget.exhausted()) return false; truncated = 'request-budget'; return true; };
  const pace = async () => { if (paceMs > 0) await page.waitForTimeout(paceMs); };
  let at = url; let loads = 0;
  const trail = []; // the controls acted on since the header was last at rest, in order: what reset re-acts to close them
  // the first visit settles the page; later ones only restore the closed header (same URL, overlays already answered)
  // navigations are answered 204 throughout (the page never leaves), except our own reloads
  const load = async () => {
    armed = false;
    if (loads++ === 0) { await gotoFn(page, url, visitOpts); at = page.url(); budget.rebase(at); }
    else { if (reloadPauseMs > 0) await page.waitForTimeout(reloadPauseMs); await page.goto(at, { waitUntil: 'load', timeout: 60000 }); await page.waitForTimeout(400); }
    await page.evaluate(installInPage, { rootSel }); await call(page, 'snapshot', { root: true });
    trail.length = 0;
    armed = true;
  };
  async function C(fn, arg = {}) {
    let r = await call(page, fn, arg);
    if (!r) { await load(); r = await call(page, fn, arg); }
    return r ? r.v : null;
  }
  await load();
  const park = async () => { await page.mouse.move(2, vh - 2); };
  const settled = async () => { await C('motionSettle', { maxMs: 1500 }); await page.waitForTimeout(settleMs); };
  // Escape and the parked pointer have had their turn: re-act each opened control the way it was opened, innermost first,
  // while its trigger is still visible, then click outside; true once every atom is back as the page loaded
  const closeTrail = async () => {
    const seen = new Set();
    for (let i = trail.length - 1; i >= 0; i--) {
      const { c, action } = trail[i];
      if (action === 'hover' || seen.has(c.sel)) continue;
      seen.add(c.sel);
      if (!await C('visible', { sel: c.sel })) continue;
      if (action === 'key') { if (await C('focus', { sel: c.sel })) await page.keyboard.press('Enter'); }
      else { const p = await C('center', { sel: c.sel }); if (p) await page.mouse.click(p.x, p.y); }
      await settled();
      if (await C('changed') === 0) return true;
    }
    const pt = await C('outsidePoint');
    if (pt) { await page.mouse.click(pt.x, pt.y); await settled(); }
    return await C('changed') === 0;
  };
  // the header at rest again: closed in place when that is verified against the loaded page, reloaded otherwise
  const reset = async () => {
    await park(); await page.keyboard.press('Escape'); await C('blur'); await page.evaluate(() => window.scrollTo(0, 0));
    await settled();
    if (page.url().split('#')[0] !== at.split('#')[0]) await load();
    else if (await C('changed') > 0) { await pace(); if (!await closeTrail()) await load(); }
    trail.length = 0;
    await C('snapshot');
  };
  const act = async (c, action) => {
    if (action === 'hover') { const p = await C('center', { sel: c.sel }); if (!p) return false; await page.mouse.move(p.x, p.y, { steps: 4 }); }
    else if (action === 'click') { const p = await C('center', { sel: c.sel }); if (!p) return false; await page.mouse.click(p.x, p.y); }
    else if (action === 'key') { if (!await C('focus', { sel: c.sel })) return false; await page.keyboard.press('Enter'); }
    trail.push({ c, action }); await pace();
    return true;
  };
  // re-open the parents, then measure from there: a child's state is what IT reveals
  const replay = async (path) => { for (const step of path) { await act(step.c, step.action); await C('motionSettle', { maxMs: 1500 }); await page.waitForTimeout(settleMs); } if (path.length) await C('snapshot'); };
  const shot = async (rect, tag) => {
    if (!shotsDir || !rect || rect[2] < 4 || rect[3] < 4) return null;
    shotN += 1; const f = join(shotsDir, `${width}-${String(shotN).padStart(3, '0')}-${tag.replace(/[^\w-]+/g, '-').slice(0, 40)}.png`);
    try { await page.screenshot({ path: f, clip: { x: rect[0], y: rect[1], width: rect[2], height: rect[3] } }); return basename(f); } catch { return null; }
  };
  const observe = async (c, action, path) => {
    await reset(); await replay(path);
    nav = null;
    await C('motionStart');
    if (!await act(c, action)) return null;
    const motion = await C('motionSettle', { maxMs: 2000 });
    await page.waitForTimeout(settleMs);
    const s = await C('state', { sel: c.sel });
    if (nav) return { opened: false, navigates: nav };
    if (!s || !s.opened) return s && s.hidden ? { opened: false, hides: s.hidden } : null;
    states += 1;
    s.motion = motion;
    s.shot = await shot(s.panel.rect, `${c.name || c.role}-${action}`);
    if (action === 'key') { await page.keyboard.press('Tab'); await page.waitForTimeout(80); s.tabReachesPanel = await C('focusIn'); }
    return s;
  };
  const closes = async (c, action, path) => {
    const out = {};
    const reopen = async () => { await reset(); await replay(path); await act(c, action); await settled(); };
    const shut = async () => { await settled(); const s = await C('state', { sel: c.sel }); await pace(); return !s || !s.opened; };
    if (overBudget()) return out;
    await reopen(); if (action === 'key' || action === 'click') await C('focus', { sel: c.sel });
    await page.keyboard.press('Escape'); out.escape = await shut(); out.focusReturn = out.escape ? await C('focusReturned', { sel: c.sel }) : false;
    if (overBudget()) return out;
    await reopen(); const pt = await C('outsidePoint');
    if (pt) { await page.mouse.click(pt.x, pt.y); out.outside = await shut(); } else out.outside = null;
    if (action === 'click' && !overBudget()) { await reopen(); await act(c, 'click'); out.toggle = await shut(); }
    if (action === 'hover' && !overBudget()) { await reopen(); await park(); out.leave = await shut(); }
    return out;
  };
  const probeTerm = async () => { if (typeof probe === 'function') probe = await probe(page); return probe; };
  // the term enters in one go — fill() carries all but its last letter in one input event, the last letter is typed so key
  // listeners see the whole term too — then one settle: an input costs one or two upstream requests, not one per keystroke
  const typeProbe = async (sel, term) => {
    let filled = false;
    if (term.length > 1) { try { await page.fill(sel, term.slice(0, -1), { timeout: 3000 }); filled = true; } catch { /* not fillable: typed whole below */ } }
    await page.keyboard.type(filled ? term.slice(-1) : term, { delay: 0 });
    await page.waitForTimeout(1500);
  };
  const typeIn = async (c, path) => {
    const term = await probeTerm();
    await reset(); await replay(path);
    if (!await act(c, 'click')) return null;
    await C('snapshot');
    nav = null;
    await typeProbe(c.sel, term);
    const s = await C('state', { sel: c.sel });
    // Enter: a GET submit is a navigation like any other — answered 204, its URL is the record and the page never leaves (no
    // results load, no reload); a POST is followed to where it lands (the results URL is in its redirect), then the page is restored
    nav = null; submitting = true; followed = false;
    await page.keyboard.press('Enter');
    for (const t0 = Date.now(); !nav && Date.now() - t0 < 5000;) await page.waitForTimeout(100);
    if (followed) await page.waitForURL((u) => u.href !== at, { timeout: 10000, waitUntil: 'commit' }).catch(() => null);
    const submit = page.url() !== at ? page.url() : nav;
    const left = followed || page.url() !== at;
    submitting = false; followed = false;
    if (left) await load(); else await page.fill(c.sel, '', { timeout: 1000 }).catch(() => null);
    return { probe: term, typeahead: s && s.opened ? { links: s.panel.links.length, options: s.panel.options } : { links: 0, options: 0 }, submit: submit ? submit.replace(encodeURIComponent(term), '{q}').replace(term.replace(/ /g, '+'), '{q}') : null };
  };
  const sig = (s) => JSON.stringify([s.panel.links.map((l) => l.href).sort(), s.panel.headings, s.panel.buttons]);
  const explore = async (scope, path, depth, seen = new Set(), known = new Set()) => {
    const found = (await C('controls', { scope })).filter((c) => !known.has(c.sel));
    const listed = new Set([...known, ...found.map((c) => c.sel)]);
    const out = [];
    for (const c of found) {
      if (states >= maxStates) { truncated = truncated || (path.map((p) => p.c.name).join(' > ') || 'top level'); break; }
      if (overBudget()) break;
      const node = { name: c.name, key: normName(c.name), role: c.role, kind: controlKind(c), sel: c.sel, href: c.href || undefined, expanded: c.expanded, rect: c.rect, actions: {} };
      if (c.role === 'input') {
        // inputs past the cap are listed, not typed into: nothing is asserted about them (search: null says so)
        if (typeaheads >= maxTypeahead) { node.search = null; node.skipped = 'typeahead-cap'; inputsSkipped += 1; } else { typeaheads += 1; node.search = await typeIn(c, path); }
        out.push(node); continue;
      }
      const acts = c.role === 'link' ? (touch ? [] : ['hover']) : touch ? ['click', 'key'] : ['hover', 'click', 'key'];
      for (const a of acts) { if (overBudget()) { node.partial = 'request-budget'; break; } node.actions[a] = await observe(c, a, path); }
      const opener = ['click', 'hover', 'key'].find((a) => node.actions[a] && node.actions[a].opened);
      // a state already open higher up the path (a drawer's Back, a tab re-selecting the default pane) is recorded, not re-entered
      if (opener && seen.has(sig(node.actions[opener]))) node.returns = true;
      else if (opener && !overBudget()) {
        node.close = await closes(c, opener, path);
        if (depth >= maxDepth) truncated = truncated || `depth ${maxDepth} at ${[...path.map((p) => p.c.name), c.name].join(' > ')}`;
        else if (!overBudget()) {
          await reset(); await replay(path); await act(c, opener); await settled();
          node.children = await explore('panel', [...path, { c, action: opener }], depth + 1, new Set([...seen, sig(node.actions[opener])]), listed);
        }
      }
      if (c.role === 'link' && !opener) { delete node.actions; node.actions = {}; }
      out.push(node);
    }
    return out;
  };
  const rootPath = await C('root');
  const controls = rootPath ? await explore('root', [], 1) : [];
  await reset();
  const scroll = [];
  const docH = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
  if (rootPath && docH > vh + 1000) {
    for (const [label, y] of [['top', 0], ['down', 1000], ['up', 700], ['back', 0]]) {
      await page.mouse.wheel(0, y - await page.evaluate(() => scrollY)); await page.waitForTimeout(700);
      scroll.push({ at: label, ...(await C('header')) });
    }
  }
  await page.unroute('**/*');
  return { root: rootPath, controls, scroll, states, truncated, loads, requests: budget.count, maxRequests, inputsSkipped, probe: typeof probe === 'function' ? null : probe };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, '').trim()); process.exit(0); }
  const { url, out, widths } = opts;
  if (!url || !out) { console.error('usage: chrome-explore.mjs <url> <out.json> [--width 1440,390] [--root <sel>] [--max-states 400] [--max-depth 4] [--probe <term>] [--shots <dir>] [--plain] [--pace-ms 400] [--reload-pause-ms 1500] [--max-requests 600] [--max-typeahead 2]'); process.exit(1); }
  const shotsDir = opts.shots || join('stardust', '.work', 'chrome', basename(out, '.json'));
  mkdirSync(shotsDir, { recursive: true }); mkdirSync(dirname(out), { recursive: true });
  let probe = opts.probe;
  const sp = join('stardust', 'spec', 'knowledge', 'search-probes.json');
  if (!probe && existsSync(sp)) { try { probe = (JSON.parse(readFileSync(sp, 'utf8'))[0] || {}).term || null; } catch { /* none */ } }
  // no term yet: a nav label word, read from the explored page itself when an input turns up (no extra page load)
  const navWord = (p) => p.evaluate(() => ((document.querySelector('header nav,header') || document.body).innerText.match(/\p{L}{4,}/u) || ['news'])[0].toLowerCase());
  const here = dirname(fileURLToPath(import.meta.url));
  const { openBrowser, openPage, visit } = await import(pathToFileURL(join(here, 'measure-live.mjs')).href);
  const { chromium } = await loadPlaywright();
  const browser = await openBrowser(chromium, { tier: opts.plain ? 'plain' : 'stealth' });
  const doc = { tool: 'chrome-explore', url, at: new Date().toISOString(), shots: shotsDir, widths: {} };
  try {
    for (const width of widths) {
      const { ctx, page } = await openPage(browser, { width, height: width < TOUCH_BELOW ? 844 : 900, locale: opts.locale });
      ctx.on('page', (p) => { if (p !== page) p.close().catch(() => {}); });
      const gotoFn = (p, u) => visit(p, u, { warmup: opts.warmup, settle: { passes: 1, quietMs: 800 } });
      const r = await exploreWidth(page, { url, width, rootSel: opts.rootSel, maxStates: opts.maxStates, maxDepth: opts.maxDepth, probe: probe || navWord, shotsDir, gotoFn, paceMs: opts.paceMs, reloadPauseMs: opts.reloadPauseMs, maxRequests: opts.maxRequests, maxTypeahead: opts.maxTypeahead });
      probe = r.probe || probe; delete r.probe;
      doc.widths[width] = r;
      await ctx.close();
    }
    doc.probe = probe;
  } catch (e) {
    await browser.close();
    if (e.name === 'BotChallengeError') { console.error(`chrome-explore: bot challenge on ${url} — retry with --warmup or the headed tier`); process.exit(3); }
    throw e;
  }
  await browser.close();
  writeFileSync(out, `${JSON.stringify(doc, null, 1)}\n`);
  for (const line of summarize(doc)) console.log(`chrome-explore ${line}`);
  console.log(`→ ${out} (crops in ${shotsDir})`);
}

const self = (() => { try { return realpathSync(fileURLToPath(import.meta.url)); } catch { return ''; } })();
if (process.argv[1] && (() => { try { return realpathSync(process.argv[1]) === self; } catch { return false; } })()) main().catch((e) => { console.error(`chrome-explore: ${e.message}`); process.exit(1); });
