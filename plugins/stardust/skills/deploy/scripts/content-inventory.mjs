/**
 * skills/deploy/scripts/content-inventory.mjs
 *
 * The SHARED content-inventory engine: one role classifier + one inventory
 * differ, consumed by every gate that measures content fidelity —
 *   - skills/diff/scripts/content-diff.mjs          (post-deploy page probe, Step 10)
 *   - skills/deploy/scripts/section-schema.mjs      (pre-code ENCODE/DECODE contract, #93)
 *   - skills/deploy/scripts/block-roundtrip.mjs     (in-loop per-block gate, #94)
 *   - skills/deploy/scripts/content-count.mjs       (offline L5 content count, CLI)
 *   - skills/migrate/scripts/encode.mjs             (the same count on every encoded page → `incomplete`)
 *
 * Factoring it here is the point, not a convenience: the schema a block is
 * written FROM, the in-loop assertion it is checked WITH, and the post-deploy
 * diff it is finally proved BY must all classify roles identically, or a pass
 * at one layer means nothing at the next. Change the classifier here and every
 * gate moves together.
 *
 * `inventory` runs IN the page (Playwright-serialized, ONE arg):
 *   page.evaluate(inventory, [rootSelector, eyebrow{maxFontPx,maxLen}])
 * It returns { items: [{role, order, text, key, href?, w, family, loaded}], imgCount }
 * with role ∈ heading | eyebrow | cta | body, classified by COMPUTED STYLE +
 * tag so a prototype's .ds-* DOM and an EDS block DOM compare symmetrically.
 *
 * `diffInventories(srcItems, tgtItems, prof)` consumes each source item
 * against the first unused same-key target item (duplicates count correctly)
 * and returns { flags, matchedCount }. All stack-specific labels + hints come
 * from a diff-profiles.mjs profile. Pass fontDelta: Infinity to suppress the
 * FONT FORK pass (the in-loop harness renders with local fonts, so face
 * fidelity is Step 4/10's business there, not the round-trip's).
 *
 * `editableInventory` runs IN the page (ONE arg): page.evaluate(editableInventory, [rootSel])
 * returns { count, items: [{tag, text}] } — the OUTERMOST h1-h6/p/ul/ol/pre/
 * blockquote elements under the root that carry visible text (outermost = no
 * ancestor matching the same list inside the root; empty and image-only elements
 * skipped). That is exactly the set Experience Workspace stamps `data-prose-index`
 * on (deploy SKILL.md § Experience Workspace editability contract): the ENCODE side
 * counts it on the prototype (section-schema `editableTexts`), the DECODE side on
 * the decorated page (content-diff's "editable texts" advisory, the --ew gate) —
 * fewer surviving outermost editables after decoration means authored elements
 * were rebuilt or merged.
 *
 * OFFLINE half (no browser, no network) — the L5 content count of a capture's
 * content root against a document. The caller parses (migrate's encode/dom.mjs
 * node shape: {type:'element', tag, attrs, children, parent} / {type:'text',
 * text, parent}; other node types are ignored); this module never imports a parser.
 *   offlineInventory(root, opts) → { items, excluded, joined }
 *     opts.exclude(node) → false | true | '<reason>'  skips a subtree (the caller's map
 *       exclusions: chrome, drop:/dynamics: markers, rich-text drops); built in on both
 *       sides: non-content tags, EDS metadata/section-metadata blocks, data-hidden-live
 *       (not <details>), <button> outside a heading (a control), text-less aria-hidden.
 *     opts.mediaKey(absUrl) → string|null  an image's media identity (the ledger's contentUrl)
 *     opts.linkKey(absUrl) → string|null   a page link's identity (the link map; never asked
 *                                           for documents); null = the default below
 *     opts.base                             the page URL (resolves relative URLs; its host,
 *                                           www-insensitive, is "same site")
 *     items: { role: heading|link|image|text, key (norm), text, …role fields }
 *       heading — h1–h6 by text, level ignored;
 *       link    — a[href] with text, a label, or an image and a destination; href = identity: null for
 *                 #…/javascript:/empty (text only), mailto:/tel: by value, a document
 *                 (rehost-docs' DOC_EXT) `asset:<docFileName, no extension, no -<sha8>>`,
 *                 another non-page file `asset:<its name folded the same way>`, else
 *                 linkKey, else same-site `pathKey(deliveredUrl(path))` + query, else the URL;
 *       image   — img: ids (absolute URLs + mediaKey), stems (file name, the fetcher's
 *                 -<sha8> dropped), alt;
 *       text    — block runs: contiguous inline content in a block container, so inline
 *                 markup never splits a run (editableInventory's granularity); heading
 *                 text and runs made only of link text belong to those roles.
 *     excluded: { <reason>: { n, sample[≤4] } }   joined: the block-joined key text
 *   diffOffline(srcInv, docInv) → { pass, missing[], extra[], tolerated[], counts }
 *     Exact same-role matches are consumed first (images: ids, then stem, then alt);
 *     leftovers try the tolerant rules — demoted (heading found as text/link), promoted
 *     (text found as heading/link), merged (text found word-bounded in the joined text; a
 *     run of ≤ 3 words must occur as often), relabelled (same href, label containment,
 *     full text present), duplicate (set semantics: an identical item already matched),
 *     unlinked (a link with no destination found as text), split (a run whose inline parts
 *     touch, found as ≤ 8 consecutive unused document runs that concatenate to it). Anything else is MISSING
 *     {role, key, text, reason, href? (links), src? (images)}; pass = 0 MISSING in every role, never a
 *     ratio. extra (document items without a capture source) and tolerated {rule, role,
 *     key, text} are reported only. counts.<role> = {capture, found, tolerated, missing, extra}.
 *   norm(s) — the in-page `norm` as a module export; a test keeps the two equal.
 *   summariseOffline(diff) — the one-line verdict.
 * It cannot see HIDDEN content, CSS-generated text, layout or the style-derived
 * eyebrow role (gate-all's), nor the loss of one copy of repeated content.
 */

