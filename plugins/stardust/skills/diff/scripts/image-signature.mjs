/**
 * skills/diff/scripts/image-signature.mjs — what an icon LOOKS like, so two probes can tell "the same picture" from
 * "the same file name". DA re-hosts every image as `media_<hash>`, and a build may draw an inline-svg icon as an
 * `<img>`: neither file name nor technique survives a migration, the pixels do.
 *
 * A signature is the element's own screenshot — opaque: whatever the page paints behind the element is captured with
 * it — averaged down to a SIG_SIZE × SIG_SIZE grid of RGB cells (flat [r, g, b, r, g, b, …], 0–255): colour is kept, so
 * the same shape recoloured is another image. Two signatures are the same image when neither is blank (a near-uniform
 * grid), their mean absolute difference over the DRAWN cells is ≤ SAME_IMAGE_MAX and the rendered boxes match within
 * 2 px. A drawn cell differs from its grid's background (the median of the border cells) on either side; averaging over
 * those cells only keeps a thin-line icon in a mostly-empty box from hiding in the background.
 *
 *   signatureDistance(a, b)        → mean |Δ| (0–255) over the drawn cells, or null when either side has no signature
 *   sameImage(a, b)                → { sig, size: 'W×H' } pairs → boolean
 *   signElements(page, refs, opts) → Map ref → signature; refs = [{ ref, selector }], visible elements only
 *
 * Library: imported by content-diff (and the replica chrome probes); no CLI.
 */
export const SIG_SIZE = 12;
export const SAME_IMAGE_MAX = 12;

const CH = 3; // r, g, b per cell
const square = (sig) => { const n = Math.round(Math.sqrt(sig.length / CH)); return n > 0 && n * n * CH === sig.length; };
const INK = 24; // a cell more than this (any channel) off the background is drawn
// The background colour: per channel, the median of the grid's border cells.
function background(sig) {
  const n = Math.round(Math.sqrt(sig.length / CH));
  const border = [];
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) if (y === 0 || x === 0 || y === n - 1 || x === n - 1) border.push((y * n + x) * CH);
  return [0, 1, 2].map((c) => { const v = border.map((i) => sig[i + c]).sort((p, q) => p - q); return v[v.length >> 1]; });
}
const drawn = (sig, bg, i) => [0, 1, 2].some((c) => Math.abs(sig[i + c] - bg[c]) > INK);

export function signatureDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !square(a)) return null;
  const ba = background(a); const bb = background(b);
  let sum = 0; let cells = 0;
  for (let i = 0; i < a.length; i += CH) {
    if (!drawn(a, ba, i) && !drawn(b, bb, i)) continue;
    cells += 1;
    for (let c = 0; c < CH; c += 1) sum += Math.abs(a[i + c] - b[i + c]);
  }
  return cells ? sum / (cells * CH) : 0;
}

// A near-uniform grid (an empty box, a glyph whose font did not render) shows nothing to recognise: never an identity.
export function isBlank(sig) {
  if (!Array.isArray(sig) || !square(sig)) return true;
  return [0, 1, 2].every((c) => { let lo = 255; let hi = 0; for (let i = c; i < sig.length; i += CH) { lo = Math.min(lo, sig[i]); hi = Math.max(hi, sig[i]); } return hi - lo < 16; });
}

const dims = (size) => String(size || '').split('×').map(Number);
export function sameImage(a, b) {
  if (isBlank(a && a.sig) || isBlank(b && b.sig)) return false;
  const d = signatureDistance(a && a.sig, b && b.sig);
  if (d === null || d > SAME_IMAGE_MAX) return false;
  const [aw, ah] = dims(a.size); const [bw, bh] = dims(b.size);
  return Math.abs(aw - bw) <= 2 && Math.abs(ah - bh) <= 2;
}

// Runs IN the page (ONE arg): a PNG data URL → the RGB grid. A data: URL never taints the canvas.
/* eslint-disable no-undef */
export async function gridFromDataUrl([url, n]) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = n; c.height = n;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, n, n);
  g.drawImage(img, 0, 0, n, n);
  const d = g.getImageData(0, 0, n, n).data;
  const out = [];
  for (let i = 0; i < d.length; i += 4) out.push(d[i], d[i + 1], d[i + 2]);
  return out;
}
/* eslint-enable no-undef */

export async function signElements(page, refs, { max = 120, timeoutMs = 2500 } = {}) {
  const sigs = new Map();
  for (const { ref, selector } of refs.slice(0, max)) {
    try {
      const loc = page.locator(selector).first();
      if (!(await loc.isVisible())) continue;
      const png = await loc.screenshot({ timeout: timeoutMs, animations: 'disabled' });
      sigs.set(ref, await page.evaluate(gridFromDataUrl, [`data:image/png;base64,${png.toString('base64')}`, SIG_SIZE]));
    } catch { /* hidden, detached or too slow: no signature — the probe falls back to identity by name */ }
  }
  return sigs;
}
