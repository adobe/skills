#!/usr/bin/env node
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-console, no-continue, no-nested-ternary, no-plusplus, no-underscore-dangle, no-restricted-globals, newline-per-chained-call, object-property-newline */
/* global __clipChain, __controlOf, __isControl, __norm, __pageRect, __parent, __path, __rendered, __sel, __srOnly, __visibleText, __walk */
/**
 * skills/diff/scripts/content-presence.mjs — the CONTENT-PRESENCE gate of the published-origin gate
 * (#125, D2): live origin vs served page, same minute, same settle, compared per band.
 *
 * content-diff.mjs's role classifier is tuned to a prototype's DOM; on live commerce origins its
 * per-node findings were false. This probe asks the smaller question the pixel gate cannot: is every
 * VISIBLE heading, link, button, image and text block of the origin present AND visible on the served
 * page, band by band, and does every control show the same state? Both pages load in the same
 * window-free real-Chrome tier and settle the same way (measure-live.mjs). Visibility = rendered,
 * non-zero box, on-page, not clipped past 50 % (clip-probe's model): in the DOM but clipped = HIDDEN.
 * Bands: the visible h1–h3 sequences aligned by text (LCS); items fall into bands by y.
 *
 *   MISSING / HIDDEN HEADING, MISSING / HIDDEN LINK ×n        🔴  (exit 2)
 *   MISSING / HIDDEN BUTTON, CONTROL STATE                    🟠
 *   COUNT TEXT|IMAGES|LINKS, MOVED LINK, EXTRA …, HEADING AS TEXT  🟡
 *
 * Links and buttons are one pool on the served side; text-less image anchors count as images. Scope
 * is symmetric (root only when BOTH sides have one, else whole page); header / footer and everything
 * above / below them are left to the chrome crop gate unless --chrome. `--variable <selO=selE,…>`
 * marks session-variable regions (counts only, HIDDEN still counts). The origin side fails loud on
 * HTTP ≥ 400 (exit 4) and on a bot challenge (exit 3). Trap: an infinite-scroll origin keeps loading
 * under the settle — mark that region --variable.
 *
 * Usage: node skills/diff/scripts/content-presence.mjs <originUrl> <edsUrl> [--width 1440]
 *        [--main <sel>[=<selEds>]] [--variable <sel,…>] [--chrome] [--json [<file>]] [--min-cut 2]
 *        [--settle-passes 4] [--max-findings 40] [--count-words <w,…>] [--plain] [--warmup <url>]
 * `presenceInventoryInPage`, `alignHeadings`, `diffPresence`, `formatReport`, `norm` are exported.
 */
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clipInventoryInPage, inPage, morePrelude, summarize } from './clip-probe.mjs';
import { browserTier, openBrowser, openPage, visit } from './measure-live.mjs';

const HELP = `content-presence — origin vs served page: visible headings / links / buttons / images / text per band + control state (#125 D2)

Usage: node content-presence.mjs <originUrl> <edsUrl> [options]
  --width <px>             viewport width (default 1440)
  --main <sel>[=<selEds>]  content root(s) (default main, else body)
  --variable <sel,…>       session-variable subtrees, counts only (selO=selE pairs allowed)
  --json [<file>]          JSON (inventories, bands, findings, totals, clip, textBoxes)
  --min-cut <px>           clip partial-cut floor (default 2)
  --chrome                 include header / footer items (default: left to the chrome crop gate)
  --settle-passes <n>      slow-scroll passes until the height is stable (default 4; infinite-scroll
                           origins keep loading — mark those regions --variable)
  --max-findings <n>       printed findings per kind (default 40)
  --count-words <w,…>      result-count nouns (default English: results, items, products, coupons, offers, reviews, stores, matches)
  --more-words <re>        "read more" toggle labels for the clip model (default English)
  --plain                  bundled Chromium instead of the window-free real-Chrome tier
  --warmup <url>           visit this URL first on the ORIGIN side (bot-managed sites)
  --locale <tag>           default en-US
  --help                   this text
Exit: 0 clean, 2 any MISSING/HIDDEN link or heading, 1 error, 3 bot challenge, 4 origin HTTP >= 400.`;

