#!/usr/bin/env node
/**
 * skills/diff/scripts/content-diff.mjs
 *
 * Prototype ↔ EDS STRUCTURAL content + typography reconcile for the
 * stardust:deploy skill (Step 10, run alongside visual-diff.mjs).
 *
 * visual-diff.mjs reasons about PIXELS via heuristics (stretch / flush / blank /
 * colour) — it is structurally blind to "the right text is in the wrong slot" or
 * "one CTA is gone": the pixels are full, the colours plausible, nothing looks
 * blank, so no flag fires. Those are the failures it kept missing (the-people
 * eyebrow↔body swap #76, the dropped the-place CTA, the typography fork #77).
 *
 * This tool adds the missing layer: it extracts an ORDERED, role-classified
 * inventory of every text-bearing node ({role, text, href, alt}) from each page's
 * <main>, classifying by COMPUTED STYLE + tag (symmetric across the prototype's
 * .ds-* DOM and the EDS block DOM), then DIFFS the two inventories:
 *   - MISSING   a proto heading / CTA / eyebrow with no EDS match   (🔴 structural)
 *   - ROLE SWAP same text present but under a different role         (🔴 the #76 class)
 *   - MISSING BODY / EXTRA  body copy dropped / invented             (🟡 advisory)
 *   - FONT DIFF a matched line whose rendered FACE differs           (🟠 width probe, #77)
 *
 * Font detection uses a WIDTH PROBE, never document.fonts.check (which returns
 * true for any family name the page references, installed or not — #77): the same
 * normalised string at a fixed size under each element's computed family+weight;
 * a materially different width across pages ⇒ a different actual face.
 *
 * Usage:
 *   node skills/diff/scripts/content-diff.mjs <prototypeURL> <edsURL> [options]
 *     --main <selector>     content root to compare        (default "main")
 *     --width <px>          viewport width                 (default 1280)
 *     --json                also print the two raw inventories
 *     --ua <string>         user agent                     (default: real-Chrome desktop UA)
 *     --wait-until <state>  goto wait state override. Default rule: 'domcontentloaded'
 *                           for http(s) URLs that are NOT localhost/127.0.0.1 (live
 *                           sites with analytics beacons never reach networkidle),
 *                           'networkidle' otherwise (local/prototype targets keep
 *                           the original behavior). Decided per URL side.
 *     --dismiss [sel,...]   dismiss overlays on both sides via live-session
 *                           (consent + timed marketing modals), plus these extra
 *                           site-specific selectors (optional)
 *     --headed              escalation: headed stealth real Chrome (bot-managed sites)
 *     --locale <tag>        pin Accept-Language + context locale (geo-redirect determinism)
 *
 * Every context gets the real-Chrome UA + the standard request headers via
 * live-session.mjs (UA alone still 403s on Akamai — F-R1). A bot-management
 * challenge on either navigation FAILS LOUD (exit 3) — a challenge page must
 * never be measured as the source.
 *
 * Exit codes: 0 ran (flags are advisory, they do NOT fail the run), 1 error,
 * 3 bot challenge/blocked live side (BotChallengeError — escalate with --headed).
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, newline-per-chained-call, no-continue, no-multi-spaces */
/* standalone dev tool: playwright is a devDependency; sequential page ops use awaited loops by design */
import { chromium } from 'playwright';
import { resolveProfile } from './diff-profiles.mjs';
import { REAL_CHROME_UA, isLiveHttpUrl, launchStealthHeaded, newLiveContext, gotoLive, dismissOverlays } from './live-session.mjs';

const USAGE = `usage: node skills/diff/scripts/content-diff.mjs <sourceURL> <buildURL> [options]
  --profile eds|generic  stack profile (default eds)
  --main <sel>           content root (default from profile)
  --width <px>           viewport width (default 1280)
  --json                 also print the two raw inventories
  --ua <string>          user agent (default: real-Chrome desktop UA)
  --wait-until <state>   goto wait state. Default: domcontentloaded for non-localhost
                         http(s) URLs (live sites never reach networkidle), networkidle
                         for localhost/127.0.0.1 (unchanged local behavior). Per-URL.
  --dismiss [sel,...]    dismiss overlays (consent + timed marketing modals) on both
                         sides; optional comma-separated extra selectors
  --headed               headed stealth real Chrome (escalation for bot-managed sites)
  --locale <tag>         pin Accept-Language + locale (e.g. en-GB) for geo determinism
exit codes: 0 ran (flags advisory), 1 error, 3 bot challenge (live side blocked — fail loud)
`;

// live http(s) targets default to domcontentloaded; local targets keep networkidle.
const defaultWaitUntil = (url) => (isLiveHttpUrl(url) ? 'domcontentloaded' : 'networkidle');

