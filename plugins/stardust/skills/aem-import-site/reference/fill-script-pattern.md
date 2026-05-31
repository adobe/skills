# The fill-script pattern (verbatim-at-scale guarantee)

The fill script is what makes site-wide migration trustworthy. Without it,
you'd be running an LLM per page — paraphrase risk, slow, expensive,
and silently lossy on content fidelity.

## The contract

For each template, a Node script at
`<eds-project>/scripts/aem-import/fill-<template>.mjs` that:

1. Takes a page slug as its single input.
2. Reads `stardust/current/pages/<slug>.json` (the captured page snapshot).
3. Maps captured fields onto the template's locked slot map.
4. Writes DA-ready HTML to `stardust/aem-import-out/<template>/<slug>.html`.
5. Exits 0 on success, non-zero with a structured error on failure.

**No LLM at fill time.** No paraphrase, no completion, no inference. Pure
field interpolation. This is what makes the migration's content carriage
honest at scale.

## Why no LLM at fill time

If the fill script could invoke an LLM, three failure modes open up:

1. **Silent paraphrase.** Captured "0% APR for 60 months" becomes "Zero
   percent financing for five years." Looks fine; legally different.
2. **Unbounded cost.** 1,000 pages × N LLM calls per page = thousands of
   API calls per migration run. The leverage of templates collapses.
3. **Untestable fidelity.** Per-page output depends on LLM sampling. No
   reproducibility. The verification phase can't tell you whether a
   variation is a bug or just temperature drift.

A pure-script fill is reproducible, fast, and content-faithful by
construction. The slot map is the only place creative judgement happens —
and that judgement was made ONCE per template at approval time.

## Script structure

```js
// scripts/aem-import/fill-equipment-used.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const TEMPLATE_NAME = 'equipment-detail-used';
const THEME = 'wheelercat-equipment-used-v2';
const PROJECT_ROOT = '/Users/paolo/stardust/uplift-wheelercat';

// Load the locked slot map for this template
const templates = JSON.parse(readFileSync(`${PROJECT_ROOT}/stardust/templates.json`, 'utf8'));
const tmpl = templates.templates.find(t => t.name === TEMPLATE_NAME);
if (!tmpl) throw new Error(`Template ${TEMPLATE_NAME} not in templates.json`);

// Slot extractors — pure functions, no LLM
const extractors = {
  'h1': (page) => page.headings.find(h => h.level === 1)?.text,
  'price': (page) => {
    const flexbox = page.blocks?.find(b => b.cls?.includes('flexbox'));
    return flexbox?.innerText.match(/Price:\s*\$([\d,]+)/)?.[1];
  },
  'hours': (page) => {
    const flexbox = page.blocks?.find(b => b.cls?.includes('flexbox'));
    return flexbox?.innerText.match(/Hours\s*\n+\s*(\d+)/)?.[1];
  },
  // ... one extractor per slot
};

function fill(pageSlug) {
  const page = JSON.parse(readFileSync(
    `${PROJECT_ROOT}/stardust/current/pages/${pageSlug}.json`, 'utf8'
  ));

  const slots = {};
  const missingRequired = [];

  for (const [slotName, slotSpec] of Object.entries(tmpl.slotMap)) {
    const value = extractors[slotSpec.source]?.(page);
    if (value === undefined || value === null) {
      if (slotSpec.required) missingRequired.push(slotName);
      continue;
    }
    slots[slotName] = value;
  }

  if (missingRequired.length) {
    return { ok: false, error: 'missing-required-slots', missing: missingRequired };
  }

  // Interpolate slots into the DA template
  const html = renderDA(tmpl, slots, page);

  const outPath = `${PROJECT_ROOT}/stardust/aem-import-out/${TEMPLATE_NAME}/${pageSlug}.html`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);

  return { ok: true, path: outPath, slotCount: Object.keys(slots).length };
}

function renderDA(tmpl, slots, page) {
  // Template-specific: emits the DA-shaped HTML for THIS template.
  // For equipment-detail-used:
  //   - breadcrumb (computed from URL)
  //   - hero (slots.h1, slots.price, specs grid from slots, CTA)
  //   - gallery (page.images filtered + dedupe)
  //   - features (page.features list)
  //   - cta-bar (canonical)
  //   - metadata (title, description, template)
  return `<body>... ${slots['h1']} ... ${slots['price']} ...</body>`;
}

// CLI invocation
if (process.argv[2]) {
  const result = fill(process.argv[2]);
  if (!result.ok) { console.error(result); process.exit(1); }
  console.log(result);
}
```

## What the slot map looks like

Locked at template approval and stored in `templates.json`:

