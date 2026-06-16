#!/usr/bin/env node
/* eslint-disable no-await-in-loop, no-console, no-restricted-syntax, no-continue --
   CLI batch tool: sequential async downloads are intentional (avoid hammering
   the source server); console is the output channel; for-of loops are clearer
   for ordered side effects; continue is clearer than nested ternaries for
   skip paths. */
/**
 * asset-collect.mjs
 *
 * Mechanical asset normalization for snowflake Phase 1 (Capture).
 * Scans index.html for in-scope asset references (raster images, videos,
 * fonts), classifies each by reachability, downloads local/unreachable
 * assets into normalized subdirectories, rewrites references in index.html,
 * and emits asset-manifest.json.
 *
 * In-scope types:
 *   images : .png .jpg .jpeg .webp .avif .gif
 *   videos : .mp4 .webm
 *   fonts  : .otf .woff .woff2 .ttf .eot
 *
 * Asset strategies (per-asset, not per-run):
 *   absolute  — stable public URL; leave as-is
 *   vendor    — local/unreachable font; download to fonts/
 *   da-media  — local/unreachable image or video; download to images/ or videos/
 *
 * Usage:
 *   node <SKILL_DIR>/scripts/asset-collect.mjs \
 *     --input  <path-to-input-dir> \
 *     --base-url <source-url>      \
 *     [--dry-run]
 *
 * Flags:
 *   --input     Directory containing index.html (required)
 *   --base-url  Original page URL for resolving relative refs (required)
 *   --dry-run   Classify without downloading or rewriting; print manifest to stdout
 *
 * Exit codes:
 *   0  Success (collected, no-op, or dry-run completed cleanly)
 *   1  Input error (missing flags, missing index.html)
 *   2  Fetch failure (hard stop, not recoverable)
 *   3  Filesystem error
 */

import { readFile, writeFile, mkdir, copyFile, access, stat } from 'node:fs/promises';
import { join, basename, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif']);
const VIDEO_EXTS = new Set(['.mp4', '.webm']);
const FONT_EXTS = new Set(['.otf', '.woff', '.woff2', '.ttf', '.eot']);

const STABLE_CDN_HOSTS = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'unpkg.com',
]);

const PRIVATE_IP_RE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

const log = (msg) => console.log(`[asset-collect] ${msg}`);
const warn = (msg) => console.warn(`[asset-collect] WARN: ${msg}`);
const die = (msg, code = 1) => { console.error(`[asset-collect] ERROR: ${msg}`); process.exit(code); };

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

/** @returns {{ inputDir: string, baseUrl: string, dryRun: boolean }} */
function parseArgs() {
  const args = process.argv.slice(2);
  let inputDir = '';
  let baseUrl = '';
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input') inputDir = args[++i] ?? '';
    else if (args[i] === '--base-url') baseUrl = args[++i] ?? '';
    else if (args[i] === '--dry-run') dryRun = true;
  }
  if (!inputDir) die('--input is required');
  if (!baseUrl) die('--base-url is required');
  return { inputDir, baseUrl, dryRun };
}

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

/**
 * @param {string} url
 * @returns {'image'|'video'|'font'|null}
 */
function assetType(url) {
  const ext = extname(new URL(url, 'http://x').pathname).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (FONT_EXTS.has(ext)) return 'font';
  return null;
}

/**
 * @param {string} resolvedUrl
 * @returns {'local'|'stable-cdn'|'reachable'}
 */
function reachability(resolvedUrl) {
  let host;
  try { host = new URL(resolvedUrl).hostname; } catch { return 'local'; }
  if (PRIVATE_IP_RE.test(host)) return 'local';
  if (STABLE_CDN_HOSTS.has(host)) return 'stable-cdn';
  return 'reachable';
}

/**
 * @param {'local'|'stable-cdn'|'reachable'} reach
 * @param {'image'|'video'|'font'} type
 * @returns {'absolute'|'vendor'|'da-media'}
 */
function strategy(reach, type) {
  if (reach !== 'local') return 'absolute';
  if (type === 'font') return 'vendor';
  return 'da-media';
}

/**
 * @param {'image'|'video'|'font'} type
 * @returns {string}
 */
function typeDir(type) {
  if (type === 'font') return 'fonts';
  if (type === 'video') return 'videos';
  return 'images';
}

// ---------------------------------------------------------------------------
// Filename normalization
// ---------------------------------------------------------------------------

const HASH_RE = /^[0-9a-f]{8,}$/i;

