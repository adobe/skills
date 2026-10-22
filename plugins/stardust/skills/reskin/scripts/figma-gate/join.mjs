// skills/reskin/scripts/figma-gate/join.mjs — B0, the section join: every mapping.md slot that renders as
// a module must be one <section> of the page, in order, carrying the module the mapping names and the
// slot's first heading; the join pairs each with its Figma module frame. Every later check measures
// inside these sections, so a page that drifted from the mapping stops here.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { includedModules } from './io.mjs';
import { anchors, norm, parseMapping } from './mapping.mjs';
import { loadChromium, loadMeasureLive, localAttributes } from './target.mjs';

// Statuses that put a section on the page; chrome and carried-invisible slots live outside the join.
const RENDERED = new Set(['mapped', 'new-module']);
const WIDTH = 1440;

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
// page selects that page's rows of a multi-page mapping.md.
export async function runJoin({ target, inputs, out, page }) {
  const [chromium, { openBrowser }] = await Promise.all([loadChromium(), loadMeasureLive()]);
  const browser = await openBrowser(chromium, { tier: 'plain' });
  let dom;
  try {
    const page = await target.open(browser, WIDTH);
    dom = await target.join.collect(page);
  } finally { await browser.close(); }
  const matched = await (target.join.match ?? matchSections)({
    dom,
    mapping: parseMapping(inputs.mapping, page),
    anchors: anchors(inputs.contentModel),
    modules: includedModules(inputs.rules),
    selector: target.join.selector,
  });
  const result = { version: 1, url: target.url, regime: target.regime, width: WIDTH, ...matched };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'join.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
