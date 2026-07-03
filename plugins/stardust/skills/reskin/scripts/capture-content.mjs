#!/usr/bin/env node
/**
 * skills/reskin/scripts/capture-content.mjs
 *
 * Byte-oriented CONTENT-MODEL capture of a content page (reskin Phase 2).
 * Distinct from extract's design-oriented capture: this one exists so a
 * renderer can interpolate every visible string and the content gate can
 * assert byte equality.
 *
 * Captures, per section slot (children of the declared content-root scope):
 *   headings (level + rendered text), body paragraphs, list items,
 *   CTAs (text + href + ABSOLUTE href + classes), ordered VISIBLE images
 *   (currentSrc + alt + intrinsic size), "leftovers" — text nodes not
 *   inside h1..h6, p, li, or a (eyebrows, spans, figcaptions, button labels) —
 *   and `ordered`: the render-ready ORDERED STREAM — the same content as
 *   kind-tagged nodes in document order, nesting preserved (a CTA wrapping
 *   its heading, a heading wrapping its CTA), each node carrying `sep`
 *   ('' tight join | ' ' separated) so renderers never reconstruct order or
 *   separators from visibleText (reference/content-model.md § The ordered
 *   stream). A slot root that IS itself an h1..h6/p/li/a (an sr-only h2
 *   scoped with "!") is classified as that kind, not as leftovers.
 * Plus page-level:
 *   full SEO metadata (title / description / canonical / OG / Twitter /
 *   JSON-LD / lang / favicon), the whitespace-normalized visible text of
 *   the whole scope (the content-gate reference string), a scope-coverage
 *   diagnostic (bodyTextLen vs scopeTextLen + h1-in-scope), and a
 *   full-page screenshot.
 *
 * Text is captured via innerText, i.e. RENDERED case — text-transform is
 * reflected. The reskin reproduces casing via CSS text-transform, never by
 * editing strings (reference/mapping-brief.md § Casing policy).
 *
 * The normalization ledger (--normalize) is applied BEFORE capture and must
 * be the SAME file the gates receive (reference/content-model.md
 * § Normalization ledger).
 *
 * Usage:
 *   node capture-content.mjs --url <page-url> --out <dir>
 *       [--scope 'sel1,sel2!,...']   content-root scope; default "main".
 *                                    Comma-separated scopes captured in
 *                                    order and concatenated. A trailing "!"
 *                                    keeps that scope WHOLE as one slot
 *                                    (don't descend into children).
 *       [--normalize <ledger.mjs>]   page normalization ledger module
 *                                    (default: the shared default ledger)
 *
 * Exit: 0 captured, 2 setup/scope error.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadNormalize, IMG_VISIBLE } from './source-normalize.mjs';

function parseArgs(argv) {
  const opts = { url: null, out: null, scope: 'main', normalize: null };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--url') opts.url = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--scope') opts.scope = argv[++i];
    else if (a === '--normalize') opts.normalize = argv[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
    else { console.error(`[capture-content] unknown arg: ${a}`); process.exit(2); }
  }
  return opts;
}

const opts = parseArgs(process.argv);
if (opts.help || !opts.url || !opts.out) {
  console.log('usage: node capture-content.mjs --url <page-url> --out <dir> [--scope sel1,sel2!] [--normalize ledger.mjs]');
  console.log('Writes <dir>/content-model.json + <dir>/source-full.png.');
  console.log('Scope: comma-separated selectors captured in order; trailing "!" keeps a scope whole as one slot.');
  console.log('Each slot carries per-type arrays (mapping/gates) AND sections[].ordered — the');
  console.log('document-ordered, sep-flagged stream renderers consume (content-model.md § The ordered stream).');
  console.log('Pass the SAME --normalize ledger to dom-equality.mjs at gate time.');
  process.exit(opts.help ? 0 : 2);
}

let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  console.error('[capture-content] playwright not importable from this script\'s directory.');
  console.error('Copy skills/reskin/scripts/* into the project (stardust/scripts/reskin/) and');
  console.error('run: npm i -D playwright --no-save --legacy-peer-deps  (extract SKILL.md § Setup)');
  process.exit(2);
}

const { script: NORMALIZE, ledger, source: normalizeSource } = await loadNormalize(opts.normalize);
mkdirSync(opts.out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(opts.url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2000);

// Trigger lazy loading.
await page.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 700) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 200));
  }
  window.scrollTo(0, 0);
});
await page.waitForTimeout(2000);

// Apply the declared source normalizations (shared with the gates).
await page.evaluate(NORMALIZE);
await page.waitForTimeout(300);

const metadata = await page.evaluate(() => {
  const ogTags = {}; const twitterTags = {}; let description = '';
  document.querySelectorAll('meta').forEach((meta) => {
    const property = meta.getAttribute('property') || '';
    const name = meta.getAttribute('name') || '';
    const content = meta.getAttribute('content');
    if (content === null) return;
    if (property.startsWith('og:')) ogTags[property] = content;
    else if (name.startsWith('twitter:') || property.startsWith('twitter:')) twitterTags[name || property] = content;
    if (name === 'description') description = content;
  });
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href') || null;
  const jsonLd = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try { jsonLd.push(JSON.parse(s.textContent || '')); } catch {}
  });
  return {
    title: document.title || '', description, canonical, ogTags, twitterTags, jsonLd,
    lang: document.documentElement.lang || '',
    favicon: document.querySelector('link[rel*="icon"]')?.href || null,
  };
});

const model = await page.evaluate(({ scopeSelList, imgVisibleSrc }) => {
  // A trailing "!" on a selector means: keep this scope whole as ONE slot
  // (don't descend into children). Without it, children become slots.
  const scopeDefs = scopeSelList.split(',').map((s) => s.trim()).map((s) => ({
    sel: s.replace(/!$/, ''), whole: s.endsWith('!'),
  }));
  const scopes = scopeDefs.map((d) => document.querySelector(d.sel));
  if (scopes.some((s) => !s)) {
    return { error: `scope not found among: ${scopeSelList}` };
  }
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const isVisible = (el) => {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0 || el.offsetParent !== null;
  };
  // Shared image predicate — the SAME code dom-equality.mjs runs at gate
  // time (source-normalize.mjs IMG_VISIBLE), so capture and gate can never
  // drift on which images count as content.
  const imgVisible = (0, eval)(imgVisibleSrc);
  const kindOf = (el) => {
    const t = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(t)) return 'heading';
    if (t === 'p') return 'paragraph';
    if (t === 'li') return 'listItem';
    if (t === 'a') return 'cta';
    if (t === 'img') return 'image';
    return null;
  };

  // Section slots: for each scope, descend single-child wrappers, then take
  // children as content blocks — unless the scope is marked whole ("!").
  const sectionEls = [];
  scopes.forEach((scope, si) => {
    if (scopeDefs[si].whole) { sectionEls.push(scope); return; }
    let root = scope;
    while (root.children.length === 1) root = root.children[0];
    Array.from(root.children)
      .filter((el) => norm(el.innerText).length > 0 || el.querySelector('img'))
      .forEach((el) => sectionEls.push(el));
  });

  const sections = sectionEls.map((sec, i) => {
    // querySelectorAll never matches the root element itself — a slot root
    // that IS an h1..h6/p/li/a (an sr-only h2 scoped with "!") must be
    // classified as that kind, not fall through to leftovers.
    const q = (sel) => (sec.matches(sel) ? [sec] : []).concat(Array.from(sec.querySelectorAll(sel)));
    const headings = q('h1,h2,h3,h4,h5,h6')
      .filter(isVisible)
      .map((h) => ({ level: h.tagName.toLowerCase(), text: norm(h.innerText) }))
      .filter((h) => h.text);
    const ctas = q('a')
      .filter(isVisible)
      .map((a) => ({
        text: norm(a.innerText),
        href: a.getAttribute('href') || '',
        absHref: a.href || '',
        classes: (typeof a.className === 'string' ? a.className : ''),
      }))
      .filter((a) => a.text);
    const paragraphs = q('p')
      .filter(isVisible)
      .map((p) => norm(p.innerText))
      .filter(Boolean);
    const listItems = q('li')
      .filter(isVisible)
      .map((li) => norm(li.innerText))
      .filter(Boolean);
    const images = q('img')
      .filter(imgVisible)
      .map((img) => ({
        currentSrc: img.currentSrc || img.src || '',
        alt: img.getAttribute('alt') || '',
        w: img.naturalWidth, h: img.naturalHeight,
      }));
    // Text nodes not inside h*/p/li/a — leftovers (eyebrows, spans, button
    // labels, figcaptions…). These carry real content; never drop them.
    const covered = new Set();
    q('h1,h2,h3,h4,h5,h6,p,li,a').forEach((el) => {
      el.querySelectorAll('*').forEach((c) => covered.add(c)); covered.add(el);
    });
    const leftovers = [];
    const walker = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || covered.has(parent) || !isVisible(parent)) continue;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) continue;
      const t = norm(node.textContent);
      if (t) {
        leftovers.push({
          text: t,
          parentTag: parent.tagName.toLowerCase(),
          parentClass: (typeof parent.className === 'string' ? parent.className : '').slice(0, 60),
        });
      }
    }
    // ---- The ordered stream (reference/content-model.md § The ordered
    // stream): the same content as kind-tagged nodes in DOCUMENT ORDER,
    // nesting preserved (a hero <a> wrapping its h2 is a cta node with a
    // heading child; a news h3 wrapping its <a> is the reverse), each node
    // carrying `sep` — '' when it joins the previous text with NO separator
    // (inline zero-separator runs), ' ' when whitespace separates them.
    // Renderers consume this; they no longer reconstruct order from
    // visibleText as an oracle.
    function nodeFor(el) {
      const kind = kindOf(el);
      if (kind === 'image') {
        if (!imgVisible(el)) return null;
        return { kind: 'image', currentSrc: el.currentSrc || el.src || '', alt: el.getAttribute('alt') || '' };
      }
      if (!isVisible(el)) return null;
      const n = { kind, text: norm(el.innerText), display: getComputedStyle(el).display };
      if (kind === 'heading') n.level = el.tagName.toLowerCase();
      if (kind === 'cta') {
        n.href = el.getAttribute('href') || '';
        n.absHref = el.href || '';
        n.classes = (typeof el.className === 'string' ? el.className : '');
      }
      const children = streamOf(el);
      // Pure-text leaves need no children; keep them only when they add
      // structure (nested cta/heading/image, interleaved text runs).
      if (!(children.length === 1 && children[0].kind === 'text' && children[0].text === n.text)
          && children.length) n.children = children;
      if (!n.text && !(n.children && n.children.length)) return null;
      return n;
    }
    function streamOf(rootEl) {
      const out = [];
      (function walk(el) {
        for (const node of el.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            let t = norm(node.textContent);
            if (t && isVisible(el) && !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) {
              // Text nodes have no innerText — apply the parent's computed
              // text-transform so the stream is RENDERED-case like every
              // other captured string (content-model.md § Rendered-case).
              const tt = getComputedStyle(el).textTransform;
              if (tt === 'uppercase') t = t.toUpperCase();
              else if (tt === 'lowercase') t = t.toLowerCase();
              else if (tt === 'capitalize') t = t.replace(/(^|\s)(\S)/g, (m, sp, ch) => sp + ch.toUpperCase());
              out.push({
                kind: 'text',
                text: t,
                parentTag: el.tagName.toLowerCase(),
                parentClass: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
              });
            }
            continue;
          }
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(node.tagName)) continue;
          if (kindOf(node)) {
            const n = nodeFor(node);
            if (n) out.push(n);
            continue;
          }
          walk(node); // transparent wrapper — descend
        }
      })(rootEl);
      return out;
    }
    // Assign `sep` flags by tiling each parent's normalized text with its
    // children's texts, left to right in document order — deterministic
    // (unlike oracle matching, order is known), and self-verifying: any
    // non-whitespace gap or unconsumed tail marks the slot unverified.
    function assignSeps(parentText, children) {
      let cursor = 0; let ok = true;
      for (const c of children) {
        c.sep = '';
        if (c.kind === 'image' || !c.text) continue;
        const idx = parentText.indexOf(c.text, cursor);
        if (idx < 0) { ok = false; c.sep = ' '; continue; }
        if (parentText.slice(cursor, idx).trim() !== '') ok = false;
        c.sep = idx === cursor ? '' : ' '; // first child is always '' (cursor 0, idx 0)
        cursor = idx + c.text.length;
        if (c.children) ok = assignSeps(c.text, c.children) && ok;
      }
      if (parentText.slice(cursor).trim() !== '') ok = false;
      return ok;
    }
    const visibleText = norm(sec.innerText);
    const ordered = kindOf(sec) ? [nodeFor(sec)].filter(Boolean) : streamOf(sec);
    const orderedVerified = assignSeps(visibleText, ordered);
    return {
      slot: `s${String(i + 1).padStart(2, '0')}`,
      rootTag: sec.tagName.toLowerCase(),
      rootClass: (typeof sec.className === 'string' ? sec.className : ''),
      visibleText,
      headings, paragraphs, listItems, ctas, images, leftovers,
      ordered, orderedVerified,
    };
  });

  // Scope-coverage diagnostic (reference/content-model.md § Scope discovery):
  // the whole-body normalized text is the ceiling; the h1 must live in scope.
  const scopeText = norm(scopes.map((s) => s.innerText || '').join(' '));
  const bodyText = norm(document.body.innerText || '');
  const h1 = document.querySelector('h1');
  const h1Text = h1 ? norm(h1.innerText) : null;
  return {
    scope: scopeDefs,
    visibleTextNormalized: scopeText,
    coverage: {
      bodyTextLen: bodyText.length,
      scopeTextLen: scopeText.length,
      ratio: bodyText.length ? +(scopeText.length / bodyText.length).toFixed(3) : null,
      h1Text,
      h1InScope: h1Text ? scopeText.includes(h1Text) : null,
    },
    sections,
  };
}, { scopeSelList: opts.scope, imgVisibleSrc: IMG_VISIBLE });

