#!/usr/bin/env node
/**
 * skills/deploy/scripts/qa-gate.mjs — the stock Local-QA assertion gate (#101).
 *
 * Three e2e runs showed every conversion hand-rolling an ad-hoc probe.mjs
 * (~3–5 min each) asserting the same invariants the section schema already
 * encodes. This is that probe, bundled: point it at the HARNESS page (through
 * the dev server) and the page's eds-schema JSON and it asserts the whole
 * decoration contract in one run.
 *
 *   node skills/deploy/scripts/qa-gate.mjs http://localhost:3000/stardust/.work/harness/page.html \
 *        --schema stardust/eds-schema/<page>.json [--maxw 1340] [--marker <s>] [--no-drive]
 *
 * Served identity FIRST (exit 4 = no verdict, never a FAIL): before any page read the harness origin must
 * be THIS project's — `replica/scripts/served-identity.mjs assertServedIdentity()` checks
 * `/stardust/.work/harness/marker.txt` (written by build-harness.mjs), then the page body for the marker,
 * then the schema's block names. `--marker <s>` overrides the marker read from stardust/.work/harness/marker.txt;
 * with neither, identity is not asserted (one line says so). Ports: `aem up --port $(node
 * skills/replica/scripts/port.mjs harness)` — never a typed 3000 (harness-quirks.md § Ports).
 * Arguments (schema-checks.mjs parseQaGateArgs): the URL is the one positional, wherever it sits; every value
 * flag refuses a following `--flag`; an unknown flag is usage — exit 2, no browser launched.
 *
 * Asserts (FAIL → exit 1):
 *   - the runtime booted: body.appear present (a blank render = harness bug, #40)
 *   - exactly one <h1>, no heading nested inside it (#35/#55)
 *   - >0 sections; every [data-block-name] reaches data-block-status="loaded"
 *   - zero pageerror events; zero broken images (loaded but naturalWidth 0)
 *   - every block instance renders non-empty (height > 5px, has child elements)
 *   - schema unit counts: each schema section with repeats count N≥2 renders
 *     ≥N units in its matching page section (grid/flex children or unit-level
 *     headings — the 1-of-N / 0-of-N segmentation collapse, #48/#52/#62)
 *   - wide-viewport (#13, second pass at 1600px): block content boxes stay
 *     ≤ --maxw unless the block is genuinely full-bleed in the schema order —
 *     over-wide boxes print as WARN (cross-check against the prototype).
 *   - generic-with-structure (T28.4, audit-and-naming.md § 2b): a schema section triaged to default
 *     content (`defaultContent: true`) whose measured `structure` has interactive descendants or ≥ 2
 *     columns, and whose page section (matched by order over the schema's non-chrome sections) renders
 *     with no `[data-block-name]` — prose cannot carry a tab strip or a side-by-side layout. FAIL; the
 *     recorded object form `"defaultContent": { "reason", "dynamicsRow" }` prints it as ⚠ instead. No
 *     `--allow-*` flag; hands-off never writes the reason.
 *   - h1Section (T21.2): the authored <h1> still sits in its authored section — schema `hasH1` index
 *     vs the rendered `main .section` holding the <h1>. A mismatch is a FAIL when
 *     stardust/runtime-contract.json#autoBlocks is non-empty (a builder moved it), else a WARN.
 *   - full-bleed pass (the INVERSE of #13): for blocks rendered edge-to-edge,
 *     the block's section wrapper must compute the full viewport width. The
 *     list is derived from the loaded block CSS — every [data-block-name] whose
 *     own /blocks/<name>/<name>.css sets `max-width: none` on the block or its
 *     wrapper/container; --full-bleed a,b overrides the derived list. A template-level cap (`main > .section > div { max-width }`) that
 *     out-specifies the block's own `max-width: none` squeezes heroes, dark
 *     bands and card grids into a capped column with white gutters — it reads
 *     as a block bug and shipped three times before the template rule was
 *     found. WARN with the measured widths (cross-check the template CSS).
 *
 *   - control pass (#28, T20.2): every [aria-label*=next i], [aria-label*=previous i],
 *     .dots button, [aria-expanded], [role=tab], summary inside a [data-block-name]
 *     is clicked once (dynamics lib.mjs driveControl — one helper, shared with
 *     dynamics-check `click-control`); disabled / aria-disabled / zero-box
 *     controls are SKIP; a control after which no observable changed
 *     (aria-expanded, aria-selected, hidden, open, scrollLeft, a transform,
 *     the block className) prints `control <sel> in block <name>: no observable
 *     changed`. 🟡 ADVISORY this release (WARN, exit unchanged) — B30 "no
 *     behaviour assertion" stands until the owner answers the D15 re-proposal;
 *     then the line becomes FAIL. `--no-drive` skips the pass (one WARN says so).
 *
 * Deliberately NOT here: CLS (deployed-URL only — the harness false-passes,
 * #100/#101) and content/visual-diff (Step 10, deployed-URL only).
 */
