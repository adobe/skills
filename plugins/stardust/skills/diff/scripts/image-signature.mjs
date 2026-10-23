/**
 * skills/diff/scripts/image-signature.mjs — what an icon LOOKS like, so two probes can tell "the same picture" from
 * "the same file name". DA re-hosts every image as `media_<hash>`, and a build may draw an inline-svg icon as an
 * `<img>`: neither file name nor technique survives a migration, the pixels do.
 *
 * A signature is the element's own screenshot, composited on white and averaged down to a SIG_SIZE × SIG_SIZE grey
 * grid (0–255). Two signatures are the same image when neither is blank (a near-uniform grid), their mean absolute
 * difference is ≤ SAME_IMAGE_MAX and the rendered boxes match within 2 px.
 *
 *   signatureDistance(a, b)        → mean |Δ| (0–255), or null when either side has no signature
 *   sameImage(a, b)                → { sig, size: 'W×H' } pairs → boolean
 *   signElements(page, refs, opts) → Map ref → signature; refs = [{ ref, selector }], visible elements only
 *
 * Library: imported by content-diff (and the replica chrome probes); no CLI.
 */
export const SIG_SIZE = 12;
export const SAME_IMAGE_MAX = 12;

export function signatureDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return null;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

// A near-uniform grid (an empty box, a glyph whose font did not render) shows nothing to recognise: never an identity.
export const isBlank = (sig) => !Array.isArray(sig) || !sig.length || Math.max(...sig) - Math.min(...sig) < 16;

const dims = (size) => String(size || '').split('×').map(Number);
export function sameImage(a, b) {
  if (isBlank(a && a.sig) || isBlank(b && b.sig)) return false;
  const d = signatureDistance(a && a.sig, b && b.sig);
  if (d === null || d > SAME_IMAGE_MAX) return false;
  const [aw, ah] = dims(a.size); const [bw, bh] = dims(b.size);
  return Math.abs(aw - bw) <= 2 && Math.abs(ah - bh) <= 2;
}

// Runs IN the page (ONE arg): a PNG data URL → the grey grid. A data: URL never taints the canvas.
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
  for (let i = 0; i < d.length; i += 4) out.push(Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]));
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
