// skills/reskin/scripts/figma-gate/geometry.mjs — B1, geometry: every geometry entry of the checks file is
// measured on the page (measure-live's measureInPage, one page load per width) and compared with the same
// measure taken from the Figma box tree, or with a token. All values are relative to the section on the
// page and to the module root in Figma. measureInPage rounds to whole px, tolerancePx (default 1) absorbs
// Figma's half pixels. A section in a rail page's grid column (mapping "rail": a source sidebar beside the
// content) is narrower than the module's Figma frame by design: its root width entry is UNASSERTED with the
// reason, its inner entries are measured as usual. expected, observed, judge and inColumn are pure.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findBox } from './boxes.mjs';
import { scopeSelector, selectorFor } from './checks.mjs';
import { stampsOf } from './stamp.mjs';
import { loadChromium, loadMeasureLive } from './target.mjs';

const PADDING = { paddingTop: 0, paddingRight: 1, paddingBottom: 2, paddingLeft: 3 };
const fmt = (n) => Number(n.toFixed(2));
const tokenValue = (tokens, path) => path.split('.').reduce((v, k) => (v !== null && typeof v === 'object' ? v[k] : undefined), tokens);

// The Figma side of an entry: { want, source } relative to the root box.
export function expected(entry, root, tokens) {
  if (entry.token !== undefined) return { want: parseFloat(tokenValue(tokens, entry.token)), source: `token ${entry.token}` };
  const ids = entry.nodes ?? [entry.node];
  const boxes = ids.map((id) => {
    const b = findBox(root, id);
    if (!b) throw new Error(`${id} is not inside root ${root.id}`);
    return b;
  });
  const [a, b] = boxes;
  const source = entry.nodes ? `nodes ${ids.join(', ')}` : `node ${ids[0]}`;
  const want = {
    left: () => a.x,
    right: () => root.w - (a.x + a.w),
    top: () => a.y,
    width: () => a.w,
    height: () => a.h,
    gapX: () => b.x - (a.x + a.w),
    gapY: () => b.y - (a.y + a.h),
  }[entry.measure]?.() ?? a.layout?.padding?.[PADDING[entry.measure]];
  if (!Number.isFinite(want)) throw new Error(`${entry.id}: no ${entry.measure} on ${ids.join(', ')}`);
  return { want, source };
}

const padOf = (it, i) => Number(String(it.pad ?? '').split(' ')[i]);

// The page side: one { id, value, why? } per entry, from measureInPage items (the section's own, then the
// entries' scopeSelector), relative to the section's rect.
export function observed(entries, items, sectionSel) {
  const section = items.find((it) => it.sel === sectionSel && !it.missing && !it.error);
  return entries.map((e) => {
    const sel = scopeSelector(sectionSel, e.selector);
    if (!section) return { id: e.id, value: null, why: `section ${sectionSel} matched nothing` };
    const hits = items.filter((it) => it.sel === sel);
    if (hits.some((it) => it.error)) return { id: e.id, value: null, why: `${e.selector} is not a valid selector` };
    const matches = hits.filter((it) => !it.missing);
    if (!matches.length) return { id: e.id, value: null, why: `${e.selector} matched nothing in the section` };
    const index = e.index ?? 0;
    const gap = e.measure === 'gapX' || e.measure === 'gapY';
    const picked = gap ? [matches[index], matches[index + 1]] : [matches[index]];
    if (picked.some((it) => !it)) {
      return { id: e.id, value: null, why: gap ? `${e.selector} has ${matches.length} match(es), a gap needs two from index ${index}` : `${e.selector} has ${matches.length} match(es), no index ${index}` };
    }
    if (picked.some((it) => !it.w || !it.h)) return { id: e.id, value: null, why: `${e.selector} has a zero-size box` };
    const [a, b] = picked;
    const value = {
      width: () => a.w,
      height: () => a.h,
      left: () => a.x - section.x,
      right: () => section.w - (a.x - section.x + a.w),
      top: () => a.y - section.y,
      gapX: () => b.x - (a.x + a.w),
      gapY: () => b.y - (a.y + a.h),
    }[e.measure]?.() ?? padOf(a, PADDING[e.measure]);
    return { id: e.id, value };
  });
}

export function judge(entry, want, got, why) {
  const tol = entry.tolerancePx ?? 1;
  if (got === null || got === undefined) return { status: 'FAIL', detail: `unmeasurable: ${why}` };
  const detail = `${fmt(got)} vs ${fmt(want)} (±${tol})`;
  return { status: Math.abs(got - want) <= tol + 1e-9 ? 'PASS' : 'FAIL', detail };
}

