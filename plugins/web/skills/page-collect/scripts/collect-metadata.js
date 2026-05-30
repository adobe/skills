/**
 * Metadata collector — extracts meta tags, Open Graph, structured
 * data, canonical URL, and favicon from a webpage.
 */

export async function collectMetadata(page) {
  return page.evaluate(() => {
    const meta = {};

    meta.title = document.title || null;

    meta.tags = {};
    for (const el of document.querySelectorAll('meta[name], meta[property]')) {
      const key = el.getAttribute('name') || el.getAttribute('property');
      const content = el.getAttribute('content');
      if (key && content) meta.tags[key] = content;
    }

    const canonical = document.querySelector('link[rel="canonical"]');
    meta.canonical = canonical ? canonical.getAttribute('href') : null;

    meta.structuredData = [];
    for (const script of document.querySelectorAll(
      'script[type="application/ld+json"]'
    )) {
      try {
        meta.structuredData.push(JSON.parse(script.textContent));
      } catch {
        // skip malformed JSON-LD
      }
    }

    const favicon =
      document.querySelector('link[rel="icon"]') ||
      document.querySelector('link[rel="shortcut icon"]');
    meta.favicon = favicon ? favicon.getAttribute('href') : null;

    return meta;
  });
}