/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax */
// Dependencies through the resolution chain (skills/stardust/scripts/lib/resolve.mjs — runtime-preflight.md
// § Resolution chain): plugin layout, then a project copy made as a set (harness-permissions.md § Two classes);
// a lone copy without the helper falls back to the bare import it resolved before. A miss at every link is one
// line naming preflight-runtime.mjs, exit 2 (no verdict — the same class as 124).
const CHAIN = await (async () => { for (const c of ['../../stardust/scripts/lib/resolve.mjs', '../stardust/lib/resolve.mjs']) { try { return await import(new URL(c, import.meta.url)); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; } } return null; })();
const loadDep = (name) => (CHAIN ? CHAIN.resolveDep(name, { from: import.meta.url }) : import(name).then((m) => ('module.exports' in m ? m['module.exports'] : (m.default && Object.keys(m).every((k) => k === 'default' || k === '__esModule' || k in m.default) ? m.default : m))));
const preflightExit = (e) => { console.error(e.message); process.exit(2); };
const { chromium } = await loadDep('playwright').catch(preflightExit);
import fs from 'fs';
import { assertServedIdentity } from '../../replica/scripts/served-identity.mjs';
import { driveControl } from '../../dynamics/scripts/lib.mjs';
import { flagGenericWithStructure, h1SectionVerdict, parseQaGateArgs } from './schema-checks.mjs';

const qa = parseQaGateArgs(process.argv.slice(2)); // value flags refuse a following --flag; the URL is the first positional that is not a flag's value
const { url, schema: schemaPath, maxw, fullBleed: fullBleedOpt, noDrive } = qa;
if (qa.error || !url) { if (qa.error) console.error(`qa-gate: ${qa.error}`); console.error('usage: qa-gate.mjs <harnessURL> [--schema <eds-schema.json>] [--maxw 1340] [--full-bleed hero,band] [--marker <s>] [--no-drive]'); process.exit(2); }
const schema = schemaPath ? JSON.parse(fs.readFileSync(schemaPath, 'utf8')) : null;

// Served identity before any read: the server on that port must be ours (exit 4 = no verdict, never a FAIL).
const MARKER_FILE = 'stardust/.work/harness/marker.txt';
const marker = qa.marker || (fs.existsSync(MARKER_FILE) ? fs.readFileSync(MARKER_FILE, 'utf8').trim() : null);
if (marker) {
  try {
    const id = await assertServedIdentity(url, marker, { fallbackNames: schema ? (schema.sections || []).map((s) => s.section) : [] });
    console.log(`identity: ${url} is ours (via ${id.via})`);
  } catch (e) {
    if (e.code === 4) { console.error(`qa-gate: ${e.message}`); process.exit(4); }
    throw e;
  }
} else console.log(`identity: not asserted — pass --marker <s> or build the harness first (${MARKER_FILE})`);

