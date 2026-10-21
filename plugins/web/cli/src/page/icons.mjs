import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ICON_MAX_SIZE = 48;

export const KNOWN_PATTERNS = [
  'search',
  'cart',
  'account',
  'user',
  'menu',
  'hamburger',
  'close',
  'globe',
  'language',
  'phone',
  'mail',
  'email',
  'heart',
  'star',
  'share',
  'download',
  'arrow',
  'chevron',
  'caret',
  'plus',
  'minus',
  'check',
  'info',
  'warning',
  'home',
  'settings',
  'notification',
  'bell',
  'lock',
];

export function classify(entry) {
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
  const alt = (entry.alt || entry.parentAriaLabel || '').toLowerCase();

  if (allClasses.includes('logo') || allClasses.includes('brand') || alt.includes('logo')) {
    return 'logo';
  }
  if (maxDim > ICON_MAX_SIZE && !entry.parentTag) return 'image';
  return 'icon';
}

export function deriveName(entry, index) {
  const candidates = [entry.parentAriaLabel, entry.alt, entry.id].filter(Boolean);
  const allClasses = [entry.parentClass, entry.imgClass, entry.svgClass, entry.className]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  for (const pattern of KNOWN_PATTERNS) {
    if (allClasses.includes(pattern)) return { name: pattern, confidence: 'high' };
  }
  for (const candidate of candidates) {
    const clean = candidate
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    if (clean.length > 0 && clean.length < 30) return { name: clean, confidence: 'high' };
  }
  return { name: `icon-${index}`, confidence: 'low' };
}

export function optimizeSvg(svgString, classification) {
  let svg = svgString;
  svg = svg.replace(/<\?xml[^?]*\?>\s*/g, '');
  svg = svg.replace(/<!--[\s\S]*?-->/g, '');
  svg = svg.replace(/<metadata[\s\S]*?<\/metadata>/gi, '');
  svg = svg.replace(/<title[\s\S]*?<\/title>/gi, '');
  svg = svg.replace(/<desc[\s\S]*?<\/desc>/gi, '');
  svg = svg.replace(/\s*(xmlns:(?:xlink|sketch|dc|cc|rdf|sodipodi|inkscape))="[^"]*"/g, '');
  svg = svg.replace(/\s*(sketch:|sodipodi:|inkscape:)[a-z-]+="[^"]*"/gi, '');
  svg = svg.replace(/\s*data-name="[^"]*"/g, '');
  svg = svg.replace(/\s*(?:class|aria-hidden|focusable|display|style)="[^"]*"/g, '');

  if (!svg.includes('viewBox')) {
    const wMatch = svg.match(/\bwidth=["'](\d+(?:\.\d+)?)["']/);
    const hMatch = svg.match(/\bheight=["'](\d+(?:\.\d+)?)["']/);
    if (wMatch && hMatch) {
      svg = svg.replace('<svg', `<svg viewBox="0 0 ${wMatch[1]} ${hMatch[1]}"`);
    }
  }
  svg = svg.replace(/\s*(?<![\w-])width=["'][^"']*["']/g, '');
  svg = svg.replace(/\s*(?<![\w-])height=["'][^"']*["']/g, '');

  if (classification === 'icon') {
    svg = svg.replace(
      /\b(fill|stroke)="(?!none|currentColor|transparent)[^"]+"/g,
      '$1="currentColor"',
    );
    svg = svg.replace(
      /\b(fill|stroke)='(?!none|currentColor|transparent)[^']+'/g,
      "$1='currentColor'",
    );
  }
  svg = svg
    .replace(/\s{2,}/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();
  return svg;
}

function dropSpriteDuplicates(svgs) {
  const resolved = svgs.filter((e) => e.source === 'svg-sprite' && e.symbolSvg);
  const resolvedFallbacks = new Set(resolved.map((e) => e.fallbackSvg));
  const inlineSvgs = new Set(svgs.filter((e) => e.source === 'inline-svg').map((e) => e.svg));
  return svgs.filter((e) => {
    if (e.source === 'inline-svg') return !resolvedFallbacks.has(e.svg);
    if (e.source === 'svg-sprite' && !e.symbolSvg) return !inlineSvgs.has(e.fallbackSvg);
    return true;
  });
}

/**
 * Write classified, optimized SVGs and an icons.json manifest into `iconsDir`.
 * @returns {{ url: string, icons: object[] }} the manifest written
 */
export function writeIcons(svgs, url, iconsDir) {
  mkdirSync(iconsDir, { recursive: true });

  const icons = [];
  let unnamedIndex = 1;
  const usedNames = new Set();
  const nameCollisionCounts = new Map();

  for (const entry of dropSpriteDuplicates(svgs)) {
    const classification = classify(entry);
    if (classification === 'image') continue;

    let svgContent = null;
    if (entry.source === 'inline-svg') {
      svgContent = entry.svg;
    } else if (entry.source === 'img-svg') {
      svgContent = entry.resolvedSvg || null;
    } else if (entry.source === 'css-bg-svg') {
      svgContent = entry.resolvedSvg || null;
    } else if (entry.source === 'svg-sprite') {
      if (entry.symbolSvg) {
        svgContent = entry.symbolSvg
          .replace(/^<symbol/, '<svg xmlns="http://www.w3.org/2000/svg"')
          .replace(/<\/symbol>$/, '</svg>');
      } else {
        svgContent = entry.fallbackSvg;
      }
    }

    if (!svgContent) continue;

    const { name: rawName, confidence } = deriveName(entry, unnamedIndex);
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
    writeFileSync(join(iconsDir, filename), optimized);

    const context = [
      entry.containerTag ? entry.containerTag.toLowerCase() : '',
      entry.parentTag ? entry.parentTag.toLowerCase() : '',
      entry.parentAriaLabel || '',
    ]
      .filter(Boolean)
      .join(' ');

    icons.push({
      name,
      class: classification,
      source: entry.source,
      file: filename,
      nameConfidence: confidence,
      context: context || 'unknown',
    });
  }

  const manifest = { url, icons };
  writeFileSync(join(iconsDir, 'icons.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