// A root width entry of a section that sits in a grid column narrower than main (column: { w, of } measured in
// the page, or null) → the UNASSERTED override, else null. The rail placement is gate (a′) S4's to judge.
export function inColumn(entry, base, want, column) {
  if (!column || entry.measure !== 'width' || !base.node || base.node !== base.root) return null;
  return { status: 'UNASSERTED', detail: `rail column: the section is ${column.w}px of ${column.of}px beside a rail (mapping "rail", gate (a′) S4), not the module root's ${fmt(want)}` };
}

// In the page: per section selector, { w, of } when its parent is a grid of two or more columns and the
// section does not span it, else null.
const columnsInPage = (sels) => Object.fromEntries(sels.map((sel) => {
  const el = document.querySelector(sel);
  const parent = el?.parentElement;
  if (!parent) return [sel, null];
  const cs = getComputedStyle(parent);
  const tracks = /grid/.test(cs.display) ? cs.gridTemplateColumns.split(/\s+/).filter(Boolean).length : 1;
  const w = el.getBoundingClientRect().width;
  const of = parent.getBoundingClientRect().width;
  return [sel, tracks > 1 && w < of - 1 ? { w: Math.round(w), of: Math.round(of) } : null];
}));

// checks is validateChecks(...).sections; join is runJoin's result (its sections hold the selectors). On a preview an
// entry is measured by its previewSelector (selectorFor). Each result carries root, the checks root it was measured
// against. Writes <out>/geometry.json.
export async function runGeometry({ target, join: joined, checks, boxes, tokens, out }) {
  const selectorOf = new Map(joined.sections.map((s) => [s.slot, s.selector]));
  const planned = [];
  for (const [slot, section] of Object.entries(checks)) {
    for (const entry of section.geometry) {
      const rootId = section.roots[entry.width];
      const rootBox = rootId ? boxes.roots[rootId]?.box : null;
      const base = { slot, id: entry.id, measure: entry.measure, node: entry.token !== undefined ? null : (entry.nodes?.[0] ?? entry.node ?? null), root: rootId ?? null };
      let want = null;
      let source = null;
      try {
        ({ want, source } = expected(entry, rootBox, tokens));
      } catch (e) {
        planned.push({ entry, slot, base, error: e.message });
        continue;
      }
      planned.push({ entry, slot, base, want, source, sectionSel: selectorOf.get(slot), selector: selectorFor(entry, target.regime) });
    }
  }

  const widths = [...new Set(planned.filter((p) => !p.error).map((p) => p.entry.width))];
  const measured = new Map();
  if (widths.length) {
    const [chromium, { openBrowser, measureInPage }] = await Promise.all([loadChromium(), loadMeasureLive()]);
    const browser = await openBrowser(chromium, { tier: 'plain' });
    try {
      for (const width of widths) {
        const at = planned.filter((p) => !p.error && p.entry.width === width);
        const sels = [...new Set(at.flatMap((p) => [p.sectionSel, scopeSelector(p.sectionSel, p.selector)]))];
        const page = await target.open(browser, width);
        try {
          const { items } = await page.evaluate(measureInPage, { sels, all: true });
          const sectionSels = [...new Set(at.map((p) => p.sectionSel))];
          const columns = await page.evaluate(columnsInPage, sectionSels.filter(Boolean));
          for (const sectionSel of sectionSels) {
            const own = at.filter((p) => p.sectionSel === sectionSel);
            observed(own.map((p) => ({ ...p.entry, selector: p.selector })), items, sectionSel).forEach((o, i) => measured.set(own[i], { ...o, column: columns[sectionSel] ?? null }));
          }
        } finally { await page.context().close(); }
      }
    } finally { await browser.close(); }
  }

  const results = planned.map((p) => {
    if (p.error) return { ...p.base, want: null, got: null, status: 'FAIL', detail: p.error };
    const o = measured.get(p);
    return { ...p.base, want: p.want, got: o.value, ...(inColumn(p.entry, p.base, p.want, o.column) ?? judge(p.entry, p.want, o.value, o.why)) };
  });
  const result = { pass: results.every((r) => r.status === 'PASS' || r.status === 'UNASSERTED'), results };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'geometry.json'), `${JSON.stringify({ version: 1, url: target.url, regime: target.regime, checksStamp: stampsOf(checks), ...result }, null, 2)}\n`);
  return result;
}