const fails = [];
const warns = [];
const ok = [];
const check = (cond, label, detail = '') => (cond ? ok : fails).push(`${label}${detail ? ` — ${detail}` : ''}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
// let lazy sections load
await page.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 60); }); }
  window.scrollTo(0, 0);
});
await page.waitForTimeout(1200);

const r = await page.evaluate(() => {
  const out = {};
  out.appear = document.body.classList.contains('appear');
  out.h1 = document.querySelectorAll('h1').length;
  out.h1Nested = document.querySelectorAll('h1 h1, h1 h2, h1 h3, h1 h4, h1 h5, h1 h6').length;
  out.sections = document.querySelectorAll('main .section').length;
  out.blocks = [...document.querySelectorAll('[data-block-name]')].map((b) => {
    const rect = b.getBoundingClientRect();
    const containers = [b, ...b.querySelectorAll('*')].filter((e) => ['grid', 'flex'].includes(getComputedStyle(e).display));
    const cand = containers[0] || null;
    // the repeating container is the DENSEST grid/flex, not the first (an
    // outer 2-col layout wrapping a 5-item rail would otherwise read as 2)
    const unitCount = containers.reduce((m, e) => Math.max(m, e.children.length), 0);
    // tag-level unit proxies (the schema's unitSelector tag maps to these)
    const tagCounts = {
      article: b.querySelectorAll('article').length,
      li: b.querySelectorAll('li').length,
      figure: b.querySelectorAll('figure').length,
      details: b.querySelectorAll('details').length, // accordions/FAQ units (was a false-negative "units 0")
    };
    const headingUnits = b.querySelectorAll('h3, h4, h5').length;
    return {
      name: b.dataset.blockName,
      status: b.dataset.blockStatus,
      height: Math.round(rect.height || b.scrollHeight),
      kids: b.childElementCount,
      layout: cand ? getComputedStyle(cand).display : 'block-only',
      unitCount,
      headingUnits,
      tagCounts,
    };
  });
  // content.da.live / admin.da.live are auth-gated → 401 to an anon harness browser,
  // so they read as "broken" locally though they ingest fine (was a false-negative).
  // The delivered-URL check (B1 .plain.html about:error / img-count) is the real image gate.
  out.brokenImgs = [...document.querySelectorAll('img')]
    .filter((i) => !/(content|admin)\.da\.live/.test(i.currentSrc || i.src || ''))
    .filter((i) => i.complete && !i.naturalWidth).length;
  // page sections that hold blocks, in order (for schema matching)
  out.blockSections = [...document.querySelectorAll('main .section')]
    .filter((s) => s.querySelector('[data-block-name]'))
    .map((s) => {
      const b = s.querySelector('[data-block-name]');
      return { block: b.dataset.blockName };
    });
  // every main section in order: its first block name (null = default content) and whether it holds the <h1>
  out.mainSections = [...document.querySelectorAll('main .section')].map((s) => ({ block: s.querySelector('[data-block-name]') ? s.querySelector('[data-block-name]').dataset.blockName : null, hasH1: !!s.querySelector('h1') }));
  return out;
});

check(r.appear, 'body.appear set (runtime booted)');
check(r.h1 === 1, 'exactly one <h1>', `found ${r.h1}`);
check(r.h1Nested === 0, 'no heading nested inside <h1>', `found ${r.h1Nested}`);
check(r.sections > 0, 'main .section count > 0', `${r.sections} sections`);
check(pageErrors.length === 0, 'zero pageerror events', pageErrors.slice(0, 3).join(' | '));
check(r.brokenImgs === 0, 'zero broken images', `${r.brokenImgs} broken`);
for (const b of r.blocks) {
  check(b.status === 'loaded', `block ${b.name} loaded`, `status=${b.status}`);
  check(b.height > 5 && b.kids > 0, `block ${b.name} renders non-empty`, `h=${b.height} kids=${b.kids}`);
}

// control pass (#28, T20.2) — click once, one observable must change. 🟡 advisory
// this release (D15 pending): the dead-control line is a WARN, never a FAIL.
const CONTROL_SELECTOR = '[data-block-name] :is([aria-label*="next" i], [aria-label*="previous" i], .dots button, [aria-expanded], [role="tab"], summary)';
if (noDrive) warns.push('control pass skipped (--no-drive) — dead controls are not detected this run');
else {
  const n = await page.evaluate((sel) => { const els = [...document.querySelectorAll(sel)].slice(0, 24); els.forEach((el, i) => el.setAttribute('data-sd-ctl', String(i))); return els.length; }, CONTROL_SELECTOR);
  let dead = 0;
  for (let i = 0; i < n; i += 1) {
    let d; try { d = await driveControl(page, `[data-sd-ctl="${i}"]`); } catch (e) { warns.push(`control ${i}: drive error — ${String(e.message).slice(0, 80)}`); continue; }
    if (!d.found) continue;
    if (d.skipped) ok.push(`control ${d.label} in block ${d.block}: skipped (${d.skipped})`);
    else if (d.changed) ok.push(`control ${d.label} in block ${d.block}: ${d.by} changed`);
    else { dead += 1; warns.push(`control ${d.label} in block ${d.block}: no observable changed (🟡 advisory this release — D15; becomes FAIL once answered)`); }
    await page.keyboard.press('Escape').catch(() => {});
  }
  ok.push(`control pass: ${n} control(s) driven, ${dead} dead`);
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('[data-sd-ctl]').forEach((el) => el.removeAttribute('data-sd-ctl')); });
}

// schema unit counts — match Nth block-bearing page section to Nth schema
// section that has repeats is fragile; match by ORDER over all schema sections.
if (schema && Array.isArray(schema.sections)) {
  const withRepeats = schema.sections
    .map((s, i) => ({ ...s, i }))
    .filter((s) => (s.repeats || []).some((rep) => rep.count >= 2));
  // page block instances in DOM order:
  const instances = r.blocks.filter((b) => !['header', 'footer'].includes(b.name));
  // schema sections (excluding chrome) in order:
  const protoSections = schema.sections.filter((s) => !['header', 'footer'].includes(s.section));
  withRepeats.forEach((s) => {
    const pos = protoSections.indexOf(protoSections.find((x) => x.section === s.section));
    const inst = instances[pos];
    if (!inst) { warns.push(`schema section "${s.section}" (repeats) has no matching page block by order — verify manually`); return; }
    const want = Math.max(...s.repeats.map((rep) => rep.count));
    // schema-informed proxy: the unitSelector's TAG (proto classes don't survive
    // conversion, the semantic tag usually does), else densest grid / headings
    const tags = s.repeats.map((rep) => (rep.unitSelector || '').split('.')[0].toLowerCase()).filter(Boolean);
    const tagGot = Math.max(0, ...tags.map((t) => (inst.tagCounts || {})[t] || 0));
    const got = Math.max(inst.unitCount, inst.headingUnits, tagGot);
    check(got >= want, `units: "${s.section}" → block ${inst.name} renders ≥${want}`, `rendered ${got} (grid kids ${inst.unitCount} / unit headings ${inst.headingUnits} / tag ${tagGot})`);
  });
}

// generic-with-structure (T28.4) + h1Section (T21.2) — judged in schema-checks.mjs; the schema's non-chrome
// sections bind to `main .section` by order (the same binding the unit-count pass uses).
if (schema && Array.isArray(schema.sections)) {
  const protoSections = schema.sections.filter((s) => !['header', 'footer'].includes(s.section));
  for (const f of flagGenericWithStructure({ sections: protoSections })) {
    const pos = protoSections.findIndex((s) => s.section === f.section);
    const sec = r.mainSections[pos];
    if (!sec) { warns.push(`generic-with-structure: schema section "${f.section}" (${f.facts}) has no page section #${pos + 1} by order — verify manually`); continue; }
    if (sec.block) { ok.push(`generic-with-structure: "${f.section}" (${f.facts}) renders as block ${sec.block}`); continue; }
    if (f.reason || f.dynamicsRow) { warns.push(`generic-with-structure: "${f.section}" has ${f.facts} and renders as default content — recorded: ${f.dynamicsRow ? `dynamics row ${f.dynamicsRow}` : ''}${f.dynamicsRow && f.reason ? ', ' : ''}${f.reason || ''}`); continue; }
    fails.push(`generic-with-structure: section "${f.section}" has ${f.facts} but renders as default content — needs a block or a dynamics row (audit-and-naming.md § 2b)`);
  }
  const schemaH1 = protoSections.findIndex((s) => s.hasH1 === true);
  const pageH1 = r.mainSections.findIndex((s) => s.hasH1);
  const contractFile = 'stardust/runtime-contract.json';
  const autoBlocks = fs.existsSync(contractFile) ? ((() => { try { return JSON.parse(fs.readFileSync(contractFile, 'utf8')).autoBlocks; } catch { return []; } })() || []) : [];
  const v = h1SectionVerdict({ schemaIndex: schemaH1 >= 0 ? schemaH1 : null, pageIndex: pageH1 >= 0 ? pageH1 : null, autoBlocks });
  if (v) (v.level === 'ok' ? ok : v.level === 'warn' ? warns : fails).push(`h1Section: ${v.message}`);
}

