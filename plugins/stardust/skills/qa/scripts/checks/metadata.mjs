/**
 * qa/checks/metadata.mjs — category F: metadata / SEO (delivery layer, raw fetch).
 *
 * Per page (full HTML, no browser — what crawlers see):
 *   - <title> and meta description present; fleet-wide duplicates flagged
 *   - canonical present and pointing at the page itself
 *   - og:title / og:type / og:image (+ og:image:alt); og:image must serve 200
 *   - no noindex via meta robots or x-robots-tag on the live host
 *   - every ld+json script parses as JSON and carries @type
 *   - JSON-LD leak: structured data visible as body text (the metadata-block
 *     nesting failure) — "@context" must never appear in rendered text
 *   - favicon: the icon the home page links (default /favicon.ico) serves 200, is NOT the
 *     aem-boilerplate default (the recorded first-pass miss — the site's icon never shipped while
 *     /favicon.ico answered 200), and matches the captured stardust/current/assets/favicon.<ext>
 *     when that file exists (a format conversion is legitimate, so a mismatch is a warn)
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchUrl, pMap, finding, pageUrl, stripTags, decodeAttr } from '../lib.mjs';

/** sha256 of adobe/aem-boilerplate's favicon.ico — served when deploy Step 3 § Favicon was skipped. */
export const BOILERPLATE_FAVICON_SHA256 = '59aace6919696a103e9bb92db4f5384eb38dca610a42c52aed0cd95a6270474d';
export const CAPTURED_FAVICON_DIR = 'stardust/current/assets';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** href of the first <link rel~="icon"> in a page (any rel token containing "icon"), else /favicon.ico. */
export function iconHref(html) {
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = (tag.match(/\brel=["']([^"']*)["']/i) || [])[1] || '';
    if (!/(^|\s)(icon|shortcut icon)(\s|$)/i.test(rel)) continue;
    const href = (tag.match(/\bhref=["']([^"']*)["']/i) || [])[1];
    if (href) return decodeAttr(href);
  }
  return '/favicon.ico';
}

/** The captured source favicon (extract writes favicon.<ext>), or null. */
export function capturedFavicon(dir = CAPTURED_FAVICON_DIR) {
  if (!existsSync(dir)) return null;
  const name = readdirSync(dir).find((f) => /^favicon\.[a-z0-9]+$/i.test(f));
  return name ? readFileSync(join(dir, name)) : null;
}

/** Pure: { status, bytes, captured, href } → one finding descriptor or null. */
export function classifyFavicon({ status, bytes, captured = null, href = '/favicon.ico' }) {
  if (status !== 200 || !bytes || !bytes.length) return { id: 'favicon-broken', severity: 'error', message: `${href} returns ${status}` };
  const served = sha256(bytes);
  if (served === BOILERPLATE_FAVICON_SHA256) {
    return { id: 'favicon-default', severity: 'error', message: `${href} is the aem-boilerplate default icon — the site's favicon never shipped (deploy Step 3 § Favicon)` };
  }
  if (captured && sha256(captured) !== served) {
    return { id: 'favicon-mismatch', severity: 'warn', message: `${href} differs from the captured ${CAPTURED_FAVICON_DIR}/favicon.<ext> (sha256 ${served.slice(0, 12)}… vs ${sha256(captured).slice(0, 12)}…) — a format conversion, or the wrong icon` };
  }
  return null;
}

function meta(html, name) {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, 'i');
  const tag = (html.match(re) || [])[0];
  if (!tag) return null;
  const v = (tag.match(/content=["']([^"']*)["']/i) || [])[1];
  return v === undefined ? null : decodeAttr(v);
}