// ---- in-page inventory (needs IN_PAGE_LIB — run via inPage()) -----------------------------------------
/** page.evaluate(inPage(presenceInventoryInPage, { rootSel, variableSels })) → { docH, pageW, root, items[] } */
export function presenceInventoryInPage({ rootSel = null, variableSels = [], countWords = 'results?|items?|products?|coupons?|offers?|reviews?|stores?|matches' } = {}) {
  const COUNT_RE = new RegExp(`\\b(\\d[\\d,]*)\\s+(${countWords})\\b`, 'i');
  // Always walk the whole body; each item carries `inRoot`. The differ picks the scope SYMMETRICALLY: root
  // only when BOTH sides have one, else the whole page (a live origin without <main> against a build with
  // one would otherwise compare chrome against content).
  const root = document.body;
  const rootEl = (rootSel && document.querySelector(rootSel)) || (!rootSel && document.querySelector('main')) || null;
  // chrome landmarks: items inside them are flagged so the differ can leave the header / footer to the chrome
  // crop gate (the chrome repeats on every page and its live promo strips / account state are session-variable)
  // Chrome = the landmarks AND everything above the header's bottom edge / below the footer's top edge
  // (promo strips often sit OUTSIDE <header>); the chrome crop gate judges that region, --chrome includes it.
  const chromeEls = [...document.querySelectorAll('header, [role="banner"], footer, [role="contentinfo"]')].filter((c) => !rootEl || !rootEl.contains(c));
  const banner = chromeEls.filter((c) => c.matches('header, [role="banner"]')).map((c) => __pageRect(c.getBoundingClientRect())).filter((r) => r.h > 0);
  const contentinfo = chromeEls.filter((c) => c.matches('footer, [role="contentinfo"]')).map((c) => __pageRect(c.getBoundingClientRect())).filter((r) => r.h > 0);
  const chromeTop = banner.length ? Math.max(...banner.map((r) => r.b)) : 0;
  const chromeBottom = contentinfo.length ? Math.min(...contentinfo.map((r) => r.t)) : Infinity;
  const inChrome = (el) => { if (chromeEls.some((c) => c.contains(el))) return true; const r = __pageRect(el.getBoundingClientRect()); return r.b <= chromeTop || r.t >= chromeBottom; };
  const pageW = document.documentElement.clientWidth;
  const variableEls = variableSels.flatMap((s) => { try { return [...document.querySelectorAll(s)]; } catch { return []; } });
  const inVariable = (el) => variableEls.some((v) => v.contains(el));
  const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  // 'visible' | 'hidden' (clipped past 50 % by the nearest overflow ancestor) | null (not rendered / off-page / collapsed)
  const state = (el) => {
    if (!__rendered(el) || __srOnly(el)) return null;
    const br = el.getBoundingClientRect();
    if (br.width <= 0 || br.height <= 0) return null;
    const r = __pageRect(br);
    if (r.r <= 0 || r.l >= pageW) return null;
    const cc = __clipChain(el, false);
    if (cc.skip) return null;
    for (const clip of cc.chain) {
      if (clip.mode === 'scroll') continue;
      const vis = (clip.axes.y ? overlap(r.t, r.b, clip.rect.t, clip.rect.b) : r.h) * (clip.axes.x ? overlap(r.l, r.r, clip.rect.l, clip.rect.r) : r.w);
      if (vis / (r.w * r.h) < 0.5) return 'hidden';
    }
    return 'visible';
  };
  const rectOf = (el) => { const r = __pageRect(el.getBoundingClientRect()); return { x: Math.round(r.l), y: Math.round(r.t), w: Math.round(r.w), h: Math.round(r.h) }; };
  const label = (el) => __norm(__visibleText(el)) || __norm((el.querySelector('img') || {}).alt) || __norm(el.getAttribute('aria-label')) || __norm(el.getAttribute('title')) || '';
  const file = (src) => { try { return new URL(src, window.location.href).pathname.split('/').pop().replace(/\.[a-z0-9]+$/i, '').slice(0, 40); } catch { return ''; } };
  const items = [];
  const push = (kind, el, extra) => { const st = state(el); if (!st) return; items.push({ kind, state: st, variable: inVariable(el), inRoot: rootEl ? rootEl.contains(el) : null, inChrome: inChrome(el), path: __path(el, 3), ...rectOf(el), ...extra }); };
  const textBlocks = new Set();
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
  const hasCountedAncestor = (el) => { for (let a = __parent(el); a && a !== root; a = __parent(a)) if (textBlocks.has(a)) return true; return false; };
  const controlLabel = (el) => {
    const al = __norm(el.getAttribute('aria-label'));
    if (al) return al;
    if (el.labels && el.labels.length) return __norm(el.labels[0].textContent);
    const lb = el.closest && el.closest('label');
    if (lb) return __norm(lb.textContent).slice(0, 60);
    const id = el.getAttribute('aria-labelledby'); if (id) { const l = document.getElementById(id); if (l) return __norm(l.textContent); }
    return __norm(el.getAttribute('name')) || '';
  };
  for (const el of __walk(root)) {
    if (el.nodeType !== 1) continue;
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag) || el.getAttribute('role') === 'heading') {
      const level = /^H[1-6]$/.test(tag) ? Number(tag[1]) : Number(el.getAttribute('aria-level') || 2);
      const text = label(el); if (text) push('heading', el, { level, text: text.slice(0, 120) });
      continue;
    }
    if (tag === 'A' && el.hasAttribute('href')) { const text = label(el); let href = ''; try { href = new URL(el.getAttribute('href'), window.location.href).pathname; } catch { href = el.getAttribute('href'); } push('link', el, { text: text.slice(0, 80), href }); }
    else if (tag === 'BUTTON' || (tag === 'INPUT' && /^(button|submit|reset)$/i.test(el.type)) || el.getAttribute('role') === 'button') {
      const text = tag === 'INPUT' ? __norm(el.value) : label(el);
      push('button', el, { text: text.slice(0, 80) });
      const pop = el.getAttribute('aria-haspopup'); const exp = el.getAttribute('aria-expanded');
      if ((pop && pop !== 'false') || exp !== null || el.getAttribute('role') === 'combobox') push('control', el, { label: controlLabel(el) || 'trigger', value: text.slice(0, 60), via: 'trigger' });
    }
    else if (tag === 'IMG') { const br = el.getBoundingClientRect(); if (br.width >= 16 && br.height >= 16) push('image', el, { text: __norm(el.alt).slice(0, 60), file: file(el.currentSrc || el.src) }); }
    else if (tag === 'SELECT') { const o = el.options[el.selectedIndex]; push('control', el, { label: controlLabel(el) || 'select', value: o ? __norm(o.textContent).slice(0, 60) : '', via: 'select' }); }
    else if (tag === 'INPUT' && /^(radio|checkbox)$/i.test(el.type)) { if (el.checked) push('control', el, { label: controlLabel(el) || el.type, value: controlLabel(el) || 'checked', via: el.type }); }
    else if (el.getAttribute('role') === 'combobox') push('control', el, { label: controlLabel(el) || 'combobox', value: (__norm(el.value) || label(el)).slice(0, 60), via: 'combobox' });
    else if ((el.getAttribute('role') === 'tab' || el.getAttribute('role') === 'option') && el.getAttribute('aria-selected') === 'true') push('control', el, { label: `${el.getAttribute('role')} selected`, value: label(el).slice(0, 60), via: 'aria-selected' });
    else if (el.getAttribute('aria-pressed') === 'true') push('control', el, { label: 'pressed', value: label(el).slice(0, 60), via: 'aria-pressed' });
    else if (el.hasAttribute('aria-current') && el.getAttribute('aria-current') !== 'false') push('control', el, { label: 'current', value: label(el).slice(0, 60), via: 'aria-current' });
    // text blocks: own text ≥ 3 chars, not inside an already counted block, not a control / heading
    if (tag !== 'A' && tag !== 'BUTTON' && !__isControl(el)) {
      const own = ownText(el);
      if (own.length >= 3 && !hasCountedAncestor(el) && !__controlOf(el)) {
        textBlocks.add(el);
        push('text', el, { text: own.slice(0, 80) });
        const m = own.match(COUNT_RE);
        if (m) push('control', el, { label: `count ${m[2].toLowerCase().replace(/s$/, '')}`, value: m[1].replace(/,/g, ''), via: 'count' });
      }
    }
  }
  return { docH: document.documentElement.scrollHeight, pageW, root: rootEl ? __sel(rootEl) : null, items };
}

