# Eval: multi-template migrate

Validates Path A (approved page), Path A′ (template-applied
sibling), Path B (unique render), canon application, module
reuse, broken-link reporting, idempotent skip, canon-driven
re-render, and bespoke-slot promotion suggestion.

## Setup

A project where `prepare-migration` has run and three archetypes
are approved:

- `stardust/state.json` lists 25 pages:
  - `home` — `approved` (canon-author, V01 Polish)
  - `news/post-housing-summit` — `approved` (article archetype)
  - `news` — `approved` (listing archetype)
  - 18 `article`-typed pages — `directed`
  - 2 `program`-typed pages — `directed`
  - 1 `form`-typed page (`donate`) — `directed`
  - 1 `unique`-typed page (`404`) — `directed`
- `stardust/current/` populated with full inventory and typed
  slots per page.
- Project-root `PRODUCT.md`, `DESIGN.md`, `DESIGN.json` exist
  with populated `extensions.canon`, `extensions.modules[]`,
  `extensions.colorReservations[]`, `extensions.metadata`.
- `stardust/canon/` populated (`header.html`, `footer.html`,
  `canon.css`, `modules/hotline-211.html`,
  `modules/donate-band.html`, `modules/story-card.html`,
  `modules/stat-trio.html`).
- `stardust/direction.md` has an active direction (Mode A
  brand-faithful, with `brand_faithful_inversions[]` declared
  for #FFFFFF, #000000, hex format, 0px corners, ALL CAPS).
- `stardust/prototypes/` has the three approved files.
- No `stardust/migrated/` yet.
- Impeccable installed.

## User prompt (run 1)

`$stardust migrate`

## Expected behavior (run 1)

The `stardust:migrate` skill is invoked. It:

1. Runs the master setup; verifies state, DESIGN, canon,
   direction.
2. **Prints the plan** with branch partition:
   - Path A: 3 pages
   - Path A′: 21 pages (18 article, 2 program, 1 form)
   - Path B: 1 page (404)
3. For Path A pages: reads each `<slug>-proposed.html`,
   refreshes `:root` from DESIGN.md (with canon.pinned
   precedence), injects canon.css, applies content-preservation,
   validates with brand-faithful inversions lifted, writes.
4. For Path A′ pages: per
   `reference/template-and-module-rendering.md` § Path A′,
   forks the matching archetype's structure, injects this
   page's typed slots from `current/pages/<slug>.json § slots`,
   adapts content that doesn't fit (logged as
   `template-adapted`), applies canon, validates, writes.
5. For Path B (`404`): per § Path B, composes a one-off using
   DESIGN.md/json + canon + modules. Logs `unique-render`
   decision.
6. Each migrated page has:
   - `:root` block from `canon.pinned` first, DESIGN.md
     fallback otherwise.
   - Canon CSS injected after `:root` in the first `<style>`.
   - Canon header and footer applied verbatim with
     `data-canon` flag on containers.
   - Required `data-*` vocabulary present
     (`data-template="<type>"` on body/main, `data-section`
     per section, `data-module` per module instance,
     `data-slot` per slot container, locally scoped).
   - Provenance block as first child of `<head>` with all
     required shas.
   - JSON-LD per page-type (`Article` on news posts,
     `ItemList` on news, extends-`Organization` on about,
     none on 404).
   - Internal links rewritten to migrated-tree paths;
     missing-slug targets flagged `data-broken-link="true"`.
   - Resolved `<head>` metadata composed per
     `reference/metadata-and-jsonld.md` five categories.
7. Each page's directory contains `index.html` AND
   `_meta.json` sidecar with full `migrationDecisions[]`
   trace, slotsFilled, modules, canonShas, deviations.
8. Copies referenced media to `migrated/assets/media/`;
   verifies fonts and favicon variants present.
9. Writes `migrated/robots.txt` and `migrated/sitemap.xml`
   with page-type-derived priorities.
10. Updates `state.json`: 25 pages move to `migrated`.
11. Prints summary including:
    - Render branch counts (3 A / 21 A′ / 1 B).
    - Pages with non-trivial decisions (with one-line "why").
    - Broken internal links count + target slugs.
    - Bespoke slots crossing promotion threshold (if any).
    - One-line note acknowledging brand-faithful inversion
      lifts.

