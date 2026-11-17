// skills/reskin/scripts/figma-gate/join.mjs — B0, the section join: every mapping.md slot that renders as
// a module must be one <section> of the page, in order, carrying the module the mapping names and the
// slot's first heading; the join pairs each with its Figma module frame. Every later check measures
// inside these sections, so a page that drifted from the mapping stops here. A chrome row whose Donor module is an
// included module (the page's header or footer swapped for a Figma Header / Footer component) joins the page's
// header or footer element the same way, as section "header" or "footer" (joinChrome).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { edsModules, includedModules } from './io.mjs';
import { anchors, imageAnchors, norm, parseMapping } from './mapping.mjs';
import { loadChromium, loadMeasureLive, localAttributes } from './target.mjs';

// Statuses that put a section on the page; chrome and carried-invisible slots live outside the join.
const RENDERED = new Set(['mapped', 'new-module']);
const WIDTH = 1440;

// Where a page's chrome is, first match wins: a data-canon or site-header / site-footer container, else the page's own
// <header> / <footer> (never one inside a block of main). On an EDS preview that is the decorated header / footer.
export const CHROME_SELECTORS = {
  header: ['header[data-canon]:not(main header)', '[data-canon].site-header:not(main *)', '.site-header:not(main *)', '#site-header', 'header:not(main header)'],
  footer: ['footer[data-canon]:not(main footer)', '[data-canon].site-footer:not(main *)', '.site-footer:not(main *)', '#site-footer', 'footer:not(main footer)'],
};

// In the page: { header, footer } → the first CHROME_SELECTORS match of each, { selector }, or null.
export const findChrome = (candidates) => Object.fromEntries(Object.entries(candidates).map(([part, list]) => {
  const selector = list.find((sel) => { try { return !!document.querySelector(sel); } catch { return false; } });
  return [part, selector ? { selector } : null];
}));

// The chrome sections: each chrome row whose part is header or footer and whose Donor module is named joins the page
// element `found` gives for that part, as section `header` / `footer` (one per part) with the module's frame, so the
// checks file's `header` / `footer` entries and the coverage floor reach it. A chrome row naming no module ("—") or a
// banner needs nothing, as before. A module that is not included, a second row mapping the same part, or a part the
// page has no element for is section drift.
export function joinChrome({ mapping, found = {}, modules }) {
  const problems = [];
  const drift = (msg) => problems.push(`section drift: ${msg}`);
  const sections = [];
  const taken = new Map();
  for (const row of mapping.filter((r) => r.status === 'chrome' && r.part && r.module)) {
    const { slot, module, part } = row;
    if (taken.has(part)) { drift(`${slot} maps the ${part} to ${module}, ${taken.get(part)} already maps it: one chrome row per part`); continue; }
    taken.set(part, slot);
    if (!modules.has(module)) { drift(`${module} is not an included module in curation-rules.json (mapping.md maps chrome ${slot}, the ${part}, to it)`); continue; }
    const el = found[part];
    if (!el) { drift(`${slot}: mapping.md maps the ${part} to ${module} but the page has no ${part} (<${part}>, ${part}[data-canon] or .site-${part})`); continue; }
    sections.push({ slot: part, module, node: modules.get(module) || null, selector: el.selector, index: null, chrome: slot });
  }
  return { sections, problems };
}

export function matchSections({ dom, mapping, anchors: anchorOf, modules, selector = localAttributes.selector }) {
  const problems = [];
  const drift = (msg) => problems.push(`section drift: ${msg}`);
  const listed = new Set(mapping.map((r) => r.slot));
  for (const slot of new Set(dom.map((d) => d.slot))) {
    if (!listed.has(slot)) drift(`${slot} is in the page but not in mapping.md`);
  }

  const sections = [];
  const parentChecked = new Set();
  for (const row of mapping.filter((r) => RENDERED.has(r.status))) {
    const { slot, module } = row;
    if (row.status === 'mapped' && !module) drift(`${slot} is mapped but names no Donor module`);
    if (module && !modules.has(module)) drift(`${module} is not an included module in curation-rules.json (mapping.md maps ${slot} to it)`);
    const hits = dom.flatMap((d, index) => (d.slot === slot ? [{ d, index }] : []));
    if (!hits.length) { drift(`${slot} has no section: add <section data-slot="${slot}"> inside <main>`); continue; }
    if (hits.length > 1) drift(`${slot} appears ${hits.length} times: one section per slot`);
    const { d, index } = hits[0];
    if (d.nested) drift(`${slot} is nested inside another data-slot section`);
    if (module && d.module !== module) drift(`${slot} carries data-module="${d.module ?? ''}", mapping.md says ${module}`);
    const anchor = anchorOf.get(slot);
    if (anchor) {
      if (!norm(d.text).includes(anchor)) drift(`${slot}: anchor "${anchor}" not in the section`);
    } else {
      // A split sub-slot has no content-model entry: its parent's anchor must sit in one of the parent's sections.
      const parent = /^(s\d+)-/.exec(slot)?.[1];
      const parentAnchor = parent && anchorOf.get(parent);
      if (parentAnchor && !parentChecked.has(parent)) {
        parentChecked.add(parent);
        const family = dom.filter((x) => x.slot === parent || x.slot.startsWith(`${parent}-`));
        if (!family.some((x) => norm(x.text).includes(parentAnchor))) drift(`${parent}-*: anchor "${parentAnchor}" not in any ${parent}-* section`);
      }
    }
    sections.push({ slot, module, node: (module && modules.get(module)) || null, selector: selector(slot), index });
  }

  let last = null;
  for (const s of sections) {
    if (last && s.index < last.index) drift(`${s.slot} before ${last.slot}: mapping.md lists ${last.slot} first`);
    else last = s;
  }
  return { pass: problems.length === 0, sections, problems };
}

// Opens the target at the module width, joins it, and writes <out>/join.json (out = the page's work dir). A target
// whose sections are not found in its own DOM (a preview) names its matcher: join.match, over what join.collect read.
export async function runJoin({ target, inputs, out }) {
  const [chromium, { openBrowser }] = await Promise.all([loadChromium(), loadMeasureLive()]);
  const browser = await openBrowser(chromium, { tier: 'plain' });
  let dom;
  let found;
  try {
    const page = await target.open(browser, WIDTH);
    dom = await target.join.collect(page);
    found = await page.evaluate(findChrome, CHROME_SELECTORS);
  } finally { await browser.close(); }
  const mapping = parseMapping(inputs.mapping);
  const modules = includedModules(inputs.rules);
  const matched = await (target.join.match ?? matchSections)({
    dom,
    mapping,
    anchors: anchors(inputs.contentModel),
    images: imageAnchors(inputs.contentModel),
    modules,
    eds: edsModules(inputs.rules),
    selector: target.join.selector,
  });
  const chrome = joinChrome({ mapping, found, modules });
  const problems = [...matched.problems, ...chrome.problems];
  const result = { version: 1, url: target.url, regime: target.regime, width: WIDTH, ...matched, pass: problems.length === 0, sections: [...matched.sections, ...chrome.sections], problems };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'join.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
