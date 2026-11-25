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
const decodeXml = (s) =>
  s.replace(/&(?:amp|lt|gt|quot|apos|#(\d+)|#x([\da-fA-F]+));/g, (e, dec, hex) => {
    if (!dec && !hex) return ENTITIES[e];
    const point = dec ? Number(dec) : parseInt(hex, 16);
    return point <= 0x10ffff ? String.fromCodePoint(point) : e;
  });

const escapeXml = (s) =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

/** Canonical case of a language tag: `EN_us` → `en-US`, `zh-hant-tw` → `zh-Hant-TW`. */
function canonicalTag(tag) {
  return tag
    .split(/[-_]/)
    .map((part, i) => {
      if (i === 0) return part.toLowerCase();
      if (/^[a-z]{4}$/i.test(part)) return part[0].toUpperCase() + part.slice(1).toLowerCase();
      return /^[a-z]{2}$/i.test(part) ? part.toUpperCase() : part.toLowerCase();
    })
    .join('-');
}

/** @returns {{ index: boolean, urlset: boolean, entries: {loc: string, alternates: {href: string, lang: string}[]}[] }} */
export function parseSitemap(source) {
  // Comments go and CDATA becomes escaped text, so one decoder reads every value. An unclosed
  // section runs to the end of the file.
  const xml = source.replace(
    /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[([\s\S]*?)(?:\]\]>|$)/g,
    (_m, cdata) => (cdata === undefined ? '' : escapeXml(cdata)),
  );
  const root = /<([\w.-]+:)?(sitemapindex|urlset)(?=[\s/>])/i.exec(xml);
  const index = root?.[2].toLowerCase() === 'sitemapindex';
  // Entries and their <loc> share the root's prefix; extension elements (image:loc) don't.
  const ns = (root?.[1] ?? '').replace(/\./g, '\\.');
  const open = new RegExp(`<${ns}${index ? 'sitemap' : 'url'}(?=[\\s>])[^>]*>`, 'gi');
  const locRe = new RegExp(`<${ns}loc\\s*>([^<]*)<\\/${ns}loc\\s*>`, 'i');
  const starts = [...xml.matchAll(open)];
  const entries = [];
  starts.forEach((start, i) => {
    // An entry runs to the next one, so a missing </url> loses nothing.
    const block = xml.slice(start.index + start[0].length, starts[i + 1]?.index ?? xml.length);
    const loc = decodeXml(locRe.exec(block)?.[1] ?? '').trim();
    if (!loc) return;
    const alternates = [];
    if (!index) {
      for (const [, attrs] of block.matchAll(
        /<(?:[\w.-]+:)?link\s((?:[^"'<>]|"[^"]*"|'[^']*')*)>/gi,
      )) {
        const values = new Map();
        for (const [, name, double, single] of attrs.matchAll(
          /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
        )) {
          values.set(name.toLowerCase(), decodeXml(double ?? single).trim());
        }
        const lang = values.get('hreflang');
        const href = values.get('href');
        const rel = values.get('rel')?.toLowerCase().split(/\s+/) ?? [];
        if (rel.includes('alternate') && lang && href) alternates.push({ href, lang });
      }
    }
    entries.push({ loc, alternates });
  });
  return { index, urlset: root?.[2].toLowerCase() === 'urlset', entries };
}

function normalizedUrl(raw) {
  const url = URL.parse(raw);
  if (url) url.hash = '';
  return url;
}

/**
 * Group the scanned URLs with their language variants. As Google requires, two URLs that a
 * read sitemap lists are variants only when each declares the other. A declared URL that no
 * read sitemap lists (another origin, a sitemap not read) can't answer: it is taken on trust
 * from each URL that declares it, and joins no groups together.
 */
function groupVariants(scanned) {
  const answers = (from, to) => to === from || !to.read || to.declares.has(from);
  const owner = new Map();
  const groups = [];
  for (const start of scanned) {
    if (owner.has(start)) continue;
    // member → the tags its group declares for it, in discovery order
    const members = new Map([[start, new Set()]]);
    owner.set(start, members);
    for (const node of members.keys()) {
      for (const [target, tags] of node.declares) {
        if (!answers(node, target)) continue;
        if (!members.has(target)) {
          members.set(target, new Set());
          if (target.read) owner.set(target, members);
        }
        for (const tag of tags) members.get(target).add(tag);
      }
    }
    const owned = [...members.keys()].filter((m) => owner.get(m) === members);
    const fallback = [...members]
      .filter(([, tags]) => tags.has('x-default'))
      .map(([m]) => m.url)
      .sort()[0];
    groups.push({ members, owned, fallback });
  }
  // An x-default that several groups share (often the home page) names none of them.
  const proposed = new Map();
  for (const { fallback } of groups) {
    if (fallback) proposed.set(fallback, (proposed.get(fallback) ?? 0) + 1);
  }
  return groups.map(({ members, owned, fallback }) => ({
    url: proposed.get(fallback) === 1 ? fallback : owned.map((m) => m.url).sort()[0],
    variants: [...members]
      .filter(([m, tags]) => owner.get(m) === members || [...tags].some((t) => t !== 'x-default'))
      .map(([m, tags]) => ({
        lang: [...new Set([m.lang, ...tags])].filter((t) => t && t !== 'x-default'),
        url: m.url,
      })),
  }));
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
 * Collect same-origin URLs from sitemaps or by following links. Declared alternates can
 * be on other origins and do not count as scanned URLs.
 * @param {string} origin start URL
 * @param {{ strategy?: 'sitemaps'|'http', include?: string[], exclude?: string[],
 *   limit?: number, timeoutMs?: number, headers?: object }} [options]
 * @returns {Promise<{ origin: string, strategy: string, total: number, valid: number,
 *   urls: {url: string, variants: {url: string, lang: string[]}[]}[], scannedUrls: string[],
 *   sitemaps: string[], errors: {url: string, message: string}[] }>}
 */
export async function crawl(origin, options = {}) {
  const { strategy = 'sitemaps', limit, timeoutMs = 10000, headers } = options;
  const include = (options.include ?? []).map(globToRegExp);
  const exclude = (options.exclude ?? []).map(globToRegExp);
  const base = new URL(origin);
  const seen = new Set();
  const scanned = [];
  const sitemaps = [];
  const errors = [];
  const full = () => limit !== undefined && scanned.length >= limit;
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
  const accept = (u) => {
    if (u.origin !== base.origin || seen.has(u.href)) return false;
    seen.add(u.href);
    return matches(u);
  };
  const nodes = new Map();
  /** One node per URL a sitemap names; `read` once its own <url> entry was parsed. */
  const nodeFor = (u) => {
    if (!nodes.has(u.href)) {
      nodes.set(u.href, {
        url: u.href,
        lang: langOf(u.pathname),
        read: false,
        declares: new Map(),
      });
    }
    return nodes.get(u.href);
  };
  const declare = (u, alternates) => {
    const source = nodeFor(u);
    source.read = true;
    for (const { href, lang } of alternates) {
      const target = normalizedUrl(href);
      if (!target || !['http:', 'https:'].includes(target.protocol)) continue;
      const node = nodeFor(target);
      if (!source.declares.has(node)) source.declares.set(node, new Set());
      source.declares.get(node).add(canonicalTag(lang));
    }
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
      const { index, urlset, entries } = parseSitemap(doc.text);
      // A page instead of a sitemap (a bot challenge, an app shell, a redirect home) has no
      // <loc>; an empty <urlset> is a real, empty sitemap.
      if (!entries.length && !index && !urlset) {
        const why = movedAway(url, doc) || `not a sitemap (${doc.type || 'no content-type'})`;
        errors.push({ url, message: why });
        continue;
      }
      sitemaps.push(url);
      if (index) queue.push(...entries.map(({ loc }) => loc));
      else {
        let mine = 0;
        // Finish reading declarations in this file even if the URL limit was reached.
        for (const { loc, alternates } of entries) {
          const u = normalizedUrl(loc);
          const where = u?.origin;
          if (where && where !== base.origin) elsewhere.set(where, (elsewhere.get(where) ?? 0) + 1);
          else {
            mine += 1;
            if (!u) continue;
            if (!full() && accept(u)) scanned.push(nodeFor(u));
            declare(u, alternates);
          }
        }
        if (entries.length && !mine) foreign += 1;
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
        if (matches(final)) scanned.push(nodeFor(final));
        for (const link of extractLinks(doc.text, final.href)) {
          const u = new URL(link);
          if (accept(u)) queue.push(u.href);
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
    valid: scanned.length,
    urls: groupVariants(scanned),
    scannedUrls: scanned.map((node) => node.url),
    sitemaps,
    errors,
  };
}
