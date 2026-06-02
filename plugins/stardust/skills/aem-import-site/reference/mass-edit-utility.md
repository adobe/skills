# Mass-edit utility — the GET / mutate / PUT recipe

After a batch is live, a recurring late-migration need: amend a small
piece of every page's DA source. Common examples:

- Strip a now-unused authored block (static breadcrumb → dynamic block)
- Inject a new metadata field (page-level `category`, `pageType`,
  source-derived `og:image`)
- Fix a typo or broken link across all pages of a template
- Convert a hardcoded value to a sentinel token

Each of these is a one-off script following the same pattern. Formalize
it as a standard project utility so the next mass edit is one copy +
mutate-function-edit away.

## The recipe

```js
// scripts/utils/mass-edit-template.mjs
import { readFileSync, writeFileSync } from 'fs';

const env = readFileSync('.env', 'utf8');
const TOKEN = env.match(/^DA_TOKEN=(.+)$/m)[1].trim();
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const DA = '<org>/<repo>';
const ORIGIN = 'https://main--<repo>--<org>.aem.page';

// The transformation. Project-specific — replace this function.
function mutate(html, pagePath) {
  // Example: strip a now-unused static block, leaving an empty shell
  return html.replace(
    /<div class="legacy-block">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/,
    '<div class="legacy-block"><div><div></div></div></div>',
  );
}

async function fetchRetry(url, opts, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await fetch(url, opts); }
    catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

async function mutateOne(path) {
  const slug = path.replace(/^\//, '');
  const url = `https://admin.da.live/source/${DA}/${slug}.html`;

  let res;
  try { res = await fetchRetry(url, { headers: AUTH }); }
  catch (e) { return { path, ok: false, phase: 'get', error: e.message }; }

  // 404 = orphan page (in query-index but no DA source). Skip, don't fail.
  if (res.status === 404) return { path, ok: true, action: 'skipped (orphan)' };
  if (!res.ok) return { path, ok: false, phase: 'get', status: res.status };

  const html = await res.text();
  const newHtml = mutate(html, path);
  if (html === newHtml) return { path, ok: true, action: 'skipped (no-change)' };

  const fd = new FormData();
  fd.append('data', new Blob([newHtml], { type: 'text/html' }), `${slug.split('/').pop()}.html`);
  try {
    const putRes = await fetchRetry(url, { method: 'PUT', headers: AUTH, body: fd });
    if (!putRes.ok) return { path, ok: false, phase: 'put', status: putRes.status };
    await new Promise(r => setTimeout(r, 600));
    await fetchRetry(`https://admin.hlx.page/preview/${DA}/main/${slug}`, { method: 'POST', headers: AUTH });
    await fetchRetry(`https://admin.hlx.page/live/${DA}/main/${slug}`, { method: 'POST', headers: AUTH });
    return { path, ok: true, action: 'mutated' };
  } catch (e) {
    return { path, ok: false, phase: 'network', error: e.message };
  }
}

async function main() {
  const idx = await (await fetch(`${ORIGIN}/query-index.json`)).json();
  let paths = idx.data.map(r => r.path).filter(p => p && p !== '/');

  // CLI: --limit, --dry-run, --concurrency, --skip-pattern
  const args = process.argv.slice(2);
  const flag = (n) => args.includes(`--${n}`);
  const value = (n, def) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : def; };
  const LIMIT = parseInt(value('limit', '0'), 10);
  const CONCURRENCY = parseInt(value('concurrency', '5'), 10);
  if (LIMIT > 0) paths = paths.slice(0, LIMIT);

  const queue = [...paths];
  const results = [];
  let processed = 0;
  const worker = async () => {
    while (queue.length) {
      const p = queue.shift();
      const r = await mutateOne(p);
      results.push(r);
      processed += 1;
      if (processed % 50 === 0) {
        const mutated = results.filter(x => x.action === 'mutated').length;
        const skipped = results.filter(x => x.action?.startsWith('skipped')).length;
        const failed = results.filter(x => !x.ok).length;
        console.log(`  [${processed}/${paths.length}] mutated:${mutated} skipped:${skipped} failed:${failed}`);
      }
    }
  };

  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)}s.`);
  writeFileSync('/tmp/mass-edit-results.json', JSON.stringify(results, null, 2));

  // Retry-failed pattern (rerun by reading the results file in a separate script)
  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    console.log(`${failed.length} failed — retry sequentially with: node retry-failed.mjs`);
  }
}

main();
```

## Required conventions

Every mass-edit script must follow these conventions:

1. **Treat GET 404 as skip, not failure.** Orphan pages (in
   query-index but without DA source) are normal. Counting them
   as failures pollutes the metrics.

2. **Detect no-change and skip the PUT.** Keeps idempotent re-runs
   fast and quiet. The mutate function should return the same string
   if it has nothing to do.

3. **Use concurrency 5 (default).** Admin.hlx.page rate limit is 10/s;
   5 workers × 4 calls per page averages out under that. See
   admin-api §2.

4. **Retry network errors with linear backoff.** 3 retries with 1.5s ×
   (n+1) backoff covers every transient admin.hlx.page failure
   observed.

5. **Write `/tmp/mass-edit-results.json` at the end.** A separate
   retry-failed script reads it and reruns just the failed slugs.

6. **Log progress every 50 pages.** Long batches go silent otherwise;
   progress lines reassure the operator and give a sense of pace.

## Companion retry-failed pattern

A second tiny script reads the results file and reruns just the
failures, sequentially with extra retry attempts:

```js
// scripts/utils/retry-mass-edit.mjs
import { readFileSync } from 'fs';
import { mutateOne } from './mass-edit-template.mjs';  // export from main script

const failed = JSON.parse(readFileSync('/tmp/mass-edit-results.json', 'utf8'))
  .filter(r => !r.ok)
  .map(r => r.path);

for (const path of failed) {
  const r = await mutateOne(path);
  console.log(`  ${r.ok ? '✓' : '✗'} ${path}`);
}
```

## Common mass-edit patterns

Real ones seen in production migrations:

| Pattern | mutate function |
|---|---|
| Strip a static block, leave shell | `html.replace(/<div class="X">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/, '<div class="X"><div><div></div></div></div>')` |
| Inject a metadata row | `html.replace(/(<div>title<\/div>[\s\S]*?<\/div>\s*<\/div>)/, '$1\n    <div><div>category</div><div>...</div></div>')` |
| Add `og:image` from a curated map | Look up `pagePath → imageURL` from an external JSON; inject as `image` metadata row |
| Fix a global URL | `html.replaceAll('/old-path/', '/new-path/')` (and republish — the dynamic block links don't need re-rendering) |
| Convert hardcoded number to sentinel | `html.replace(/Showing \d+ items/, 'Showing <code>ITEMS_COUNT</code> items')` |

## Limitations

- **Doesn't handle DA source files for pages NOT in query-index.**
  The mass edit scans `/query-index.json`, which only includes
  published pages. Draft / unpublished pages in DA aren't touched.
  For full-DA scans, walk `/list/<org>/<repo>/` via admin.da.live
  (different endpoint, different conventions; rarely needed).

- **Doesn't handle assets.** Images / fonts / non-HTML files in DA
  need different mutation patterns. The recipe above is HTML-only.

- **24h DA_TOKEN expiry.** Long mass edits over 24h pages need either
  a chunked run or a load-per-call token re-read (see admin-api §1).
