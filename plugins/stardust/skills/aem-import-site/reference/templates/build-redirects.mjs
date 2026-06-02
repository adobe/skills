#!/usr/bin/env node
/*
 * build-redirects.mjs — STARDUST aem-import-site reference template
 *
 * Generate /redirects.json from /query-index.json. Maps `<path>/` → `<path>`
 * for every indexed page, fixing trailing-slash 404s site-wide without
 * touching any existing content.
 *
 * Use after a URL-shape mismatch is discovered (typical: source site used
 * trailing-slash URLs in WordPress; EDS serves at no-slash; chrome and
 * breadcrumbs link with trailing slashes → all 404). Single file fix.
 *
 * Setup: drop this file at <project-root>/scripts/utils/build-redirects.mjs.
 * Requires EDS_PREVIEW_ORIGIN + DA_ORG + DA_REPO + DA_TOKEN in .env.
 *
 * Then `cd <project-root> && node scripts/utils/build-redirects.mjs`.
 * Output: /tmp/redirects.json (PUT to DA + preview + publish manually,
 * or extend this script to do it).
 *
 * See: aem-import-site/reference/admin-api-and-publish-flow.md §3
 *      "Trailing-slash → no-slash via /redirects.json"
 */

import { writeFileSync, readFileSync } from 'fs';

const env = readFileSync('.env', 'utf8');
const ORIGIN = env.match(/^EDS_PREVIEW_ORIGIN=(.+)$/m)?.[1]?.trim();
if (!ORIGIN) {
  console.error('Set EDS_PREVIEW_ORIGIN in .env');
  process.exit(1);
}

const idx = await (await fetch(`${ORIGIN}/query-index.json`)).json();

const rows = [];
const seen = new Set();
idx.data.forEach((r) => {
  const path = r.path.replace(/\/$/, '');
  if (!path || path === '/') return;
  const source = `${path}/`;
  if (seen.has(source)) return;
  seen.add(source);
  rows.push({ Source: source, Destination: path });
});

const payload = {
  total: rows.length,
  offset: 0,
  limit: rows.length,
  data: rows,
  ':type': 'sheet',
};
writeFileSync('/tmp/redirects.json', JSON.stringify(payload, null, 2));
console.log(`Built ${rows.length} redirect entries.`);
console.log('Sample:');
rows.slice(0, 5).forEach((r) => console.log(`  ${r.Source} → ${r.Destination}`));
console.log('\nNow PUT to DA: curl -X PUT https://admin.da.live/source/<org>/<repo>/redirects.json \\');
console.log('  -H "Authorization: Bearer $DA_TOKEN" -F "data=@/tmp/redirects.json;type=application/json"');
console.log('Then preview + publish via admin.hlx.page (see admin-api §2).');
