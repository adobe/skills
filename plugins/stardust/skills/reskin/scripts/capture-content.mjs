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
 *   (currentSrc + alt + intrinsic size), form controls (select with ordered
 *   option texts, input value/placeholder, textarea — their text is part of
 *   innerText and therefore of the byte-gate reference, F-R3), "leftovers"
 *   — text nodes not inside h1..h6, p, li, or a (eyebrows, spans,
 *   figcaptions, button labels) —
 *   and `ordered`: the render-ready ORDERED STREAM — the same content as
 *   kind-tagged nodes in document order, nesting preserved (a CTA wrapping
 *   its heading, a heading wrapping its CTA), each node carrying `sep`
 *   ('' tight join | ' ' separated) so renderers never reconstruct order or
 *   separators from visibleText (reference/content-model.md § The ordered
 *   stream). A slot root that IS itself an h1..h6/p/li/a (an sr-only h2
 *   scoped with "!") is classified as that kind, not as leftovers.
 *   Stream text nodes are built on an innerText-CONSISTENT basis (F-R2):
 *   a text node enters the stream only if its text is part of its parent's
 *   rendered innerText — Chrome's innerText is the byte-gate reference, so
 *   SVG <title>/<desc> a11y labels ("Arrow right", "Play") and other
 *   innerText-invisible text never become ghost nodes that a spec-compliant
 *   renderer would emit and fail the gate on.
 *
 * Live navigation is hardened via the shared diff live-session module
 * (real-Chrome UA + the standard request headers — UA alone still 403s on
 * Akamai (F-R1) — domcontentloaded on live targets, webdriver spoof,
 * challenge-solve window). A bot challenge or a blocked/degraded live
 * source FAILS LOUD (exit 3) — it is never silently captured as the source.
 * Local/file targets keep the legacy networkidle behavior.
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
 *       [--ua <string>]              user agent (default: live-session's
 *                                    real-Chrome UA + standard headers)
 *       [--wait-until <state>]       live-target goto waitUntil (default
 *                                    domcontentloaded; local/file targets
 *                                    keep networkidle)
 *       [--headed]                   headed stealth real Chrome (escalation
 *                                    for bot-managed sites)
 *       [--locale <tag>]             pin Accept-Language + locale (e.g.
 *                                    en-GB) for geo determinism
 *
 * Exit: 0 captured, 2 setup/scope error,
 *       3 bot challenge / blocked live source (fail loud, never captured).
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadNormalize, IMG_VISIBLE } from './source-normalize.mjs';

// live-session.mjs lives in the diff skill's scripts dir. Two layouts exist:
// the plugin tree (skills/reskin/scripts ↔ skills/diff/scripts) and the
// documented project copy (stardust/scripts/reskin ↔ stardust/scripts/diff)
// — resolve either, so a project re-copy can't silently sever the shared
// live-target hardening (F-G/F-R1).
const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_SESSION = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs']
  .map((p) => resolvePath(HERE, p)).find((p) => existsSync(p));
if (!LIVE_SESSION) {
  console.error('[capture-content] live-session.mjs not found (looked in ../../diff/scripts/ and ../diff/).');
  console.error('Copy the diff skill\'s live-session.mjs alongside the reskin scripts (SKILL.md § Setup).');
  process.exit(2);
}
const { isLiveHttpUrl, launchStealthHeaded, newLiveContext, gotoLive } = await import(pathToFileURL(LIVE_SESSION).href);

function parseArgs(argv) {
  const opts = { url: null, out: null, scope: 'main', normalize: null, ua: null, waitUntil: 'domcontentloaded', headed: false, locale: null };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--url') opts.url = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--scope') opts.scope = argv[++i];
    else if (a === '--normalize') opts.normalize = argv[++i];
    else if (a === '--ua') opts.ua = argv[++i];
    else if (a === '--wait-until') opts.waitUntil = argv[++i];
    else if (a === '--headed') opts.headed = true;
    else if (a === '--locale') opts.locale = argv[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
    else { console.error(`[capture-content] unknown arg: ${a}`); process.exit(2); }
  }
  return opts;
}