// ---- pure: alignment + diff --------------------------------------------------------------------------
// Matching key: lower-case; trademark / footnote glyphs and a trailing footnote digit dropped ("no annual
// fee †", "$50/month. 1"); a bare "tm" token dropped (a <sup>TM</sup> serialises as text on one side and as
// the glyph on the other — 17 false MISSING on one recorded page); punctuation runs collapsed.
export const norm = (s) => (s || '')
  .toLowerCase()
  .replace(/[®™©†‡§*]/g, ' ')
  .replace(/\b(tm|sm)\b/g, ' ')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201c\u201d]/g, '"')
  .replace(/\s+/g, ' ')
  .replace(/(\D)\s+\d{1,2}\s*$/g, '$1')
  .replace(/\s*([.,;:!?])\s*/g, '$1 ')
  .replace(/\s+/g, ' ')
  .trim();
const sameHeading = (a, b) => a === b || (a.length >= 8 && b.length >= 8 && (a.startsWith(b) || b.startsWith(a)));

/** Longest common subsequence over the two visible h1–h3 sequences → [{ oi, ei }] index pairs. */
export function alignHeadings(origin, eds) {
  const n = origin.length; const m = eds.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) dp[i][j] = sameHeading(origin[i], eds[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = []; let i = 0; let j = 0;
  while (i < n && j < m) {
    if (sameHeading(origin[i], eds[j])) { pairs.push({ oi: i, ei: j }); i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1; else j += 1;
  }
  return pairs;
}

const countBy = (arr, key) => { const m = new Map(); for (const it of arr) { const k = key(it); m.set(k, (m.get(k) || 0) + 1); } return m; };
const linkKey = (it) => norm(it.text) || `href:${it.href}`;

/**
 * diffPresence(originInv, edsInv, { countTol }) → { bands, findings, totals }
 * Inventories are the in-page result ({ items }); items hidden on the origin are dropped first.
 */
export function diffPresence(originInv, edsInv, { countTol = 0.25, chrome = false } = {}) {
  const scope = originInv.root && edsInv.root ? 'root' : 'page';
  const inScope = (it) => (scope === 'page' || it.inRoot) && (chrome || !it.inChrome);
  const O = originInv.items.filter((it) => it.state === 'visible' && inScope(it));
  const E = edsInv.items.filter(inScope);
  const bandHeads = (items) => items.filter((it) => it.kind === 'heading' && it.level <= 3 && it.state === 'visible').sort((a, b) => a.y - b.y);
  const oh = bandHeads(O); const eh = bandHeads(E);
  const pairs = alignHeadings(oh.map((h) => norm(h.text)), eh.map((h) => norm(h.text)));
  const findings = [];
  const add = (sev, kind, msg, extra = {}) => findings.push({ sev, kind, msg, ...extra });
  // unaligned headings
  const alignedO = new Set(pairs.map((p) => p.oi)); const alignedE = new Set(pairs.map((p) => p.ei));
  const edsHeadingsAll = E.filter((it) => it.kind === 'heading');
  const edsVisibleTexts = new Set(E.filter((it) => it.state === 'visible' && (it.kind === 'text' || it.kind === 'link' || it.kind === 'heading')).map((it) => norm(it.text)));
  oh.forEach((h, i) => {
    if (alignedO.has(i)) return;
    const hidden = edsHeadingsAll.find((x) => sameHeading(norm(x.text), norm(h.text)) && x.state === 'hidden');
    if (hidden) add('🔴', 'HIDDEN HEADING', `h${h.level} "${h.text}" is in the served DOM but clipped away (${hidden.path})`, { band: i, text: h.text });
    else if (edsVisibleTexts.has(norm(h.text))) add('🟡', 'HEADING AS TEXT', `origin h${h.level} "${h.text}" is served as plain text / a link, not a heading (visually present — semantics only)`, { band: i, text: h.text });
    else add('🔴', 'MISSING HEADING', `h${h.level} "${h.text}" (origin y ${h.y}) has no served heading`, { band: i, text: h.text });
  });
  eh.forEach((h, j) => { if (!alignedE.has(j)) add('🟡', 'EXTRA HEADING', `served h${h.level} "${h.text}" (y ${h.y}) has no origin heading`, { text: h.text }); });
  // bands: one per aligned heading pair, plus band 0 (above the first aligned heading)
  const bounds = (heads, idxs) => { const ys = idxs.map((i) => heads[i].y); return [0, ...ys, Infinity]; };
  const ob = bounds(oh, pairs.map((p) => p.oi)); const eb = bounds(eh, pairs.map((p) => p.ei));
  const bandOf = (b, y) => { let k = 0; while (k + 1 < b.length - 1 && y >= b[k + 1]) k += 1; return k; };
  const bands = [];
  for (let k = 0; k < ob.length - 1; k += 1) {
    const name = k === 0 ? '(top)' : oh[pairs[k - 1].oi].text;
    const oItems = O.filter((it) => bandOf(ob, it.y) === k); const eItems = E.filter((it) => bandOf(eb, it.y) === k);
    const variable = oItems.some((it) => it.variable) || eItems.some((it) => it.variable);
    const band = { index: k, heading: name, variable, origin: {}, eds: {}, findings: [] };
    for (const kind of ['link', 'button', 'text', 'image']) {
      band.origin[kind] = oItems.filter((it) => it.kind === kind).length;
      band.eds[kind] = eItems.filter((it) => it.kind === kind && it.state === 'visible').length;
      band.eds[`${kind}Hidden`] = eItems.filter((it) => it.kind === kind && it.state === 'hidden').length;
    }
    bands.push(band);
    // links + buttons by text
    for (const [kind, sev, missingKind, hiddenKind] of [['link', '🔴', 'MISSING LINK', 'HIDDEN LINK'], ['button', '🟠', 'MISSING BUTTON', 'HIDDEN BUTTON']]) {
      // links and buttons are ONE pool on the served side (a "Sign in" button served as a link is the same
      // visible control); the ORIGIN kind decides the severity.
      const action = (it) => it.kind === 'link' || it.kind === 'button';
      // a text-less link (an image-only anchor without alt) is the image's presence (counted there); its href
      // does not survive a migration's path rewrite — text-keyed only.
      const oFixed = oItems.filter((it) => it.kind === kind && !it.variable && norm(it.text)); const oVar = oItems.filter((it) => it.kind === kind && it.variable && norm(it.text));
      const eVis = countBy(eItems.filter((it) => action(it) && it.state === 'visible'), linkKey);
      const eHid = countBy(eItems.filter((it) => action(it) && it.state === 'hidden'), linkKey);
      const eVisAll = countBy(E.filter((it) => action(it) && it.state === 'visible'), linkKey);
      const oAll = countBy(O.filter(action), linkKey);
      for (const [key, cO] of countBy(oFixed, linkKey)) {
        const vE = eVis.get(key) || 0; if (vE >= cO) continue;
        let deficit = cO - vE;
        const hid = Math.min(deficit, eHid.get(key) || 0);
        const sample = oFixed.find((it) => linkKey(it) === key);
        if (hid) { add(sev, hiddenKind, `${hid > 1 ? `×${hid} ` : ''}"${sample.text || sample.href}" in band "${name}" — in the served DOM but clipped away (${(eItems.find((it) => action(it) && it.state === 'hidden' && linkKey(it) === key) || {}).path || ''})`, { band: k, n: hid, text: sample.text, href: sample.href }); deficit -= hid; }
        if (deficit > 0) {
          if ((eVisAll.get(key) || 0) >= (oAll.get(key) || 0)) add('🟡', kind === 'link' ? 'MOVED LINK' : 'MOVED BUTTON', `${deficit > 1 ? `×${deficit} ` : ''}"${sample.text || sample.href}" short in band "${name}" but visible elsewhere on the served page`, { band: k, n: deficit, text: sample.text });
          else add(sev, missingKind, `${deficit > 1 ? `×${deficit} ` : ''}"${sample.text || sample.href}"${sample.href ? ` → ${sample.href}` : ''} in band "${name}" (origin y ${sample.y}) not on the served page`, { band: k, n: deficit, text: sample.text, href: sample.href });
        }
      }
      if (oVar.length) { const eVarVis = eItems.filter((it) => it.kind === kind && it.variable && it.state === 'visible').length; const eVarHid = eItems.filter((it) => it.kind === kind && it.variable && it.state === 'hidden').length; if (eVarHid) add(sev, hiddenKind, `×${eVarHid} ${kind}s clipped away inside the session-variable region of band "${name}"`, { band: k, n: eVarHid, variable: true }); if (Math.abs(eVarVis - oVar.length) > Math.max(2, countTol * oVar.length)) add('🟡', `COUNT ${kind.toUpperCase()}S`, `session-variable region in band "${name}": ${oVar.length} origin → ${eVarVis} served`, { band: k }); }
      // extra
      if (kind === 'link') for (const [key, cE] of eVis) { const cO = oAll.get(key) || 0; if (cO === 0 && !key.startsWith('href:')) { const s = eItems.find((it) => action(it) && linkKey(it) === key); add('🟡', 'EXTRA LINK', `${cE > 1 ? `×${cE} ` : ''}"${s.text || s.href}" served in band "${name}", no origin link or button`, { band: k, n: cE, text: s.text }); } }
    }
    for (const kind of ['text', 'image']) {
      const cO = band.origin[kind]; const cE = band.eds[kind]; const hid = band.eds[`${kind}Hidden`];
      if (Math.abs(cE - cO) > Math.max(kind === 'text' ? 3 : 2, countTol * cO) || hid > Math.max(2, countTol * cO)) add('🟡', `COUNT ${kind.toUpperCase()}${kind === 'text' ? '' : 'S'}`, `band "${name}": ${cO} origin → ${cE} served visible${hid ? ` (+${hid} clipped away)` : ''}`, { band: k, origin: cO, eds: cE, hidden: hid });
    }
    // control state: by label, else by ordinal among generic triggers
    const oC = oItems.filter((it) => it.kind === 'control'); const eC = eItems.filter((it) => it.kind === 'control' && it.state === 'visible');
    const used = new Set();
    for (const c of oC) {
      const lab = norm(c.label); const generic = /^(trigger|combobox|select|checked|radio|checkbox|pressed|current|tab selected|option selected)$/.test(lab);
      let m = null;
      if (!generic) m = eC.find((x, idx) => !used.has(idx) && norm(x.label) === lab && (used.add(idx) || true));
      // ordinal fallback only for GENERIC labels: a specifically labelled trigger with no served counterpart is
      // CONTROL MISSING, never paired with an unrelated trigger
      if (!m && generic) { const sameVia = eC.map((x, idx) => ({ x, idx })).filter(({ x, idx }) => !used.has(idx) && x.via === c.via); const exact = sameVia.find(({ x }) => norm(x.value) === norm(c.value)); const pick = exact || sameVia[0]; if (pick) { used.add(pick.idx); m = pick.x; } }
      if (!m) {
        if (/^count/.test(lab)) { add('🟠', 'CONTROL STATE', `${c.label}: origin "${c.value}", served: none`, { band: k, label: c.label, value: c.value }); continue; }
        const dup = findings.find((f) => f.kind === 'CONTROL MISSING' && f.band === k && f.label === c.label && f.value === c.value);
        if (dup) { dup.n = (dup.n || 1) + 1; dup.msg = dup.msg.replace(/^(×\d+ )?/, `×${dup.n} `); } else add('🟡', 'CONTROL MISSING', `${c.label} = "${c.value}" (band "${name}") has no served counterpart`, { band: k, label: c.label, value: c.value });
        continue;
      }
      if (norm(m.value) !== norm(c.value)) add('🟠', 'CONTROL STATE', `${c.label}: origin "${c.value}" → served "${m.value}" (band "${name}")`, { band: k, label: c.label, origin: c.value, eds: m.value });
    }
    band.findings = findings.filter((f) => f.band === k).map((f) => f.kind);
  }
  const order = { '🔴': 0, '🟠': 1, '🟡': 2 };
  findings.sort((a, b) => order[a.sev] - order[b.sev]);
  const sum = (kind) => findings.filter((f) => f.kind === kind).reduce((a, f) => a + (f.n || 1), 0);
  const totals = {
    missingHeadings: sum('MISSING HEADING'), hiddenHeadings: sum('HIDDEN HEADING'), extraHeadings: sum('EXTRA HEADING'),
    missingLinks: sum('MISSING LINK'), hiddenLinks: sum('HIDDEN LINK'), movedLinks: sum('MOVED LINK'), extraLinks: sum('EXTRA LINK'),
    missingButtons: sum('MISSING BUTTON'), hiddenButtons: sum('HIDDEN BUTTON'),
    controlState: findings.filter((f) => f.kind === 'CONTROL STATE').length, countDeltas: findings.filter((f) => f.kind.startsWith('COUNT')).length,
    findings: findings.length, structural: findings.filter((f) => f.sev === '🔴').length,
  };
  totals.missing = totals.missingHeadings + totals.missingLinks; totals.hidden = totals.hiddenHeadings + totals.hiddenLinks;
  return { scope, chrome, bands, findings, totals };
}

export function formatReport(res, { maxPerKind = 40 } = {}) {
  const lines = [];
  lines.push('| band | heading | links O/E (+hidden) | buttons O/E (+hidden) | text O/E | images O/E | findings |', '|---|---|---|---|---|---|---|');
  for (const b of res.bands) lines.push(`| ${b.index} | ${b.heading.slice(0, 40)}${b.variable ? ' (variable)' : ''} | ${b.origin.link}/${b.eds.link}${b.eds.linkHidden ? ` (+${b.eds.linkHidden})` : ''} | ${b.origin.button}/${b.eds.button}${b.eds.buttonHidden ? ` (+${b.eds.buttonHidden})` : ''} | ${b.origin.text}/${b.eds.text} | ${b.origin.image}/${b.eds.image} | ${[...new Set(b.findings)].join(', ') || '-'} |`);
  const seen = new Map();
  for (const f of res.findings) { const n = (seen.get(f.kind) || 0) + 1; seen.set(f.kind, n); if (n <= maxPerKind) lines.push(`  ${f.sev} ${f.kind}: ${f.msg}`); else if (n === maxPerKind + 1) lines.push(`  … more ${f.kind} (${res.findings.filter((x) => x.kind === f.kind).length} total)`); }
  const t = res.totals;
  lines.push(`Content: MISSING ${t.missing} (headings ${t.missingHeadings}, links ${t.missingLinks}) / HIDDEN ${t.hidden} (headings ${t.hiddenHeadings}, links ${t.hiddenLinks}) / control-state ${t.controlState} / buttons missing ${t.missingButtons} hidden ${t.hiddenButtons} / moved ${t.movedLinks} extra ${t.extraLinks} / count deltas ${t.countDeltas}`);
  lines.push(`Findings: ${t.findings ? `${t.findings} (${t.structural} structural 🔴)` : 'none — every visible origin heading and link is visible on the served page'}`);
  return lines.join('\n');
}

// ---- CLI ---------------------------------------------------------------------------------------------
export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.length < 2 || rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(rest.includes('--help') || rest.includes('-h') || !rest.length ? 0 : 1); }
  const opts = { origin: null, eds: null, width: 1440, main: null, mainEds: null, variable: [], variableEds: [], json: false, jsonFile: null, minCut: 2, maxFindings: 40, plain: false, warmup: null, locale: 'en-US', chrome: false, settlePasses: 4, countWords: null, moreWords: null };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--width') opts.width = Number(rest[++i]);
    else if (a === '--main') { const [o, e] = rest[++i].split('='); opts.main = o; opts.mainEds = e || o; }
    else if (a === '--variable') { for (const s of rest[++i].split(',').map((x) => x.trim()).filter(Boolean)) { const [o, e] = s.split('='); opts.variable.push(o); opts.variableEds.push(e || o); } }
    else if (a === '--json') { opts.json = true; if (rest[i + 1] && !rest[i + 1].startsWith('--')) opts.jsonFile = rest[++i]; }
    else if (a === '--min-cut') opts.minCut = Number(rest[++i]);
    else if (a === '--chrome') opts.chrome = true;
    else if (a === '--settle-passes') opts.settlePasses = Number(rest[++i]);
    else if (a === '--count-words') opts.countWords = rest[++i].split(',').map((w) => w.trim()).filter(Boolean).join('|');
    else if (a === '--more-words') opts.moreWords = rest[++i];
    else if (a === '--max-findings') opts.maxFindings = Number(rest[++i]);
    else if (a === '--plain') opts.plain = true;
    else if (a === '--warmup') opts.warmup = rest[++i];
    else if (a === '--locale') opts.locale = rest[++i];
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else if (!opts.origin) opts.origin = a; else if (!opts.eds) opts.eds = a;
  }
  if (!opts.origin || !opts.eds) { console.error(`need <originUrl> <edsUrl>\n\n${HELP}`); process.exit(1); }
  return opts;
}

