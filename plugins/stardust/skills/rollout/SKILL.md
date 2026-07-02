---
name: rollout
description: Deploy a WHOLE redesigned site to AEM Edge Delivery Services — the full-site, bulk sibling of `deploy` (which ships one page). Use to roll out, bulk-deploy, or publish an entire migrated stardust site at once ("deploy all pages", "full site deployment", "deploy the whole/entire website to AEM"), not just a single page. Inventories the migrated tree (stardust/migrated/ + _meta.json) into a delivery ledger, dedups blocks, drives `deploy` per page, verifies, and tracks what's done and what's left. Supports archetypes-only mode — when only the template archetype pages are migrated, it deploys all block code immediately and registers the rest as content-pending.
license: Apache-2.0
---

# stardust:rollout — whole site → AEM (Edge Delivery Services)

`deploy` converts **one** page to AEM. `rollout` delivers the **whole site**: it
inventories the agnostic output of `migrate`, then drives `deploy` across every
page, tracking delivery coverage so you always know what's done and what's left.

`rollout` is **delivery-only** — it does not redesign. The page-by-page redesign
(`extract → direct → prototype → migrate`) and `deploy` itself are **unchanged**;
`rollout` is the across-pages layer on top. Design rationale, coverage model, and
phasing are in [`notes/rollout/PLAN.md`](../../notes/rollout/PLAN.md). The flow
runs **A→I** below.

## When to use

**Full mode** — the user has a fully migrated site at `stardust/migrated/`
(per-page HTML + `_meta.json` from `stardust migrate`), an EDS/AEM project + DA
destination (the same target `deploy` needs), and wants the **entire** site
delivered, incrementally and resumably.

**Archetypes-only mode** — the user has one migrated archetype per template plus a
full page inventory in `stardust/state.json` (with `type` per page), and wants to
ship all block code immediately without waiting for every page to be migrated.
Sibling pages register as `content-pending` and get their content later via a
separate track.

If there is no `stardust/migrated/` tree at all, recommend `stardust migrate` on at
least the archetype pages first. For a single page, use `stardust deploy` directly.

## Setup

1. Run the master skill's setup (`skills/stardust/SKILL.md` § Setup).
2. Verify `stardust/migrated/` exists with at least one `*.html` page (full mode:
   all pages; archetypes-only: the archetypes + a `state.json` with `type`
   populated). If not, recommend `stardust migrate` on the archetypes and stop.
3. Verify the EDS/AEM target is ready exactly as `deploy` requires (project
   scaffolding, `DA_TOKEN`, code branch pushable). `rollout` adds no new transport.
4. If `state.json.handsOff` is true (`skills/stardust/SKILL.md` § Hands-off
   mode), run full-auto: no per-phase pauses. Every gate and verify step below
   runs unchanged — hands-off removes waiting, not validation.

## Procedure

### Phase A — Inventory (build the coverage)

```bash
node skills/rollout/scripts/inventory.mjs --site-url <source-url>
# defaults: --migrated stardust/migrated  --out stardust/rollout
# archetypes-only mode: add the full page roster from state.json
node skills/rollout/scripts/inventory.mjs --site-url <source-url> --state stardust/state.json
```

Writes `coverage/pages.json` (one row per page: slug, delivered `path`,
`templateId`, `blocks`, `sourceHash`, `delivery` status), `coverage/templates.json`
(pages grouped by template), and `rollout.json` (target + DA config + `lastRun`).

**Archetypes-only mode** (`--state`): pages with a `_meta.json` are seeded as in
full mode; pages present only in `state.json` are seeded with `templateId` from
`type`, `blocks` from the archetype sidecar, and `delivery.status:
content-pending`.

Inventory is **idempotent and incremental**: delivery status is preserved; a page
whose migrated HTML changed after delivery is re-flagged `stale`. Fill in the DA
coordinates in `rollout.json` (`site.da.org`, `site.site`, `site.da.ref`,
`site.liveHost`) if not inferred.

### Phase B — Block dedup plan (FIRST-CLASS, before any conversion)

```bash
node skills/rollout/scripts/blocks.mjs   # → coverage/blocks.json (the dedup unit)
node skills/rollout/scripts/plan.mjs     # → plan.json + a readable conversion plan
```

