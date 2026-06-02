# Completion report — the "done" deliverable

After Phase 9 (polish), the skill's final deliverable is the
**Completion Report** — a written record that lets the project
owner answer "is the migration done?" without re-deriving the
state from scratch.

The report is one Markdown file at `stardust/completion-report.md`
plus a machine-readable JSON sidecar at `stardust/completion-report.json`.
Both are regenerated on demand by a small script that reads
`/query-index.json` + the batch result files + the link audit.

## Report shape

```markdown
# Site Migration Completion Report — <site name>
Generated: <ISO timestamp>

## Inventory
- Source site total pages (from sitemap_index.xml): <N>
- Migrated pages live in EDS: <M>
- Coverage: <M/N * 100>%

## By template family
| Template | pageType | Source pages | Migrated | Failed | Deferred |
|---|---|---:|---:|---:|---:|
| home | (root) | 1 | 1 | 0 | 0 |
| <detail-family-A> | detail | <X> | <X> | 0 | 0 |
| <detail-family-B> | detail | <Y> | <Z> | 0 | <Y-Z> |
| category-listings | listing | <X> | <X> | 0 | 0 |
| hubs | hub | <H> | <H> | 0 | 0 |
| locations | location | <L> | <L> | 0 | 0 |
| info pages | info | <I> | <I> | 0 | 0 |
| <other...> | ... | ... | ... | ... | ... |
| **TOTAL** | | **<N>** | **<M>** | **<F>** | **<D>** |

## Link audit
- Unique internal link destinations across sample pages: <U>
- Live destinations: <L> (<L/U * 100>%)
- Missing destinations: <M-count>
  - Chrome-linked missing: <X> (priority for follow-up)
  - High-inbound missing: <Y>
  - Long-tail missing: <Z>

See `/tmp/link-audit.csv` for the full sorted-by-inbound list.

## CLS audit
- Pages sampled: <K> (one per template+pageType combination)
- Throttled-mobile CLS (95th percentile): <V>
- All sampled pages with CLS < 0.1: <yes/no>
- Pages over 0.1 threshold: <list>

## Chrome navigation
- Chrome verb destinations resolved: <X/Y>
- Chrome verb destinations 404: <list>
- Header utility-strip destinations resolved: <A/B>
- Footer destinations resolved: <C/D>

## Orphan pages
Pages still in `/query-index.json` but with no DA source (typically
old flat-path pages that were superseded by a URL restructure but
couldn't be unpublished due to the admin.hlx.page DELETE trap):

- Count: <N>
- Sample paths: <first 5>
- Mitigation: dedupe logic in dynamic blocks already filters these
  out (see admin-api §3 "Filename-hash dedup"). Manual cleanup via
  DA admin UI if needed.

## Deferred work
Templates / sub-templates intentionally not migrated in this phase:

- <template-name>: <count> pages — <reason>
  Re-engage via `node scripts/aem-import/batch-<template>.mjs`
  when ready.

## Standard utilities deployed
- `scripts/aem-import/fill-<template>.mjs` × <N>
- `scripts/aem-import/batch-<template>.mjs` × <N>
- `scripts/utils/link-audit.mjs`
- `scripts/utils/build-redirects.mjs`
- `scripts/utils/mass-edit-template.mjs` (+ <N> instances)
- `scripts/utils/measure-cls.mjs`

## Site-wide config files
- `helix-query.yaml` — fields: <list>
- `/redirects.json` — entries: <N>
- `head.html` — preload count: <N>
- `styles/styles.css` — CLS reservations: header / footer / main

## Health checks
- Site root (/) returns 200: <yes/no>
- All chrome hub destinations return 200: <yes/no>
- `/query-index.json` returns 200 and parses: <yes/no>
- `/redirects.json` returns 200 and parses: <yes/no>
- Sample dynamic block (hub) renders > 0 cards: <yes/no>

## Known issues
<list any items the project knew about but chose not to fix>

## Next steps
- <prioritized list of remaining work>
```

## Generation script outline

```js
// scripts/utils/generate-completion-report.mjs
import { readFileSync, writeFileSync, existsSync } from 'fs';

const ORIGIN = '<your EDS preview URL>';
const idx = await (await fetch(`${ORIGIN}/query-index.json`)).json();

// Aggregate by template + pageType
const byTemplate = {};
idx.data.forEach((r) => {
  const key = `${r.template || '?'}|${r.pageType || 'detail'}`;
  byTemplate[key] = (byTemplate[key] || 0) + 1;
});

// Read batch result files
const batches = {};
for (const tmpl of templates) {
  const p = `stardust/aem-import-out/<template>/_batch-results.json`;
  if (existsSync(p)) batches[tmpl] = JSON.parse(readFileSync(p, 'utf8'));
}

// Read link audit (optional)
const audit = existsSync('/tmp/link-audit.csv') ? readFileSync('/tmp/link-audit.csv', 'utf8') : null;

// Compose report
const report = `# Site Migration Completion Report
Generated: ${new Date().toISOString()}

## Inventory
Source site total pages: ${SOURCE_TOTAL}
Migrated pages live: ${idx.total}
Coverage: ${(idx.total / SOURCE_TOTAL * 100).toFixed(1)}%
...
`;

writeFileSync('stardust/completion-report.md', report);
writeFileSync('stardust/completion-report.json', JSON.stringify({ /* same data */ }, null, 2));
```

## When to generate

Generate the report at the end of Phase 9 (polish) as the natural
project conclusion. Re-generate after any subsequent gap-fill or
deferred-batch run — the report is the project's single source of
truth for "what's live, what's missing, what's known-deferred".

## What the report is NOT

- **Not a status dashboard.** Don't try to make it real-time; it's a
  snapshot. Re-generate on demand.
- **Not a content-quality audit.** Doesn't check whether content is
  factually correct or current. That's a separate human review.
- **Not a SEO audit.** Doesn't check meta descriptions, og:image
  coverage, structured data. Use a dedicated SEO tool.
- **Not a performance audit.** CLS is in scope (because we engineered
  it); LCP/FID/INP need a separate Lighthouse pass.

## Audience

The report is for:
- Project owners deciding "are we done?"
- Operations teams figuring out what to handoff
- Future maintainers understanding the project's shape
- The skill itself, on a re-engagement, to skip "what state are we in?"
  re-discovery