## User prompt (run 2 — immediately after run 1, no other changes)

`$stardust migrate`

## Expected behavior (run 2 — idempotent re-run)

12. **Zero file writes**. Every page is sha-compared. All
    match → all 25 skipped.
13. Summary: 0 migrated, 25 unchanged (idempotent skip),
    0 failed.
14. `state.json` is NOT updated for unchanged pages.

## User prompt (run 3 — after editing DESIGN.md to bump section padding)

`$stardust migrate`

## Expected behavior (run 3 — DESIGN-driven re-render)

15. designMd sha changed → all 25 pages re-render.
16. Per `reference/migration-procedure.md` § :root block
    sourcing: `canon.pinned` retains precedence for pinned
    paths; non-pinned paths inherit the new DESIGN.md value.
17. Summary reflects the cause:
    `Re-rendered: DESIGN.md sha changed (1a2b3c4 → 4d5e6f7)`.

## User prompt (run 4 — after editing canon.css)

`$stardust migrate`

## Expected behavior (run 4 — canon-driven re-render)

18. canon CSS sha changed → all 25 pages re-render (canon
    affects every page).
19. **No stale-flagging is triggered.** Stale-flagging fires
    only when an underlying skill (`prototype --prep` approval,
    `extract --prep` module-catalog update, `direct --re-direct`)
    commits a content-aware change. A manual edit to `canon.css`
    doesn't run any of those skills — migrate detects the change
    purely through sha-mismatch in the idempotent-skip check.
20. Summary surfaces canon-driven cause:
    `Re-rendered: canon.css sha changed (1k2l3m → 9m8n7o)`.

## User prompt (run 5 — broken-link reporting)

The user manually deletes
`stardust/current/pages/programs__shelter.json` and the
corresponding `state.json` entry. Then runs `$stardust migrate`.

## Expected behavior (run 5)

21. Pages that linked to `/programs/shelter` (e.g., the home
    program-grid module instance, the programs listing) get
    their links flagged `data-broken-link="true"` and the href
    rewritten to the migrated-tree path the slug WOULD have
    served at (`/programs/shelter/`).
22. Run summary surfaces:
    ```
    Broken internal links: 1
      /programs/shelter   referenced by 3 pages; not in inventory
    ```
23. Migration succeeds for all 24 remaining pages.

## User prompt (run 6 — bespoke slot promotion)

The home, get-help, and donate pages each carry a `hotline-211`
module instance with a `<span data-slot="state"
data-bespoke>Utah</span>` element. The `state` slot is not in
the module catalog. After `$stardust migrate`:

## Expected behavior (run 6)

24. All three instances render with `data-bespoke` on the
    `state` slot.
25. `_meta.json` sidecar for each page records a
    `module-bespoke-slot` decision.
26. Run summary surfaces the promotion suggestion:
    ```
    Bespoke slots crossing promotion threshold: 1
      hotline-211: "state"  (3 instances) —
      consider `$stardust prepare-migration --refine-module`
    ```
27. Promoting via the suggested command updates the module
    catalog (slot `state` becomes canonical with appropriate
    type/required/default), and the next migrate run drops the
    `data-bespoke` flag from those instances (sha mismatch
    triggers re-render).

## User prompt (run 7 — color-reservation violation)

The `static`-typed archetype that `legal/privacy` would fork
from contains a `.footnote-callout` element with inline
`style="color: #DC323D"` (centennial-red, reserved to the
`trh-100-lockup` module). When `legal/privacy` renders via
Path A' and inherits that section, the rendered output carries
the violating color outside the reserved context. The page
fails validation per
`DESIGN.json.extensions.colorReservations[]`.

## Expected behavior (run 7)

28. The page is **not** written; its directory in `migrated/`
    is left in its prior state (or absent on first run).
29. `state.json.lastRun.failures[]` records:
    ```json
    {
      "slug": "legal__privacy",
      "kind": "color-reservation",
      "color": "#DC323D",
      "reservedFor": ["module:trh-100-lockup"],
      "found": "inline style on .footnote-callout"
    }
    ```
30. Run summary surfaces the failure with a remediation hint
    (re-iterate prototype to remove the reserved color, or
    promote the violating element to a `trh-100-lockup` module
    instance).