/** Inventory one side: visit + settle, presence inventory, clip inventory. */
export async function inventorySide(browser, url, { width, locale, warmup, rootSel, variableSels, minCut, settlePasses = 4, httpError = 'measure', countWords = null, moreWords = null }) {
  const { ctx, page } = await openPage(browser, { width, locale });
  try {
    const v = await visit(page, url, { warmup, settle: { passes: settlePasses }, httpError });
    const inv = await page.evaluate(inPage(presenceInventoryInPage, countWords ? { rootSel, variableSels, countWords } : { rootSel, variableSels }, morePrelude(moreWords)));
    const clip = await page.evaluate(inPage(clipInventoryInPage, { minCut, rootSel: null, maxFindings: 400 }, morePrelude(moreWords)));
    return { url, at: new Date().toISOString(), status: v.status, settlePasses: v.passes, ...inv, clip: { counts: clip.counts, groups: summarize(clip.findings), findings: clip.findings }, textBoxes: clip.textBoxes };
  } finally { await ctx.close(); }
}

async function main() {
  const opts = parseArgs(process.argv);
  const { chromium } = await import('playwright');
  const browser = await openBrowser(chromium, { tier: opts.plain ? 'plain' : 'stealth' });
  let o; let e; let tier;
  try {
    tier = browserTier(browser);
    // ORIGIN side fails loud on any HTTP ≥ 400 (a 403 page measured as the origin reads "100 EXTRA on the
    // build"); the SERVED side is measured with a warning (a 404 build before preview propagation is the
    // advisory contract).
    o = await inventorySide(browser, opts.origin, { width: opts.width, locale: opts.locale, warmup: opts.warmup, rootSel: opts.main, variableSels: opts.variable, minCut: opts.minCut, settlePasses: opts.settlePasses, httpError: 'throw', countWords: opts.countWords, moreWords: opts.moreWords });
    e = await inventorySide(browser, opts.eds, { width: opts.width, locale: opts.locale, warmup: null, rootSel: opts.mainEds, variableSels: opts.variableEds, minCut: opts.minCut, settlePasses: opts.settlePasses, countWords: opts.countWords, moreWords: opts.moreWords });
  } finally { await browser.close(); }
  const res = diffPresence(o, e, { chrome: opts.chrome });
  const strip = (side) => ({ url: side.url, at: side.at, status: side.status, settlePasses: side.settlePasses, docH: side.docH, root: side.root, items: side.items, clip: { counts: side.clip.counts, groups: side.clip.groups } });
  const out = { _provenance: { writtenBy: 'content-presence.mjs', at: new Date().toISOString(), width: opts.width, variable: opts.variable, tier }, origin: strip(o), eds: { ...strip(e), clip: e.clip }, bands: res.bands, findings: res.findings, totals: res.totals, textBoxes: { origin: o.textBoxes, eds: e.textBoxes } };
  if (opts.json && !opts.jsonFile) console.log(JSON.stringify(out, null, 1));
  else {
    console.log(`content-presence @ ${opts.width}px (${tier}) — origin ${opts.origin} (docH ${o.docH}, ${o.items.length} items, HTTP ${o.status}) vs served ${opts.eds} (docH ${e.docH}, ${e.items.length} items, HTTP ${e.status})`);
    console.log(`scope: ${res.scope === 'root' ? `${o.root} vs ${e.root}` : 'whole page (one side has no <main> / --main root)'}${res.chrome ? ' + chrome' : ' (header/footer left to the chrome crop gate; --chrome to include)'}`);
    console.log(formatReport(res, { maxPerKind: opts.maxFindings }));
    console.log(`Clipped (served side): ${e.clip.counts.total} — origin side ${o.clip.counts.total}`);
    if (opts.jsonFile) { mkdirSync(dirname(opts.jsonFile) || '.', { recursive: true }); writeFileSync(opts.jsonFile, JSON.stringify(out, null, 1)); console.log(`json → ${opts.jsonFile}`); }
  }
  process.exitCode = res.totals.missing + res.totals.hidden > 0 ? 2 : 0;
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main().catch((err) => { console.error(`content-presence error: ${String(err.message).split('\n')[0]}`); process.exit(err.name === 'BotChallengeError' ? 3 : err.name === 'LiveHTTPError' ? 4 : 1); });
}
