#!/usr/bin/env node
/**
 * rollout/assemble.mjs — site-level assembly (Phase 2).
 *
 * Generates the artifacts that only make sense for the whole site (not any single
 * page): sitemap.xml + robots.txt from the delivery coverage, and a fragments
 * manifest mapping the canon chrome to the EDS static fragments deploy injects.
 * Deterministic outputs staged under stardust/rollout/site/; the actual push of
 * fragments is deploy's job (this only prepares + records what to push).
 *
 * Usage: node skills/rollout/scripts/assemble.mjs [--out <rolloutDir>] [--canon <dir>]
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJSON, writeJSON } from './lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback; }
const OUT = arg('out', 'stardust/rollout');
const CANON = arg('canon', 'stardust/canon');

const pagesDoc = readJSON(join(OUT, 'coverage', 'pages.json'));
const blocksDoc = readJSON(join(OUT, 'coverage', 'blocks.json'));
const config = readJSON(join(OUT, 'rollout.json'), {});
if (!pagesDoc) { console.error('rollout assemble: run inventory.mjs first.'); process.exit(1); }

const pages = pagesDoc.pages || [];
const host = (config.site && config.site.liveHost) ? `https://${config.site.liveHost}` : '';
const siteDir = join(OUT, 'site');
mkdirSync(siteDir, { recursive: true });

// sitemap.xml — delivered (extensionless) paths.
const urls = pages.map((p) => `  <url><loc>${host}${p.path}</loc></url>`).join('\n');
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
writeFileSync(join(siteDir, 'sitemap.xml'), sitemap);

// robots.txt
const robots = `User-agent: *\nAllow: /\n${host ? `Sitemap: ${host}/sitemap.xml\n` : ''}`;
writeFileSync(join(siteDir, 'robots.txt'), robots);

// Fragments manifest — chrome blocks → static fragment targets, with canon source.
const chrome = ((blocksDoc && blocksDoc.blocks) || []).filter((b) => b.kind === 'chrome');
const fragmentSrc = { header: join(CANON, 'header.html'), nav: join(CANON, 'header.html'), footer: join(CANON, 'footer.html') };
const fragments = chrome.map((b) => ({
  id: b.id,
  target: b.delivery.blockPath || `fragments/${b.id}.html`,
  canonSource: existsSync(fragmentSrc[b.id]) ? fragmentSrc[b.id] : null,
  status: b.delivery.status,
}));

const now = new Date().toISOString();
writeJSON(join(siteDir, 'manifest.json'), {
  _provenance: { writtenBy: 'stardust:rollout/assemble', writtenAt: now, stardustVersion: (config._provenance || {}).stardustVersion || '0.0.0' },
  generatedAt: now,
  host: host || null,
  sitemap: join(siteDir, 'sitemap.xml'),
  robots: join(siteDir, 'robots.txt'),
  fragments,
});

console.log(`rollout assemble → ${siteDir}`);
console.log('='.repeat(60));
console.log(`sitemap.xml   ${pages.length} urls${host ? ` @ ${host}` : ' (no liveHost set — relative locs)'}`);
console.log(`robots.txt    written`);
console.log(`fragments     ${fragments.length}: ${fragments.map((f) => `${f.id}${f.canonSource ? '' : ' (no canon source!)'}`).join(', ') || 'none'}`);
if (fragments.some((f) => !f.canonSource)) console.log('  ⚠ some chrome has no canon/*.html source — deploy must lift it from a delivered page.');
