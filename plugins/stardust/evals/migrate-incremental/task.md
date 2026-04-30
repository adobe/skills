# Eval: incremental migrate (mixed approved + directed; idempotent re-run)

## Setup

A project where extract + direct + partial prototype have completed:

- `stardust/state.json` lists 5 pages:
  - `home`, `pricing` — `approved` (with proposed.html + viewer)
  - `about`, `features`, `contact` — `directed` (no prototype yet)
- `stardust/current/` populated.
- Project-root `PRODUCT.md`, `DESIGN.md`, `DESIGN.json` exist.
- `stardust/direction.md` has an active direction.
- `stardust/prototypes/` has the two approved pages' files.
- No `stardust/migrated/` yet.
- Impeccable installed.

## User prompt (run 1)

"$stardust migrate"

## Expected behavior (run 1)

The `stardust:migrate` skill is invoked. It:

1. Runs the master setup.
2. Verifies state contract: directed pages exist, DESIGN.md exists,
   active direction exists.
3. **Prints the plan** (5 in-scope, partitioned by render path)
   with DESIGN.md and DESIGN.json shas.
4. For `home` and `pricing` (path A): reads each
   `<slug>-proposed.html`, refreshes the `:root` block from latest
   DESIGN.md, applies content-preservation rules, validates,
   writes to `stardust/migrated/`.
5. For `about`, `features`, `contact` (path B): renders from
   scratch using `current/pages/<slug>.json` IA + DESIGN.json
   components, applying the resolved direction. Validates and
   writes.
6. Maps slugs to **nested `index.html`** output paths:
   - `home` → `migrated/index.html`
   - `pricing` → `migrated/pricing/index.html`
   - `about` → `migrated/about/index.html`
   - `features` → `migrated/features/index.html`
   - `contact` → `migrated/contact/index.html`
7. Each migrated page has `:root`, data attributes, provenance
   (with designMd/designJson/sourceCurrent/sourceProposed shas),
   content preserved, internal links rewritten to root-relative
   paths, asset references rewritten to `/assets/...`.
8. Copies `stardust/current/assets/logo.<ext>` and referenced media
   to `stardust/migrated/assets/`.
9. Writes `stardust/migrated/robots.txt` and
   `stardust/migrated/sitemap.xml` derived from the migrated
   inventory.
10. Updates `state.json`: 5 pages move to `migrated`, history
    entries appended.
11. Prints summary: 5 migrated, 0 unchanged, 0 failed, asset count,
    deploy hint.

## User prompt (run 2 — immediately after run 1, no other changes)

"$stardust migrate"

## Expected behavior (run 2 — idempotent re-run)

12. **Zero file writes**. Every page is sha-compared against
    DESIGN.md, DESIGN.json, current page, and proposed file (where
    applicable); all match, so all 5 are skipped.
13. Summary: 0 migrated, 5 unchanged (idempotent skip), 0 failed.
14. state.json is NOT updated for the unchanged pages (no new
    history entries).