const opts = parseArgs(process.argv);
if (opts.help || !opts.url || !opts.out) {
  console.log('usage: node capture-content.mjs --url <page-url> --out <dir> [--scope sel1,sel2!] [--normalize ledger.mjs]');
  console.log('         [--ua <string>] [--wait-until domcontentloaded] [--headed] [--locale <tag>]');
  console.log('Writes <dir>/content-model.json + <dir>/source-full.png.');
  console.log('Scope: comma-separated selectors captured in order; trailing "!" keeps a scope whole as one slot.');
  console.log('Each selector captures exactly ONE element (querySelector, first match) — to capture N');
  console.log('siblings, scope their common container (content-model.md § Scope discovery step 4).');
  console.log('Each slot carries per-type arrays (mapping/gates) AND sections[].ordered — the');
  console.log('document-ordered, sep-flagged stream renderers consume (content-model.md § The ordered stream).');
  console.log('Pass the SAME --normalize ledger to dom-equality.mjs at gate time.');
  console.log('Live targets get the shared live-session hardening (real-Chrome UA + standard headers,');
  console.log('domcontentloaded, challenge detection); escalate bot-managed sites with --headed.');
  console.log('Exit: 0 captured, 2 setup/scope error, 3 bot challenge / blocked live source.');
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

const browser = opts.headed ? await launchStealthHeaded(chromium) : await chromium.launch();
// UA + standard headers + webdriver spoof on the context (live-session) —
// harmless on local/file targets, mandatory on live ones (F-G/F-R1).
const ctx = await newLiveContext(browser, {
  ua: opts.ua, locale: opts.locale, viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();
if (isLiveHttpUrl(opts.url)) {
  // Challenge/blocked interstitial or non-challenge HTTP >= 400 → loud
  // failure. A challenge page must NEVER be silently captured as the source:
  // the model built from it would gate the render against an interstitial.
  // solveWindow only under --headed: headless clearance never lands, and the
  // solve loop would spend the Akamai block budget (1 hit vs up to 4).
  try {
    await gotoLive(page, opts.url, { waitUntil: opts.waitUntil, timeoutMs: 60000, settleMs: 0, solveWindow: opts.headed });
  } catch (e) {
    console.error(`[capture-content] ${e.message}`);
    await browser.close();
    process.exit(e.name === 'BotChallengeError' ? 3 : 2);
  }
} else {
  // local/file target — legacy behavior (a served prototype reaches
  // networkidle; analytics-free local pages don't hang on it).
  await page.goto(opts.url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
}
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
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  // Case-insensitive locate that NEVER reuses an index across case-folded
  // strings: some case folds change the string length — Turkish dotted
  // capital İ (U+0130) lowercases to 'i' + U+0307, ONE UTF-16 unit becoming
  // TWO — so an index found in haystack.toLowerCase(), applied to the
  // unlowered haystack, is shifted and returns a corrupted slice
  // ("İstanbul Hotels" + "Hotels" → "otels…" → orderedVerified:false → the
  // sanctioned fallback silently drops the node). Instead: exact indexOf on
  // the original first; else scan the ORIGINAL string's offsets, testing
  // candidate windows of the needle's length ±1 (the fold can grow/shrink
  // per İ-class char), accepting a slice only when the slice itself
  // case-folds to the needle. Returns the verified slice (in the haystack's
  // rendered case) or null. Dependency-free; O(n·m) worst case is fine at
  // text-node sizes.
  const ciFind = (hay, needle) => {
    if (!hay || !needle) return null;
    if (hay.indexOf(needle) >= 0) return needle;
    const nLow = needle.toLowerCase();
    for (let i = 0; i <= hay.length - needle.length + 1; i += 1) {
      for (const len of [needle.length, needle.length + 1, needle.length - 1]) {
        if (len <= 0 || i + len > hay.length) continue;
        const cand = hay.slice(i, i + len);
        if (cand.toLowerCase() === nLow) return cand;
      }
    }
    return null;
  };
  if (scopes.some((s) => !s)) {
    // Scope-discovery hint (F-D): a zero-output failure must carry the
    // evidence the discovery procedure needs — the largest-text-child chain
    // from <body> is the candidate-root ladder (each element on it covers
    // the most page text at its depth; the real content root is on it).
    const bodyTextLen = norm(document.body.innerText || '').length;
    const selOf = (e) => e.tagName.toLowerCase()
      + (e.id ? `#${e.id}` : '')
      + ((typeof e.className === 'string' && e.className.trim()) ? `.${e.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '');
    const candidates = [];
    let el = document.body;
    for (let depth = 0; depth < 8 && el; depth += 1) {
      let best = null; let bestLen = 0;
      for (const k of el.children) {
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(k.tagName)) continue;
        const L = norm(k.innerText || '').length;
        if (L > bestLen) { best = k; bestLen = L; }
      }
      if (!best || !bestLen) break;
      candidates.push({ sel: selOf(best), textLen: bestLen, ratio: bodyTextLen ? +(bestLen / bodyTextLen).toFixed(3) : null });
      el = best;
    }
    const missing = scopeDefs.filter((d, i) => !scopes[i]).map((d) => d.sel);
    return { error: `scope not found: ${missing.join(', ')} (among: ${scopeSelList})`, bodyTextLen, candidates };
  }
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
    // Form controls are stream nodes (F-R3): a <select>'s option text is
    // part of innerText — the byte-gate reference — but getComputedStyle on
    // <option> is display:none, so without an explicit kind the options are
    // skipped by the stream AND every per-type array, leaving the slot's
    // bytes unreconstructable from structured fields (redcross s03).
    if (t === 'select' || t === 'input' || t === 'textarea') return 'formControl';
    return null;
  };
  // Shared shape for the stream node and the per-type formControls array.
  const formControlData = (el) => {
    const tag = el.tagName.toLowerCase();
    const d = { control: tag, text: norm(el.innerText) };
    const name = el.getAttribute('name'); if (name) d.name = name;
    if (tag === 'select') {
      // option texts VERBATIM, in order — the renderer emits them as an
      // equivalent control, option order preserved (content-model.md).
      d.options = Array.from(el.options).map((o) => norm(o.textContent));
      d.selectedIndex = el.selectedIndex;
    } else {
      if (tag === 'input') d.inputType = el.type || 'text';
      if (el.value) d.value = el.value;
      const ph = el.getAttribute('placeholder'); if (ph) d.placeholder = ph;
    }
    return d;
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
    // Form controls (F-R3) — visibility is tested on the CONTROL, not its
    // options (options compute display:none); input[type=hidden] is excluded
    // by the same predicate.
    const formControls = q('select,input,textarea')
      .filter(isVisible)
      .map(formControlData);
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
      if (kind === 'formControl') {
        if (!isVisible(el)) return null;
        // text is norm(innerText) — for a <select> that includes the option
        // texts, so the node tiles visibleText like any other stream node;
        // the structured fields (options/value/placeholder) are the render
        // surface (F-R3). No descent: options ARE the structure.
        return { kind: 'formControl', ...formControlData(el), display: getComputedStyle(el).display };
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
              // innerText-consistent basis (F-R2): the stream must tile
              // visibleText, and visibleText (plus both gates) is Chrome's
              // innerText. A text node enters the stream only if its text is
              // part of its parent's rendered innerText; the matched slice
              // is taken FROM innerText, so casing is Chrome's own rendered
              // case (text-transform included — no reimplementation).
              // What this drops, deliberately: SVG <title>/<desc> a11y
              // labels ("Arrow right", "Play" — no innerText on SVG
              // elements) and any text the UA renders invisible — the ghost
              // nodes that made spec-compliant renderers fail the byte gate.
              // Located via ciFind (never an index from a case-folded copy
              // applied to the original — the İ U+0130 offset-shift trap).
              const pInner = typeof el.innerText === 'string' ? norm(el.innerText) : '';
              const slice = ciFind(pInner, t);
              if (slice === null) continue; // absent from innerText → not in the byte reference → not a stream node
              t = slice;
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
      headings, paragraphs, listItems, ctas, images, formControls, leftovers,
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
  // Scope-discovery hint (F-D): never a bare zero-output error — print the
  // candidate-root ladder so the next --scope attempt is informed, not blind.
  if (model.candidates) {
    console.error(`[capture-content] body text: ${model.bodyTextLen} chars. Candidate content roots (largest-text-child chain from <body>):`);
    for (const c of model.candidates) {
      console.error(`  ${c.sel}  — ${c.textLen} chars (${Math.round((c.ratio || 0) * 100)}% of body)`);
    }
    console.error('[capture-content] run the scope-discovery procedure: reference/content-model.md § Scope discovery.');
    console.error('[capture-content] (a missing obvious root like `main` on a live URL can also mean a degraded/bot-served page — this capture is hardened, but check the exit-3 path and --headed if the site is bot-managed.)');
  }
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
    nav: {
      live: isLiveHttpUrl(opts.url),
      waitUntil: isLiveHttpUrl(opts.url) ? opts.waitUntil : 'networkidle',
      headed: opts.headed,
      ...(opts.ua ? { ua: opts.ua } : {}),
      ...(opts.locale ? { locale: opts.locale } : {}),
    },
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
  console.log('[capture-content] sanctioned resolution: drop stream text absent from the slot\'s visibleText and record the drop in the model\'s provenance (content-model.md § The ordered stream — orderedVerified:false fallback).');
}
console.log(`[capture-content] wrote ${out} + ${shot}`);
await browser.close();
