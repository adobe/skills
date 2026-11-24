/**
 * Plans the images an agent judges a region on, so each reaches the model at full size and
 * lossless: Pi's `read` fits images into 2000x2000 and turns those over 4.5 MiB into JPEG;
 * Claude 4.7+ shrinks anything over 2,576 px or 4,784 tokens (ceil(w/28) x ceil(h/28)).
 */
export const BOX = { maxW: 2000, maxH: 2000, maxTokens: 4784, maxB64: 4718592 };
export const PANELS = 3;
export const LABEL_H = 20;
export const GAP = 8;

export const tokensOf = (w, h) => Math.ceil(w / 28) * Math.ceil(h / 28);

export function fits({ w, h, b64Bytes = 0 }, box = BOX) {
  return (
    w <= box.maxW && h <= box.maxH && tokensOf(w, h) <= box.maxTokens && b64Bytes <= box.maxB64
  );
}

export const maxPieceH = (box = BOX) =>
  Math.floor((box.maxH - PANELS * LABEL_H - (PANELS - 1) * GAP) / PANELS);

// SOURCE, EDS and DIFF stacked, each under a label strip.
export const stackedSize = (w, h) => ({ w, h: PANELS * (LABEL_H + h) + (PANELS - 1) * GAP });

/** 1 where pixelmatch drew its diff colour (red); anti-aliasing (yellow) is not a difference. */
export function diffMask(rgba, w, h) {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (rgba[o] === 255 && rgba[o + 1] === 0 && rgba[o + 2] === 0) mask[i] = 1;
  }
  return mask;
}

function cellsOf(mask, w, h, cell) {
  const cols = Math.ceil(w / cell);
  const cells = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const k = Math.floor(y / cell) * cols + Math.floor(x / cell);
      const c = cells.get(k) ?? { x0: x, y0: y, x1: x, y1: y, n: 0 };
      c.x0 = Math.min(c.x0, x);
      c.y0 = Math.min(c.y0, y);
      c.x1 = Math.max(c.x1, x);
      c.y1 = Math.max(c.y1, y);
      c.n++;
      cells.set(k, c);
    }
  }
  return { cells, cols };
}

/** Clusters of differing pixels: 8-connected cells of `cell` px, padded and clamped. */
export function clusters(mask, w, h, { cell = 24, pad = 16 } = {}) {
  const { cells, cols } = cellsOf(mask, w, h, cell);
  const seen = new Set();
  const out = [];
  for (const start of cells.keys()) {
    if (seen.has(start)) continue;
    const box = { x0: Infinity, y0: Infinity, x1: -1, y1: -1, n: 0 };
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const k = stack.pop();
      const c = cells.get(k);
      Object.assign(box, {
        x0: Math.min(box.x0, c.x0),
        y0: Math.min(box.y0, c.y0),
        x1: Math.max(box.x1, c.x1),
        y1: Math.max(box.y1, c.y1),
        n: box.n + c.n,
      });
      const [cy, cx] = [Math.floor(k / cols), k % cols];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nk = (cy + dy) * cols + (cx + dx);
          if (cx + dx < 0 || cx + dx >= cols || seen.has(nk) || !cells.has(nk)) continue;
          seen.add(nk);
          stack.push(nk);
        }
      }
    }
    const x = Math.max(0, box.x0 - pad);
    const y = Math.max(0, box.y0 - pad);
    out.push({
      x,
      y,
      w: Math.min(w, box.x1 + 1 + pad) - x,
      h: Math.min(h, box.y1 + 1 + pad) - y,
      pixels: box.n,
    });
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

// The widest piece whose stacked view stays within the token budget.
function maxPieceW(pieceH, box) {
  const rows = Math.ceil(stackedSize(1, pieceH).h / 28);
  return Math.min(box.maxW, Math.floor(box.maxTokens / rows) * 28);
}

function split(rect, box) {
  const ph = maxPieceH(box);
  const pieces = [];
  for (let y = rect.y; y < rect.y + rect.h; y += ph) {
    const h = Math.min(ph, rect.y + rect.h - y);
    const pw = maxPieceW(h, box);
    for (let x = rect.x; x < rect.x + rect.w; x += pw) {
      pieces.push({ x, y, w: Math.min(pw, rect.x + rect.w - x), h });
    }
  }
  return pieces;
}

// A crop smaller than this shows the difference without its surroundings.
const MIN_W = 480;
const MIN_H = 160;

function grow(r, w, h) {
  const gw = Math.min(w, Math.max(r.w, MIN_W));
  const gh = Math.min(h, Math.max(r.h, MIN_H));
  const x = Math.min(Math.max(0, Math.round(r.x + r.w / 2 - gw / 2)), w - gw);
  const y = Math.min(Math.max(0, Math.round(r.y + r.h / 2 - gh / 2)), h - gh);
  return { x, y, w: gw, h: gh };
}

/** Crops around the clusters, full-width bands when they cover most of the region, or none. */
export function cropPlan(rects, { w, h }, { box = BOX, coverage = 0.6 } = {}) {
  if (!rects.length) return { mode: 'none', pieces: [] };
  const area = rects.reduce((s, r) => s + r.w * r.h, 0);
  if (area / (w * h) > coverage) return { mode: 'bands', pieces: split({ x: 0, y: 0, w, h }, box) };
  return { mode: 'crops', pieces: rects.flatMap((r) => split(grow(r, w, h), box)) };
}

/** Largest scale ≤ 1 at which a w x h image fits the box. */
export function overviewScale(w, h, box = BOX) {
  let s = Math.min(1, box.maxW / w, box.maxH / h);
  while (tokensOf(Math.round(w * s), Math.round(h * s)) > box.maxTokens) s *= 0.99;
  return s;
}
