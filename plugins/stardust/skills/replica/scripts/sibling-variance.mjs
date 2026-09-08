#!/usr/bin/env node
/**
 * skills/replica/scripts/sibling-variance.mjs
 *
 * Live-variance probe for sibling fan-out: BEFORE cloning a gated archetype
 * onto its "same-template" siblings, measure the template-defining computed
 * values on each sibling's LIVE page and diff them against the archetype's.
 * Vendor templates are not constant: eight siblings of one gated archetype
 * varied in ways the crawl JSON never showed — a compact hero (441 vs 528px,
 * wider card, smaller logo), an INVERTED hero scrim (0.6→0.1 vs 0.1→0.5), list
 * bullets split into two visual families (arrow-image `::before` vs plain
 * disc), terms sections in three shapes. Each delta found here is first-class
 * work to budget — a block VARIANT class emitted by the sibling generator —
 * not an edge case discovered at the pixel gate. The probe is read-only
 * evidence; it changes nothing in the clone.
 * Content is not variance: image and background url() FILENAMES are ignored
 * (a sibling's own photo is the source's choice — replicate it); only the
 * layer stack, geometry and computed styles are compared.
 *
 * Usage:
 *   node skills/replica/scripts/sibling-variance.mjs <archetypeURL> <siblingURL> [<siblingURL>…] [options]
 *     --probe <name>=<sel>   template-defining element to compare (repeatable). For
 *                            each: match count, first match's rect + the computed
 *                            group (background layers, colour, padding, font
 *                            size/weight/line-height, radius), its first heading,
 *                            its first image, list-style + `::before` mechanism,
 *                            and — when the selector matches several elements —
 *                            the number of distinct style clusters among them.
 *                            Default when none given: hero = first section of
 *                            --main; card = the most repeated element class in
 *                            the page; li = "main li".
 *     --main <sel>           content root (default main) — also probes the
 *                            section list ([label, height] per top-level section)
 *     --width <px>           viewport width                    (default 1440)
 *     --tolerance <px>       ignore numeric deltas ≤ this      (default 2)
 *     --consent <sel>        extra consent-accept selector
 *     --dismiss <sel,…>      extra overlay-dismiss selectors
 *     --headed               headed stealth real Chrome (bot-managed sites)
 *     --locale <tag>         pin Accept-Language + locale
 *     --json                 machine-readable output
 *
 * Exit codes: 0 every sibling matches the archetype within tolerance, 2 variance
 * found (budget it), 1 error, 3 bot challenge (fail loud — never measured).
 * Every URL is one live navigation: probe a template's siblings in ONE run and
 * keep the JSON as the fan-out brief's evidence.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, no-continue */
import { chromium } from 'playwright';
import { existsSync } from 'fs';
import { dirname, resolve as resolvePath } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_SESSION = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs']
  .map((p) => resolvePath(HERE, p)).find((p) => existsSync(p));
if (!LIVE_SESSION) {
  console.error('sibling-variance error: live-session.mjs not found (looked in ../../diff/scripts/ and ../diff/). Copy the diff skill\'s scripts dir alongside this one (replica SKILL.md § Setup).');
  process.exit(1);
}
const { isLiveHttpUrl, launchStealthHeaded, newLiveContext, gotoLive, dismissOverlays, defaultWaitUntil } = await import(pathToFileURL(LIVE_SESSION).href);

const HELP = `sibling-variance — diff template-defining computed values of live siblings against the archetype

Usage: node sibling-variance.mjs <archetypeURL> <siblingURL> [<siblingURL>…] [options]
  --probe <name>=<sel>  template-defining element (repeatable; defaults: hero, card, li)
  --main <sel>          content root (default main)
  --width <px>          viewport width (default 1440)
  --tolerance <px>      ignore numeric deltas ≤ this (default 2)
  --consent <sel>       extra consent-accept selector
  --dismiss <sel,…>     extra overlay-dismiss selectors
  --headed              headed stealth real Chrome
  --locale <tag>        pin Accept-Language + locale
  --json                machine-readable output
  --help                this text

Exit codes: 0 no variance, 2 variance found, 1 error, 3 bot challenge.`;

