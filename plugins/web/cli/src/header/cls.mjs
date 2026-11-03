/**
 * Layout shift of a page load: the total (CLS, as summed by the gate); per place an element
 * moved in (a section's styles, header, footer, main), the sum of the shifts that moved it, the
 * three largest; and the boxes whose height changed after they first showed (the usual cause:
 * a box above the moved ones resized), with their successive heights.
 * shifts: [{ v: value, at: [place] }] from a layout-shift observer, and samples of the boxes'
 * heights as entries { v: 0, at: [], heights: { place: px } }.
 */
export function clsOf(shifts) {
  const r = (x) => Math.round(x * 1000) / 1000;
  const by = new Map();
  for (const s of shifts) for (const p of s.at) by.set(p, (by.get(p) ?? 0) + s.v);
  const seen = new Map();
  for (const s of shifts) {
    for (const [p, h] of Object.entries(s.heights ?? {})) {
      const hs = seen.get(p) ?? [];
      // a box's first appearance (from 0, hidden while loading) is not a resize
      if (hs.at(-1) !== h && (hs.length || h > 0)) hs.push(h);
      seen.set(p, hs);
    }
  }
  return {
    value: r(shifts.reduce((t, s) => t + s.v, 0)),
    by: [...by]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([p, v]) => [p, r(v)]),
    resized: [...seen].filter(([, hs]) => hs.length > 1),
  };
}