if (model.error) {
  console.error(`[capture-content] ${model.error}`);
  await browser.close();
  process.exit(2);
}

const shot = `${opts.out.replace(/\/$/, '')}/source-full.png`;
await page.screenshot({ path: shot, fullPage: true });

const out = `${opts.out.replace(/\/$/, '')}/content-model.json`;
writeFileSync(out, JSON.stringify({
  _provenance: {
    writtenBy: 'stardust:reskin/capture-content.mjs',
    capturedAt: new Date().toISOString(),
    url: opts.url,
    viewport: '1440x900',
    scope: opts.scope,
    normalize: { source: normalizeSource, ledger },
  },
  metadata,
  ...model,
}, null, 2));

const imgCount = model.sections.reduce((n, s) => n + s.images.length, 0);
console.log(`[capture-content] slots=${model.sections.length} textLen=${model.visibleTextNormalized.length} images=${imgCount}`);
console.log(`[capture-content] coverage: scope ${model.coverage.scopeTextLen} / body ${model.coverage.bodyTextLen} chars (ratio ${model.coverage.ratio}) — h1 in scope: ${model.coverage.h1InScope}`);
if (model.coverage.h1InScope === false) {
  console.log('[capture-content] WARNING: the page h1 is OUTSIDE the declared scope — the top failure mode (hero living in <header>). Widen --scope.');
}
// Slot-granularity smell (content-model.md § Scope discovery step 3b): a
// whole page collapsing to ~2 slots, or one slot carrying most of the scope
// text, means the scope sits on a page-wide wrapper (CMS parsys), not on
// the real sections. Coverage ratio and h1InScope both pass in that state.
const largestSlot = model.sections.reduce((m, s) => Math.max(m, s.visibleText.length), 0);
const largestShare = model.visibleTextNormalized.length ? largestSlot / model.visibleTextNormalized.length : 0;
console.log(`[capture-content] granularity: ${model.sections.length} slots — largest slot carries ${Math.round(largestShare * 100)}% of scope text`);
if (model.sections.length < 3 || largestShare > 0.5) {
  console.log('[capture-content] WARNING: wrapper-scope smell — fewer slots than visible sections, or one mega-slot. Scope DEEPER so the real sections become the scope\'s children (content-model.md § Scope discovery step 3b).');
}
const unverified = model.sections.filter((s) => !s.orderedVerified).map((s) => s.slot);
if (unverified.length) {
  console.log(`[capture-content] WARNING: ordered stream did not tile visibleText for ${unverified.join(', ')} — renderers must not trust sep flags on those slots; inspect before rendering.`);
}
console.log(`[capture-content] wrote ${out} + ${shot}`);
await browser.close();