function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const pos = [];
  const opts = { probes: [], main: 'main', width: 1440, tolerance: 2, consent: null, dismiss: [], headed: false, locale: null, json: false };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--probe') {
      const spec = rest[i += 1] || '';
      const m = spec.match(/^([\w-]+)=(.+)$/);
      if (!m) { console.error(`bad --probe "${spec}" — expected name=<selector>\n\n${HELP}`); process.exit(1); }
      opts.probes.push({ name: m[1], sel: m[2].trim() });
    }
    else if (a === '--main') { opts.main = rest[i += 1]; }
    else if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--tolerance') { opts.tolerance = Number(rest[i += 1]); }
    else if (a === '--consent') { opts.consent = rest[i += 1]; }
    else if (a === '--dismiss') { opts.dismiss = (rest[i += 1] || '').split(',').map((s) => s.trim()).filter(Boolean); }
    else if (a === '--headed') { opts.headed = true; }
    else if (a === '--locale') { opts.locale = rest[i += 1]; }
    else if (a === '--json') { opts.json = true; }
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else pos.push(a);
  }
  if (pos.length < 2) { console.error(`need <archetypeURL> and at least one <siblingURL>\n\n${HELP}`); process.exit(1); }
  return { archetype: pos[0], siblings: pos.slice(1), opts };
}

// ---------------------------------------------------------------- in-page probe

