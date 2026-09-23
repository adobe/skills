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
 * The assembled sitemap is the EXPECTED url set, never the served one: stardust/rollout/ is not
 * served (`.hlxignore`), the platform builds its own /sitemap.xml from the index of published
 * documents — and that index takes every published document, chrome (/nav, /footer, per-locale
 * nav-* / footer-*, locale shells) included, unless the document carries `Robots: noindex`
 * metadata. A recorded hands-off run reported "sitemap 36 urls" from the local file while the
 * served sitemap listed 58 (every page plus 22 chrome documents). Verify the served one:
 *
 * Usage: node skills/rollout/scripts/assemble.mjs [--out <rolloutDir>] [--canon <dir>] [--verify-origin <live-origin>]
 *   defaults: --out stardust/rollout  --canon stardust/canon
 *   --verify-origin <origin>  GET <origin>/sitemap.xml (a sitemap index is followed), compare its
 *                             <loc> path set with the assembled one, print the served / assembled
 *                             counts with the extra and missing paths, record the result in
 *                             manifest.json (`servedSitemap`), exit 1 on any mismatch or when the
 *                             served sitemap cannot be read. The only network call — nothing is
 *                             fetched without the flag.
 *
 * Reads <out>/coverage/pages.json (required — run inventory.mjs first), coverage/blocks.json
 * and rollout.json. Writes (under <out>/site/): sitemap.xml, robots.txt, manifest.json
 * (fragments list with their canon source and delivery status, each `robots: noindex`; plus
 * `servedSitemap` when verified). Exit 1 when pages.json is missing or the served sitemap differs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJSON, writeJSON } from './lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback; }
const OUT = arg('out', 'stardust/rollout');
const CANON = arg('canon', 'stardust/canon');
const VERIFY = (arg('verify-origin', '') || '').replace(/\/+$/, '');

const pagesDoc = readJSON(join(OUT, 'coverage', 'pages.json'));
const blocksDoc = readJSON(join(OUT, 'coverage', 'blocks.json'));
const config = readJSON(join(OUT, 'rollout.json'), {});
if (!pagesDoc) { console.error('rollout assemble: run inventory.mjs first.'); process.exit(1); }

const pages = pagesDoc.pages || [];
const host = (config.site && config.site.liveHost) ? `https://${config.site.liveHost}` : '';
const siteDir = join(OUT, 'site');
mkdirSync(siteDir, { recursive: true });