export async function run(ctx) {
  const { base, inventory } = ctx;
  const findings = [];
  const titles = new Map(); const descs = new Map();

  await pMap(inventory.pages, async (p) => {
    const res = await ctx.fetchPage(pageUrl(base, p.path));
    if (res.status !== 200) return;
    const html = res.body;

    const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]?.trim();
    if (!title) findings.push(finding('metadata', 'missing-title', 'error', p.path, 'page has no <title>'));
    else titles.set(p.path, title);

    const desc = meta(html, 'description');
    if (!desc) findings.push(finding('metadata', 'missing-description', 'warn', p.path, 'page has no meta description'));
    else descs.set(p.path, desc);

    const canonical = (html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i) || [])[0];
    const canonicalHref = canonical ? decodeAttr((canonical.match(/href=["']([^"']*)["']/i) || [])[1]) : null;
    if (!canonicalHref) {
      findings.push(finding('metadata', 'missing-canonical', 'warn', p.path, 'page has no canonical link'));
    } else {
      const want = pageUrl(base, p.path).replace(/\/$/, '');
      if (canonicalHref.replace(/\/$/, '') !== want) {
        findings.push(finding('metadata', 'canonical-mismatch', 'warn', p.path,
          `canonical is ${canonicalHref}, expected ${want}`));
      }
    }

    for (const key of ['og:title', 'og:type', 'og:image']) {
      if (!meta(html, key)) {
        findings.push(finding('metadata', `missing-${key.replace(':', '-')}`, 'warn', p.path, `page has no ${key}`));
      }
    }
    const ogImage = meta(html, 'og:image');
    if (ogImage) {
      if (!meta(html, 'og:image:alt')) {
        findings.push(finding('metadata', 'missing-og-image-alt', 'info', p.path, 'og:image has no og:image:alt'));
      }
      const imgUrl = ogImage.startsWith('http') ? ogImage : pageUrl(base, ogImage);
      const img = await fetchUrl(imgUrl, { method: 'HEAD' });
      if (img.status !== 200) {
        findings.push(finding('metadata', 'og-image-broken', 'error', p.path, `og:image returns ${img.status}: ${ogImage}`));
      }
    }

    const robotsMeta = meta(html, 'robots') || '';
    const robotsHeader = res.headers['x-robots-tag'] || '';
    if (/noindex/i.test(robotsMeta) || /noindex/i.test(robotsHeader)) {
      findings.push(finding('metadata', 'noindex-on-live', 'error', p.path,
        `page is noindex on the live host (${/noindex/i.test(robotsMeta) ? 'meta robots' : 'x-robots-tag header'})`));
    }

    // JSON-LD validity + type
    const ldScripts = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const [, raw] of ldScripts) {
      try {
        const doc = JSON.parse(raw);
        const types = [].concat(doc).flatMap((d) => (d['@graph'] ? d['@graph'] : [d])).map((d) => d['@type']).filter(Boolean);
        if (!types.length) {
          findings.push(finding('metadata', 'jsonld-no-type', 'warn', p.path, 'a JSON-LD script has no @type'));
        }
      } catch (e) {
        findings.push(finding('metadata', 'jsonld-invalid', 'error', p.path,
          `JSON-LD script fails to parse: ${e.message}`, { excerpt: raw.slice(0, 200) }));
      }
    }

    // JSON-LD leak into visible copy (metadata-block nesting failure)
    const bodyHtml = (html.split(/<body[^>]*>/i)[1] || html);
    if (/@context/.test(stripTags(bodyHtml))) {
      findings.push(finding('metadata', 'jsonld-visible-as-text', 'error', p.path,
        'structured data ("@context") appears in visible body text — JSON-LD row landed outside the metadata block'));
    }
  }, 8);

  // fleet-wide duplicate titles / descriptions
  for (const [label, map, id] of [['title', titles, 'duplicate-title'], ['description', descs, 'duplicate-description']]) {
    const byValue = new Map();
    for (const [path, v] of map) {
      if (!byValue.has(v)) byValue.set(v, []);
      byValue.get(v).push(path);
    }
    for (const [v, paths] of byValue) {
      if (paths.length > 1) {
        findings.push(finding('metadata', id, 'warn', paths[0],
          `${paths.length} pages share the same ${label}: "${v.slice(0, 80)}"`, { pages: paths }));
      }
    }
  }

  // favicon — once per sweep, from the icon the home page actually links
  const home = await ctx.fetchPage(pageUrl(base, '/'));
  const href = iconHref(home.status === 200 ? home.body : '');
  const iconUrl = /^data:/i.test(href) ? null : new URL(href, pageUrl(base, '/')).href;
  const fav = iconUrl ? await fetchUrl(iconUrl, { binary: true }) : { status: 200, bytes: Buffer.from(href) };
  const verdict = classifyFavicon({ status: fav.status, bytes: fav.bytes, captured: capturedFavicon(), href });
  if (verdict) findings.push(finding('metadata', verdict.id, verdict.severity, '', verdict.message, { href }));

  return findings;
}