/* eslint-disable no-undef */
function probePage({ probes, main }) {
  const root = document.querySelector(main) || document.body;
  const rect = (el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
  const visible = (el) => el.getClientRects().length > 0;
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const fam = (cs) => (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase();
  // url() filenames are CONTENT (a sibling's own photo — replicate, don't
  // "fix"), never template: layers keep gradients verbatim and reduce every
  // url(...) to a bare `url(…)` marker so only the LAYER STACK is compared.
  const layers = (cs) => (cs.backgroundImage === 'none' ? [] : cs.backgroundImage.split(/,(?![^(]*\))/).map((l) => l.trim().replace(/url\([^)]*\)/g, 'url(…)')));

  // default probes
  const sections = [...root.querySelectorAll(':scope > section, :scope > .section')].filter(visible);
  const firstSection = sections[0] || root.firstElementChild;
  const classCounts = {};
  for (const el of root.querySelectorAll('[class]')) {
    if (!visible(el) || (el.children.length === 0 && !norm(el.textContent))) continue;
    if (['LI', 'A', 'SPAN', 'P', 'IMG', 'SVG', 'PATH', 'BUTTON'].includes(el.tagName)) continue; // atoms, not units
    const c = String(el.className).trim().split(/\s+/)[0];
    if (c) classCounts[c] = (classCounts[c] || 0) + 1;
  }
  const cardClass = Object.entries(classCounts).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const list = probes.length ? probes : [
    { name: 'hero', el: firstSection, sel: '(first section)' },
    ...(cardClass ? [{ name: 'card', sel: `.${cardClass}` }] : []),
    { name: 'li', sel: `${main} li` },
  ];

  const signature = (el) => {
    const cs = getComputedStyle(el);
    const h = el.querySelector('h1, h2, h3, h4');
    const img = el.querySelector('img');
    const before = getComputedStyle(el, '::before');
    const hcs = h ? getComputedStyle(h) : null;
    return {
      rect: rect(el),
      backgroundLayers: layers(cs),
      backgroundColor: cs.backgroundColor,
      color: cs.color,
      padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
      font: `${fam(cs)} ${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight}`,
      borderRadius: cs.borderRadius,
      heading: h ? `${h.tagName.toLowerCase()} ${fam(hcs)} ${hcs.fontSize}/${hcs.lineHeight} ${hcs.fontWeight} ${hcs.color}` : null,
      image: img ? rect(img) : null, // geometry only — the src is content
      listStyle: cs.listStyleType !== 'none' || el.tagName === 'LI' ? cs.listStyleType : null,
      before: (before.content && before.content !== 'none' && before.content !== 'normal') || before.backgroundImage !== 'none'
        ? `content:${before.content.replace(/url\([^)]*\)/g, 'url(…)')} bg:${layers(before).join('|') || 'none'} ${Math.round(parseFloat(before.width) || 0)}x${Math.round(parseFloat(before.height) || 0)}`
        : null,
    };
  };
  const clusterKey = (s) => JSON.stringify({ ...s, rect: undefined, heading: s.heading ? s.heading.replace(/^h\d /, '') : null });

  const out = {
    sections: sections.map((el, i) => ({ label: String(el.className || '').split(/\s+/).filter((c) => c && c !== 'section').slice(0, 2).join('.') || `${el.tagName.toLowerCase()}[${i}]`, h: rect(el).h })),
    probes: {},
  };
  for (const p of list) {
    const els = p.el ? [p.el] : [...document.querySelectorAll(p.sel)].filter(visible);
    if (!els.length) { out.probes[p.name] = { sel: p.sel, count: 0 }; continue; }
    const sigs = els.slice(0, 40).map(signature);
    const clusters = new Set(sigs.map(clusterKey)).size;
    out.probes[p.name] = { sel: p.sel, count: els.length, first: sigs[0], clusters, text: norm(els[0].textContent).slice(0, 60) };
  }
  return out;
}
/* eslint-enable no-undef */

// ------------------------------------------------------------------- diffing

const px = (v) => { const m = String(v).match(/^-?[\d.]+(?=px$)/); return m ? parseFloat(m[0]) : null; };

function diffValue(k, a, b, tol) {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && !Array.isArray(a)) {
    const d = Object.keys({ ...a, ...b }).map((kk) => diffValue(kk, a[kk], b[kk], tol)).filter(Boolean);
    return d.length ? `${k}{${d.join(', ')}}` : null;
  }
  const pa = px(a); const pb = px(b);
  if (pa !== null && pb !== null && Math.abs(pa - pb) <= tol) return null;
  if (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol) return null;
  // padding / font strings: compare token-wise with tolerance
  if (typeof a === 'string' && typeof b === 'string' && a.split(' ').length === b.split(' ').length && a.split(' ').length > 1) {
    const ta = a.split(' '); const tb = b.split(' ');
    const diffTok = ta.some((t, i) => { const x = px(t); const y = px(tb[i]); return x !== null && y !== null ? Math.abs(x - y) > tol : t !== tb[i]; });
    if (!diffTok) return null;
  }
  const show = (v) => (Array.isArray(v) ? `[${v.join(' | ')}]` : String(v));
  return `${k} ${show(a)} → ${show(b)}`;
}

function compare(arch, sib, tol) {
  const findings = [];
  const sa = arch.sections.map((s) => s.label).join(' > '); const sb = sib.sections.map((s) => s.label).join(' > ');
  if (arch.sections.length !== sib.sections.length) findings.push({ kind: 'SECTIONS', msg: `${arch.sections.length} vs ${sib.sections.length} top-level sections (archetype: ${sa || '-'}; sibling: ${sb || '-'}) — a different template family or an extra/missing section` });
  else {
    const hd = arch.sections.map((s, i) => (Math.abs(s.h - sib.sections[i].h) > tol ? `${s.label} ${s.h}→${sib.sections[i].h}` : null)).filter(Boolean);
    if (hd.length) findings.push({ kind: 'SECTION HEIGHTS', msg: hd.join(', ') });
  }
  for (const [name, A] of Object.entries(arch.probes)) {
    const B = sib.probes[name];
    if (!B || !B.count) { if (A.count) findings.push({ kind: 'MISSING', probe: name, msg: `"${A.sel}" matches ${A.count} on the archetype, 0 on the sibling` }); continue; }
    if (!A.count) { findings.push({ kind: 'EXTRA', probe: name, msg: `"${B.sel}" matches 0 on the archetype, ${B.count} on the sibling` }); continue; }
    if (A.count !== B.count) findings.push({ kind: 'COUNT', probe: name, msg: `${A.count} → ${B.count} matches` });
    if (A.clusters !== B.clusters) findings.push({ kind: 'CLUSTERS', probe: name, msg: `${A.clusters} → ${B.clusters} distinct style families among matches (a second visual family = a variant class)` });
    const d = Object.keys(A.first).map((k) => diffValue(k, A.first[k], B.first[k], tol)).filter(Boolean);
    if (d.length) findings.push({ kind: 'PROBE', probe: name, msg: d.join('; ') });
  }
  return findings;
}

