/**
 * page-collect-bundle.js — in-page extraction bundle.
 *
 * Injected via playwright-cli initScript. Exposes:
 *   window.__pageCollect.extract(which)
 *
 * @param {null|'all'|string[]} which  null/'all' = all collectors;
 *   array of collector names = subset, e.g. ['icons', 'metadata'].
 * @returns {Promise<object>} raw extraction data — resolved in-page,
 *   ready for Node-side processing (classify/optimise/write).
 */
(function () {
  'use strict';

  // ─── Constants ──────────────────────────────────────────────────────────────

  const SOCIAL_DOMAINS = {
    'facebook.com': 'facebook',
    'fb.com': 'facebook',
    'twitter.com': 'twitter',
    'x.com': 'twitter',
    'linkedin.com': 'linkedin',
    'instagram.com': 'instagram',
    'youtube.com': 'youtube',
    'youtu.be': 'youtube',
    'tiktok.com': 'tiktok',
    'pinterest.com': 'pinterest',
    'github.com': 'github',
    'reddit.com': 'reddit',
    'threads.net': 'threads',
    'mastodon.social': 'mastodon',
    'bsky.app': 'bluesky',
  };

  const VIDEO_HOSTS = [
    'youtube.com', 'youtu.be', 'vimeo.com',
    'wistia.com', 'wistia.net', 'dailymotion.com', 'twitch.tv',
  ];

  // ─── SVG helpers ────────────────────────────────────────────────────────────

  /** Decode a base-64 string as UTF-8 without Buffer (browser-compatible). */
  function decodeBase64Utf8(b64) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  /**
   * Resolve a CSS background-image value that contains an inline SVG data URI.
   * Returns the SVG string, or null if the value is not an inline SVG.
   */
  function resolveCssBgSvg(backgroundImage) {
    const dataMatch = backgroundImage.match(
      /url\(["']?data:image\/svg\+xml,([^"')]+)["']?\)/
    );
    if (dataMatch) return decodeURIComponent(dataMatch[1]);

    const b64Match = backgroundImage.match(
      /url\(["']?data:image\/svg\+xml;base64,([^"')]+)["']?\)/
    );
    if (b64Match) return decodeBase64Utf8(b64Match[1]);

    return null; // external URL — not resolved in-page
  }

  /**
   * Resolve an <img src> to its SVG text.
   * Handles data URIs synchronously, external URLs via fetch.
   */
  async function resolveImgSvg(src) {
    if (!src) return null;
    if (src.startsWith('data:image/svg+xml,')) {
      return decodeURIComponent(src.replace('data:image/svg+xml,', ''));
    }
    if (src.startsWith('data:image/svg+xml;base64,')) {
      return decodeBase64Utf8(src.replace('data:image/svg+xml;base64,', ''));
    }
    try {
      const res = await fetch(src);
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  }

  // ─── SVG extraction ─────────────────────────────────────────────────────────

  function extractInlineSvgs() {
    const results = [];
    for (const svg of document.querySelectorAll('svg')) {
      const rect = svg.getBoundingClientRect();
      const parent = svg.closest('a, button');
      const container = svg.closest('header, nav, [class*="brand"]');
      results.push({
        source: 'inline-svg',
        svg: svg.outerHTML,
        width: rect.width,
        height: rect.height,
        parentTag: parent ? parent.tagName : null,
        parentClass: parent ? (parent.className || '') : '',
        parentAriaLabel: parent ? (parent.getAttribute('aria-label') || '') : '',
        parentHref: parent ? (parent.getAttribute('href') || '') : '',
        containerTag: container ? container.tagName : null,
        containerClass: container ? (container.className || '') : '',
        id: svg.id || '',
        svgClass: svg.getAttribute('class') || '',
      });
    }
    return results;
  }

  function extractImgSvgsRaw() {
    const results = [];
    for (const img of document.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      if (!src.includes('.svg') && !src.includes('image/svg+xml')) continue;
      const rect = img.getBoundingClientRect();
      const parent = img.closest('a, button');
      const container = img.closest('header, nav, [class*="brand"]');
      results.push({
        source: 'img-svg',
        src,
        alt: img.alt || '',
        width: rect.width,
        height: rect.height,
        parentTag: parent ? parent.tagName : null,
        parentClass: parent ? (parent.className || '') : '',
        parentAriaLabel: parent ? (parent.getAttribute('aria-label') || '') : '',
        parentHref: parent ? (parent.getAttribute('href') || '') : '',
        containerTag: container ? container.tagName : null,
        containerClass: container ? (container.className || '') : '',
        imgClass: img.className || '',
      });
    }
    return results;
  }

  function extractCssBgSvgsRaw() {
    const results = [];
    for (const el of document.querySelectorAll('*')) {
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === 'none') continue;
      if (!bg.includes('image/svg+xml') && !bg.includes('.svg')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      results.push({
        source: 'css-bg-svg',
        backgroundImage: bg,
        width: rect.width,
        height: rect.height,
        tag: el.tagName,
        className: el.className || '',
        id: el.id || '',
      });
    }
    return results;
  }

  function extractSvgSprites() {
    const results = [];
    for (const use of document.querySelectorAll('use')) {
      const href = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
      if (!href) continue;
      const svg = use.closest('svg');
      if (!svg) continue;
      const rect = svg.getBoundingClientRect();
      const parent = svg.closest('a, button');
      const symbolId = href.startsWith('#') ? href.slice(1) : '';
      const symbol = symbolId ? document.getElementById(symbolId) : null;
      results.push({
        source: 'svg-sprite',
        href,
        symbolSvg: symbol ? symbol.outerHTML : null,
        fallbackSvg: svg.outerHTML,
        width: rect.width,
        height: rect.height,
        parentTag: parent ? parent.tagName : null,
        parentClass: parent ? (parent.className || '') : '',
        parentAriaLabel: parent ? (parent.getAttribute('aria-label') || '') : '',
      });
    }
    return results;
  }

  // ─── Other collectors ───────────────────────────────────────────────────────

  function collectMetadata() {
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
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { meta.structuredData.push(JSON.parse(script.textContent)); } catch { /* skip */ }
    }
    const favicon =
      document.querySelector('link[rel="icon"]') ||
      document.querySelector('link[rel="shortcut icon"]');
    meta.favicon = favicon ? favicon.getAttribute('href') : null;
    return meta;
  }

  function collectText() {
    const lang = document.documentElement.getAttribute('lang') || 'und';
    const headings = [];
    for (const h of document.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      const text = h.textContent.trim();
      if (text) headings.push({ level: parseInt(h.tagName.substring(1), 10), text });
    }
    const exclude = 'nav, footer, script, style, noscript, svg, [hidden]';
    const clone = document.body.cloneNode(true);
    for (const el of clone.querySelectorAll(exclude)) el.remove();
    const text = clone.textContent.replace(/\s+/g, ' ').trim();
    const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
    return { language: lang, headings, text, wordCount };
  }

  function collectForms() {
    const forms = [];
    for (const form of document.querySelectorAll('form')) {
      const fields = [];
      for (const input of form.querySelectorAll(
        'input, select, textarea, button[type="submit"]'
      )) {
        const label =
          input.getAttribute('aria-label') ||
          input.getAttribute('placeholder') ||
          (form.querySelector(`label[for="${input.id}"]`) || {}).textContent?.trim() ||
          null;
        fields.push({
          tag: input.tagName.toLowerCase(),
          type: input.getAttribute('type') || null,
          name: input.getAttribute('name') || null,
          required: input.hasAttribute('required'),
          label,
        });
      }
      forms.push({
        action: form.getAttribute('action') || null,
        method: (form.getAttribute('method') || 'get').toLowerCase(),
        id: form.id || null,
        className: form.className || null,
        fields,
      });
    }
    return { forms };
  }

  function collectVideos() {
    const videos = [];
    for (const video of document.querySelectorAll('video')) {
      const sources = [];
      const src = video.getAttribute('src');
      if (src) sources.push({ src, type: null });
      for (const source of video.querySelectorAll('source')) {
        sources.push({ src: source.getAttribute('src'), type: source.getAttribute('type') });
      }
      videos.push({ type: 'native', poster: video.getAttribute('poster') || null, sources });
    }
    for (const iframe of document.querySelectorAll('iframe[src]')) {
      const src = iframe.getAttribute('src');
      if (VIDEO_HOSTS.some((h) => src.includes(h))) {
        videos.push({
          type: 'embed',
          src,
          width: iframe.getAttribute('width') || null,
          height: iframe.getAttribute('height') || null,
        });
      }
    }
    return { videos };
  }

  function collectSocials() {
    const socials = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (!href || seen.has(href)) continue;
      for (const [domain, platform] of Object.entries(SOCIAL_DOMAINS)) {
        if (href.includes(domain)) {
          seen.add(href);
          const isShare = href.includes('share') || href.includes('sharer') ||
            href.includes('intent/tweet');
          socials.push({
            platform,
            url: href,
            type: isShare ? 'share' : 'profile',
            text: a.textContent.trim().substring(0, 100) || null,
          });
          break;
        }
      }
    }
    return { socials };
  }

  // ─── Main entry point ────────────────────────────────────────────────────────

  /**
   * @param {null|'all'|string[]} which
   *   null or 'all' = all collectors.
   *   Array = subset, e.g. ['icons', 'text'].
   */
  async function extract(which) {
    const all = !which || which === 'all';
    const wants = (name) => all || (Array.isArray(which) && which.includes(name));

    const result = { url: window.location.href };

    if (wants('icons')) {
      const inlineSvgs = extractInlineSvgs();
      const imgSvgsRaw = extractImgSvgsRaw();
      const cssBgSvgsRaw = extractCssBgSvgsRaw();
      const sprites = extractSvgSprites();

      // Resolve img-svg URLs (may involve network fetch — must be async)
      const imgSvgs = await Promise.all(
        imgSvgsRaw.map(async (e) => ({ ...e, resolvedSvg: await resolveImgSvg(e.src) }))
      );

      // Resolve CSS bg SVGs from data URIs (sync, but keep shape consistent)
      const cssBgSvgs = cssBgSvgsRaw.map((e) => ({
        ...e,
        resolvedSvg: resolveCssBgSvg(e.backgroundImage),
      }));

      result.svgs = [...inlineSvgs, ...imgSvgs, ...cssBgSvgs, ...sprites];
    }

    if (wants('metadata')) result.metadata = collectMetadata();
    if (wants('text'))     result.text     = collectText();
    if (wants('forms'))    result.forms    = collectForms();
    if (wants('videos'))   result.videos   = collectVideos();
    if (wants('socials'))  result.socials  = collectSocials();

    return result;
  }

  window.__pageCollect = { extract };
})();