```json
{
  "name": "equipment-detail-used",
  "slotMap": {
    "h1":              { "source": "h1",                                          "required": true },
    "category.label":  { "source": "url:pathSegment[2] → titleCase",              "required": true },
    "category.href":   { "source": "url:'/used-equipment/' + pathSegment[2] + '/'","required": true },
    "price":           { "source": "regex:flexbox.innerText:Price:\\s*\\$([\\d,]+)","required": false },
    "hours":           { "source": "regex:flexbox.innerText:Hours\\s*\\n+\\s*(\\d+)","required": false },
    "serial":          { "source": "regex:flexbox.innerText:Serial Num\\s*\\n+\\s*([\\w]+)","required": false },
    "rating":          { "source": "regex:flexbox.innerText:Rating\\s*\\n+\\s*([\\w\\-]+)","required": false },
    "location":        { "source": "regex:flexbox.innerText:Location\\s*\\n+\\s*([\\w,\\s]+?)\\n","required": false },
    "usedHotline":     { "source": "regex:flexbox.innerText:Used Hotline\\s*\\n+\\s*([\\w\\/-]+)","required": false, "default": "N/A" },
    "images":          { "source": "images[]:filter:width>=240:dedupe:sort:slice:0:32","required": true },
    "features":        { "source": "blockSection:Features:listItems",              "required": false }
  }
}
```

Each source describes how to extract the value from `pages/<slug>.json`.
The fill script ships extractors for every supported source kind:
- `h1` / `h2` / `h3.N` — heading by level
- `url:pathSegment[N]` — URL path component
- `regex:<scope>:<pattern>` — regex against a named scope
- `images[]:<chain>` — image array operations
- `blockSection:<name>:<extract>` — content from a heading-bounded section

## Image handling

Equipment-detail (and similar) pages have 20–60 images. The fill script:

1. Reads `page.images[]` (captured from the page).
2. Filters out logos, CTAs, footer images (heuristic: dimensions <240px,
   src contains `banner`, `logo`, `cta`).
3. Deduplicates by src URL.
4. Picks the largest as the hero main image.
5. Emits the rest as a `.cards.gallery` block.

**Asset URL handling:** the fill script uses the captured wheelercat.com
URLs directly in the DA content. DA fetches and stores each unique URL
as a separate media-bus hash. Using direct URLs avoids the
perceptual-dedup issue documented in
[`../../aem-import/reference/conventions.md`](../../aem-import/reference/conventions.md) §5.

## Failure modes the script handles

| Failure | Script behavior |
|---|---|
| Required slot missing | Returns `{ ok: false, error: 'missing-required-slots', missing: [...] }` |
| Captured page JSON not found | Returns `{ ok: false, error: 'page-not-found' }` |
| Output path not writable | Throws (likely permissions; abort batch) |
| Image dedup empties the gallery | Continues with empty gallery (warning logged) |
| Captured text contains HTML | Escaped before interpolation (no XSS) |
| Captured text contains unicode | Preserved verbatim |

## Batch orchestrator

`scripts/aem-import/batch-migrate.mjs` walks the template inventory and
runs the fill script per page:

```js
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';

const templates = JSON.parse(readFileSync('stardust/templates.json', 'utf8'));
const approved = templates.templates.filter(t => t.status === 'approved');

const results = { ok: [], fail: [] };

for (const tmpl of approved) {
  const pages = tmpl.examples.filter(slug => slug !== tmpl.representativeSlug);
  for (const pageSlug of pages) {
    // 1. Fill
    const fill = spawnSync('node', [`scripts/aem-import/fill-${tmpl.name}.mjs`, pageSlug]);
    if (fill.status !== 0) { results.fail.push({ template: tmpl.name, slug: pageSlug, phase: 'fill', error: fill.stderr.toString() }); continue; }

    // 2. PUT to DA
    const put = spawnSync('curl', ['-X', 'PUT', '-H', `Authorization: Bearer ${DA_TOKEN}`, '-F', `data=@stardust/aem-import-out/${tmpl.name}/${pageSlug}.html`, `${DA_BASE}/${pageSlug}.html`]);
    if (put.status !== 0) { results.fail.push({ template: tmpl.name, slug: pageSlug, phase: 'da-put', error: put.stderr.toString() }); continue; }

    // 3. Trigger preview
    const preview = spawnSync('curl', ['-X', 'POST', `${HLX_BASE}/preview/.../${pageSlug}`]);
    if (preview.status !== 0) { results.fail.push({ template: tmpl.name, slug: pageSlug, phase: 'preview', error: preview.stderr.toString() }); continue; }

    results.ok.push({ template: tmpl.name, slug: pageSlug });
  }
}

writeFileSync('stardust/aem-import-out/_failures.json', JSON.stringify(results.fail, null, 2));
console.log(`✓ ${results.ok.length} pages live, ${results.fail.length} failed`);
```

Parallelism: pages within a template can be parallel (independent). Across
templates: probably serial to avoid swamping DA. The orchestrator handles
throttling.

## Verification post-batch

`scripts/aem-import/verify.mjs` reads `_failures.json` plus checks every
live page:

1. HTTP 200
2. Every captured-text > 20 chars from `pages/<slug>.json#body` appears in
   the rendered HTML (verbatim guarantee, post-hoc)
3. Page height within 15% of the template's baseline render
4. Every img has `naturalWidth > 0`

LLM is involved ONLY in triaging flagged pages — never in the fill itself.
