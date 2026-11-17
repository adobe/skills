#!/usr/bin/env node
/**
 * skills/reskin/scripts/placement.mjs — where a region sits on the source page, one definition for the
 * capture (capture-content.mjs: sections[].placement, residue[].placement), the mapping check
 * (stream-render.mjs --check) and the placement gate (source-coverage.mjs S4).
 *
 * The page's CONTENT COLUMN is the slot that holds the h1 (else the slot with the most text that is
 * not a breadcrumb), widened to every slot that shares its horizontal span. Against it, a box is:
 *   rail-start / rail-end  beside the column (< 20% horizontal overlap, some vertical overlap): a
 *                          section sidebar, a local nav, a related-links rail — on its start or end side;
 *   band                   wider than the column and covering it (a breadcrumb or banner that spans the
 *                          column and the rail);
 *   main                   the column itself.
 * A rail rendered after the content (a sidebar that follows <main> in the DOM and is placed by CSS)
 * is the case this module exists for: stacking slots in DOM order puts it above the footer.
 * Pure; exported for tests.
 */
import { pathToFileURL } from 'node:url';

export const REGIONS = ['rail-start', 'rail-end', 'band', 'main'];

const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

// items: [{ rect: { x, y, w, h }, hasH1?, textLen?, kind? }] in document order. Returns the column
// { x0, x1, y0, y1 } or null when no item has a box.
export function contentColumn(items) {
  const boxed = items.filter((it) => it?.rect && it.rect.w > 0 && it.rect.h > 0);
  if (!boxed.length) return null;
  const ref = boxed.find((it) => it.hasH1)
    || boxed.filter((it) => it.kind !== 'breadcrumb').sort((a, b) => (b.textLen || 0) - (a.textLen || 0))[0]
    || boxed[0];
  const r = ref.rect;
  const col = { x0: r.x, x1: r.x + r.w, y0: r.y, y1: r.y + r.h };
  for (const it of boxed) {
    const b = it.rect;
    // the same column: shares most of the reference's horizontal span and is no wider than it by much
    if (overlap(b.x, b.x + b.w, col.x0, col.x1) >= 0.8 * Math.min(b.w, col.x1 - col.x0) && b.w <= (col.x1 - col.x0) * 1.25) {
      col.y0 = Math.min(col.y0, b.y);
      col.y1 = Math.max(col.y1, b.y + b.h);
    }
  }
  return col;
}

// One box against the column → rail-start | rail-end | band | main.
export function regionOf(rect, col) {
  if (!rect || !col || !(rect.w > 0)) return 'main';
  const cw = col.x1 - col.x0;
  const ox = overlap(rect.x, rect.x + rect.w, col.x0, col.x1);
  const oy = overlap(rect.y, rect.y + rect.h, col.y0, col.y1);
  if (ox < 0.2 * rect.w && oy > 0) return rect.x + rect.w / 2 < (col.x0 + col.x1) / 2 ? 'rail-start' : 'rail-end';
  if (rect.w >= cw * 1.25 && ox >= 0.9 * cw) return 'band';
  return 'main';
}

// Classify every item; returns [{ region, rect }] aligned with items.
export function placements(items) {
  const col = contentColumn(items);
  return items.map((it) => ({ region: regionOf(it?.rect, col), rect: it?.rect || null }));
}

// The rail side a region asks the mapping for ('start' | 'end'), or null.
export const railSide = (region) => (region === 'rail-start' ? 'start' : region === 'rail-end' ? 'end' : null);

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  console.log('placement.mjs is a module: import { contentColumn, regionOf, placements, railSide } from it.');
}
