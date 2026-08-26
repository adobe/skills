#!/usr/bin/env node
/**
 * skills/replica/scripts/anchor.mjs
 *
 * Section-anchor probe for the stardust:replica source-fidelity loop: prints
 * `[y, height]` for every top-level section (`main > section` /
 * `main > .section`), the footer, and the document height — one line per
 * box, same shape on the live page and on the build/prototype.
 *
 * Why it exists: the pixel probe's band table says WHERE drift is; this
 * probe says WHICH SECTION owns it. The fastest converging loop in the
 * field (broadridge, 2026-08-25/26 — roughly HALVED iterations vs
 * band-reading alone): run anchor.mjs on both sides, fix the FIRST
 * mismatched section top-down (everything below it is offset-contaminated,
 * same top-down rule as the band table), then re-run pixels. Build-side
 * anchor runs are free — they never navigate the live origin, so they don't
 * consume the live-hit budget (source-fidelity-gate.md § Hit minimization);
 * capture the live side once per fix round at most and diff against it.
 *
 * Hardening: live navigations go through the shared
 * ../../diff/scripts/live-session.mjs (real-Chrome UA + document-scoped
 * standard headers, challenge fail-loud exit 3, overlay dismissal, parked
 * pointer), and the height is read AFTER a slow-scroll settle pass —
 * pre-settle height is fake on entrance-animated sites
 * (recreation-procedure.md § Capture-state).
 *
 * Usage:
 *   node skills/replica/scripts/anchor.mjs <url> [options]
 *     --width <px>        viewport width                    (default 1440)
 *     --main <sel>        content root to probe under       (default main)
 *     --consent <sel>     extra consent-accept selector
 *     --dismiss <sel,...> extra overlay-dismiss selectors
 *     --headed            escalation: headed stealth real Chrome
 *     --locale <tag>      pin Accept-Language + locale (e.g. en-GB)
 *     --json              machine-readable output on stdout
 *
 * Example (one line per section; diff the two outputs side by side):
 *   node scripts/replica/anchor.mjs "https://<site>/<path>" --width 1440
 *   node scripts/replica/anchor.mjs "http://localhost:8791/<slug>-proposed.html" --width 1440
 *
 * Requires: playwright, and the diff skill's scripts dir alongside
 * (live-session.mjs — the replica Setup copies both).
 * Exit codes: 0 printed, 1 error, 3 bot challenge (live side blocked).
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { chromium } from 'playwright';
import { existsSync } from 'fs';
import { dirname, resolve as resolvePath } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// live-session.mjs lives in the diff skill's scripts dir. Two layouts exist:
// the plugin tree (skills/replica/scripts ↔ skills/diff/scripts) and the
// documented project copy (scripts/replica ↔ scripts/diff) — resolve either.
const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_SESSION = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs']
  .map((p) => resolvePath(HERE, p)).find((p) => existsSync(p));
if (!LIVE_SESSION) {
  console.error('anchor error: live-session.mjs not found (looked in ../../diff/scripts/ and ../diff/). Copy the diff skill\'s scripts dir alongside this one (replica SKILL.md § Setup).');
  process.exit(1);
}
const { isLiveHttpUrl, launchStealthHeaded, newLiveContext, gotoLive, dismissOverlays, defaultWaitUntil } = await import(pathToFileURL(LIVE_SESSION).href);

const HELP = `anchor — per-section [y, height] probe (run on BOTH sides, fix the first mismatch top-down)

Usage: node anchor.mjs <url> [options]
  --width <px>      viewport width (default 1440)
  --main <sel>      content root to probe under (default main)
  --consent <sel>   extra consent-accept selector (clicked, not removed)
  --dismiss <sel,…> extra overlay-dismiss selectors
  --headed          headed stealth real Chrome (escalation for bot-managed sites)
  --locale <tag>    pin Accept-Language + locale (e.g. en-GB)
  --json            machine-readable output
  --help            this text

Exit codes: 0 printed, 1 error, 3 bot challenge (live side blocked — fail loud).`;

function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const pos = [];
  const opts = { width: 1440, main: 'main', consent: null, dismiss: [], headed: false, locale: null, json: false };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--main') { opts.main = rest[i += 1]; }
    else if (a === '--consent') { opts.consent = rest[i += 1]; }
    else if (a === '--dismiss') { opts.dismiss = (rest[i += 1] || '').split(',').map((s) => s.trim()).filter(Boolean); }
    else if (a === '--headed') { opts.headed = true; }
    else if (a === '--locale') { opts.locale = rest[i += 1]; }
    else if (a === '--json') { opts.json = true; }
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else pos.push(a);
  }
  const [url] = pos;
  if (!url) { console.error(`need <url>\n\n${HELP}`); process.exit(1); }
  return { url, opts };
}

async function main() {
  const { url, opts } = parseArgs(process.argv);
  const browser = opts.headed ? await launchStealthHeaded(chromium) : await chromium.launch();
  try {
    const ctx = await newLiveContext(browser, { locale: opts.locale, viewport: { width: opts.width, height: 900 } });
    const page = await ctx.newPage();
    await gotoLive(page, url, { waitUntil: defaultWaitUntil(url), settleMs: isLiveHttpUrl(url) ? 2500 : 1200, solveWindow: opts.headed });
    await dismissOverlays(page, { extra: [...(opts.consent ? [opts.consent] : []), ...opts.dismiss], lateWindowMs: isLiveHttpUrl(url) ? 6000 : 0 });

    // Slow-scroll settle before measuring — pre-settle heights are fake on
    // entrance-animated / lazy-loading pages (recreation-procedure.md
    // § Capture-state), and the boxes must be read at rest from the top.
    await page.evaluate(async () => {
      const h = document.documentElement.scrollHeight;
      for (let y = 0; y < h; y += 700) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 80); }); }
      window.scrollTo(0, 0);
      await new Promise((r) => { setTimeout(r, 400); });
    });
    await page.waitForTimeout(600);

    const out = await page.evaluate((rootSel) => {
      const box = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.y + window.scrollY), Math.round(r.height)]; };
      const root = document.querySelector(rootSel) || document.body;
      // top-level sections: <section> children and .section-classed children
      // (EDS emits div.section) — plain divs excluded to keep the two sides'
      // lists comparable at the granularity the replica authors at.
      const nodes = [...root.querySelectorAll(':scope > section, :scope > .section')];
      const label = (el, i) => {
        const cls = String(el.className || '').split(/\s+/).filter((c) => c && c !== 'section').slice(0, 2).join('.');
        return cls || `${el.tagName.toLowerCase()}[${i}]`;
      };
      const footer = document.querySelector('footer');
      return {
        doc: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
        sections: nodes.map((el, i) => ({ label: label(el, i), box: box(el) })),
        footer: footer ? box(footer) : null,
      };
    }, opts.main);

    if (opts.json) {
      console.log(JSON.stringify({ url, width: opts.width, ...out }, null, 2));
    } else {
      console.log(`doc height ${out.doc}px  (${url} @ ${opts.width})`);
      for (const s of out.sections) console.log(`  y ${String(s.box[0]).padStart(6)}  h ${String(s.box[1]).padStart(5)}  ${s.label}`);
      if (out.footer) console.log(`  y ${String(out.footer[0]).padStart(6)}  h ${String(out.footer[1]).padStart(5)}  footer`);
    }
  } finally {
    await browser.close();
  }
}

// exit 3 = bot challenge on the live side (fail loud, never measured).
main().catch((e) => { console.error(`anchor error: ${e.message}`); process.exit(e.name === 'BotChallengeError' ? 3 : 1); });