/** Delivered path in canonical form: no trailing slash (root stays `/`), `/index` is `/`. */
function normPath(p) {
  let s = String(p || '/').split(/[?#]/)[0];
  if (!s.startsWith('/')) s = `/${s}`;
  s = s.replace(/\/+$/, '') || '/';
  if (s === '/index') s = '/';
  if (s.endsWith('/index')) s = s.slice(0, -'/index'.length);
  return s;
}

// sitemap.xml — delivered (extensionless) paths.
const urls = pages.map((p) => `  <url><loc>${host}${p.path}</loc></url>`).join('\n');
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
writeFileSync(join(siteDir, 'sitemap.xml'), sitemap);

// robots.txt
const robots = `User-agent: *\nAllow: /\n${host ? `Sitemap: ${host}/sitemap.xml\n` : ''}`;
writeFileSync(join(siteDir, 'robots.txt'), robots);

// Fragments manifest — chrome blocks → authored chrome DOCUMENTS (/nav, /footer),
// deployed + published through the same content chain as any page (the stock
// header/footer blocks fetch them; they 404 sitewide if left unpublished). Each carries
// `Robots: noindex` in its metadata block so the platform index — and the served sitemap
// built from it — excludes it.
const chrome = ((blocksDoc && blocksDoc.blocks) || []).filter((b) => b.kind === 'chrome');
const fragmentTarget = { header: 'content/nav.html', nav: 'content/nav.html', footer: 'content/footer.html' };
const fragmentSrc = { header: join(CANON, 'header.html'), nav: join(CANON, 'header.html'), footer: join(CANON, 'footer.html') };
const fragments = chrome.map((b) => ({
  id: b.id,
  target: b.delivery.blockPath || fragmentTarget[b.id] || `content/${b.id}.html`,
  canonSource: existsSync(fragmentSrc[b.id]) ? fragmentSrc[b.id] : null,
  status: b.delivery.status,
  robots: 'noindex',
}));

console.log(`rollout assemble → ${siteDir}`);
console.log('='.repeat(60));
console.log(`sitemap.xml   ${pages.length} urls${host ? ` @ ${host}` : ' (no liveHost set — relative locs)'}   (the EXPECTED set — the platform serves its own; verify with --verify-origin)`);
console.log(`robots.txt    written`);
console.log(`fragments     ${fragments.length}: ${fragments.map((f) => `${f.id}${f.canonSource ? '' : ' (no canon source!)'}`).join(', ') || 'none'}${fragments.length ? '   (each needs a `Robots | noindex` metadata row)' : ''}`);
if (fragments.some((f) => !f.canonSource)) console.log('  ⚠ some chrome has no canon/*.html source — deploy must lift it from a delivered page.');

// --- Served sitemap verification (network only with --verify-origin) -----------
const locsOf = (xml) => [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
async function getText(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
  const body = await res.text();
  return { status: res.status, body };
}

let servedSitemap = null;
let mismatch = false;
if (VERIFY) {
  const url = `${VERIFY}/sitemap.xml`;
  let served = null; let error = null;
  try {
    const root = await getText(url);
    if (root.status !== 200) error = `HTTP ${root.status}`;
    else if (/<sitemapindex[\s>]/i.test(root.body)) {
      // a sitemap index (per-language sitemaps): union its children, bounded
      const children = locsOf(root.body).slice(0, 25);
      served = [];
      for (const child of children) {
        // a preview-host index lists the canonical host's children: re-host each on the verified origin
        let childPath; try { childPath = new URL(child, `${VERIFY}/`).pathname; } catch { childPath = child; }
        const r = await getText(`${VERIFY}${childPath}`);
        if (r.status !== 200) { error = `child sitemap ${child}: HTTP ${r.status}`; break; }
        served.push(...locsOf(r.body));
      }
    } else if (/<urlset[\s>]/i.test(root.body)) served = locsOf(root.body);
    else error = 'not a sitemap (no <urlset> or <sitemapindex>)';
  } catch (e) { error = `fetch error: ${e.message}`; }

  const expected = new Set(pages.map((p) => normPath(p.path)));
  if (error) {
    servedSitemap = { origin: VERIFY, url, checkedAt: new Date().toISOString(), match: false, error, count: null, assembled: expected.size, extra: [], missing: [] };
    console.log(`\nserved sitemap  ${url}  UNREADABLE — ${error}   (assembled ${expected.size})`);
    console.log('✗ served sitemap could not be verified');
    mismatch = true;
  } else {
    const servedPaths = new Set(served.map((loc) => { try { return normPath(new URL(loc, `${VERIFY}/`).pathname); } catch { return normPath(loc); } }));
    const extra = [...servedPaths].filter((p) => !expected.has(p)).sort();
    const missing = [...expected].filter((p) => !servedPaths.has(p)).sort();
    mismatch = extra.length > 0 || missing.length > 0;
    servedSitemap = { origin: VERIFY, url, checkedAt: new Date().toISOString(), match: !mismatch, error: null, count: servedPaths.size, assembled: expected.size, extra, missing };
    console.log(`\nserved sitemap  ${url}  ${servedPaths.size} urls   (assembled ${expected.size})`);
    const list = (arr) => `${arr.slice(0, 30).join(', ')}${arr.length > 30 ? ` … +${arr.length - 30}` : ''}`;
    console.log(`  extra    ${extra.length}${extra.length ? `: ${list(extra)}` : ''}${extra.length ? '\n           → a chrome/fragment document without `Robots | noindex` (author the row, republish it), or a page built outside the migrated tree with no coverage row (update-coverage.mjs --new)' : ''}`);
    console.log(`  missing  ${missing.length}${missing.length ? `: ${list(missing)}` : ''}${missing.length ? '\n           → not published live, or `noindex` on a real page' : ''}`);
    console.log(mismatch ? `✗ served sitemap does not match the assembled set (served ${servedPaths.size}, assembled ${expected.size})` : `✓ served sitemap matches the assembled set (${servedPaths.size} urls)`);
  }
}

const now = new Date().toISOString();
writeJSON(join(siteDir, 'manifest.json'), {
  _provenance: { writtenBy: 'stardust:rollout/assemble', writtenAt: now, stardustVersion: (config._provenance || {}).stardustVersion || '0.0.0' },
  generatedAt: now,
  host: host || null,
  sitemap: join(siteDir, 'sitemap.xml'),
  robots: join(siteDir, 'robots.txt'),
  fragments,
  servedSitemap,
});

if (mismatch) process.exit(1);
