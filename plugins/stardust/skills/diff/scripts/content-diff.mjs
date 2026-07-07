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
 * The classifier + differ live in content-inventory.mjs (SHARED with the deploy
 * skill's pre-code section-schema #93 and in-loop block-roundtrip #94 gates, so
 * every fidelity gate measures with the same instrument).
 *
 * Usage:
 *   node skills/diff/scripts/content-diff.mjs <prototypeURL> <edsURL> [options]
 *     --main <selector>     content root to compare        (default "main")
 *     --width <px>          viewport width                 (default 1280)
 *     --json                also print the two raw inventories
 *     --ua <string>         user agent                     (default: real-Chrome desktop UA)
 *     --wait-until <state>  goto wait state override. Default rule (three tiers,
 *                           decided per URL side by live-session's defaultWaitUntil):
 *                           localhost/127.0.0.1 → 'networkidle'; EDS build/preview
 *                           origins (*.aem.page, *.aem.live, *.hlx.page, *.hlx.live)
 *                           → 'networkidle' (they decorate async — measuring at
 *                           domcontentloaded reads the pre-decoration DOM); all
 *                           other live http(s) → 'domcontentloaded' (analytics
 *                           beacons never reach networkidle).
 *     --dismiss [sel,...]   dismiss overlays on both sides via live-session
 *                           (consent + timed marketing modals), plus these extra
 *                           site-specific selectors (optional)
 *     --headed              escalation: headed stealth real Chrome (bot-managed sites)
 *     --locale <tag>        pin Accept-Language + context locale (geo-redirect determinism)
 *
 * Every context gets the real-Chrome UA + the standard request headers via
 * live-session.mjs (UA alone still 403s on Akamai — F-R1). A bot-management
 * challenge on either navigation FAILS LOUD (exit 3) — a challenge page must
 * never be measured as the source. A plain HTTP error (e.g. a 404 build side
 * before preview propagation) is NOT fatal: it is measured with a loud
 * warning and the flags reflect it — the advisory contract Step 10 relies on.
 *
 * Exit codes: 0 ran (flags are advisory, they do NOT fail the run — an
 * HTTP-error side is measured + flagged, not fatal), 1 error, 3 bot
 * challenge/blocked live side (BotChallengeError — escalate with --headed).
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, newline-per-chained-call, no-continue, no-multi-spaces */
/* standalone dev tool: playwright is a devDependency; sequential page ops use awaited loops by design */
import { chromium } from 'playwright';
import { resolveProfile } from './diff-profiles.mjs';
import { inventory, diffInventories, summarise } from './content-inventory.mjs';
import { REAL_CHROME_UA, isLiveHttpUrl, defaultWaitUntil, launchStealthHeaded, newLiveContext, gotoLive, dismissOverlays } from './live-session.mjs';

const USAGE = `usage: node skills/diff/scripts/content-diff.mjs <sourceURL> <buildURL> [options]
  --profile eds|generic  stack profile (default eds)
  --main <sel>           content root (default from profile)
  --width <px>           viewport width (default 1280)
  --json                 also print the two raw inventories
  --ua <string>          user agent (default: real-Chrome desktop UA)
  --wait-until <state>   goto wait state. Default (per URL side, three tiers):
                         networkidle for localhost/127.0.0.1; networkidle for EDS
                         build/preview origins (*.aem.page, *.aem.live, *.hlx.page,
                         *.hlx.live — they decorate async); domcontentloaded for all
                         other live http(s) (never reach networkidle).
  --dismiss [sel,...]    dismiss overlays (consent + timed marketing modals) on both
                         sides; optional comma-separated extra selectors
  --headed               headed stealth real Chrome (escalation for bot-managed sites)
  --locale <tag>         pin Accept-Language + locale (e.g. en-GB) for geo determinism
exit codes: 0 ran (flags advisory; an HTTP-error side, e.g. a 404 build pre-propagation,
            is measured + flagged with a warning, not fatal), 1 error,
            3 bot challenge (live side blocked — fail loud)
`;

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
  // BotChallengeError (exit 3), it is never measured as the source. A plain
  // HTTP error side is MEASURED (advisory contract): a 404 build is normal on
  // aem.page before preview propagation — the flags carry the signal, exit 0.
  // solveWindow only under --headed: headless clearance never lands, and the
  // solve loop would spend the Akamai block budget (1 hit vs up to 4).
  await gotoLive(page, url, { waitUntil: opts.waitUntil || defaultWaitUntil(url), timeoutMs: 60000, settleMs: 0, httpError: 'measure', solveWindow: opts.headed });
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

  const { flags } = diffInventories(srcInv.items, tgtInv.items, prof);
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
