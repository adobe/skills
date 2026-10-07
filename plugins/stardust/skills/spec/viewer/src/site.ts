// Site facts: everything site-specific comes from the D1 `meta` table (key/value strings, some JSON).
// Pure functions, shared by the Worker (chat prompt, spec) and the web app (site context). Every key is
// optional; missing keys fall back to neutral wording.
export type Meta = Record<string, string | undefined>;

export type LoadingStage = { stage: string; what: string };

export type Site = {
  name: string;          // display name: meta.site_name, else the origin host, else "the site"
  origin: string;        // e.g. https://www.example.com (no trailing slash), '' when unknown
  host: string;          // e.g. www.example.com, '' when unknown
  scopePath: string;     // e.g. /en/ (always starts and ends with /), '/' when unknown
  scopeTree: string;     // scope path without slashes, e.g. 'en' or 'fr/fr' ('' for the whole site)
  scopeLabel: string;    // short header label
  refName: string;       // name of the reference block library verdicts compare with ('' when none)
  refCount: number | null;
  refPhrase: string;     // "the 12 blocks of <library>" / "the reference block library"
  rum: boolean;          // real-user telemetry available
};

export function parseJson<T>(s: unknown, fallback: T): T {
  if (typeof s !== 'string' || !s.trim()) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export function siteFacts(meta: Meta): Site {
  const origin = (meta.origin ?? '').trim().replace(/\/+$/, '');
  let host = '';
  try { host = origin ? new URL(origin).host : ''; } catch { host = ''; }
  const raw = (meta.scope_path ?? '').trim();
  const scopePath = raw ? `/${raw.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/') : '/';
  const scopeTree = scopePath.replace(/^\/|\/$/g, '');
  const name = meta.site_name?.trim() || host || 'the site';
  const refName = meta.reference_blocks_name?.trim() ?? '';
  const n = Number(meta.reference_blocks_count);
  const refCount = Number.isFinite(n) && n > 0 ? n : null;
  const refPhrase = refName ? (refCount ? `the ${refCount} blocks of ${refName}` : `the blocks of ${refName}`) : 'the reference block library';
  const rum = meta.rum_available === '1' ? true : meta.rum_available === '0' ? false : Number(meta.rum_bundles) > 0;
  const scopeLabel = meta.scope_label?.trim() || (host ? `${host}${scopePath === '/' ? '' : ` ${scopePath}`}` : name);
  return { name, origin, host, scopePath, scopeTree, scopeLabel, refName, refCount, refPhrase, rum };
}

// Absolute URL on the source site -> path. Accepts the origin with or without www.
export function stripOrigin(u: string | null | undefined, site: Pick<Site, 'host'>): string {
  const s = u ?? '';
  if (!site.host) return s;
  const bare = site.host.replace(/^www\./, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return s.replace(new RegExp(`^https?://(www\\.)?${bare}`, 'i'), '');
}

export const DEFAULT_LOADING_ORDER: LoadingStage[] = [
  { stage: 'Head', what: 'The consent platform stub, with the consent defaults configured today.' },
  { stage: 'Eager', what: 'The data-layer page event, built from page metadata.' },
  { stage: 'Delayed', what: 'The tag manager library after the largest paint. It keeps gating analytics and pixels on consent categories, as today.' },
  { stage: 'On interaction', what: 'Heavy third-party embeds (forms, video players, maps) load when their block enters the viewport or is used.' },
];

export function loadingOrder(meta: Meta): LoadingStage[] {
  const list = parseJson<LoadingStage[]>(meta.loading_order, []);
  const ok = Array.isArray(list) ? list.filter((x) => x && typeof x.stage === 'string' && typeof x.what === 'string') : [];
  return ok.length ? ok : DEFAULT_LOADING_ORDER;
}

export async function loadMeta(db: D1Database): Promise<Meta> {
  try {
    const rows = (await db.prepare('SELECT key, value FROM meta').all<{ key: string; value: string }>()).results;
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch {
    return {};
  }
}
