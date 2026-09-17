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
 *   - favicon serves 200
 */
import { fetchUrl, pMap, finding, pageUrl, stripTags, decodeAttr } from '../lib.mjs';

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

  const fav = await fetchUrl(`${base}/favicon.ico`, { method: 'HEAD' });
  if (fav.status !== 200) findings.push(finding('metadata', 'favicon-broken', 'warn', '', `favicon.ico returns ${fav.status}`));

  return findings;
}