/* eslint-disable no-plusplus, no-continue, max-len */
import { deliveredUrl, pathKey } from './eds-path.mjs';
import { DOC_EXT, docFileName } from './rehost-docs.mjs';

// Runs IN the page (serialized by Playwright, so it takes ONE arg). args =
// [rootSel, eyebrow{maxFontPx,maxLen}] — the content root + label classifier
// thresholds from the active profile. Returns the role-classified inventory.
/* eslint-disable no-undef */
export function inventory(args) {
  const [rootSel, eyebrow] = args;
  const root = document.querySelector(rootSel) || document.querySelector('main') || document.body;
  const ARROWS = /[→➔➜›⇒➤>]+/g;
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  // match key: lowercase, arrows + trailing punctuation stripped, whitespace collapsed.
  // Typographic punctuation is folded to ASCII first — curly vs straight apostrophes/
  // quotes, ellipsis, en/em dashes were the single largest false-positive source
  // across the e2e benchmark (a verbatim-captured prototype uses curly, authored copy
  // uses ASCII → spurious MISSING/ROLE-SWAP on identical text).
  const norm = (s) => clean(s).replace(ARROWS, ' ')
    .replace(/[‘’′]/g, "'").replace(/[“”″]/g, '"')
    .replace(/…/g, '...').replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ').trim()
    .toLowerCase().replace(/[.,;:!?·•]+$/g, '').trim();

  // Off-screen probe for rendered-face width (#77 method): a FIXED-size string
  // under an element's computed family+weight. Comparing this width across pages
  // for the SAME normalised string reveals a different actual face (e.g. the
  // prototype's system-ui fallback vs the EDS self-hosted Bebas Neue).
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;white-space:nowrap;font-size:48px';
  document.body.appendChild(probe);
  const widthOf = (text, family, weight) => {
    probe.style.fontFamily = family; probe.style.fontWeight = weight;
    probe.textContent = text || 'Agw1996';
    return Math.round(probe.getBoundingClientRect().width);
  };
  const namedFamily = (ff) => {
    const m = ff.match(/"([^"]+)"|'([^']+)'/);
    return (m && (m[1] || m[2])) || ff.split(',')[0].trim();
  };
  // Per element: the rendered-face width (its full computed stack), and — using
  // the SAME width probe, never document.fonts.check (#77) — whether the first
  // NAMED family actually loaded (probe it alone vs a guaranteed-absent name; equal
  // width ⇒ it fell back). The label then reads e.g. "Bebas Neue" vs "Bellfort→sys".
  const face = (text, cs) => {
    const s = (text || 'Agw1996').slice(0, 40);
    const named = namedFamily(cs.fontFamily);
    const w = widthOf(s, cs.fontFamily, cs.fontWeight);
    const loaded = widthOf(s, `"${named}",monospace`, cs.fontWeight)
      !== widthOf(s, '__no_such_face__,monospace', cs.fontWeight);
    return { w, family: loaded ? named : `${named}→sys`, loaded };
  };

  const out = [];
  let imgCount = 0;
  let order = 0;
  root.querySelectorAll('*').forEach((el) => {
    const tag = el.tagName.toLowerCase();

    // Images are visual-diff's domain (load/stretch/imagery-gap) and their alt
    // text rarely matches verbatim across proto↔EDS — count them, don't diff them.
    if (tag === 'img') { imgCount += 1; return; }

    // A text CTA: an <a> whose label is text (not an image link). Use the FULL
    // label (textContent) so <strong><a>…</a></strong> and <a><strong>…</strong></a>
    // both resolve, then skip the link's inner nodes below via closest('a').
    if (tag === 'a') {
      if (el.querySelector('img, picture')) return; // image/logo link, not a text CTA
      const t = clean(el.textContent);
      if (!t) return;
      out.push({ role: 'cta', order: order++, text: t, key: norm(t), href: el.getAttribute('href') || '', ...face(norm(t), getComputedStyle(el)) });
      return;
    }

    // Own text = DIRECT child text nodes only, so a wrapper <div><p>…</p></div>
    // isn't double-counted (the <p> carries the text, the <div> is empty).
    const own = clean([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
    if (!own) return;
    if (el.closest('a')) return; // text inside a link — already captured by the <a>

    const cs = getComputedStyle(el);
    const item = { order: order++, text: own, key: norm(own), ...face(norm(own), cs) };
    if (/^h[1-6]$/.test(tag)) item.role = 'heading';
    else if (cs.textTransform === 'uppercase' && parseFloat(cs.fontSize) <= eyebrow.maxFontPx && own.length <= eyebrow.maxLen) item.role = 'eyebrow';
    else item.role = 'body';
    out.push(item);
  });
  probe.remove();
  return { items: out, imgCount };
}

// Runs IN the page (ONE arg). args = [rootSel]. Outermost editable elements with
// visible text — the Experience Workspace instrumentation set (see header).
export function editableInventory(args) {
  const [rootSel] = args;
  const root = document.querySelector(rootSel) || document.querySelector('main') || document.body;
  const SEL = 'h1, h2, h3, h4, h5, h6, p, ul, ol, pre, blockquote';
  const items = [];
  root.querySelectorAll(SEL).forEach((el) => {
    const anc = el.parentElement && el.parentElement.closest(SEL);
    if (anc && anc !== root && root.contains(anc)) return; // nested inside another editable
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return; // empty or image-only (edited via data-image-index, not a text editor)
    items.push({ tag: el.tagName.toLowerCase(), text: text.slice(0, 70) });
  });
  return { count: items.length, items };
}
/* eslint-enable no-undef */

// Diff: consume each source item against the first unused target item with the
// same key (duplicates count correctly), classifying the outcome by role. All
// stack-specific labels (S/T) + remediation hints (H) come from the profile.
export function diffInventories(srcItems, tgtItems, prof) {
  const flags = [];
  const matched = []; // {proto, eds} pairs for the font pass
  const S = prof.source; const T = prof.target; const H = prof.hints;
  const used = new Array(tgtItems.length).fill(false);
  const findTgt = (key, role) => {
    let fallback = -1;
    for (let i = 0; i < tgtItems.length; i++) {
      if (used[i] || tgtItems[i].key !== key || !key) continue;
      if (tgtItems[i].role === role) return i; // exact role match preferred
      if (fallback < 0) fallback = i; // same text, other role
    }
    return fallback;
  };

  srcItems.forEach((p) => {
    if (!p.key) return;
    const i = findTgt(p.key, p.role);
    if (i < 0) {
      const where = `${S} ${p.role} "${p.text.slice(0, 48)}"`;
      if (p.role === 'cta') flags.push({ sev: '🔴', kind: 'MISSING CTA', msg: `${where}${p.href ? ` → ${p.href}` : ''} has no ${T} link. ${H.MISSING_CTA}` });
      else if (p.role === 'heading') flags.push({ sev: '🔴', kind: 'MISSING HEADING', msg: `${where} has no ${T} heading of the same text. ${H.MISSING_HEADING}` });
      else if (p.role === 'eyebrow') flags.push({ sev: '🔴', kind: 'MISSING EYEBROW', msg: `${where} has no ${T} match. ${H.MISSING_EYEBROW}` });
      else flags.push({ sev: '🟡', kind: 'MISSING BODY', msg: `${where.slice(0, 70)}… not found in ${T}. ${H.MISSING_BODY}` });
      return;
    }
    used[i] = true;
    const e = tgtItems[i];
    if (e.role !== p.role) {
      flags.push({ sev: '🔴', kind: 'ROLE SWAP', msg: `"${p.text.slice(0, 40)}" is a ${p.role} in the ${S} but a ${e.role} in ${T} — ${H.ROLE_SWAP}` });
    }
    matched.push({ p, e });
  });

  // EXTRA: target content with no source — invented copy to verify (advisory).
  tgtItems.forEach((e, i) => {
    if (used[i] || !e.key) return;
    if (e.role === 'body') flags.push({ sev: '🟡', kind: 'EXTRA', msg: `${T} body "${e.text.slice(0, 48)}" has no ${S} source — ${H.EXTRA_BODY}` });
    else flags.push({ sev: '🟠', kind: 'EXTRA', msg: `${T} ${e.role} "${e.text.slice(0, 48)}" has no ${S} source — ${H.EXTRA}` });
  });

  // FONT FORK: matched lines whose rendered FACE differs (width probe, #77). A
  // proprietary→self-hosted-fallback substitution fires on EVERY display line, so
  // GROUP them into one advisory rather than N near-identical paragraphs — the
  // agent/user decides whether the fork is intended.
  const forks = matched
    .filter(({ p, e }) => p.w && e.w && Math.abs(1 - e.w / p.w) > prof.fontDelta)
    .map(({ p, e }) => ({ role: p.role, text: p.text.slice(0, 28), from: p.family, to: e.family, pct: Math.round((e.w / p.w - 1) * 100) }));
  if (forks.length) {
    const shown = forks.slice(0, 8).map((f) => `${f.role} "${f.text}": ${S} ${f.from} vs ${T} ${f.to} (${f.pct}%)`).join('; ');
    const more = forks.length > 8 ? ` (+${forks.length - 8} more)` : '';
    flags.push({ sev: '🟠', kind: 'FONT FORK', msg: `${forks.length} matched line(s) render a DIFFERENT face: ${shown}${more}. ${H.FONT_FORK}` });
  }

  return { flags, matchedCount: matched.length };
}

export function summarise(inv) {
  const by = (r) => inv.items.filter((x) => x.role === r).length;
  return `${inv.items.length} text nodes — ${by('heading')} headings, ${by('eyebrow')} eyebrows, ${by('cta')} CTAs, ${by('body')} body; ${inv.imgCount} img`;
}

// ============================================================================ offline half (see header)

// The in-page `norm` (inside `inventory`, which is serialised into the page and cannot import helpers). Keep the two
// byte-equal in behaviour: test/content-inventory.test.mjs runs the serialised source in a stub and compares.
const ARROWS = /[→➔➜›⇒➤>]+/g;
export function norm(s) {
  return (s || '').replace(/\s+/g, ' ').trim().replace(ARROWS, ' ')
    .replace(/[‘’′]/g, "'").replace(/[“”″]/g, '"')
    .replace(/…/g, '...').replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ').trim()
    .toLowerCase().replace(/[.,;:!?·•]+$/g, '').trim();
}

// A parsed document carries character references the browser would have decoded before the in-page `norm` saw the
// text: the XML five + nbsp, every name sanitise.js's encode() emits (the test keeps this a superset of its table),
// and numeric references.
const NAMED = Object.fromEntries(('amp:26 lt:3c gt:3e quot:22 apos:27 nbsp:a0 iexcl:a1 pound:a3 yen:a5 copy:a9 laquo:ab reg:ae deg:b0 plusmn:b1 '
  + 'micro:b5 middot:b7 raquo:bb frac14:bc frac12:bd frac34:be iquest:bf Agrave:c0 Aacute:c1 Acirc:c2 Auml:c4 Ccedil:c7 Eacute:c9 Icirc:ce '
  + 'Ntilde:d1 Ouml:d6 times:d7 Uacute:da Uuml:dc agrave:e0 aacute:e1 acirc:e2 atilde:e3 auml:e4 aring:e5 aelig:e6 ccedil:e7 egrave:e8 '
  + 'eacute:e9 ecirc:ea euml:eb igrave:ec iacute:ed icirc:ee iuml:ef eth:f0 ntilde:f1 ograve:f2 oacute:f3 ocirc:f4 otilde:f5 ouml:f6 divide:f7 '
  + 'oslash:f8 ugrave:f9 uacute:fa ucirc:fb uuml:fc yacute:fd yuml:ff ndash:2013 mdash:2014 lsquo:2018 rsquo:2019 ldquo:201c rdquo:201d '
  + 'bull:2022 hellip:2026 trade:2122 larr:2190 uarr:2191 rarr:2192 darr:2193 euro:20ac')
  .split(' ').map((p) => { const [k, h] = p.split(':'); return [k, String.fromCodePoint(parseInt(h, 16))]; }));
const decodeRefs = (s) => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
  if (e[0] !== '#') return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  const cp = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
});

