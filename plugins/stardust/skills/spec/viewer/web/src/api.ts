export async function get<T = any>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(path, { signal });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}

export const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '–' : n.toLocaleString('en-US'));
export const fmtViews = (n: number | null | undefined) => {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
};
export const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');
export const media = (key?: string | null) => (key ? `/media/crops/${key}` : undefined);
// page captures are page.<ext>; the pipeline records the extension in meta.media_ext (set once by loadSite)
let mediaExt = 'webp';
export const setMediaExt = (ext?: string | null) => { if (ext) mediaExt = ext; };
export const pageShot = (captureKey?: string | null) => (captureKey ? `/media/crops/${captureKey}/page.${mediaExt}` : undefined);