## User prompt (run 8 — Path A′ template adaptation)

An article page (`news/post-2026-04-08-volunteer-recap`)
contains a video embed in its body — the news/post-housing-summit
archetype has no video slot. After `$stardust migrate`:

## Expected behavior (run 8)

31. Path A′ renders the article using the archetype's
    structure, injects all standard article slots
    (headline, byline, body, related), and places the video
    embed in an overflow region after `data-slot="article-body"`.
32. The page's `_meta.json` sidecar records:
    ```json
    {
      "kind": "template-adapted",
      "template": "article",
      "adaptations": [
        { "what": "video embed", "where": "after article-body slot", "via": "overflow region" }
      ],
      "reason": "Content carries a video module not present in canonical article template"
    }
    ```
33. Run summary surfaces the adaptation with a one-line "why".

## User prompt (run 9 — canonical strategy: deployUrl unset)

`state.json.site.deployUrl` is `null`. Run `$stardust migrate`.

## Expected behavior (run 9)

34. Each migrated page's `<link rel="canonical">` preserves the
    canonical from `current/pages/<slug>.json § metadata.canonical`
    verbatim (typically pointing back to the live origin). For
    presales/staging contexts where the migrated tree isn't
    deployed, this attributes search-engine signals back to the
    live site correctly.
35. Run summary makes no special mention of canonical strategy
    (the default-preserve behavior is silent).

## User prompt (run 10 — canonical strategy: deployUrl set)

User edits `state.json.site.deployUrl` to
`"https://migrated.example.com"`. Run `$stardust migrate`.

## Expected behavior (run 10)

36. All 25 pages re-render (state.json change invalidates the
    canonical-derived metadata; migrate recomputes per page).
37. Each migrated page's canonical is rewritten to
    `https://migrated.example.com/<slug-path>/`. Home is
    `https://migrated.example.com/`.
38. Run summary surfaces the deployUrl-driven re-render cause.

## User prompt (run 11 — brand-faithful inversion negative case)

The user edits `direction.md` to remove `#FFFFFF` from the
`brand_faithful_inversions[]` list while leaving `canon.css`
unchanged (canon.css still uses `#FFFFFF` as the page ground).
Run `$stardust migrate`.

## Expected behavior (run 11)

39. With `#FFFFFF` no longer declared as inverted, the impeccable
    "no pure black/white" hard rule applies to every migrated
    page (canon CSS rules using `#FFFFFF` are now in violation).
40. Migrate refuses every affected page and records each
    failure in `state.json.lastRun.failures[]` with
    `kind: "hard-rule-violation"`, the rule name, and the
    offending token/value.
41. Run summary surfaces the failures with a remediation hint
    (re-add the inversion to direction.md, or re-iterate the
    canon-author prototype to move off pure white).

## What this eval covers

| Behavior                                              | Run | Branch |
|-------------------------------------------------------|-----|--------|
| Path A render verbatim from approved prototype        | 1   | A      |
| Path A′ render via template fork + slot injection     | 1   | A′     |
| Path B unique render with canon + modules             | 1   | B      |
| Canon application (chrome verbatim + canon.css)       | 1   | all    |
| Module rendering via canonical files                  | 1   | all    |
| `_meta.json` sidecar with migrationDecisions          | 1   | all    |
| JSON-LD per page-type                                 | 1   | all    |
| Internal-link rewriting (always migrated-tree)        | 1, 5| all    |
| Brand-faithful inversion lifts                        | 1   | all    |
| Idempotent zero-write re-run                          | 2   | all    |
| DESIGN-driven re-render (sha change cascade)          | 3   | all    |
| Canon-driven re-render (sha change cascade)           | 4   | all    |
| Broken-link reporting on missing slugs                | 5   | all    |
| Bespoke slot promotion threshold (3 instances)        | 6     | A′     |
| Color-reservation enforcement                         | 7     | all    |
| Template adaptation (extra content → overflow region) | 8     | A′     |
| Canonical strategy (deployUrl unset → preserve)       | 9     | all    |
| Canonical strategy (deployUrl set → rewrite)          | 10    | all    |
| Brand-faithful inversion negative (rule restored)     | 11    | all    |