const ROLES = ['heading', 'link', 'image', 'text'];
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'object', 'embed', 'video', 'audio', 'link',
  'meta', 'input', 'select', 'textarea', 'option', 'head', 'title']);
const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'font', 'i', 'ins', 'kbd', 'label',
  'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr', 'img', 'picture', 'source', 'button']);
const HEADING = /^h[1-6]$/;
const PAGE_FILE = /\.(s?html?|php|aspx?|jsp|cfm)$/i;
const isEl = (n) => !!n && n.type === 'element';
const attrOf = (n, k) => (n.attrs ? n.attrs[k] : undefined);
const clean = (s) => s.replace(/\s+/g, ' ').trim();
const isLink = (n) => n.tag === 'a' && attrOf(n, 'href') !== undefined;
const fileOf = (u) => { let b = String(u || '').split(/[?#]/)[0].split('/').pop() || ''; try { b = decodeURIComponent(b); } catch { /* keep it encoded */ } return b; };
// a media file's stem: the extract fetcher names files <name>-<sha1[0..8]>.<ext>, so the suffix is not identity
const stemOf = (u) => fileOf(u).toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/-[0-9a-f]{8}$/, '');
// a document (rehost-docs' DOC_EXT) is identified by the name rehost-docs gives it, minus the extension and the
// -<sha8> it adds on a name collision; any other non-page file by its own name folded the same way
const unhash = (name) => name.replace(/\.[a-z0-9]+$/, '').replace(/-[0-9a-f]{8}$/, '');
const docKey = (url) => { try { return `asset:${unhash(docFileName(url))}`; } catch { return null; } };
const assetKey = (file) => `asset:${file.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-[0-9a-f]{8}$/, '')}`;

export function offlineInventory(root, opts = {}) {
  const base = opts.base || 'https://doc.invalid/';
  let host = 'doc.invalid'; try { host = new URL(base).host.replace(/^www\./, ''); } catch { /* relative links only */ }
  const sameSite = new Set([host, `www.${host}`, 'doc.invalid']);
  const ex = new Set();
  const excluded = {};
  const note = (reason, sample) => { const e = (excluded[reason] ||= { n: 0, sample: [] }); e.n += 1; if (e.sample.length < 4) e.sample.push(sample); };
  // text with references decoded; `blocks` pads block elements with spaces (the joined text)
  const textOf = (n, blocks = false) => {
    if (n.type === 'text') return decodeRefs(n.text);
    if (!Array.isArray(n.children) || ex.has(n) || (isEl(n) && SKIP.has(n.tag))) return '';
    if (n.tag === 'br') return ' ';
    const inner = n.children.map((c) => textOf(c, blocks)).join('');
    return blocks && isEl(n) && !INLINE.has(n.tag) ? ` ${inner} ` : inner;
  };
  const elems = function* (n) { for (const c of n.children) if (isEl(c) && !ex.has(c)) { yield c; yield* elems(c); } };
  const hasImg = (n) => [...elems(n)].some((d) => d.tag === 'img');

  const why = (c, inHeading) => {
    if (SKIP.has(c.tag)) return 'non-content';
    if (c.tag === 'div' && /^(section-)?metadata$/.test(String(attrOf(c, 'class') || '').trim().split(/\s+/)[0])) return 'metadata';
    const x = opts.exclude ? opts.exclude(c) : false;
    if (x) return typeof x === 'string' ? x : 'excluded';
    if (attrOf(c, 'data-hidden-live') !== undefined && c.tag !== 'details') return 'hidden-live';
    if (c.tag === 'button' && !inHeading) return 'control';
    if (attrOf(c, 'aria-hidden') === 'true' && !norm(textOf(c)) && !hasImg(c)) return 'decorative';
    return null;
  };
  const mark = (n, inHeading) => {
    for (const c of n.children) {
      if (!isEl(c)) continue;
      const r = why(c, inHeading);
      if (!r) { mark(c, inHeading || HEADING.test(c.tag)); continue; }
      const t = r === 'non-content' ? '' : clean(textOf(c));
      if (t || (r !== 'non-content' && hasImg(c))) note(r, t ? t.slice(0, 60) : '[img]');
      ex.add(c);
    }
  };
  mark(root, false);

  const hrefKey = (raw) => {
    const h = decodeRefs(raw).trim();
    if (!h || h.startsWith('#') || /^javascript:/i.test(h)) return null;
    if (/^(mailto|tel):/i.test(h)) return h.toLowerCase();
    let u; try { u = new URL(h, base); } catch { return h; }
    if (!/^https?:$/.test(u.protocol)) return u.href.toLowerCase();
    const doc = DOC_EXT.test(u.pathname) ? docKey(u.href) : null;
    if (doc) return doc;
    const file = fileOf(u.pathname);
    if (/\.[a-z0-9]{2,5}$/i.test(file) && !PAGE_FILE.test(file)) return assetKey(file);
    const k = opts.linkKey ? opts.linkKey(u.href) : null;
    if (typeof k === 'string') return k;
    if (sameSite.has(u.host)) return `${pathKey(deliveredUrl(u.pathname))}${u.search}`;
    return u.href.replace(/\/$/, '').toLowerCase();
  };
  const toAbs = (raw) => { try { return new URL(raw, base).href; } catch { return raw; } };
  const urlsOf = (n) => Object.keys(n.attrs || {}).filter((k) => k === 'src' || k === 'srcset' || /^data-.*src(set)?$/.test(k))
    .sort((a, b) => (a === 'src' ? -1 : b === 'src' ? 1 : 0))
    .flatMap((k) => decodeRefs(n.attrs[k]).split(',').map((s) => s.trim().split(/\s+/)[0]))
    .filter((s) => s && !/^data:/i.test(s));

  const items = [];
  const inHeading = (n) => { for (let p = n.parent; p && p !== root; p = p.parent) if (HEADING.test(p.tag)) return true; return false; };
  for (const e of elems(root)) {
    if (HEADING.test(e.tag)) {
      const text = clean(textOf(e, true)); const key = norm(text);
      if (key && !inHeading(e)) items.push({ role: 'heading', key, text });
    } else if (isLink(e)) {
      const text = clean(textOf(e, true)) || clean(decodeRefs(attrOf(e, 'aria-label') || attrOf(e, 'title') || ''));
      const key = norm(text); const raw = attrOf(e, 'href'); const href = hrefKey(raw);
      if (!key && (href === null || !hasImg(e))) { note('empty-link', raw); continue; } // no label, no image destination: no identity
      items.push({ role: 'link', key, text, href, raw });
    } else if (e.tag === 'img') {
      const pic = e.parent && e.parent.tag === 'picture' ? e.parent : null;
      const raws = [...urlsOf(e), ...(pic ? pic.children.filter((c) => isEl(c) && c.tag === 'source').flatMap(urlsOf) : [])];
      const alt = clean(decodeRefs(attrOf(e, 'alt') || '')); const altKey = norm(alt);
      if (!raws.length && !altKey) { note('placeholder', '[img]'); continue; }
      const abs = [...new Set(raws.map(toAbs))];
      const media = opts.mediaKey ? abs.map((u) => opts.mediaKey(u)).filter((m) => typeof m === 'string' && m) : [];
      const stems = [...new Set(raws.map(stemOf).filter(Boolean))];
      items.push({ role: 'image', key: altKey || stems[0] || '', text: alt || abs[0] || '', src: abs[0] || '', ids: [...new Set([...abs, ...media])], stems, alt: altKey });
    }
  }

  const blockish = new Map();
  const hasBlock = (n) => {
    if (!blockish.has(n)) blockish.set(n, n.children.some((c) => isEl(c) && !ex.has(c) && (!INLINE.has(c.tag) || hasBlock(c))));
    return blockish.get(n);
  };
  const runs = (n) => {
    let buf = [];
    const flush = () => {
      const text = clean(buf.map((b) => textOf(b)).join(''));
      const linkText = buf.filter(isEl).flatMap((b) => [b, ...elems(b)]).filter(isLink).map((a) => textOf(a)).join(' ');
      const key = norm(text);
      if (key && key !== norm(linkText)) items.push({ role: 'text', key, text });
      buf = [];
    };
    for (const c of n.children) {
      if (c.type === 'text') buf.push(c);
      else if (!isEl(c) || ex.has(c)) continue;
      else if (INLINE.has(c.tag) && !hasBlock(c)) buf.push(c);
      else { flush(); if (!HEADING.test(c.tag)) runs(c); }
    }
    flush();
  };
  runs(root);

  return { items, excluded: Object.fromEntries(Object.keys(excluded).sort().map((k) => [k, excluded[k]])), joined: norm(textOf(root, true)) };
}

const SHORT_RUN = 3; // words: a short run found only inside other text must occur as often as in the capture
const SPLIT_MAX = 8; // consecutive document runs one capture run may have been split into
const escRe = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const occurrences = (hay, k) => (k ? (hay.match(new RegExp(`(?<![\\p{L}\\p{N}])${escRe(k)}(?![\\p{L}\\p{N}])`, 'gu')) || []).length : 0);

export function diffOffline(srcInv, docInv) {
  const pools = Object.fromEntries(ROLES.map((r) => [r, docInv.items.filter((d) => d.role === r).map((d) => ({ d, used: false }))]));
  const take = (roles, pred) => { for (const r of roles) { const x = pools[r].find((p) => !p.used && pred(p.d)); if (x) { x.used = true; return x.d; } } return null; };
  const usedLike = (roles, pred) => roles.some((r) => pools[r].some((p) => p.used && pred(p.d)));
  const inDoc = (k) => occurrences(docInv.joined, k) > 0;
  const byId = (s, d) => s.ids.some((x) => d.ids.includes(x));
  const byStem = (s, d) => s.stems.some((x) => d.stems.includes(x));
  const byAlt = (s, d) => !!s.alt && s.alt === d.alt;
  const contains = (s, d) => !!d.key && (s.key.includes(d.key) || d.key.includes(s.key));
  // a capture run whose inline parts touch (no space between) and that the document split into consecutive runs
  const splitKeys = new Set();
  const takeSplit = (k) => {
    const p = pools.text;
    for (let a = 0; a < p.length; a += 1) {
      let acc = '';
      for (let b = a; b < p.length && b - a < SPLIT_MAX && !p[b].used; b += 1) {
        acc += p[b].d.text;
        const n = norm(acc);
        if (b > a && n === k) { for (let x = a; x <= b; x += 1) p[x].used = true; splitKeys.add(k); return true; }
        if (!k.startsWith(n)) break;
      }
    }
    return false;
  };

  const src = srcInv.items;
  const status = src.map(() => null); // 'found' | a tolerant rule | { reason } (MISSING)
  src.forEach((s, i) => {
    if (s.role === 'heading' || s.role === 'text') { if (take([s.role], (d) => d.key === s.key)) status[i] = 'found'; }
    else if (s.role === 'link' && take(['link'], (d) => d.key === s.key && (s.href === null ? !!s.key : d.href === s.href))) status[i] = 'found';
  });
  for (const f of [byId, byStem, byAlt]) {
    src.forEach((s, i) => { if (s.role === 'image' && !status[i] && take(['image'], (d) => f(s, d))) status[i] = 'found'; });
  }
  src.forEach((s, i) => {
    if (status[i]) return;
    const k = s.key;
    if (s.role === 'heading') {
      if (take(['text', 'link'], (d) => d.key === k)) status[i] = 'demoted';
      else if (usedLike(['heading', 'text'], (d) => d.key === k)) status[i] = 'duplicate';
      else status[i] = { reason: inDoc(k) ? 'text present, not as its own heading or run' : 'absent' };
    } else if (s.role === 'text') {
      if (take(['heading', 'link'], (d) => d.key === k)) status[i] = 'promoted';
      else if (splitKeys.has(k) || usedLike(['text'], (d) => d.key === k)) status[i] = 'duplicate';
      else if (inDoc(k) && (k.split(' ').length > SHORT_RUN || occurrences(docInv.joined, k) >= occurrences(srcInv.joined, k))) status[i] = 'merged';
      else if (takeSplit(k)) status[i] = 'split';
      else status[i] = { reason: inDoc(k) ? `short run: ${occurrences(docInv.joined, k)} of ${occurrences(srcInv.joined, k)} occurrences` : 'absent' };
    } else if (s.role === 'link') {
      const same = (d) => d.href === s.href;
      if (s.href === null) status[i] = inDoc(k) ? 'unlinked' : { reason: 'absent' };
      else if (!k && take(['link'], same)) status[i] = 'found';
      else if (k && inDoc(k) && take(['link'], (d) => same(d) && contains(s, d))) status[i] = 'relabelled';
      else if (usedLike(['link'], (d) => same(d) && (!k || d.key === k || contains(s, d)))) status[i] = 'duplicate';
      else {
        const other = k && pools.link.find((p) => p.d.key === k);
        status[i] = { reason: other ? `href differs: the document has ${other.d.raw}` : inDoc(k) ? 'text kept, link lost' : 'absent' };
      }
    } else if (usedLike(['image'], (d) => byId(s, d) || byStem(s, d) || byAlt(s, d))) status[i] = 'duplicate';
    else status[i] = { reason: 'absent' };
  });

  const counts = Object.fromEntries(ROLES.map((r) => [r, { capture: 0, found: 0, tolerated: 0, missing: 0, extra: 0 }]));
  const missing = []; const tolerated = [];
  src.forEach((s, i) => {
    const c = counts[s.role]; const st = status[i]; c.capture += 1;
    if (st === 'found') c.found += 1;
    else if (typeof st === 'string') { c.tolerated += 1; tolerated.push({ rule: st, role: s.role, key: s.key, text: s.text }); }
    else {
      c.missing += 1;
      missing.push({ role: s.role, key: s.key, text: s.text, reason: st.reason, ...(s.role === 'link' ? { href: s.raw } : {}), ...(s.role === 'image' ? { src: s.src } : {}) });
    }
  });
  const srcHrefs = new Set(src.filter((s) => s.role === 'link').map((s) => s.href));
  const extra = [];
  for (const r of ROLES) {
    for (const { d, used } of pools[r]) {
      if (used || ((r === 'heading' || r === 'text') && occurrences(srcInv.joined, d.key) > 0) || (r === 'link' && srcHrefs.has(d.href))) continue;
      counts[r].extra += 1;
      extra.push({ role: r, key: d.key, text: d.text, ...(r === 'link' ? { href: d.raw } : {}), ...(r === 'image' ? { src: d.src } : {}) });
    }
  }
  return { pass: missing.length === 0, missing, extra, tolerated, counts };
}

export function summariseOffline(diff) {
  const c = diff.counts;
  const rules = {}; for (const t of diff.tolerated) rules[t.rule] = (rules[t.rule] || 0) + 1;
  const tol = Object.keys(rules).sort().map((r) => `${r} ${rules[r]}`).join(', ');
  return `${diff.pass ? 'PASS' : 'FAIL'} — ${ROLES.map((r) => `${r} ${c[r].capture - c[r].missing}/${c[r].capture}`).join(' · ')}; MISSING ${diff.missing.length} · EXTRA ${diff.extra.length} · tolerated ${diff.tolerated.length}${tol ? ` (${tol})` : ''}`;
}
