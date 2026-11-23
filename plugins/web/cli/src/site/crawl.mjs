import { gunzipSync } from 'node:zlib';
import { redactCredentials } from '#src/errors.mjs';

const LANG_RE = /^([a-z]{2,3})(?:[-_]([a-z]{2}|\d{3}))?$/i;
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };

/** Glob over pathname+search: `*` is any run of characters, `?` any one character. */
export function globToRegExp(glob) {
  const body = [...glob]
    .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${body}$`);
}

/** IETF-ish tag from the first path segment (`/fr-fr/x` → `fr-FR`), or ''. */
export function langOf(pathname) {
  const m = LANG_RE.exec(pathname.split('/')[1] ?? '');
  return m ? (m[2] ? `${m[1].toLowerCase()}-${m[2].toUpperCase()}` : m[1].toLowerCase()) : '';
}

const decode = (s) => s.replace(/&(?:amp|lt|gt|quot|apos);/g, (e) => ENTITIES[e]);

/** @returns {{ index: boolean, locs: string[] }} `<loc>` values of a sitemap or sitemap index */
export function parseSitemap(xml) {
  const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)];
  return { index: /<sitemapindex[\s>]/i.test(xml), locs: locs.map((m) => decode(m[1])) };
}

/** @returns {string[]} absolute http(s) links of an HTML page, fragments dropped */
export function extractLinks(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    try {
      const u = new URL(decode(m[1] ?? m[2]), base);
      u.hash = '';
      if (u.protocol === 'http:' || u.protocol === 'https:') out.push(u.href);
    } catch {
      // not a URL
    }
  }
  return out;
}

/**
 * `fetch` wraps why it failed (DNS, refused connection, a proxy answering 407) in `fetch failed`:
 * name the innermost cause too.
 */
export function failureMessage(err) {
  let inner = err;
  while (inner?.cause instanceof Error) inner = inner.cause;
  const message = inner === err ? err.message : `${err.message}: ${inner.message}`;
  return redactCredentials(message);
}

async function fetchBody({ url, timeoutMs, headers }) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let buf = Buffer.from(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  return { text: buf.toString('utf-8'), type: res.headers.get('content-type') ?? '', url: res.url };
}

/**
 * Collect the URLs of a site from its sitemaps or by following links. Only URLs on the
 * origin are kept.
 * @param {string} origin start URL
 * @param {{ strategy?: 'sitemaps'|'http', include?: string[], exclude?: string[],
 *   limit?: number, timeoutMs?: number, headers?: object }} [options]
 * @returns {Promise<{ origin: string, strategy: string, total: number, valid: number,
 *   urls: {url: string, lang: string}[], sitemaps: string[], errors: {url: string,
 *   message: string}[] }>}
 */
export async function crawl(origin, options = {}) {
  const { strategy = 'sitemaps', limit, timeoutMs = 10000, headers } = options;
  const include = (options.include ?? []).map(globToRegExp);
  const exclude = (options.exclude ?? []).map(globToRegExp);
  const base = new URL(origin);
  const seen = new Set();
  const urls = [];
  const sitemaps = [];
  const errors = [];
  const full = () => limit !== undefined && urls.length >= limit;
  const get = (url) => fetchBody({ url, timeoutMs, headers });
  const attempt = async (url, fn) => {
    try {
      return await fn();
    } catch (err) {
      errors.push({ url, message: failureMessage(err) });
      return undefined;
    }
  };

  const matches = (u) => {
    const target = u.pathname + u.search;
    if (exclude.some((re) => re.test(target))) return false;
    return include.length === 0 || include.some((re) => re.test(target));
  };
  /** Same origin, new, and allowed by the patterns; marks it seen. */
  const accept = (raw) => {
    let u;
    try {
      u = new URL(raw);
    } catch {
      return null;
    }
    u.hash = '';
    if (u.origin !== base.origin || seen.has(u.href)) return null;
    seen.add(u.href);
    return matches(u) ? u : null;
  };
  const keep = (raw) => {
    const u = accept(raw);
    if (u) urls.push({ url: u.href, lang: langOf(u.pathname) });
  };

  /** Why a document asked from the origin came from another one, if it did. */
  const movedAway = (url, doc) => {
    const final = new URL(doc.url || url);
    final.hash = '';
    if (new URL(url).origin !== base.origin || final.origin === base.origin) return null;
    return `redirected to ${final.href}, another origin; scan ${final.origin} instead`;
  };

  async function walkSitemaps() {
    // A site without robots.txt is normal: a 404 means no Sitemap lines, not a failure.
    const robotsUrl = `${base.origin}/robots.txt`;
    const robots = await attempt(robotsUrl, () =>
      get(robotsUrl).catch((err) => {
        if (err.message === 'HTTP 404') return null;
        throw err;
      }),
    );
    const listed = [...(robots?.text.matchAll(/^sitemap:\s*(\S+)/gim) ?? [])].map((m) => m[1]);
    // A redirect elsewhere is only worth an error when it led nowhere: robots.txt or a sitemap
    // served from a CDN host is fine.
    const robotsMoved = robots && !listed.length && movedAway(robotsUrl, robots);
    if (robotsMoved) errors.push({ url: robotsUrl, message: robotsMoved });
    const queue = listed.length ? listed : [`${base.origin}/sitemap.xml`];
    const visited = new Set();
    // Origins of the URLs dropped for being elsewhere, to explain an empty scan.
    const elsewhere = new Map();
    let foreign = 0; // sitemaps whose URLs are all on another origin
    while (queue.length && !full()) {
      const url = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);
      const doc = await attempt(url, () => get(url));
      if (!doc) continue;
      const { index, locs } = parseSitemap(doc.text);
      // A page instead of a sitemap (a bot challenge, an app shell, a redirect home) has no
      // <loc>; an empty <urlset> is a real, empty sitemap.
      if (!locs.length && !index && !/<urlset[\s>]/i.test(doc.text)) {
        const why = movedAway(url, doc) || `not a sitemap (${doc.type || 'no content-type'})`;
        errors.push({ url, message: why });
        continue;
      }
      sitemaps.push(url);
      if (index) queue.push(...locs);
      else {
        let mine = 0;
        for (const loc of locs) {
          if (full()) break;
          const where = URL.canParse(loc) && new URL(loc).origin;
          if (where && where !== base.origin) elsewhere.set(where, (elsewhere.get(where) ?? 0) + 1);
          else {
            mine += 1;
            keep(loc);
          }
        }
        if (locs.length && !mine) foreign += 1;
      }
      // A sitemap lists one host's URLs. Three for other hosts and none for this one: the
      // origin is wrong (apex, http://), so stop before reading what can be hundreds of them.
      if (seen.size === 0 && foreign >= 3) break;
    }
    // The usual cause: the origin given is the apex or http:// version of the site.
    if (seen.size === 0 && elsewhere.size) {
      const [other] = [...elsewhere].sort((a, b) => b[1] - a[1])[0];
      errors.push({
        url: base.href,
        message: `the sitemaps list URLs of ${other} only; scan ${other} instead`,
      });
    }
  }

  // The start page is always fetched to discover links, but reported only if the patterns
  // allow it; of the links found, only those the patterns allow are followed.
  async function followLinks() {
    const queue = [base.href];
    seen.add(base.href);
    while (queue.length && !full()) {
      const url = queue.shift();
      await attempt(url, async () => {
        const doc = await get(url);
        const final = new URL(doc.url || url);
        final.hash = '';
        // Only the start page explains an empty result; a linked PDF is not worth an error.
        const why =
          final.origin !== base.origin
            ? `redirected to ${final.href}, another origin; scan ${final.origin} instead`
            : !doc.type.includes('html') && `not HTML (${doc.type || 'no content-type'})`;
        if (why) {
          if (url === base.href) errors.push({ url, message: why });
          return;
        }
        if (final.href !== url) {
          if (seen.has(final.href)) return;
          seen.add(final.href);
        }
        if (matches(final)) urls.push({ url: final.href, lang: langOf(final.pathname) });
        for (const link of extractLinks(doc.text, final.href)) {
          const u = accept(link);
          if (u) queue.push(u.href);
        }
      });
    }
  }

  if (strategy === 'http') await followLinks();
  else await walkSitemaps();
  return {
    origin: base.origin,
    strategy,
    total: seen.size,
    valid: urls.length,
    urls,
    sitemaps,
    errors,
  };
}
