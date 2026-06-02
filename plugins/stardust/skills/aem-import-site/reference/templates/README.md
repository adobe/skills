# Reference templates — copy these into project scripts/utils/

Each `.mjs` file here is a ready-to-use template for a standard
aem-import-site utility. Copy to your project's `scripts/utils/`
directory; configure via `.env` (no script edits needed for the
config-only ones).

| Template | Purpose | Project edits |
|---|---|---|
| `link-audit.mjs` | Phase 7 link audit (crawl + cross-check + weighted-missing list) | none — uses `.env` only |
| `build-redirects.mjs` | Generate `/redirects.json` from `/query-index.json` | none — uses `.env` only |
| `mass-edit.mjs` | Phase 9 mass DA-source amendment (strip block, inject metadata, fix global URL, etc.) | replace `mutate()` function with your transformation; rename file (`mass-edit-<thing>.mjs`) |
| `retry-mass-edit.mjs` | Sequential retry of failed mass-edit paths | paste same `mutate()` as your mass-edit instance |

## Required .env keys

All templates expect these keys in the project's `.env`:

```
DA_TOKEN=<bearer token from admin.da.live session>
DA_ORG=<github org>
DA_REPO=<github repo>
EDS_PREVIEW_ORIGIN=https://main--<repo>--<org>.aem.page
```

`DA_TOKEN` is the only one that rotates (24h expiry — see
admin-api §1). The others are project constants.

## How to use

```sh
cd <project-root>
mkdir -p scripts/utils
cp <skill-path>/reference/templates/*.mjs scripts/utils/

# Phase 7
node scripts/utils/link-audit.mjs

# Phase 9 — redirect generation
node scripts/utils/build-redirects.mjs
# (then PUT /tmp/redirects.json to DA + preview + publish)

# Phase 9 — mass-edit (after editing the mutate() function)
cp scripts/utils/mass-edit.mjs scripts/utils/mass-edit-strip-breadcrumbs.mjs
# edit mutate() to strip the static breadcrumb HTML
node scripts/utils/mass-edit-strip-breadcrumbs.mjs --limit 5 --dry-run   # smoke
node scripts/utils/mass-edit-strip-breadcrumbs.mjs --concurrency 5      # full
node scripts/utils/retry-mass-edit.mjs                                   # retry failures
```

## Why these are templates, not scripts

The templates ship in the skill repo so projects can copy them
without re-deriving the recipe (each script encodes admin-api
flow + retry + concurrency + sentinel handling — easy to get
subtly wrong on a from-scratch implementation).

But they're not auto-installed — the skill doesn't write into
your project tree without consent. Copy in the templates you
need; ignore the ones you don't.

See:
- `aem-import-site/reference/link-audit-workflow.md`
- `aem-import-site/reference/mass-edit-utility.md`
- `aem-import-site/reference/admin-api-and-publish-flow.md` §3
