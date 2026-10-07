// Site context: the meta table (site name, origin, scope, reference library, telemetry) loaded once at startup
// from /api/meta. Every site-specific word in the UI comes from here; missing keys fall back to neutral wording.
import { createContext, useContext, type ReactNode } from 'react';
import { parseJson, siteFacts, stripOrigin, type Meta, type Site } from '../../src/site';
import { setMediaExt } from './api';

export type SiteInfo = Site & {
  meta: Meta;
  chatModel: string | null;
  live: (path: string) => string;                    // source URL of a path, '' when the origin is unknown
  short: (u?: string | null) => string;               // absolute source URL -> path
  inScope: (path: string) => string;                  // path without the scope prefix, for dense lists
  json: <T>(key: string, fallback: T) => T;
};

export function makeSite(meta: Meta, chatModel: string | null = null): SiteInfo {
  const s = siteFacts(meta);
  const prefix = s.scopePath === '/' ? '' : s.scopePath.replace(/\/$/, '');
  return {
    ...s, meta, chatModel,
    live: (path) => (s.origin ? `${s.origin}${path}` : ''),
    short: (u) => stripOrigin(u, s),
    inScope: (path) => (prefix && path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : path),
    json: (key, fallback) => parseJson(meta[key], fallback),
  };
}

export async function loadSite(): Promise<SiteInfo> {
  try {
    const r = await fetch('/api/meta');
    if (!r.ok) throw new Error(String(r.status));
    const d = (await r.json()) as { meta?: Meta; chatModel?: string | null };
    setMediaExt(d.meta?.media_ext);
    return makeSite(d.meta ?? {}, d.chatModel ?? null);
  } catch {
    return makeSite({});
  }
}

const Ctx = createContext<SiteInfo>(makeSite({}));
export const SiteProvider = ({ site, children }: { site: SiteInfo; children: ReactNode }) => <Ctx.Provider value={site}>{children}</Ctx.Provider>;
export const useSite = () => useContext(Ctx);