// full-bleed pass (inverse of #13): the full-bleed blocks' section wrappers must
// span the viewport; a template-level max-width cap out-specifying the block's
// `max-width: none` is the recorded cause. With no --full-bleed the list is
// derived from the loaded block CSS: a block whose own stylesheet sets
// `max-width: none` on the block or its wrapper/container declares itself
// full-bleed; --full-bleed <a,b> overrides the derived list.
const derived = await page.evaluate(() => {
  const present = new Set([...document.querySelectorAll('[data-block-name]')].map((b) => b.dataset.blockName));
  const out = new Set();
  for (const sheet of document.styleSheets) {
    const m = /\/blocks\/([a-z0-9-]+)\/\1\.css(?:[?#]|$)/i.exec(sheet.href || '');
    if (!m || !present.has(m[1])) continue;
    let rules;
    try { rules = [...sheet.cssRules]; } catch { continue; } // cross-origin sheet: unreadable, skip
    const own = new RegExp(`\\.${m[1]}(?:-wrapper|-container)?(?![a-z0-9-])`);
    const walk = (list) => {
      for (const r of list) {
        if (r.cssRules) walk(r.cssRules);
        else if (r.style && r.style.maxWidth === 'none' && own.test(r.selectorText || '')) out.add(m[1]);
      }
    };
    walk(rules);
  }
  return [...out].sort();
});
const fullBleed = fullBleedOpt.length ? fullBleedOpt : derived;
if (!fullBleedOpt.length) ok.push(`full-bleed: list derived from block CSS — ${derived.length ? derived.join(', ') : 'none (no block stylesheet sets max-width: none on its block or wrapper)'}`);
if (fullBleed.length) {
  const fb = await page.evaluate((names) => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll('[data-block-name]')]
      .filter((b) => names.includes(b.dataset.blockName))
      .map((b) => {
        const wrapper = b.closest('main > .section > div') || b.parentElement;
        return { name: b.dataset.blockName, w: Math.round(wrapper.getBoundingClientRect().width), vw };
      });
  }, fullBleed);
  fullBleedOpt.filter((n) => !fb.some((b) => b.name === n)).forEach((n) => warns.push(`full-bleed: block ${n} not found on the page — check the --full-bleed list`));
  fb.forEach((b) => (b.w >= b.vw - 2 ? ok : warns).push(`full-bleed: block ${b.name} wrapper spans ${b.w}px of ${b.vw}px viewport${b.w < b.vw - 2 ? ' — a template-level `main > .section > div { max-width }` cap is likely out-specifying the block\'s escape rule; define ONE full-bleed escape at template level and route the block through it' : ''}`));
}