function parseArgs(argv) {
  const [, , proto, eds, ...rest] = argv;
  if (rest.includes('--help') || proto === '--help' || proto === '-h') { process.stdout.write(USAGE); process.exit(0); }
  const opts = { main: null, width: 1280, json: false, profile: 'eds', ua: REAL_CHROME_UA, waitUntil: null, dismiss: null, headed: false, locale: null };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--main') { opts.main = rest[i += 1]; }
    else if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--json') { opts.json = true; }
    else if (a === '--profile') { opts.profile = rest[i += 1]; }
    else if (a === '--ua') { opts.ua = rest[i += 1]; }
    else if (a === '--wait-until') { opts.waitUntil = rest[i += 1]; }
    else if (a === '--dismiss') {
      // optional value: bare --dismiss enables overlay dismissal with no extras
      const next = rest[i + 1];
      opts.dismiss = (next && !next.startsWith('--')) ? rest[i += 1].split(',').map((s) => s.trim()).filter(Boolean) : [];
    }
    else if (a === '--headed') { opts.headed = true; }
    else if (a === '--locale') { opts.locale = rest[i += 1]; }
  }
  return { proto, eds, opts };
}

// Runs IN the page (serialized by Playwright, so it takes ONE arg). args =
// [mainSel, eyebrow{maxFontPx,maxLen}] — the content root + label classifier
// thresholds from the active profile. Returns the role-classified inventory.
/* eslint-disable no-undef */
function inventory(args) {
  const [mainSel, eyebrow] = args;
  const root = document.querySelector(mainSel) || document.querySelector('main') || document.body;
  const ARROWS = /[→➔➜›⇒➤>]+/g;
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  // match key: lowercase, arrows + trailing punctuation stripped, whitespace collapsed.
  const norm = (s) => clean(s).replace(ARROWS, ' ').replace(/\s+/g, ' ').trim()
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
/* eslint-enable no-undef */

async function grab(browser, url, opts, prof) {
  // UA + standard headers on EVERY context (live-session; F-R1 — UA alone
  // still 403s on Akamai), webdriver spoof included for the --headed tier.
  const ctx = await newLiveContext(browser, {
    ua: opts.ua, locale: opts.locale,
    viewport: { width: opts.width, height: 1000 },
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  // challenge detection on every navigation — a blocked live side throws
  // BotChallengeError (exit 3), it is never measured as the source.
  await gotoLive(page, url, { waitUntil: opts.waitUntil || defaultWaitUntil(url), timeoutMs: 60000, settleMs: 0 });
  await page.waitForTimeout(1500);
  // late-modal poll window only on live targets — local prototypes' overlays
  // are not timed third-party scripts, they render immediately.
  if (opts.dismiss) await dismissOverlays(page, { extra: opts.dismiss, lateWindowMs: isLiveHttpUrl(url) ? 6000 : 0 });
  // scroll through to trigger reveal-on-scroll / lazy nodes, then return to top
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 40); }); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(400);
  const inv = await page.evaluate(inventory, [opts.main || prof.mainDefault, prof.eyebrow]);
  await ctx.close();
  return inv;
}

// Diff: consume each source item against the first unused target item with the
// same key (duplicates count correctly), classifying the outcome by role. All
// stack-specific labels (S/T) + remediation hints (H) come from the profile.
function diff(srcItems, tgtItems, prof) {
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

function summarise(inv) {
  const by = (r) => inv.items.filter((x) => x.role === r).length;
  return `${inv.items.length} text nodes — ${by('heading')} headings, ${by('eyebrow')} eyebrows, ${by('cta')} CTAs, ${by('body')} body; ${inv.imgCount} img`;
}

async function main() {
  const { proto, eds, opts } = parseArgs(process.argv);
  if (!proto || !eds) {
    process.stderr.write(USAGE);
    process.exit(1);
  }
  const prof = resolveProfile(opts.profile);
  const browser = opts.headed ? await launchStealthHeaded(chromium) : await chromium.launch();
  let srcInv; let tgtInv;
  try {
    srcInv = await grab(browser, proto, opts, prof);
    tgtInv = await grab(browser, eds, opts, prof);
  } finally {
    await browser.close();
  }

  const { flags } = diff(srcInv.items, tgtInv.items, prof);
  process.stdout.write(`\nContent diff @ ${opts.width}px (profile "${prof.name}", root "${opts.main || prof.mainDefault}")\n`);
  process.stdout.write(`  ${prof.source}: ${summarise(srcInv)}\n`);
  process.stdout.write(`  ${prof.target}: ${summarise(tgtInv)}\n`);

  if ((srcInv.items.length < 3 || tgtInv.items.length < 3)) {
    process.stdout.write('\n⚠ one side has almost no content — a blank/failed render; fix that before trusting the diff.\n');
  }

  const order = { '🔴': 0, '🟠': 1, '🟡': 2 };
  flags.sort((a, b) => order[a.sev] - order[b.sev]);
  const strong = flags.filter((f) => f.sev === '🔴').length;
  process.stdout.write(`\nFindings: ${flags.length ? `${flags.length} (${strong} structural 🔴)` : 'none — content + roles match'}\n`);
  flags.forEach((f) => process.stdout.write(`  ${f.sev} ${f.kind}: ${f.msg}\n`));

  if (opts.json) {
    process.stdout.write('\nInventories JSON:\n');
    process.stdout.write(`${JSON.stringify({ [prof.source]: srcInv, [prof.target]: tgtInv }, null, 1)}\n`);
  }
}

// exit 3 = bot challenge on a live side (distinct from generic errors, so a
// gate runner can tell "blocked — escalate with --headed" from "probe broke").
main().catch((e) => { process.stderr.write(`content-diff error: ${e.message}\n`); process.exit(e.name === 'BotChallengeError' ? 3 : 1); });