- `blocks.mjs` collapses every block instance (per-page `modules` + chrome) into
  the **distinct** set, assigns each a canonical `edsBlockName` (kebab,
  reserved-class-guarded per deploy #15), and records `usedByPages` /
  `instanceCount`. Chrome (`header`/`nav`/`footer`) is `kind: chrome` → site-wide
  fragments. In archetypes-only mode the archetype sidecars fully determine the
  block set; `content-pending` pages add none.
- `plan.mjs` orders pages **representative-first per template** and gives each
  distinct block a **single conversion point**: the first page that uses it
  CONVERTS it, every later page REUSES it by name. The per-page `convert`/`reuse`
  lists are exactly `deploy`'s Step-7 brief input, so each block converts once
  **without changing deploy**. `content-pending` pages are always `convert: []`.

> Extending an already-delivered site? A "new template" is almost always a new
> COMPOSITION of the existing block library, not new block code — audit `blocks/`
> first. See `reference/operational-learnings.md`.

### Phase B2 — Metadata contract for dynamic listings (PRE-IMPORT GATE)

**Do this before Phase C — the import is blocked on it.** What a dynamic listing
block can show is bounded by what each page emits, and retrofitting metadata across
thousands of already-published pages is a second migration. Before importing,
produce `dynamic-blocks-map.md` (which blocks are dynamic vs static, the index each
reads, the fields its cards need) and a **metadata contract** (the `<meta name="…">`
each content TYPE must carry). Then have Phase C's `deploy` brief emit the contract
per page, and author `helix-query.yaml` from the same contract. When
`stardust:prepare-migration` Phase 4.5 already ran, `stardust/dynamic-blocks-map.md`
and `helix-query.yaml` exist — verify them against the inventory here instead of
redoing them.

Mechanics (key→meta-name rules, what a row can carry): `reference/dynamic-listings.md`.

### Phase C — Deliver the site (drive `deploy` per page, per the plan)

**Blocked on Phase B2** — author each page's metadata contract into its metadata
block during delivery, so the indexes are rich at import time.

Walk `plan.json.steps` in order (representative pages first). For each page:

1. **Convert + push** the migrated HTML (`source.migratedHtml`) to AEM via the
   `deploy` methodology. **Pass the plan step into deploy's brief**: create only the
   blocks in `convert`; for each block in `reuse`, REUSE the existing block by its
   `edsBlockName` (do not recreate).

   **`content-pending` pages** (archetypes-only): no migrated HTML — skip the
   document push entirely (no shell/placeholder), record `content-pending`, surface
   as "awaiting content track." Their block code is already deployed via the
   archetype.

2. **Static contract lint (pre-PUT, deterministic).** Before the push, run the
   delivery-contract linter — it catches the cheap, deterministic failures
   (wrapper, one-CTA-per-`<p>`, trailing-slash, path-safety, `/img/` src,
   `about:error`) offline so a broken page never reaches preview. Mechanics in
   `reference/delivery-lint.md`. **A P0/P1 blocks the PUT.**
   ```bash
   node skills/rollout/scripts/delivery-lint.mjs --file <html> --path </da/path>
   node skills/rollout/scripts/media-reconcile.mjs --file <html> --deploy-host <branch>--<repo>--<owner>.aem.live [--apply]
   ```
   `media-reconcile` resolves every image on the network and decides
   optimize/keep/rewrite/omit (`skills/migrate/reference/media-reconciliation.md`)
   — the authoritative form of the image-fidelity gate below.

3. **Run the delivery gates** before flipping a page to `deployed`. Each is a
   one-line rule here; mechanics + helpers in `reference/delivery-gates.md`:
   - **Source-fidelity** — don't add sections the source lacks; never fabricate
     facts. `node skills/rollout/scripts/section-fidelity.mjs --file <html> --source <url>`
   - **Image-fidelity** — every authored `<img>` src must return 200 or be omitted;
     never ship `<img src="about:error">`. Run `media-reconcile.mjs` (step 2).
   - **Path-safety** — normalize source paths to AEM-Edge-safe form (lowercase, no
     trailing `-`/`_`, no `--` segment); record original→normalized in
     `stardust/redirects.tsv`. (delivery-lint flags violations.)
   - **Source-content hygiene** — skip dead source URLs; author bodyless/PDF-only
     sources thin and faithful (tier `thin`,
     `skills/migrate/reference/fidelity-tiers.md`), don't pad with invented prose.
   - **Fidelity tier declared** — record each page's `fidelityTier`
     (archetype/sibling/thin) so coverage shows what was craft-gated vs cloned
     (`skills/migrate/reference/fidelity-tiers.md`).

4. **Record outcomes** with the state-writer (never hand-edit the ledger):
   ```bash
   node skills/rollout/scripts/update-coverage.mjs <slug> --status converting
   node skills/rollout/scripts/update-coverage.mjs --block <id> --status converted --eds-name <name>
   node skills/rollout/scripts/update-coverage.mjs <slug> --status deployed --url <branch-preview-url>
   node skills/rollout/scripts/update-coverage.mjs <slug> --status content-pending   # no document push
   ```
   **Publish in the loop (`PUT → preview → live`), don't stop at preview** — any
   query-index (Phase D2) builds from the **live** tree, so a preview-only delivery
   leaves indexes empty. On failure: `--status failed --error "<reason>"` and
   continue (one page's failure never aborts the rollout).

**Foundation-first gate (hard block, once per rollout).** When the FIRST
archetype page flips to `deployed`, stop and prove the foundation before
authoring any second page: run `stardust:diff` (both probes) against its
prototype, **plus computed-style invariants in a headless render** — grid
containers compute `display: grid` (not stacked single-column), sections are
full-bleed where the design says so, and the CTA/button classes are actually
styled (per `stardust/runtime-contract.json`, `skills/deploy/SKILL.md`
§ Runtime-detection probe). A wrong runtime assumption (block wrapper class,
button classes) is silent and sitewide — typography still looks fine while
every grid stacks. This one gate is the difference between fixing one page
and rebuilding every template.

**Execution model: waves.** Deliver in waves of parallel **author-only** agents
— each agent curls its source pages and writes files only, never deploys or
edits blocks — template clusters concurrently (non-overlapping pages),
representative-first so blocks exist to be reused; then a **central deploy**
per page; then background batches with a per-page OK/FAIL ledger, re-driving
FAILs only. For clusters of 6–20+ siblings, the full flow is
`reference/delivery-gates.md` § Batched delivery. The central deploy step
should run the bundled, resumable driver rather than a serial loop:
`node skills/deploy/scripts/deploy-batch.mjs --org <org> --repo <repo>
--branch <branch> --content <dir>` (concurrency pool, persistent ledger that skips
already-live pages, retry/backoff, append-only log, delivered-`.plain.html` check).
After a transient blip, re-run the same command — it re-drives only the FAILs.
Then reconcile the ledger into coverage with `update-coverage.mjs`.

### Phase D — Site assembly (whole-site artifacts)

```bash
node skills/rollout/scripts/assemble.mjs   # → rollout/site/{sitemap.xml,robots.txt,manifest.json}
```

Generates site-wide artifacts: `sitemap.xml` + `robots.txt` from delivered paths,
and a fragments manifest mapping chrome blocks to `fragments/{header,footer}.html`
with their `canon/*.html` source (`deploy` pushes the actual fragment content).
**Redirects:** if Phase C's path-safety gate emitted `stardust/redirects.tsv`, wire
it into the EDS redirects mechanism here so original inbound URLs don't 404.

### Phase D2 — Dynamic listings (query-index) — optional

Blocks that LIST other pages (directories, news/event feeds, "related" rails)
should read an EDS **query-index** rather than static cards. Build it from the B2
contract: author `helix-query.yaml` (scoped indexes), rewrite the listing blocks to
`fetch` their index (with filter/sort/paginate + an authored fallback), and
validate one flagship end-to-end. The index builds from the **published (live)**
tree — publish before expecting rows. Full mechanics: `reference/dynamic-listings.md`.

**Index resilience.** After a bulk publish, **poll the index `total` with a
timeout** (indexing is async; a freshly-synced config sits at `building`/404
first) — don't assert once and fail. Decode `"requested path returned a 301 or
404"` per row as **not-published**, not a bad selector: publish the page and
re-poll (`reference/dynamic-listings.md` § The publish gotcha). If the index
never settles inside the timeout, the documented **degraded mode** is a
committed static index JSON (generated from the coverage ledger, served from
the code branch) + regeneration on content change — the listing blocks read
the same row shape either way, so the swap back is a URL change.

### Phase D3 — Multilingual (per-language trees) — optional

When the source has language trees (`/fr/…`, `/en/…`), add them as parallel content
trees that REUSE the same block library — only authored content and a little wiring
change (language-routed fragments, per-language indexes, per-language path-safety).
See `reference/multilingual.md`.

### Phase E — Full-site verify

```bash
node skills/rollout/scripts/verify.mjs            # uses rollout.json site.liveHost
# or: --base <url>   (explicit host)   |   --root <dir>   (offline, against a local export)
```

For every delivered page, `verify` confirms HTTP 200, no `about:error` (deploy
#75), and that every internal `href="/…"` resolves to a known delivered path — then
flips each page to `verified` or `failed`. Exits non-zero if any page failed.

**Headless render check (per template).** A 200 `.plain.html` can still render
blank — decoration failures (missing script, wrong block wrapper class, 404
chrome) are invisible to a text check. On the FIRST delivered page of each
template (home included), load the live URL in a headless browser and assert
decoration ran: the runtime's body class is set (`body.session` under
AuthorKit — read `stardust/runtime-contract.json`), `main .section` count > 0,
zero `pageerror` events, zero broken images.

### Phase E2 — Link-audit completeness

`verify.mjs` checks the links on delivered pages; this phase closes the set of
link **targets** a roster-driven batch misses
(`reference/operational-learnings.md` § Two verify checks):

- **Nav/footer/landing targets are NOT archetype siblings.** Enumerate every
  header/footer/nav-fragment `href` plus each section's index/landing page and
  confirm each is **deployed + published + verified** — otherwise they get
  committed but never published, their links 404, and the dashboard still
  reads 100%.
- **Localize source-site bounce links** whose path has a delivered local 200
  page (header/footer/home first); keep an absolute source link only when no
  local page exists (a bounce beats a 404).
- **Strip trailing slashes and `.html` from internal links.** EDS serves
  extensionless documents with no trailing slash, so `/x/y/` and `/x/y.html`
  both 404 (render the 404 block) while `.plain.html` still passes — nav reads
  green, every link is dead. Normalize every internal `href` (keep bare `/`);
  repoint `.html` links with no local page at the working source URL.
- **The audit GETs each href against the LIVE tree.** Structural resolution
  against the ledger misses trailing-slash and case defects that only
  delivery exposes.

### Phase F — Optimize: multi-source audit + gate (delivery quality)

The in-flow **quality gate**. optimize aggregates findings from **existing audit
skills** into one ledger (`optimize/findings.json` + `optimize/scorecard.json`),
tags each by **fixability**, and gates the rollout. Sources (full mapping in
`reference/audit-sources.md`):

1. **`rollout:baseline`** — built-in deterministic detectors:
   ```bash
   node skills/rollout/scripts/optimize.mjs        # uses rollout.json site.liveHost
   # or: --base <url> | --root <dir> | --slug <s> | --all
   ```
2. **`impeccable:critique` + `impeccable:audit`** — design quality + a11y/perf.
3. **The marketing SEO skills** — `seo-audit`, `schema`, `ai-seo`,
   `site-architecture`.
4. **`stardust:tensions`** — mechanical design tensions from
   `stardust/current/brand-review.html`.

Normalize each source's findings into the ledger with the writer:

```bash
node skills/rollout/scripts/findings.mjs record \
  --source marketing:seo-audit --layer seo --check thin-content \
  --severity P2 --fixability platform-migration \
  --scope-ids blog/post --evidence "…" --recommend "…"
node skills/rollout/scripts/findings.mjs resolve <id> --status accepted --note "…"
```

All sources share one id space, dedup, scorecard, and the **detect → fix → verify
loop**: re-running a source resolves *its own* gone findings; a regressed `fixed`
finding re-opens; human `accepted`/`wontfix` are preserved. **Fixability routing:**
`platform-migration` → autofix / re-deploy; `design-pass` → upstream (surface
only); `out-of-scope` → informational. The gate **exits non-zero if any open P1 is
in scope** — a page is delivery-clean only when verify passes *and* the ledger has
no open P1.

> At ~1k-page scale: a `head.html`-level fix needs a site-wide republish to land
> and flip its per-page findings; the optimize gate only audits pages in
> `coverage/pages.json`; and faithfully migrated parallel source trees produce
> legitimate duplicate-title findings (a canonical decision, not a bug). See
> `reference/operational-learnings.md`.

The judgment layers (brand-tensions, design-ux, content-conversion) are scored
`null` until populated by the impeccable/tensions sources — the scorecard shows
not-assessed rather than faking a score.

### Phase G — AEM autofix (close the loop)

```bash
node skills/rollout/scripts/autofix-aem.mjs --project <eds-root>   # [--dry-run] [--slug s] [--check c]
```

The platform autofix engine (AEM-EDS, v1 — aggressive). For every open finding
whose `check` has a registered EDS fixer, it edits the EDS **project** files, logs
the change on `finding.autofix`, and stages the finding `in-progress`:
- **deterministic** — `eds-fix-h1` (exactly one `<h1>`), sitemap (re-assemble).
- **content-draft** (logged for review) — `eds-metadata-title` /
  `eds-metadata-description`, `eds-alt-draft`, `eds-disambiguate-title`.
- **manual** (prepares guidance/payload) — `eds-jsonld` (use `marketing:schema`),
  `eds-canonical`, `eds-landmark-main`.

Use `--dry-run` first. After applying, **re-deploy** the edited pages, then re-run
**verify** + **optimize** — staged findings flip to `fixed`. `design-pass` findings
are surfaced, not auto-fixed.

### Phase H — Report

Read `rollout.json.lastRun` + `optimize/scorecard.json` (or re-run `inventory.mjs`):

```
rollout — <site> → aem-eds
==================================================
Pages       <N> total · <v> verified · <d> deployed · <p> pending · <cp> content-pending · <s> stale
Templates   <T> (per-template delivered/total)
Blocks      <B> total · <c> converted · <p> pending
Quality     health <H>/100 · open P1 <n> / P2 <n> / P3 <n>
To deliver  <list of remaining slugs>
Content     <cp> pages awaiting content track (block code deployed, document not yet pushed)
```

Surface `pending`/`stale`/`failed` as the explicit "what's missing" list.
`content-pending` pages are listed separately — not failures; their block code is
live and they advance to `pending` automatically when `migrate` emits their HTML
and `inventory` is re-run.

**Also write/refresh `stardust/learnings.md`** per
`skills/stardust/reference/learnings.md`: one entry per failure class this run
surfaced (evidence, proposed skill + section to change, `status: pending`).
plugin maintainers harvest pending entries into skill
diffs — this is how a run's hard-won fixes stop being re-learned.

### Phase I — Dashboard

```bash
node skills/rollout/scripts/dashboard.mjs    # → dashboard/index.html + data.json
```

A **self-contained, no-external-JS** dashboard rendered in the **project's design
identity** (brand tokens read from a migrated page's `:root`). Centerpiece: a
**page tree** of every identified page, nested by URL path, each node colour-coded
by the most-advanced lifecycle stage it reached:

```
identified → prototyped → deployed → optimised
```

The stage spans `state.json` (`rostered/extracted/directed` → identified,
`prototyped/approved/migrated` → prototyped), rollout coverage
(`deployed`/`verified` → deployed), and optimize (`optimised` = verified **and** no
open findings). A `content-pending` sibling stays at `identified` (it's in the
ledger so delivery can be tracked, but has no designed document yet). Legend counts
are **cumulative**. **Template archetypes** are badged `T`; a page with open
findings shows a red count. Also a templates table + the quality scorecard.
`dashboard/data.json` is the inspectable snapshot — regenerate at every iteration
boundary. (`state.json` is read-only and optional.)

## Inputs

| Input | Source | Used for |
|---|---|---|
| `stardust/migrated/*.html` | `migrate` | the pages to deliver (read-only) |
| `stardust/migrated/**/_meta.json` | `migrate` | `templateId` (`template`/`type`), `blocks` (`modules`), `title` |
| `stardust/state.json` | stardust core | *(archetypes-only mode)* full page roster + `type` for pages not yet migrated |
| `stardust/rollout/rollout.json` | rollout / user | DA target coordinates |

## Outputs

| Path | Purpose |
|---|---|
| `stardust/rollout/coverage/pages.json` | per-page delivery ledger (schema: `schemas/rollout-pages.schema.json`) |
| `stardust/rollout/coverage/templates.json` | template grouping + roll-ups (schema: `schemas/rollout-templates.schema.json`) |
| `stardust/rollout/coverage/blocks.json` | the block dedup ledger + EDS mapping (schema: `schemas/rollout-blocks.schema.json`) |
| `stardust/rollout/plan.json` | dedup-driven delivery order + per-page convert/reuse briefs |
| `stardust/rollout/optimize/findings.json` | multi-source quality findings ledger (schema: `schemas/rollout-findings.schema.json`) |
| `stardust/rollout/optimize/scorecard.json` | quality scorecard + history (schema: `schemas/rollout-scorecard.schema.json`) |
| `stardust/rollout/rollout.json` | config + `lastRun` summary (schema: `schemas/rollout-config.schema.json`) |
| `stardust/rollout/site/{sitemap.xml,robots.txt,manifest.json}` | site-level assembly artifacts |
| `stardust/rollout/dashboard/{index.html,data.json}` | self-contained progress dashboard + snapshot |
| edits to the **EDS project** (`content/**`, `styles/`) | applied by `autofix-aem` (the only files rollout writes outside `stardust/rollout/`) |
| the delivered EDS site | produced by `deploy` per page (blocks/, content/, fragments — owned by `deploy`) |

`rollout` writes under `stardust/rollout/` and — only via `autofix-aem` — to the
**EDS project** it delivers to. It never modifies the agnostic core, `state.json`,
or `migrated/` — those are read-only inputs.

## Dependencies (audit sources — referenced, not vendored)

optimize orchestrates existing audit skills by invocation; they must be installed:

- **impeccable** (`critique`, `audit`) — already a stardust dependency.
- **marketing skills** — `seo-audit`, `schema`, `ai-seo`, `site-architecture`.
  Optional; surface a note if absent.
- **stardust tensions** — emitted in-repo by `extract` (`brand-review.html`).

Normalize each one's output into the ledger via `findings.mjs record`. See
`reference/audit-sources.md`.

## What rollout does NOT do

- **No upstream redesign.** `design-pass` findings are surfaced, not fixed here.
  autofix only touches platform-fixable findings in the EDS project.
- **No new transport.** Delivery is `deploy`'s DA Source API path, unchanged.
- **No redesign of the agnostic core.** `extract`/`direct`/`prototype`/`migrate`
  and `deploy` are untouched.
- **No full pre-migration requirement.** Archetypes-only mode is first-class: block
  code is deployed from the archetypes; remaining pages advance from
  `content-pending` to `deployed` as `migrate` emits their HTML — no rollout restart.

## Scripts

- `scripts/inventory.mjs` — migrated tree → page + template coverage (idempotent,
  stale-aware). `--state <path>` enables archetypes-only mode.
- `scripts/blocks.mjs` — distinct-block dedup ledger (`blocks.json`).
- `scripts/plan.mjs` — dedup-driven delivery order + per-page convert/reuse briefs.
- `scripts/update-coverage.mjs` — deterministic delivery state-writer for pages and
  blocks; re-derives all roll-ups.
- `scripts/section-fidelity.mjs` — source-fidelity gate scaffold (authored sections
  vs source heading outline; informs the gate, never auto-decides).
- `scripts/assemble.mjs` — site-level sitemap / robots / fragments manifest.
- `scripts/verify.mjs` — full-site structural verification (HTTP or offline `--root`).
- `scripts/optimize.mjs` — `rollout:baseline` detectors + the multi-source gate;
  exits non-zero on open P1.
- `scripts/findings.mjs` — record/resolve findings from the external audit sources.
- `scripts/autofix-aem.mjs` — the AEM autofix engine (edits the EDS project).
- `scripts/dashboard.mjs` — design-identity dashboard + `data.json` snapshot.
- `scripts/lib.mjs` — shared IO + roll-up + page-loading + autofix-registry helpers.

## References

- `notes/rollout/PLAN.md` — design, coverage model, phasing, open questions.
- `reference/delivery-gates.md` — Phase C gates + batched-delivery-at-scale flow.
- `reference/dynamic-listings.md` — metadata contract + query-index mechanics (B2/D2).
- `reference/multilingual.md` — per-language trees (D3).
- `reference/operational-learnings.md` — scaled-rollout gotchas (extend, republish, verify).
- `reference/audit-sources.md` — the audit-source → layer → fixability → autofix map.
- `reference/checks.md` — the `rollout:baseline` check catalog.
- `skills/stardust/reference/learnings.md` — the per-run learnings ledger the
  report phase writes.
- `skills/migrate/reference/fidelity-tiers.md` — the archetype/sibling/thin tier
  contract Phase C records.
- `skills/migrate/reference/media-reconciliation.md` — the image-fidelity
  resolver's decision table.
- `skills/deploy/SKILL.md` — the single-page conversion methodology rollout drives.
- `skills/deploy/da-deploy-protocol.md` — the DA Source API transport.
- `skills/migrate/SKILL.md` — produces the `migrated/` + `_meta.json` inputs.
- `schemas/*.schema.json` — the coverage + config contracts.
