#!/usr/bin/env node
/*
 * retry-mass-edit.mjs — STARDUST aem-import-site reference template
 *
 * Re-run mass-edit.mjs on previously-failed paths only, sequentially with
 * longer backoff. The standard recovery pattern for transient network
 * failures from admin.hlx.page during a long mass edit.
 *
 * Reads /tmp/mass-edit-results.json (written by mass-edit.mjs), filters
 * to failed entries, retries each.
 *
 * Setup: drop next to mass-edit.mjs in <project-root>/scripts/utils/.
 * Same .env requirements as mass-edit.mjs.
 *
 * See: aem-import-site/reference/mass-edit-utility.md
 */

import { readFileSync, writeFileSync } from 'fs';

const env = readFileSync('.env', 'utf8');
const TOKEN = env.match(/^DA_TOKEN=(.+)$/m)?.[1]?.trim();
const ORG = env.match(/^DA_ORG=(.+)$/m)?.[1]?.trim();
const REPO = env.match(/^DA_REPO=(.+)$/m)?.[1]?.trim();
if (!TOKEN || !ORG || !REPO) {
  console.error('Set DA_TOKEN, DA_ORG, DA_REPO in .env');
  process.exit(1);
}
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const DA = `${ORG}/${REPO}`;

const resultsPath = '/tmp/mass-edit-results.json';
const previous = JSON.parse(readFileSync(resultsPath, 'utf8'));
const failed = previous.filter((x) => !x.ok).map((x) => x.path);
console.log(`Retrying ${failed.length} previously-failed paths sequentially...`);

// PROJECT-SPECIFIC: paste the same mutate() function from mass-edit.mjs here
// so the retry uses identical transformation logic.
function mutate(html /*, pagePath */) { return html; }

async function fetchRetry(url, opts, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try { return await fetch(url, opts); }
    catch (e) { if (i === retries - 1) throw e; await new Promise(r => setTimeout(r, 2000 * (i + 1))); }
  }
}

const results = [];
let i = 0;
for (const path of failed) {
  i++;
  const slug = path.replace(/^\//, '');
  const url = `https://admin.da.live/source/${DA}/${slug}.html`;
  try {
    const res = await fetchRetry(url, { headers: AUTH });
    if (res.status === 404) { results.push({ path, ok: true, action: 'skipped (orphan)' }); continue; }
    if (!res.ok) { results.push({ path, ok: false, phase: 'get', status: res.status }); continue; }
    const html = await res.text();
    const newHtml = mutate(html, path);
    if (html === newHtml) { results.push({ path, ok: true, action: 'skipped (no-change)' }); continue; }
    const fd = new FormData();
    fd.append('data', new Blob([newHtml], { type: 'text/html' }), `${slug.split('/').pop()}.html`);
    const putRes = await fetchRetry(url, { method: 'PUT', headers: AUTH, body: fd });
    if (!putRes.ok) { results.push({ path, ok: false, phase: 'put', status: putRes.status }); continue; }
    await new Promise(r => setTimeout(r, 500));
    await fetchRetry(`https://admin.hlx.page/preview/${DA}/main/${slug}`, { method: 'POST', headers: AUTH });
    await fetchRetry(`https://admin.hlx.page/live/${DA}/main/${slug}`, { method: 'POST', headers: AUTH });
    results.push({ path, ok: true, action: 'mutated' });
    if (i % 20 === 0) console.log(`  ${i}/${failed.length}  mutated:${results.filter((x) => x.action === 'mutated').length} failed:${results.filter((x) => !x.ok).length}`);
  } catch (e) {
    results.push({ path, ok: false, phase: 'unhandled', error: e.message });
  }
}

const mutated = results.filter((x) => x.action === 'mutated').length;
const failedAgain = results.filter((x) => !x.ok).length;
console.log(`\n▸ Retry done. Mutated: ${mutated} | Still failed: ${failedAgain}`);
writeFileSync('/tmp/mass-edit-results-retry.json', JSON.stringify(results, null, 2));
if (failedAgain) {
  console.log('Persistent failures (manual investigation needed):');
  results.filter((x) => !x.ok).slice(0, 10).forEach((r) => console.log(`  ${r.path}: ${r.phase} ${r.status || r.error || ''}`));
}
