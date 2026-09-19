#!/usr/bin/env node
/**
 * rollout/assemble.mjs — site-level assembly (Phase 2).
 *
 * Generates the artifacts that only make sense for the whole site (not any single
 * page): sitemap.xml + robots.txt from the delivery coverage, and a fragments
 * manifest mapping the canon chrome to the authored /nav + /footer documents deploy publishes.
 * Deterministic outputs staged under stardust/rollout/site/; the actual push of
 * fragments is deploy's job (this only prepares + records what to push).
 *
 * sitemap.xml lists only rows that are live pages: `delivery.type` page (not
 * fragment/index rows) with status deployed | verified | stale, at their
 * served path (`delivery.deployedPath` else `path`). Undelivered rows are not
 * URLs yet. Host = rollout.json site.liveHost normalised (lib.mjs siteBase).
 *
 * Usage: node skills/rollout/scripts/assemble.mjs [--out <rolloutDir>] [--canon <dir>]
 * Exit: 0 written · 2 coverage missing (run inventory.mjs first — the family precondition code)
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJSON, writeJSON, siteBase, deliveredPathOf, artifactType } from './lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); if (i === -1) return fallback; const v = process.argv[i + 1]; if (v === undefined || v.startsWith('--')) { console.error(`rollout assemble: --${name} needs a value`); process.exit(2); } return v; } // never swallow the next flag
if (process.argv.includes('--help')) { console.log('Usage: node skills/rollout/scripts/assemble.mjs [--out <rolloutDir>] [--canon <dir>]\n  exit 0 written · 2 coverage missing'); process.exit(0); }
const OUT = arg('out', 'stardust/rollout');
const CANON = arg('canon', 'stardust/canon');

const pagesDoc = readJSON(join(OUT, 'coverage', 'pages.json'));
const blocksDoc = readJSON(join(OUT, 'coverage', 'blocks.json'));
const config = readJSON(join(OUT, 'rollout.json'), {});
if (!pagesDoc) { console.error('rollout assemble: run inventory.mjs first.'); process.exit(2); }

const pages = pagesDoc.pages || [];
const host = siteBase(config) || '';
const siteDir = join(OUT, 'site');
mkdirSync(siteDir, { recursive: true });

// sitemap.xml — live page rows only, at their served (extensionless) paths.
const LIVE = new Set(['deployed', 'verified', 'stale']);
const sitemapRows = pages.filter((p) => artifactType(p) === 'page' && LIVE.has(p.delivery && p.delivery.status));
const urls = sitemapRows.map((p) => `  <url><loc>${host}${deliveredPathOf(p)}</loc></url>`).join('\n');
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
writeFileSync(join(siteDir, 'sitemap.xml'), sitemap);

// robots.txt
const robots = `User-agent: *\nAllow: /\n${host ? `Sitemap: ${host}/sitemap.xml\n` : ''}`;
writeFileSync(join(siteDir, 'robots.txt'), robots);

// Fragments manifest — chrome blocks → authored chrome DOCUMENTS (/nav, /footer),
// deployed + published through the same content chain as any page (the stock
// header/footer blocks fetch them; they 404 sitewide if left unpublished).
const chrome = ((blocksDoc && blocksDoc.blocks) || []).filter((b) => b.kind === 'chrome');
const fragmentTarget = { header: 'content/nav.html', nav: 'content/nav.html', footer: 'content/footer.html' };
const fragmentSrc = { header: join(CANON, 'header.html'), nav: join(CANON, 'header.html'), footer: join(CANON, 'footer.html') };
const fragments = chrome.map((b) => ({
  id: b.id,
  target: b.delivery.blockPath || fragmentTarget[b.id] || `content/${b.id}.html`,
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
console.log(`sitemap.xml   ${sitemapRows.length} urls (live page rows of ${pages.length})${host ? ` @ ${host}` : ' (no liveHost set — relative locs)'}`);
console.log(`robots.txt    written`);
console.log(`fragments     ${fragments.length}: ${fragments.map((f) => `${f.id}${f.canonSource ? '' : ' (no canon source!)'}`).join(', ') || 'none'}`);
if (fragments.some((f) => !f.canonSource)) console.log('  ⚠ some chrome has no canon/*.html source — deploy must lift it from a delivered page.');
