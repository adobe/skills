# stardust:migrate: phase 2, per-page render

The text of this part of `skills/migrate/SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

### Phase 2 — Per-page render

In the replica flow a sibling renders only after its archetype is deployed and gated at the
published origin (`../replica/reference/handoff-contract.md` § 3 row C, unit `C-archetype`; #126);
the render is the encoder's input, its gate is the row after PUT. For each page in scope, follow
`reference/migration-procedure.md` and
`reference/template-and-module-rendering.md`:

- **Idempotent skip check** first (sha-compare across
  `designMd`, `designJson`, `sourceCurrent`, `sourceProposed`,
  `canonShas`, `archetypeSource`).
- **Placeholder gate** (Path A and Path A′ only — pages with a
  proposed file or archetype). Refuse when `[data-placeholder]`
  elements or non-empty `_provenance.unsourcedContent[]` are
  present — the user fills the missing content in the proposed
  file before re-invoking migrate. No bypass flag: shipping
  placeholders to a public site is the failure mode this gate
  exists to prevent. Widget mounts are links (`a[data-widget]`),
  never `data-placeholder`, so the gate does not fire on them.
- **Render branch selection** (LLM judgment per T&M §
  Render path selection): A / A′ / B. **Declare the page's
  `fidelityTier`** from the branch — A → `archetype` (craft-gated),
  A′ → `sibling` (canon-fork, the cheap default for breadth — variance-probed
  once per template before cloning, `reference/fidelity-tiers.md` § Sibling
  variance probe; deltas become variant classes, never per-page forks),
  B/bodyless → `thin` — per `reference/fidelity-tiers.md`. Record
  `fidelityTier`, `archetypeSource`, `template` (the archetype's slug;
  the archetype's own sidecar leaves it null), `modules[]` (the page's
  block ids — composite sections only), `widgets[]` (derived from the
  page's `a[data-widget]` mounts) and `gatesPassed[]` in
  `_meta.json` so coverage shows what was craft-gated vs cloned and
  rollout groups and dedups from the sidecars, without a census.
- **Render** per the chosen branch's procedure in T&M.
- **Canon application** — chrome injection, canon.css
  injection, deviation logging.
- **Module rendering** — render module instances via
  `stardust/canon/modules/<id>.html`; bespoke slots logged
  with `data-bespoke`.
- **Apply content-preservation rules** per
  `reference/content-preservation.md`. Internal-link rewriting
  always emits migrated-tree paths; missing slugs flagged
  broken.
- **Content-count acceptance** per
  `reference/fidelity-tiers.md` § Content-count acceptance:
  compare role-classified node counts (headings, body/list
  nodes, CTAs, images) between the captured source page JSON
  and the rendered result. A count drop in any class not
  covered by a logged `contentDeviations[]` entry fails the
  page — dropped-content importer bugs must surface here,
  while the importer is still cheap to fix, not at a
  downstream fidelity gate. Record the pass in
  `_meta.json#gatesPassed[]` as `"content-count"`.
- **Compose `<head>` metadata** per
  `reference/metadata-and-jsonld.md` (five categories;
  page-type-driven JSON-LD).
- **Validate** per T&M § Validation contracts. Strict contracts
  refuse the page; soft contracts log and continue.
- **Compute output path** per migration-procedure.md
  § Output path mapping.
- **Asset bundling.** Scan the final HTML for asset references
  (six detection shapes per
  `reference/asset-bundling.md` § Detection), copy each unique
  referenced subpath from `stardust/current/assets/<subpath>` to
  `stardust/migrated/assets/<subpath>` (preserving subdir
  structure), then rewrite every reference to the root-relative
  form `/assets/<subpath>`. Cross-page dedup uses a
  module-level Set seeded from
  `state.json.migrate.bundledAssets[]`. Missing source assets
  warn-and-skip per § Edge cases; the bundle stays internally
  consistent.
- **Media reconciliation.** For every image **not** bundled to
  same-origin (reused source-CDN URLs under Mode A image-reuse),
  decide optimize/keep/rewrite/omit per
  `reference/media-reconciliation.md`. Cross-origin `<img>` kept
  as source URLs must **skip `createOptimizedPicture`** (it drops
  the `?v=` key and corrupts the rendition); broken URLs are
  repaired (missing `?`-delimiter, wrong host) or omitted, never
  shipped as `about:error`. `rollout` re-runs the authoritative
  network resolve at delivery (`media-reconcile.mjs`).
- **Cinematic sibling (when `<slug>-cinematic.html` exists).**
  Migrate consumes the STATIC prototype only — the cinematic layer
  is never merged. Copy the motion assets (`lenis.min.js`,
  `lenis.min.css`) from `stardust/prototypes/` to
  `stardust/migrated/assets/motion/` (idempotent) for downstream
  consumers (deploy/rollout decide whether to wire them), and
  record `cinematic-variant-not-consumed` in the page's
  `_meta.json#migrationDecisions[]`.
- **Write** the migrated `index.html` and the `_meta.json`
  sidecar in the same directory. Provenance block as first
  child of `<head>`. Record `assetsBundled` (count of unique
  asset refs on this page) in `_meta.json`.

The mechanics of this phase are scripted:
`node skills/migrate/scripts/migrate.mjs render <slug…|--all>` (the
project copy runs from `stardust/scripts/migrate/`) builds the page
map, places each page at its URL-literal path, rewrites internal
links, bundles assets, composes `<head>` (provenance, `:root`,
canonical and JSON-LD defaults), validates strictly and writes the
sidecar, skipping pages whose input shas are unchanged. The judgments
it cannot make are recorded on the sidecar with `gate`, `deviation`,
`decision`, `variant` and `modules` on the same script; it never
advances `pages[].status`.

**Recorded units.** A whole-site render is bookkept as units in
`stardust/migrate/progress.json`, the shape of rollout's C-deliver unit
ledger (`../replica/reference/handoff-contract.md` § 3 row C):
`units.<name>: {status: pending|running|done|failed, kind:
plan|render|assets|report, templates[], pages: n, startedAt, endedAt,
verdict}`. One `plan` unit (Phase 1), one `render` unit per template
cluster of at most ~8 siblings (`migrate.mjs render <slug…>` takes the
cluster's slug list), one `assets` unit when Phase 3 rehosts media, one
`report` unit (Phase 4). Per unit, in this order: the `progress.json`
write → the checkpoint commit → the next unit; a unit end is a safe
resume point, not a stop. A session resumed inside migrate reads the file
and runs only the units not `done`; a unit left `running` re-renders its
slugs — the driver is idempotent, unchanged pages are skipped. A recorded
run rendered 31 siblings through five parallel builders as one unit in
one session — its most expensive — with no resume point between the plan
and the final report.