// wide-viewport pass (#13)
await page.setViewportSize({ width: 1600, height: 900 });
await page.waitForTimeout(600);
const wide = await page.evaluate(() => [...document.querySelectorAll('[data-block-name]')].map((b) => {
  const inner = b.querySelector('.wrap, [class*="inner"], [class*="container"]') || b.firstElementChild;
  return { name: b.dataset.blockName, w: inner ? Math.round(inner.getBoundingClientRect().width) : 0 };
}));
wide.filter((b) => b.w > maxw + 40 && !['header', 'footer'].includes(b.name) && !fullBleed.includes(b.name)) // declared full-bleed blocks are exempt from #13
  .forEach((b) => warns.push(`wide-1600: block ${b.name} content spans ${b.w}px (> ${maxw}) — full-bleed is correct ONLY if the prototype section has no inner max-width wrapper (#13)`));

await browser.close();

ok.forEach((l) => console.log(`  ✓ ${l}`));
warns.forEach((l) => console.log(`  ⚠ ${l}`));
fails.forEach((l) => console.log(`  ✗ ${l}`));
console.log(`QA GATE: ${fails.length === 0 ? 'PASS' : 'FAIL'} — ${ok.length} ok, ${warns.length} warn, ${fails.length} fail`);
process.exit(fails.length ? 1 : 0);
