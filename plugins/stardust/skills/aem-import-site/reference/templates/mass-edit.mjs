#!/usr/bin/env node
/*
 * mass-edit.mjs — STARDUST aem-import-site reference template
 *
 * The standard GET / mutate / PUT recipe for amending every page's DA
 * source after a batch. Used for:
 *
 *   - Stripping a now-unused authored block (static → dynamic conversion)
 *   - Injecting a new metadata field (category, pageType, og:image)
 *   - Fixing a global typo or broken link
 *   - Converting a hardcoded value to a sentinel token
 *
 * Setup: copy this file to <project-root>/scripts/utils/mass-edit-<thing>.mjs
 * (one copy per amendment; mutate() function is project-specific).
 * Requires DA_TOKEN + DA_ORG + DA_REPO + EDS_PREVIEW_ORIGIN in .env.
 *
 * Then `cd <project-root> && node scripts/utils/mass-edit-<thing>.mjs
 *      [--limit 5] [--dry-run] [--concurrency 5]`.
 *
 * See: aem-import-site/reference/mass-edit-utility.md
 */

import { readFileSync, writeFileSync } from 'fs';

const env = readFileSync('.env', 'utf8');
const TOKEN = env.match(/^DA_TOKEN=(.+)$/m)?.[1]?.trim();
const ORG = env.match(/^DA_ORG=(.+)$/m)?.[1]?.trim();
const REPO = env.match(/^DA_REPO=(.+)$/m)?.[1]?.trim();
const ORIGIN = env.match(/^EDS_PREVIEW_ORIGIN=(.+)$/m)?.[1]?.trim();
if (!TOKEN || !ORG || !REPO || !ORIGIN) {
  console.error('Set DA_TOKEN, DA_ORG, DA_REPO, EDS_PREVIEW_ORIGIN in .env');
  process.exit(1);
}
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const DA = `${ORG}/${REPO}`;

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n, def) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : def; };
const LIMIT = parseInt(value('limit', '0'), 10);
const CONCURRENCY = parseInt(value('concurrency', '5'), 10);
const DRY_RUN = flag('dry-run');

// ─────────────────────────────────────────────────────────────────────────
// PROJECT-SPECIFIC: replace this function with your transformation.
// Return the input unchanged if there's nothing to do — the runner will
// skip the PUT (idempotent re-runs).
// ─────────────────────────────────────────────────────────────────────────
function mutate(html, pagePath) {
  // Example: strip an unused static block, leaving an empty shell.
  // return html.replace(
  //   /<div class="legacy-block">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/,
  //   '<div class="legacy-block"><div><div></div></div></div>',
  // );
  return html;
}
// ─────────────────────────────────────────────────────────────────────────

async function fetchRetry(url, opts, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await fetch(url, opts); }
    catch (e) { if (i === retries - 1) throw e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
}

async function mutateOne(path) {
  const slug = path.replace(/^\//, '');
  const url = `https://admin.da.live/source/${DA}/${slug}.html`;

  let res;
  try { res = await fetchRetry(url, { headers: AUTH }); }
  catch (e) { return { path, ok: false, phase: 'get', error: e.message }; }

  if (res.status === 404) return { path, ok: true, action: 'skipped (orphan)' };
  if (!res.ok) return { path, ok: false, phase: 'get', status: res.status };

  const html = await res.text();
  const newHtml = mutate(html, path);
  if (html === newHtml) return { path, ok: true, action: 'skipped (no-change)' };

  if (DRY_RUN) return { path, ok: true, action: 'would-mutate' };

  const fd = new FormData();
  fd.append('data', new Blob([newHtml], { type: 'text/html' }), `${slug.split('/').pop()}.html`);
  try {
    const putRes = await fetchRetry(url, { method: 'PUT', headers: AUTH, body: fd });
    if (!putRes.ok) return { path, ok: false, phase: 'put', status: putRes.status };
    await new Promise(r => setTimeout(r, 600));
    await fetchRetry(`https://admin.hlx.page/preview/${DA}/main/${slug}`, { method: 'POST', headers: AUTH });
    await fetchRetry(`https://admin.hlx.page/live/${DA}/main/${slug}`, { method: 'POST', headers: AUTH });
    return { path, ok: true, action: 'mutated' };
  } catch (e) { return { path, ok: false, phase: 'network', error: e.message }; }
}

async function main() {
  const idx = await (await fetch(`${ORIGIN}/query-index.json`)).json();
  let paths = idx.data.map((r) => r.path).filter((p) => p && p !== '/');
  if (LIMIT > 0) paths = paths.slice(0, LIMIT);
  console.log(`Considering ${paths.length} paths (concurrency=${CONCURRENCY}${DRY_RUN ? ', dry-run' : ''})`);

  const queue = [...paths];
  const results = [];
  let processed = 0;
  const worker = async () => {
    while (queue.length) {
      const p = queue.shift();
      const r = await mutateOne(p);
      results.push(r);
      processed += 1;
      if (processed % 50 === 0 || processed === paths.length) {
        const mutated = results.filter((x) => x.action === 'mutated' || x.action === 'would-mutate').length;
        const skipped = results.filter((x) => x.action?.startsWith('skipped')).length;
        const failed = results.filter((x) => !x.ok).length;
        console.log(`  [${processed}/${paths.length}] mutated:${mutated} skipped:${skipped} failed:${failed}`);
      }
    }
  };
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)}s.`);

  writeFileSync('/tmp/mass-edit-results.json', JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log(`\n${failed.length} failed — retry with retry-mass-edit.mjs (sequential, longer backoff).`);
    failed.slice(0, 5).forEach((r) => console.log(`  ${r.path}: ${r.phase} ${r.status || r.error || ''}`));
  }
}

main();
