/**
 * Icon collector — extracts, classifies, and optimizes SVG icons
 * from a webpage.
 *
 * Extraction sources:
 * - Inline <svg> elements
 * - <img> tags pointing to SVG files or data URIs
 * - CSS background-image SVG data URIs
 * - SVG <use> sprites (resolved to standalone SVGs)
 *
 * Classification:
 * - icon:  rendered <= 48px, inside interactive element
 * - logo:  in brand area, "logo" in alt/class/src
 * - image: rendered > 48px, standalone
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ICON_MAX_SIZE = 48;

async function extractInlineSvgs(page) {
  return page.evaluate(() => {
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
        parentTag: parent?.tagName || null,
        parentClass: parent?.className || '',
        parentAriaLabel: parent?.getAttribute('aria-label') || '',
        parentHref: parent?.getAttribute('href') || '',
        containerTag: container?.tagName || null,
        containerClass: container?.className || '',
        id: svg.id || '',
        svgClass: svg.getAttribute('class') || '',
      });
    }
    return results;
  });
}

async function extractImgSvgs(page) {
  return page.evaluate(() => {
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
        parentTag: parent?.tagName || null,
        parentClass: parent?.className || '',
        parentAriaLabel: parent?.getAttribute('aria-label') || '',
        parentHref: parent?.getAttribute('href') || '',
        containerTag: container?.tagName || null,
        containerClass: container?.className || '',
        imgClass: img.className || '',
      });
    }
    return results;
  });
}

async function extractCssBgSvgs(page) {
  return page.evaluate(() => {
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
  });
}

async function extractSvgSprites(page) {
  return page.evaluate(() => {
    const results = [];
    for (const use of document.querySelectorAll('use')) {
      const href = use.getAttribute('href')
        || use.getAttribute('xlink:href') || '';
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
        parentTag: parent?.tagName || null,
        parentClass: parent?.className || '',
        parentAriaLabel: parent?.getAttribute('aria-label') || '',
      });
    }
    return results;
  });
}

async function extractRawSvgs(page) {
  const [inline, img, cssBg, sprites] = await Promise.all([
    extractInlineSvgs(page),
    extractImgSvgs(page),
    extractCssBgSvgs(page),
    extractSvgSprites(page),
  ]);
  return [...inline, ...img, ...cssBg, ...sprites];
}

async function resolveImgSvg(page, src) {
  if (src.startsWith('data:image/svg+xml,')) {
    return decodeURIComponent(
      src.replace('data:image/svg+xml,', '')
    );
  }
  if (src.startsWith('data:image/svg+xml;base64,')) {
    const b64 = src.replace(
      'data:image/svg+xml;base64,',
      ''
    );
    return Buffer.from(b64, 'base64').toString('utf-8');
  }
  try {
    return await page.evaluate(async (url) => {
      const res = await fetch(url);
      if (!res.ok) return null;
      return res.text();
    }, src);
  } catch {
    return null;
  }
}

function resolveCssBgSvg(backgroundImage) {
  const dataMatch = backgroundImage.match(
    /url\(["']?data:image\/svg\+xml,([^"')]+)["']?\)/
  );
  if (dataMatch) return decodeURIComponent(dataMatch[1]);

  const b64Match = backgroundImage.match(
    /url\(["']?data:image\/svg\+xml;base64,([^"')]+)["']?\)/
  );
  if (b64Match) {
    return Buffer.from(b64Match[1], 'base64').toString('utf-8');
  }

  return null;
}

function classify(entry) {
  const maxDim = Math.max(entry.width, entry.height);
  const allClasses = [
    entry.parentClass,
    entry.containerClass,
    entry.imgClass,
    entry.svgClass,
    entry.className,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const alt = (
    entry.alt ||
    entry.parentAriaLabel ||
    ''
  ).toLowerCase();

  if (
    allClasses.includes('logo') ||
    allClasses.includes('brand') ||
    alt.includes('logo')
  ) {
    return 'logo';
  }

  if (maxDim > ICON_MAX_SIZE && !entry.parentTag) {
    return 'image';
  }

  return 'icon';
}

const KNOWN_PATTERNS = [
  'search', 'cart', 'account', 'user', 'menu',
  'hamburger', 'close', 'globe', 'language', 'phone',
  'mail', 'email', 'heart', 'star', 'share',
  'download', 'arrow', 'chevron', 'caret', 'plus',
  'minus', 'check', 'info', 'warning', 'home',
  'settings', 'notification', 'bell', 'lock',
];

function deriveName(entry, index) {
  const candidates = [
    entry.parentAriaLabel,
    entry.alt,
    entry.id,
  ].filter(Boolean);

  const allClasses = [
    entry.parentClass,
    entry.imgClass,
    entry.svgClass,
    entry.className,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  for (const pattern of KNOWN_PATTERNS) {
    if (allClasses.includes(pattern)) {
      return { name: pattern, confidence: 'high' };
    }
  }

  for (const candidate of candidates) {
    const clean = candidate
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    if (clean.length > 0 && clean.length < 30) {
      return { name: clean, confidence: 'high' };
    }
  }

  return { name: `icon-${index}`, confidence: 'low' };
}

function optimizeSvg(svgString, classification) {
  let svg = svgString;

  svg = svg.replace(/<\?xml[^?]*\?>\s*/g, '');
  svg = svg.replace(/<!--[\s\S]*?-->/g, '');
  svg = svg.replace(/<metadata[\s\S]*?<\/metadata>/gi, '');
  svg = svg.replace(/<title[\s\S]*?<\/title>/gi, '');
  svg = svg.replace(/<desc[\s\S]*?<\/desc>/gi, '');

  svg = svg.replace(
    /\s*(xmlns:xlink|xmlns:sketch|xmlns:dc|xmlns:cc|xmlns:rdf|xmlns:sodipodi|xmlns:inkscape)="[^"]*"/g,
    ''
  );
  svg = svg.replace(
    /\s*(sketch:|sodipodi:|inkscape:)[a-z-]+="[^"]*"/gi,
    ''
  );
  svg = svg.replace(/\s*data-name="[^"]*"/g, '');
  svg = svg.replace(/\s*(?:class|aria-hidden|focusable|display|style)="[^"]*"/g, '');

  if (!svg.includes('viewBox')) {
    const wMatch = svg.match(/\bwidth=["'](\d+(?:\.\d+)?)["']/);
    const hMatch = svg.match(/\bheight=["'](\d+(?:\.\d+)?)["']/);
    if (wMatch && hMatch) {
      svg = svg.replace(
        '<svg',
        `<svg viewBox="0 0 ${wMatch[1]} ${hMatch[1]}"`
      );
    }
  }

  svg = svg.replace(/\s*(?<![\w-])width=["'][^"']*["']/g, '');
  svg = svg.replace(/\s*(?<![\w-])height=["'][^"']*["']/g, '');

  if (classification === 'icon') {
    svg = svg.replace(
      /\b(fill|stroke)="(?!none|currentColor|transparent)[^"]+"/g,
      '$1="currentColor"'
    );
    svg = svg.replace(
      /\b(fill|stroke)='(?!none|currentColor|transparent)[^']+'/g,
      "$1='currentColor'"
    );
  }

  svg = svg
    .replace(/\s{2,}/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();

  return svg;
}

export async function collectIcons(page, outputDir) {
  const iconsDir = join(outputDir, 'icons');
  await mkdir(iconsDir, { recursive: true });

  const rawEntries = await extractRawSvgs(page);
  const icons = [];

  let unnamedIndex = 1;
  const usedNames = new Set();
  const nameCollisionCounts = new Map();

  for (const entry of rawEntries) {
    const classification = classify(entry);

    if (classification === 'image') continue;

    let svgContent = null;

    if (entry.source === 'inline-svg') {
      svgContent = entry.svg;
    } else if (entry.source === 'img-svg') {
      svgContent = await resolveImgSvg(page, entry.src);
    } else if (entry.source === 'css-bg-svg') {
      svgContent = resolveCssBgSvg(entry.backgroundImage);
    } else if (entry.source === 'svg-sprite') {
      if (entry.symbolSvg) {
        svgContent = entry.symbolSvg
          .replace(
            /^<symbol/,
            '<svg xmlns="http://www.w3.org/2000/svg"'
          )
          .replace(/<\/symbol>$/, '</svg>');
      } else {
        svgContent = entry.fallbackSvg;
      }
    }

    if (!svgContent) continue;

    const { name: rawName, confidence } = deriveName(
      entry,
      unnamedIndex
    );
    let name = rawName;
    if (usedNames.has(name)) {
      const count = (nameCollisionCounts.get(rawName) || 1) + 1;
      nameCollisionCounts.set(rawName, count);
      name = `${rawName}-${count}`;
    }
    if (confidence === 'low') unnamedIndex++;
    usedNames.add(name);

    const optimized = optimizeSvg(svgContent, classification);

    const filename = `${name}.svg`;
    await writeFile(join(iconsDir, filename), optimized);

    const context = [
      entry.containerTag
        ? entry.containerTag.toLowerCase()
        : '',
      entry.parentTag
        ? entry.parentTag.toLowerCase()
        : '',
      entry.parentAriaLabel || '',
    ]
      .filter(Boolean)
      .join(' ');

    icons.push({
      name,
      class: classification,
      source: entry.source,
      file: `icons/${filename}`,
      nameConfidence: confidence,
      context: context || 'unknown',
    });
  }

  const manifest = {
    url: page.url(),
    icons,
  };

  await writeFile(
    join(outputDir, 'icons.json'),
    JSON.stringify(manifest, null, 2)
  );

  return manifest;
}