// ---------------------------------------------------------------------- main

async function probeUrl(browser, url, opts) {
  const ctx = await newLiveContext(browser, { locale: opts.locale, viewport: { width: opts.width, height: 900 } });
  const page = await ctx.newPage();
  await gotoLive(page, url, { waitUntil: defaultWaitUntil(url), settleMs: isLiveHttpUrl(url) ? 2500 : 1200, solveWindow: opts.headed });
  await dismissOverlays(page, { extra: [...(opts.consent ? [opts.consent] : []), ...opts.dismiss], lateWindowMs: isLiveHttpUrl(url) ? 6000 : 0 });
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += 700) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 80); }); }
    window.scrollTo(0, 0);
    await new Promise((r) => { setTimeout(r, 400); });
  });
  await page.waitForTimeout(500);
  const out = await page.evaluate(probePage, { probes: opts.probes, main: opts.main });
  await ctx.close();
  return out;
}

async function main() {
  const { archetype, siblings, opts } = parseArgs(process.argv);
  const browser = opts.headed ? await launchStealthHeaded(chromium) : await chromium.launch();
  let varying = 0;
  try {
    const A = await probeUrl(browser, archetype, opts);
    const results = [];
    for (const url of siblings) {
      const S = await probeUrl(browser, url, opts);
      const findings = compare(A, S, opts.tolerance);
      if (findings.length) varying += 1;
      results.push({ url, findings, raw: S });
    }
    const probesVarying = [...new Set(results.flatMap((r) => r.findings.map((f) => f.probe || f.kind)))];
    if (opts.json) {
      console.log(JSON.stringify({ archetype, width: opts.width, tolerance: opts.tolerance, probes: Object.fromEntries(Object.entries(A.probes).map(([k, v]) => [k, v.sel])), archetypeRaw: A, siblings: results.map(({ url, findings, raw }) => ({ url, findings, raw })), summary: { siblings: siblings.length, varying, probesVarying } }, null, 2));
    } else {
      console.log(`sibling-variance @ ${opts.width}px, tolerance ${opts.tolerance}px\n  archetype: ${archetype}\n  probes: ${Object.entries(A.probes).map(([k, v]) => `${k}=${v.sel} (${v.count})`).join(', ')}\n  sections: ${A.sections.map((s) => `${s.label}:${s.h}`).join(' > ') || '-'}`);
      for (const r of results) {
        console.log(`\n■ ${r.url}: ${r.findings.length ? `${r.findings.length} delta(s)` : '✓ matches the archetype'}`);
        for (const f of r.findings) console.log(`  ${f.kind.padEnd(16)}${f.probe ? `${f.probe}: ` : ''}${f.msg}`);
      }
      console.log(`\n${varying ? `✗ ${varying} of ${siblings.length} sibling(s) vary from the archetype in: ${probesVarying.join(', ')} — budget variant classes for these before cloning; do not assume template constancy.` : `✓ ${siblings.length} sibling(s) match the archetype within tolerance — clone.`}`);
    }
  } finally {
    await browser.close();
  }
  process.exit(varying ? 2 : 0);
}

main().catch((e) => { console.error(`sibling-variance error: ${e.message}`); process.exit(e.name === 'BotChallengeError' ? 3 : 1); });