/**
 * Build a normalized filename for a downloaded asset.
 * For hash-named fonts, derive from @font-face context.
 *
 * @param {string} originalUrl - the raw URL as found in HTML
 * @param {'image'|'video'|'font'} type
 * @param {Map<string, {family: string, style: string}>} fontContext - basename → font metadata
 * @param {Set<string>} usedNames - already-claimed normalized names (collision guard)
 * @returns {string} e.g. "adobe-clean-spectrum-vf.woff2"
 */
function normalizeFilename(originalUrl, type, fontContext, usedNames) {
  const urlPath = (() => {
    try { return new URL(originalUrl).pathname; } catch { return originalUrl; }
  })();
  const base = basename(urlPath);
  const ext = extname(base).toLowerCase();
  const stem = base.slice(0, base.length - ext.length);
  const cleanStem = stem.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  let candidate;
  if (type === 'font' && HASH_RE.test(cleanStem)) {
    const ctx = fontContext.get(base);
    if (ctx) {
      const familySlug = ctx.family.toLowerCase().replace(/["']/g, '').trim()
        .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const italicSuffix = ctx.style === 'italic' ? '-italic' : '';
      candidate = `${familySlug}${italicSuffix}${ext}`;
    }
  }
  if (!candidate) candidate = `${cleanStem || 'asset'}${ext}`;

  // Collision guard
  if (!usedNames.has(candidate)) { usedNames.add(candidate); return candidate; }
  for (let n = 2; n < 1000; n++) {
    const alt = `${candidate.slice(0, candidate.length - ext.length)}-${n}${ext}`;
    if (!usedNames.has(alt)) { usedNames.add(alt); return alt; }
  }
  die(`Cannot resolve filename collision for ${candidate}`, 3);
}

// ---------------------------------------------------------------------------
// HTML/CSS scanning
// ---------------------------------------------------------------------------

/**
 * Extract @font-face context: basename → { family, style }.
 * Used for hash-named font renaming.
 *
 * @param {string} html
 * @returns {Map<string, {family: string, style: string}>}
 */
function extractFontContext(html) {
  const map = new Map();
  const faceRE = /@font-face\s*\{([^}]+)\}/gi;
  let m;
  while ((m = faceRE.exec(html)) !== null) {
    const block = m[1];
    const familyM = block.match(/font-family\s*:\s*(['"]?)([^;'"]+)\1/i);
    const styleM = block.match(/font-style\s*:\s*(\w+)/i);
    const srcM = block.match(/url\(['"]?([^'")\s]+)['"]?\)/g);
    if (!familyM || !srcM) continue;
    const family = familyM[2].trim();
    const style = styleM ? styleM[1].toLowerCase() : 'normal';
    for (const srcEntry of srcM) {
      const urlM = srcEntry.match(/url\(['"]?([^'")\s]+)['"]?\)/);
      if (urlM) map.set(basename(urlM[1]), { family, style });
    }
  }
  return map;
}

/**
 * Extract all in-scope asset URLs from HTML text.
 * Returns raw URL strings as they appear in the HTML (not resolved).
 *
 * @param {string} html
 * @returns {string[]}
 */
function scanHtml(html) {
  const found = new Set();

  const addIfInScope = (rawUrl) => {
    if (!rawUrl || rawUrl.startsWith('data:')) return;
    const ext = extname(new URL(rawUrl, 'http://x').pathname).toLowerCase();
    if (IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext) || FONT_EXTS.has(ext)) found.add(rawUrl);
  };

  // img src
  for (const m of html.matchAll(/<img[^>]+src=['"]([^'"]+)['"]/gi)) addIfInScope(m[1]);
  // img srcset / picture source srcset — "url [descriptor], url [descriptor]"
  for (const m of html.matchAll(/srcset=['"]([^'"]+)['"]/gi)) {
    for (const part of m[1].split(',')) {
      const url = part.trim().split(/\s+/)[0];
      if (url) addIfInScope(url);
    }
  }
  // video source src, video poster
  for (const m of html.matchAll(/<(?:source|video)[^>]+src=['"]([^'"]+)['"]/gi)) addIfInScope(m[1]);
  for (const m of html.matchAll(/poster=['"]([^'"]+)['"]/gi)) addIfInScope(m[1]);
  // inline style: background-image / content url()
  for (const m of html.matchAll(/style=['"][^'"]*url\((['"]?)([^'")\s]+)\1\)[^'"]*['"]/gi)) {
    addIfInScope(m[2]);
  }
  // CSS url() inside <style> blocks
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const u of m[1].matchAll(/url\((['"]?)([^'")\s]+)\1\)/g)) addIfInScope(u[2]);
  }

  return [...found];
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * Download or copy a single asset to dest path.
 *
 * @param {string} resolvedUrl
 * @param {string} inputDir - base for resolving file:// or relative paths
 * @param {string} destPath
 * @returns {Promise<number>} file size in bytes
 */
async function downloadAsset(resolvedUrl, inputDir, destPath) {
  await mkdir(dirname(destPath), { recursive: true });

  if (resolvedUrl.startsWith('file://')) {
    const src = fileURLToPath(resolvedUrl);
    await copyFile(src, destPath);
    return (await stat(destPath)).size;
  }

  const res = await fetch(resolvedUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buf);
  return buf.length;
}

// ---------------------------------------------------------------------------
// Idempotency check
// ---------------------------------------------------------------------------

/**
 * @param {string} inputDir
 * @returns {Promise<boolean>} true if already collected and all files present
 */
async function alreadyCollected(inputDir) {
  const manifestPath = join(inputDir, 'asset-manifest.json');
  try { await access(manifestPath); } catch { return false; }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const asset of manifest.assets ?? []) {
    if (asset.strategy === 'absolute' || !asset.normalizedPath) continue;
    try { await access(join(inputDir, asset.normalizedPath)); } catch { return false; }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { inputDir, baseUrl, dryRun } = parseArgs();

const indexPath = join(inputDir, 'index.html');
try { await access(indexPath); } catch { die(`index.html not found in ${inputDir}`, 1); }

if (!dryRun && await alreadyCollected(inputDir)) {
  log('already collected — skipping');
  process.exit(0);
}

const html = await readFile(indexPath, 'utf8');
const fontContext = extractFontContext(html);
const rawUrls = scanHtml(html);

log(`scanned ${rawUrls.length} in-scope asset reference(s)`);

const assets = [];
const warnings = [];
const usedNames = new Set();
const rewrites = new Map(); // originalUrl → normalizedPath

for (const originalUrl of rawUrls) {
  let resolvedUrl;
  try { resolvedUrl = new URL(originalUrl, baseUrl).toString(); } catch {
    warnings.push(`Cannot resolve URL '${originalUrl}' against base '${baseUrl}' — skipped`);
    continue;
  }

  const type = assetType(resolvedUrl);
  if (!type) continue;

  const reach = reachability(resolvedUrl);
  const strat = strategy(reach, type);

  const asset = { originalUrl, resolvedUrl, normalizedPath: null, type, reachability: reach, strategy: strat };

  if (strat === 'absolute') {
    if (type === 'font' && reach === 'reachable') {
      warnings.push(`Font '${originalUrl}' is cross-origin — may hit CORS issues in EDS`);
    }
    assets.push(asset);
    continue;
  }

  const filename = normalizeFilename(originalUrl, type, fontContext, usedNames);
  const normalizedPath = `${typeDir(type)}/${filename}`;
  const destPath = join(inputDir, normalizedPath);
  asset.normalizedPath = normalizedPath;

  if (!dryRun) {
    try {
      const size = await downloadAsset(resolvedUrl, inputDir, destPath);
      asset.size = size;
      log(`${strat === 'vendor' ? 'vendored' : 'downloaded'} ${originalUrl} → ${normalizedPath}`);
    } catch (err) {
      warnings.push(`Failed to fetch '${originalUrl}': ${err.message}`);
      asset.fetchFailed = true;
    }
  }

  rewrites.set(originalUrl, normalizedPath);
  assets.push(asset);
}

// Rewrite index.html in-place
if (!dryRun && rewrites.size > 0) {
  let rewritten = html;
  for (const [original, normalized] of rewrites) {
    rewritten = rewritten.replaceAll(original, normalized);
  }
  await writeFile(indexPath, rewritten, 'utf8');
  log(`rewrote ${rewrites.size} reference(s) in index.html`);
}

// Build manifest
const byStrategy = { absolute: 0, vendor: 0, 'da-media': 0 };
const byType = { font: 0, image: 0, video: 0 };
for (const a of assets) {
  byStrategy[a.strategy] = (byStrategy[a.strategy] ?? 0) + 1;
  byType[a.type] = (byType[a.type] ?? 0) + 1;
}

const manifest = {
  version: 1,
  sourceUrl: baseUrl,
  scannedAt: new Date().toISOString(),
  stats: { total: assets.length, byStrategy, byType },
  assets,
  warnings,
};

if (dryRun) {
  console.log(JSON.stringify(manifest, null, 2));
} else {
  await writeFile(join(inputDir, 'asset-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  log(`wrote asset-manifest.json (${assets.length} asset(s), ${warnings.length} warning(s))`);
}
