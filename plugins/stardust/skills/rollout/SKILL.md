---
name: rollout
description: Deploy a WHOLE redesigned site to AEM Edge Delivery Services — the full-site, bulk sibling of `deploy` (which ships one page). Use to roll out, bulk-deploy, or publish an entire migrated stardust site at once ("deploy all pages", "full site deployment", "deploy the whole/entire website to AEM"), not just a single page. Inventories the migrated tree (stardust/migrated/ + _meta.json) into a delivery ledger, dedups blocks, drives `deploy` per page, verifies, and tracks what's done and what's left. Supports archetypes-only mode — when only the template archetype pages are migrated, it deploys all block code immediately and registers the rest as content-pending.
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, playwright-cli on PATH, and the impeccable skill (github.com/pbakaus/impeccable) installed alongside stardust.
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

1. Run the master skill's setup (`skills/stardust/SKILL.md` § Setup). **Flow
   guard:** `stardust/state.json` without `flow` on a migration ask → do not
   roll out; print the master's two-flow table and hand back to its routing
   (`skills/stardust/reference/state-machine.md` § Flow keys).
2. Verify `stardust/migrated/` exists with at least one `*.html` page (full mode:
   all pages; archetypes-only: the archetypes + a `state.json` with `type`
   populated). If not, recommend `stardust migrate` on the archetypes and stop.
   **Gated-archetype precondition (`flow: replica`).** Read
   `stardust/replica/progress.json`: a page type may ship only when its
   archetype has a gate result at every configured breakpoint that is
   `pass: true`, or over the bar with every residual carrying a `cause`
   (`skills/replica/reference/source-fidelity-gate.md` § Residual logging
   format — a documented residual is a pass with an asterisk). A page type
   whose archetype was never gated, or is over the bar with no residual
   entries, is **blocked**: list it with its archetype slug and the command
   to gate it (`$stardust replica <archetype>`), and neither fan out its
   siblings nor `POST /live/` any of them. Accepting logged residuals under
   hands-off is not a bypass for an ungated archetype. Thresholds are the
   gate's, unchanged. (Recorded: 2,207 pages published at 24–28 % diff from
   an archetype that never passed; a 3,366-page re-import after a random
   review found what a gate would have.)
3. Verify the EDS/AEM target is ready exactly as `deploy` requires (project
   scaffolding, `DA_TOKEN`, code branch pushable). `rollout` adds no new transport.
4. If `state.json.handsOff` is true (`skills/stardust/SKILL.md` § Hands-off
   mode), run full-auto: no per-phase pauses. Every gate and verify step below
   runs unchanged — hands-off removes waiting, not validation.

## Procedure

### Phase A — Inventory (build the coverage)

```bash
node skills/rollout/scripts/inventory.mjs --site-url <source-url>
# defaults: --migrated stardust/migrated  --out stardust/rollout  --content content
# archetypes-only mode: add the full page roster from state.json
node skills/rollout/scripts/inventory.mjs --site-url <source-url> --state stardust/state.json
```

Writes `coverage/pages.json` (one row per page: slug, delivered `path`, `templateId`,
`blocks`, `sourceHash`, `delivery` status, and `delivered`: the page's blocks in document
order from `content/`), `coverage/templates.json` (pages grouped by template), and
`rollout.json` (target + DA config + `lastRun`). Coverage files carry `formatVersion`.

**Archetypes-only mode** (`--state`): pages with a `_meta.json` are seeded as in
full mode; pages present only in `state.json` are seeded with `templateId` from
`type`, `blocks` from the archetype sidecar, and `delivery.status:
content-pending`. `--state` needs a state file (`pages[]` of `{slug, url, type}`)
and an archetypes-only tree: a sibling in the tree or a malformed file exits 2 with
nothing written — re-run without `--state`.

Inventory is **idempotent and incremental**: delivery status is preserved; a
delivered page is re-flagged `stale` only when the same document's bytes change — a
roster row later migrated keeps its status. Fill in the DA
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
  `instanceCount`; module rows also carry option classes, variants, description,
  contract and base type. Chrome (`header`/`nav`/`footer`) is `kind: chrome` → site-wide
  authored documents (`/nav`, `/footer`) fed to the header/footer blocks. In
  archetypes-only mode the archetype sidecars fully determine the
  block set; `content-pending` pages add none. A module that maps to EDS **default
  content** (title, text, image, button, separator — deploy's D1) needs no block: record
  it `update-coverage.mjs --block <id> --status converted --eds-name default-content`;
  such a row is never counted pending, whatever its status. Every directory under
  `blocks/` is registered — one no page lists gets a row `source: blocks-dir` (header
  and nav count as one chrome); a block deliberately left undelivered is recorded
  `update-coverage.mjs --block <name> --status not-delivered --reason "<text>"`.
  `rollout.json` `lastRun.blocks` counts `{total, converted, notDelivered, pending}`.
- `plan.mjs` orders pages **representative-first per template** and gives each
  distinct block a **single conversion point**: the first page that uses it
  CONVERTS it, every later page REUSES it by name. The per-page `convert`/`reuse`
  lists are exactly `deploy`'s Step-7 brief input, so each block converts once
  **without changing deploy**. `content-pending` pages are always `convert: []`.

> Extending an already-delivered site? A "new template" is almost always a new
> COMPOSITION of the existing block library, not new block code — audit `blocks/`
> first. See `reference/operational-learnings.md`.

### Phase B2 — Dynamic surface (PRE-IMPORT GATE — verify the inventory)

**Before Phase C.** `stardust/dynamic-features.md` (from prepare-migration 4.5 or replica
Phase 2) must exist with a disposition on every row; verify it against fresh evidence here —
`dynamics-detect.mjs --from-state … --reach stardust/current --reuse-if-fresh` (a `_dynamics.json`
written after this run's `A-inventory` start with the same URLs and roster, every page loaded
without error, is reused — the line says so; `--fresh` re-probes) and `dynamics-plan.mjs
--target-origin <live host> --migrated stardust/migrated` (host-bound APIs, rows the capture
already delivered). New evidence → new rows. The listings contract (per-type `<meta>` fields +
`helix-query.yaml`) is emitted by Phase C's `deploy` brief per page: retrofitting metadata across
published pages is a second migration. Missing inventory → run the stardust `dynamics` skill Phases 1–3 now.
Contract: `skills/dynamics/reference/triage.md`, `reference/listings.md`.

### Phase C — Deliver the site (drive `deploy` per page, per the plan)

**Blocked on Phase B2** — author each page's metadata contract into its metadata
block during delivery, so the indexes are rich at import time.

Walk `plan.json.steps` in order (representative pages first). For each page:

1. **Convert + push** the migrated HTML (`source.migratedHtml`) to AEM via the
   `deploy` methodology. **Pass the plan step into deploy's brief**: create only the
   blocks in `convert`; for each block in `reuse`, REUSE the existing block by its
   `edsBlockName` (do not recreate). **The brief MUST carry the Experience Workspace
   editability contract** (deploy SKILL.md § 8, EW1–EW10): every converted block
   moves authored elements into wrappers (never rebuilds from text) and passes the
   EW gate (`block-roundtrip --ew`) before it counts as delivered — a brief without
   it skipped the contract on 27/27 blocks of a real site. **The brief also carries
   the archetype's `captureState[].restoreAtDelivery` list** (replica `progress.json`):
   a freeze the gate needed (video at frame 0, carousel on slide 1) is a behaviour to
   deliver, never the spec (`../replica/reference/recreation-procedure.md § Carousels`).

   **Deploy first, judge on the preview origin.** The local harness
   (`build-harness.mjs` → `qa-gate.mjs`, `block-roundtrip.mjs --ew`) serves the
   structural asserts only; every pixel or visual judgment — replica's
   source-fidelity gate, the header/footer `crop-compare` bands, the deployed
   eyeball — runs against the page's preview URL after `PUT → preview`, never
   against the harness before the first PUT (deploy SKILL.md § Local QA before
   deploy, § Step 10). A recorded delivery session iterated CSS against a local
   harness pixel diff for its whole budget and delivered no page.

   **Chrome and fragment documents carry `Robots | noindex`.** `content/nav.html`,
   `content/footer.html`, every per-locale `nav-*` / `footer-*` document and any
   locale shell that is not a page get one more metadata block row at write time —
   `<div><div>Robots</div><div>noindex</div></div>` (renders
   `<meta name="robots" content="noindex">`). Without it the platform's index of
   published documents, and the `/sitemap.xml` it serves, list them as pages;
   Phase D verifies the served sitemap.

   **`content-pending` pages** (archetypes-only): no migrated HTML — skip the
   document push entirely (no shell/placeholder), record `content-pending`, surface
   as "awaiting content track." Their block code is already deployed via the
   archetype.

   **Encoded pages** (`source.encodedHtml`, migrate's `stardust/encoded/`): no
   convert — deploy's `stage-content.mjs` copies the document into `content/`
   (deploy SKILL.md § Deploy, the Stage row), then steps 2–4 as for any page.

2. **Static contract lint (pre-PUT, deterministic).** Before the push, run the
   delivery-contract linter — it catches the cheap, deterministic failures
   (wrapper, one-CTA-per-`<p>`, trailing-slash, path-safety, `/img/` src,
   `about:error`) offline so a broken page never reaches preview. Mechanics in
   `reference/delivery-lint.md`. **A P0/P1 blocks the PUT.**
   ```bash
   node skills/rollout/scripts/delivery-lint.mjs --file <html> --path </da/path>
   node skills/rollout/scripts/media-reconcile.mjs --file <html> --deploy-host <branch>--<repo>--<owner>.aem.live [--media-ledger <file>] [--apply]
   ```
   `media-reconcile` resolves every non-hosted image on the network and decides
   optimize/keep/rewrite/omit (`skills/migrate/reference/media-reconciliation.md`)
   — the authoritative form of the image-fidelity gate below. A content-host URL
   (`content.da.live`) is the `hosted` decision instead: checked offline against the
   media ledger (`--media-ledger <file>`, auto-detected), never fetched anonymously
   (`401` by design); missing from the ledger fails the gate.

3. **Run the delivery gates** before flipping a page to `deployed`. Each is a
   one-line rule here; mechanics + helpers in `reference/delivery-gates.md`:
   - **Source-fidelity** — don't add sections the source lacks; never fabricate
     facts. `node skills/rollout/scripts/section-fidelity.mjs --file <html> --source <url>`
     (a static outline check on the authored file — not replica's pixel
     source-fidelity gate, which runs on the published origin after `deployed`)
   - **Image-fidelity** — every authored `<img>` src must return 200 or be omitted;
     never ship `<img src="about:error">`. Run `media-reconcile.mjs` (step 2).
   - **Path-safety** — `reference/delivery-gates.md` § Gate 3; record
     original→normalized in `stardust/redirects.tsv`. (delivery-lint flags violations.)
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
   node skills/rollout/scripts/update-coverage.mjs --block <id> --status converted --eds-name default-content   # maps to default content, no block
   node skills/rollout/scripts/update-coverage.mjs <slug> --status deployed --url <branch-preview-url>
   node skills/rollout/scripts/update-coverage.mjs <slug> --status content-pending   # no document push
   ```
   **`deployed` is on disk and committed before any gate:** each page's
   `--status deployed` line runs right after its `.plain.html` checks, then,
   inside a C-deliver unit, `node skills/stardust/scripts/unit-commit.mjs <unit>`
   (`<unit>`: the recorded unit holding the page, `stardust/rollout/units/<unit>.paths`);
   D2-built pages and `foundation-chrome`'s chrome documents are recorded and
   committed at the checkpoint commit. The published-origin gate comes after
   (handoff contract § 3, row C).
   **Publish in the loop (`PUT → preview → live`), don't stop at preview** — any
   query-index (Phase D2) builds from the **live** tree, so a preview-only delivery
   leaves indexes empty. On failure: `--status failed --error "<reason>"` and
   continue (one page's failure never aborts the rollout).

**Foundation-first gate (hard block, once per rollout).** When the FIRST
archetype page flips to `deployed`, stop and prove the foundation before
authoring any sibling page of that template: run the stardust `diff` skill (both probes) against its
prototype, **plus computed-style invariants in a headless render** — grid
containers compute `display: grid` (not stacked single-column), sections are
full-bleed where the design says so, and the CTA/button classes are actually
styled (per `stardust/runtime-contract.json`, `skills/deploy/SKILL.md`
§ Runtime-detection probe). Its probes run against the preview URL, never a
harness (step 1). A wrong runtime assumption (block wrapper class, button classes) is silent and sitewide — typography still looks fine while every grid stacks. The same gate runs `qa.mjs --checks metadata`
against the origin: `favicon-default` means the site's icon never shipped
(deploy Step 3 § Favicon) — recorded first passes served the boilerplate icon while `/favicon.ico` answered 200. **Foundation sub-units (C0):** in C-deliver
the foundation is three recorded units, each its own `progress.json` entry, a
subagent that returns one verdict line, a checkpoint commit and a boundary ask:
`foundation-chrome` (header + footer blocks, the chrome documents) and
`foundation-styles` (styles, fonts, favicon, scripts,
`stardust/runtime-contract.json`) may run in parallel (disjoint files);
`archetype-<template>` of the shell template may convert its blocks and write its
document meanwhile, but its first `unit-commit.mjs` (the Code-stage push) and its
deploy wait for both foundation checkpoint commits, which the main agent makes
itself, one at a time, staging by path the sub-unit's frozen-set paths, chrome
documents, `stardust/runtime-contract.json`, `stardust/rollout/progress.json` and
any file only it wrote (the favicon, `stardust/rollout/chrome-map.json`), never
`git add -A`. The foundation sub-units
close on their own lint and `.plain.html` checks, this gate runs once, on that
archetype page (a failing check reopens the sub-unit owning its files:
`progress.mjs unit start <sub-unit> --again`), and
`foundation-freeze.mjs freeze` runs once it passes, before any sibling page is
authored or any post-C0 unit starts (handoff contract § Fan-out discipline,
Foundation first). A `fix-later` header request raised during the wave is applied by the
`foundation-chrome` owner as soon as the first wave is running — in parallel with the archetype
units, with a home re-gate — not deferred to C-final, where header parity is only verified (a
recorded run queued two at 19:44 and applied them only at C-final 22:01–22:41, 40 min on the
critical path). **Archetype first, per template (#126):** the
template's archetype is deployed and passes its full gate row on the preview URL
(`gate-all.mjs --only`, cap 3 fix rounds, stop at PASS — `reference/delivery-gates.md`
§ Iteration discipline) before any of its siblings is rendered
or converted — the recorded unit `C-archetype` (handoff contract § 3, row C).
An encoded template's C-archetype — every template with two or more siblings is one — drafts the map
(`stardust/import/<template>/`) once the archetype gates, round-trips it and records the attempt
(`encode-attempt.mjs record --template <t>`; `not-attempted` is refused for it without a `--reason`, and `migrate.mjs plan` lists the maps still due — `skills/migrate/SKILL.md` § Encoder first; an exception follows the
same SKILL.md, § When the encoder cannot: a sibling the variance probe finds differing is the SAME template with
variant CSS/JS — it takes the variant class the probe records (`variant: <name>` in
`stardust/rollout/variance/<template>.json`), never its own archetype; re-typing a sibling into a new template is the
EXCEPTION, not the response to "differs" — `state.mjs set --type` refuses it when the current template would be left
with ≤ 2 pages or the new one would have ≤ 2 pages, unless `--owner-decision "<why it is a real new template, not a
variant>"` is given (recorded on the page); hand-authored last, recorded first). Its cluster unit is then the map plus the exceptions, and the
main agent alone re-runs `inventory.mjs` and `plan.mjs` once the wave's clusters have encoded and staged
(handoff contract § 3, row C; `skills/migrate/reference/importer-recipe.md` § Encoder contract).
**Cluster sub-units (#134):** in C-deliver a template cluster of more than 16
siblings is delivered as recorded sub-units `cluster-<template>-1..n` — at most
16 pages each, near-equal, cut in sibling order, run one after another — each
with its own `stardust/rollout/progress.json` entry (`node skills/stardust/scripts/progress.mjs unit start|done|failed <unit>`), checkpoint commit and
boundary ask; fix rounds (cap 3, stop at PASS — `reference/delivery-gates.md`
§ Iteration discipline) and the `gate-all.mjs --only` scope are per sub-unit.
Target: no C-deliver unit runs longer than 90 minutes
(handoff contract § 3, row C). A fan-out subagent honours the pause file
`STARDUST_PAUSE_FILE` (handoff contract § Fan-out discipline).
Other edits go through instruments too: text in a tracked file through the
edit tool or `skills/stardust/scripts/replace.mjs` (counted, atomic), a JSON
value through `skills/stardust/scripts/json-edit.mjs` — an inline interpreter
may read and print, never write a tracked file
(`../replica/reference/reading-discipline.md`).
**Execution model: waves.** Deliver in waves of parallel **author-only** agents
— each agent curls its source pages and writes files only, never deploys or
edits blocks — template clusters concurrently (non-overlapping pages),
representative-first so blocks exist to be reused; then a **central deploy**
per page; then background batches with a per-page OK/FAIL ledger, re-driving
FAILs only. For clusters of 6–20+ siblings, the full flow is
`reference/delivery-gates.md` § Batched delivery (and its one self-deploying
variant, replica's Phase 5 fan-out). The central deploy step
should run the bundled, resumable driver rather than a serial loop:
`node skills/deploy/scripts/deploy-batch.mjs --org <org> --repo <repo>
--branch <branch> --content <dir>`. The driver and every batch run in the background; its log and ledger are the
progress file. After a transient blip, re-run the same command — it re-drives
only the FAILs. Then reconcile the ledger into coverage with `update-coverage.mjs`
(step 4's order). **Schedule (replica's Phase 5 fan-out):** once C0's sub-units
are committed and frozen, start EVERY archetype unit in the same turn (one
background subagent each; disjoint by construction) and each cluster (its first
sub-unit) the moment its archetype is `done`; never serialize disjoint units to
spare browsers — the browser slot queue paces captures, not the number of units
(recorded: a run that started four units in one turn finished ten in the time a
serial run finished five). The lead's loop:
`progress.mjs wait` → `progress.mjs show --waves` → for each unit that ended,
handoff contract § 5's other steps (block records, freeze check, `unit-commit.mjs
<unit>` — it commits the end flip — boundary ask) → start everything its `can start now:` line
names, each launch line naming the unit's `deadline: <UTC HH:MM>` (the brief
carries the clock, contract § Unit briefs) → wait again;
C-final only once that line names `gate-all` (a wait's exit 2 is no signal).
Each unit's subagent flips its own end as its last act, after its commit; the
lead marks `failed` only a unit whose agent returned without it (at a 77, or a
75 past its `deadline:`; handoff contract § Fan-out
discipline). The one exception: a unit that edits a shared
file waits for that file's lock as the contract's shared-ledgers bullet
describes — inside its writer, never by starting later. Waits: the master
skill's wait discipline.

```bash
P="node skills/stardust/scripts/progress.mjs"   # project copy: stardust/scripts/stardust/progress.mjs
# C0 (with archetype-page, the shell template's) committed and frozen → ONE turn: record and
# spawn (background) page's cluster and every other archetype; each launch line's deadline —
# "deadline: 22:25": 21:10 UTC + 90 min = 22:40; session end 22:30 − 5 min = 22:25; the earlier wins
$P unit start cluster-page      --kind cluster   --templates page
$P unit start archetype-article --kind archetype --templates article
$P unit start archetype-product --kind archetype --templates product
$P wait          # --max 300 (240 under a five-minute cache); by exit code:
#  0   a unit flipped its own end ("progress rollout archetype-product: done …") → its § 5 steps
#      (unit-commit.mjs <unit> commits the flip), then the two lines below
#  75  nothing ended within --max → a unit `running` past its deadline whose agent returned
#      (its line in `stardust/.labs/wake`, or the harness's agent status):
#      $P unit failed <unit> --verdict "no end by its deadline: <reason>"; wait again
#  76  the pause file → start nothing new, let running units return, ask the boundary
#  77  a background agent finished (the wake line) → show --waves: its unit flipped → as 0; already
#      handled → wait again; still `running`, no paused: report → it died:
#      $P unit failed <unit> --verdict "<reason>"; then wait again
$P show --waves  # before every wait (ends between waits go unprinted, a wake can be lost; the 75
                 # deadline check too); can start now: cluster-product
$P unit start cluster-product --kind cluster --templates product
$P wait          # … until show --waves says "can start now: gate-all" → C-final
```

### Phase D — Site assembly (whole-site artifacts)

```bash
node skills/rollout/scripts/assemble.mjs   # → rollout/site/{sitemap.xml,robots.txt,manifest.json} — the EXPECTED set
node skills/rollout/scripts/assemble.mjs --verify-origin https://<branch>--<repo>--<owner>.aem.live   # vs the SERVED /sitemap.xml; exit 1 on a mismatch
```

Generates site-wide artifacts: `sitemap.xml` + `robots.txt` from delivered paths,
and a fragments manifest mapping chrome blocks to the authored chrome documents
(`content/nav.html`, `content/footer.html`) with their `canon/*.html` source
(`deploy` Step 6 builds them with `node skills/deploy/scripts/chrome-docs.mjs`,
then localizes their hrefs and re-hosts the logo — a re-build repeats both — and
deploys them through the normal content chain; they MUST be published or the
chrome 404s sitewide).

**The assembled sitemap is never the served one.** `stardust/rollout/` is in
`.hlxignore`, so `site/sitemap.xml` is a local artifact — the EXPECTED url set.
The platform serves its own `/sitemap.xml`, built from its index of every
published document, chrome documents included unless each carries `Robots |
noindex` (Phase C). A recorded hands-off run read the local file, reported
"sitemap 36 urls" and shipped a served sitemap of 58 (36 pages + 22 `nav` /
`footer` documents). Two remedies, the first required:
- **Authoring:** every chrome/fragment document — `/nav`, `/footer`, per-locale
  `nav-*` / `footer-*`, locale shells that are not pages — carries the metadata
  row `Robots | noindex` (`chrome-docs.mjs` writes it); a document already
  published without it is re-authored and re-published (preview → live) before
  the check below.
- **Configuration (alternative, additive):** when the code branch is writable, a
  `helix-sitemap.yaml` at the project root (`sitemaps.default.include: ['/**']`,
  `exclude: ['/nav', '/footer', '/**/nav*', '/**/footer*', '/fragments/**']`,
  `properties.lastmod: lastModified`) keeps chrome out of the served sitemap even
  when a document lacks the row; the same `exclude` globs go into
  `helix-query.yaml` (Phase D2) so the index never carries them either.

**Verify the SERVED sitemap, never the local file.** `assemble.mjs --verify-origin
<live-origin>` fetches `<origin>/sitemap.xml` (a sitemap index is followed),
compares its `<loc>` paths with the coverage rows, prints served vs assembled
counts with every extra and missing path, records the result in
`site/manifest.json` (`servedSitemap`) and exits 1 on any difference. An extra
path is a chrome document without `noindex` or a page built outside the migrated
tree with no coverage row (`update-coverage.mjs --new`, Phase D2); a missing path
is a page not published live. Re-run after the fix until it exits 0. The `D-site`
ledger `end` line names the SERVED count, never the assembled one — e.g.
`--detail "sitemap served 36 = assembled 36; redirects wired; / 200"`.

**D-site checklist** (all before the `D-site end` line): `assemble.mjs
--verify-origin` exits 0 · every chrome document carries `Robots | noindex` and is
published · the redirects sheet is published (below) · `curl -sIL <origin>/` ends
in 200.

**Redirects:** if Phase C's path-safety gate emitted `stardust/redirects.tsv`, wire
it into the EDS redirects mechanism here so original inbound URLs don't 404 — the
redirects sheet at the content root (on a DA-backed site `/redirects.json`, columns
Source / Destination; PUT through the admin API, then preview + publish it like a
page). The root MUST answer: when the source root serves a page, deliver it as
the root `index` document (the pipeline serves `/` from it — `/index` ≡ `/`;
never also a `/` Source row, which would shadow it); only when the source root
itself redirects (`curl -sI <source-url>`, follow the Location chain) does the
sheet carry `/` and `/index.html` → the landing page. Then verify
`curl -sIL https://<branch>--<repo>--<owner>.aem.page/` ends in 200: a 404 on
`/` fails the whole delivery after every phase has passed (recorded — a sheet
with a row for every `.html` path and
none for `/`).

### Phase D2 — Dynamic features (`dynamics` Phases 4–5)

Implement the plan's reproducibility-`self` rows from the pattern catalogue
(`skills/dynamics/reference/patterns.md` — index-backed listings and search, modal loader,
media as URL, client-compute blocks, owner-facing tag config disabled, off-origin data tiers,
sheet sync); emit every other row as **one owner decision batch** and ship its interim tier.
Query indexes build from the **published** tree — publish per page in Phase C, then poll `total`.
Each feature ends with a parity row in `stardust/dynamics/parity.json` carrying a replayable check;
`dynamics-check.mjs --origin <live host>` runs before Phase H (exit 2 on any FAIL) and the report
carries its table. Failed replays are `dynamic-gap` / `api-dependency` learnings, never silent passes;
a parity fix changes block code, never the delivered content's meaning (a recorded run turned a
video button into a source link so its own replay passed).
Index-backed listings ship **document-first** (authored rows, index for non-text and top-up —
`dynamics/reference/listings.md`); the deploy AI-readability gate runs on every listing page.

**A missing query index is a code-branch gap, not a configuration-service problem.**
`/query-index.json` answering 404 means the project ships no `helix-query.yaml`. Author it
at the code branch root (a spec's `knowledge/helix-query.yaml` is the draft), publish the
pages LIVE and poll: `skills/dynamics/reference/listings.md` § Getting an index at all. A
403 from the configuration service is expected; only an unwritable code branch ships the
sheet-backed interim index (recorded `interim`, decision named).

**Search parity is count + titles, not presence.** The results block ranks title
matches first and consults description, then body text, only while fewer than N title
hits exist (N = the source's visible count for the probe term), dedupes by title +
description and caps the typeahead at N — N, the top titles and one known hit are read
from the SOURCE during detect and recorded on the `search-query` check (`expectCount`,
`expectTitles`, `expectIncludes`); `dynamics-check.mjs` fails the check on a count
mismatch (`skills/dynamics/reference/patterns.md` § search-index-backed).

**Pages built here enter coverage.** A results page (or any page without a capture)
has no inventory row, so it stays outside `verify.mjs --all`, `optimize.mjs` and the
assembled sitemap unless registered:
```bash
node skills/rollout/scripts/update-coverage.mjs --new search --path /search --template search --origin dynamics --title "Search"
```
then record its status like any page. `inventory.mjs` keeps such rows on a re-run (the
origin marker in `source.migratedHtml` identifies them; status untouched), so the line
runs once.

### Phase D3 — Multilingual (per-language trees) — optional

When the source has language trees (`/fr/…`, `/en/…`), add them as parallel content
trees that REUSE the same block library — only authored content and a little wiring
change (language-routed chrome documents, per-language indexes, per-language path-safety).
See `reference/multilingual.md`.

### Phase E — Full-site verify

**Order: E2 before E.** Phase E2 (link audit + repoints, below) runs BEFORE this verify, so a verify
failure is never a link E2 was about to repoint. After E2's href-only edits the roster re-gate is
`gate-all.mjs --changed-only` (Phase E2), never the full roster — a recorded run re-gated all 9 pages
(8.2 min) over 136 href-only edits, and the same class cost an earlier run 61 minutes.

```bash
node skills/rollout/scripts/verify.mjs            # uses rollout.json site.liveHost
# or: --base <url>   (explicit host)   |   --root <dir>   (offline, against a local export)
```

For every delivered page — fetched where it was deployed (`delivery.deployedUrl`,
else its path: the delivered-path contract) — `verify` confirms HTTP 200, no
`about:error` (deploy #75), and an `<h1>` count that matches the source capture — then
flips each page to `verified` or `failed`. Exits non-zero if any page failed. Two things
are NOT failures: an `<h1>` count the capture shares (0 or more than one, a recorded
source **`trait`** — content is never edited to satisfy a verifier), and an out-of-plan
internal `href="/…"` (reported **`e2_pending`** for E2 to repoint, since E2 already ran).
Media and text-track links — `.vtt`, `.mp3`, … — are assets, neither a link nor a trait.

**Headless render check (per template).** A 200 `.plain.html` can still render
blank — decoration failures (missing script, wrong block wrapper class, 404
chrome) are invisible to a text check. On the FIRST delivered page of each
template (home included), load the live URL in a headless browser and assert
decoration ran: the runtime's `body.appear` class is set (per
`stardust/runtime-contract.json`), `main .section` count > 0,
zero `pageerror` events, zero broken images, and every `restoreAtDelivery`
entry of the template's archetype holds: an `autoplay` `<video>` at least a
quarter visible is playing (`!paused`, `currentTime` advancing — not merely
present), a rotating carousel advances without interaction.

**Published-origin gate over the roster (#125).** `verify` proves the pages render; the
DELIVERY verdict is replica's `gate-all.mjs` (pixel + height + clip + content per deployed page,
`../replica/reference/source-fidelity-gate.md` § The all-pages published-origin gate). Its roster
is the coverage: rows `deployed` / `verified` with a `deployedUrl`, and `failed` by the gate so a
fix round re-gates them — no state file, no hand-built roster.
`update-coverage.mjs --gate <table | dir>` (the roster `summary.json`, an `--only` run's
`runs/<ts>-<slug>.json`, or the gate dir `stardust/replica/gates/all-<w>/`), run for both widths'
tables, feeds each row back into `delivery.gate` (with the `host` measured) — each width's own verdict in
`delivery.gate.passByWidth`, so a unit is proven only when every width passed — and flips a
failing page to `failed`, back only when no width fails; while any width fails, `verify` never
marks it `verified` and `done-check.mjs` lists it in `pages_failed` — completion derives from
one place, never from the pixel number alone. An INCONCLUSIVE
row (a polluted capture) is no pass: `--gate` leaves the status alone and records
`delivery.gate.inconclusive`, and `verify` reads it as not passed until a measured row replaces it; an
override counts only when gate-all validated it (`delivery.gate.override.valid`). In C-deliver
the roster run is the recorded unit `gate-all` (handoff contract § 3, row C); only when
`done-check.mjs` lists `pages_failed` after C-final does one bounded `gap-closure` pass per
template run, and what fails after it is reported as residuals, never looped again (handoff
contract § 3).

### Phase E2 — Link-audit completeness (runs BEFORE Phase E)

This phase runs BEFORE the full-site verify (Phase E): it audits and **repoints** the link
**targets** a roster-driven batch misses, so the links already resolve when `verify` runs — a href
`verify` still finds out of plan is `e2_pending`, not a failure
(`reference/operational-learnings.md` § Two verify checks). After E2's href-only edits, re-gate with
`gate-all.mjs --changed-only` (it re-gates only pages whose content/CSS fingerprint moved), never the
full roster:

- **Nav/footer/landing targets are NOT archetype siblings.** Enumerate every
  `href` in the `/nav` + `/footer` documents plus each section's index/landing
  page and confirm each is **deployed + published + verified** — and that the
  chrome documents THEMSELVES are published — otherwise they get
  committed but never published, their links 404, and the dashboard still
  reads 100%.
- **Localize source-site bounce links** with the deploy stage, not by hand:
  `node skills/deploy/scripts/localize-links.mjs --source-host <live-host>
  --content content --redirects stardust/redirects.tsv` rewrites every
  source-host href whose path exists in the content tree (header/footer/home
  included) to the canonical root-relative form and lists the ones it kept
  absolute (no local page — a bounce beats a 404). Inside a C-deliver unit
  with pages pass `--unit <unit>` to the plain pass and to `--check` (only the
  unit's documents are written; the map still spans the whole tree). **The
  whole-tree pass runs elsewhere** (C0's foundation sub-units, C-final, this
  phase): earlier units' pages gain newly valid targets only when a later unit
  ships them. `--check` is the gate (exit 2 = localizable links remain).
- **Link every internal page at its served URL** (`deploy/scripts/eds-path.mjs`):
  no `.html`, a slash only on a folder index (`/x/`). `.html` and a leaf's
  slash 404 while `.plain.html` passes. Repoint `.html` links with no local
  page at the working source URL.
- **The audit GETs each href against the LIVE tree**: the ledger alone misses
  slash and case defects.
- **Targets missing from the capture.** Two cases, both recorded in
  `direction.md` as a named decision with the list: a target the direction's
  caps meant to include is a CAPTURE GAP — crawl it first (capture → migrate →
  gate, never authored from a live read) and deliver when the gap is ≤ 12
  pages, else repoint to the source site and list it as scope debt; a target
  outside the declared caps is SCOPE EXTENSION — repoint regardless of count.
  External targets: repoint to the source site; other-locale targets: repoint
  ONLY when that locale root was never captured. Any captured page — a `stardust/state.json` row, including
  `duplicateOf` shells and locale roots — is in scope and is delivered, never
  repointed (the ≤ 12 rule is for UNcaptured pages; a recorded run dropped ten
  captured locale roots by citing it). Never leave a 404 (a recorded audit
  found 10 uncaptured in-scope pages — delivering them was the right call).

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

**Source parity.** When the extract capture exists (`stardust/current/pages/<slug>.json`
and its rendered sidecar; `--current <dir>` to point elsewhere), baseline findings the
SOURCE shares — the same `<title>`, no description on the source either, no JSON-LD on
the source either, the same title shared by the same pages — are tagged `fixability:
out-of-scope` with the evidence prefix `source parity:`, recorded with `status:
informational` (never `open`) and listed in their own report section: excluded from the
health score and the open P1/P2/P3 counts, never gated, never auto-fixed. A recorded hands-off run accepted 63 such findings by
hand. Everything else routes as before (`reference/checks.md` § Source parity).

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

Use `--dry-run` first. On an encoded page (`source.encodedHtml`) the fix goes into `stardust/patches/<slug>.json`
or the map, re-encoded and re-staged — never into `content/` (the next stage refuses a hand edit). After applying,
**re-deploy** the edited pages, then re-run
**verify** + **optimize** — staged findings flip to `fixed`. `design-pass` findings
are surfaced, not auto-fixed.

### Phase H — Report

Include the dynamic parity table (`stardust/qa/dynamics-report.md`, from Phase D2) next to
the delivery ledger: per feature its class, reach, status, owner decision and the replayed
check — so the report is honest about what the site *does*, not only what it *shows*.

Read `rollout.json.lastRun` + `optimize/scorecard.json` (or re-run `inventory.mjs`):

```
rollout — <site> → aem-eds
==================================================
Pages       <N> total · <v> verified · <d> deployed · <p> pending · <cp> content-pending · <s> stale
Templates   <T> (per-template delivered/total)
Blocks      <B> total · <c> converted · <n> not delivered · <p> pending
Quality     health <H>/100 · open P1 <n> / P2 <n> / P3 <n>
Pixel table prototypes <p>/<P> PASS · deployed <d>/<D> PASS (pixel-only <x>/<D>) — gates/{prototypes,all}-1440/summary.md
To deliver  <list of remaining slugs>
Content     <cp> pages awaiting content track (block code deployed, document not yet pushed)
```

Surface `pending`/`stale`/`failed` as the explicit "what's missing" list. The pixel-table
line comes from the two `summary.json` totals (`pass`, `pixelOnlyPass`, `pages`); a deployed
page missing from `all-1440/summary.json` is ungated and belongs in that list (#125).
`content-pending` pages are listed separately — not failures; their block code is
live and they advance to `pending` automatically when `migrate` emits their HTML
and `inventory` is re-run.

**Usage:** `node skills/stardust/scripts/token-ledger.mjs` writes `stardust/usage.md` +
`usage.json` — commit them; with the session transcripts unreachable it still writes the
table, its token cells `unknown`.

**Also write/refresh `stardust/learnings.md`** per
`skills/stardust/reference/learnings.md`: one entry per failure class this run
surfaced (evidence, proposed skill + section to change, `status: pending`).

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

Stage rules, legend and badges: `dashboard.mjs --help`.
`dashboard/data.json` is the inspectable snapshot — regenerate at every iteration
boundary. (`state.json` is read-only and optional.)

**Migration export (required when `rollout.json` `exports` lists `migration-workspace`).** After
`dashboard.mjs`, before the `I-dashboard` end line (format: `reference/coverage-contract.md`). Once, first:
`node skills/rollout/scripts/workspace-manifest.mjs --draft-judgement`, then fill
`stardust/rollout/workspace/judgement.json` in one short pass: per template a name and a one-sentence description;
per block a base type (`hero`, `cards`, `columns`, … or `unknown`), a purpose and reuse guidance. Nothing else is
model-authored, and a re-run never asks again. Then the three commands, in order — each one required:

```bash
node skills/rollout/scripts/inventory.mjs <Phase A flags> && node skills/rollout/scripts/blocks.mjs  # 1. coverage + judged values
node skills/rollout/scripts/block-origin.mjs --verify  # 2. REQUIRED → workspace/mapping.json: source selectors
node skills/rollout/scripts/workspace-manifest.mjs  # 3. → workspace/manifest.json; exit 2 = no mapping.json
```

Build the export once the roster is frozen — no unit running, no fix round open, gap-closure
finished — so the manifest, mapping and judgement describe the final content. Re-run all three, in
order, whenever an input changed after the manifest (a gap-closure or G-aem fix to `content/`,
`blocks/` or `styles/`, a judgement edit), and always BEFORE `done-check.mjs`, which lists
`export_stale:<why>` until the export is fresh — the proof it was not. Under a session deadline that
will cut it short, refresh the export only if it takes under five minutes; otherwise leave
`export_stale` standing for the resumed run. A failing command names what to re-run — fix it and
re-run, never `blocked`.

**Done is one verdict:** the rollout is complete when `node skills/rollout/scripts/done-check.mjs`
exits 0; otherwise it prints one gap per line.

## Inputs

| Input | Source | Used for |
|---|---|---|
| `stardust/migrated/*.html` | `migrate` | the pages to deliver (read-only) |
| `stardust/encoded/**/*.html` | `migrate` (`encode.mjs`) | an encoded sibling's delivered document — staged by deploy, never edited (read-only) |
| `stardust/migrated/**/_meta.json` | `migrate` | `templateId` (`template`; an archetype with `template: null` groups under its own slug; else `type`), `blocks` (`modules` — the inventory report counts sidecars with an empty list: fill them before Phase B), `title` |
| `stardust/state.json` | stardust core | *(archetypes-only mode)* full page roster + `type` for pages not yet migrated |
| `stardust/rollout/rollout.json` | rollout / user | DA target coordinates |
| `content/**`, `blocks/`, `stardust/eds-conversion-log.md` | `deploy` | per-page delivered block structure (inventory), option classes, descriptions and contracts (blocks); read-only |

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
| `stardust/rollout/workspace/{manifest,judgement,mapping}.json` | the migration export (`exports` lists `migration-workspace`): manifest (hashes, handover state), judgement and source selectors (contract: `reference/coverage-contract.md`) |
| edits to the **EDS project** (`content/**`, `styles/`) | applied by `autofix-aem` (the only files rollout writes outside `stardust/rollout/`) |
| the delivered EDS site | produced by `deploy` per page (blocks/, content/, fragments — owned by `deploy`) |

`rollout` writes under `stardust/rollout/` and — only via `autofix-aem` — to the
**EDS project** it delivers to. It never modifies the agnostic core, `state.json`,
`migrated/` or `encoded/` — those are read-only inputs.

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
  blocks; re-derives all roll-ups. `--new <slug> --path --template --origin` registers a
  page built outside the migrated tree (D2) so it enters coverage.
- `scripts/section-fidelity.mjs` — source-fidelity gate scaffold (authored sections
  vs source heading outline; informs the gate, never auto-decides).
- `scripts/assemble.mjs` — site-level sitemap / robots / fragments manifest (the
  EXPECTED set); `--verify-origin <live-origin>` compares the SERVED `/sitemap.xml`
  with it and exits 1 on a mismatch.
- `scripts/verify.mjs` — full-site structural verification (HTTP or offline `--root`).
- `scripts/optimize.mjs` — `rollout:baseline` detectors + the multi-source gate;
  exits non-zero on open P1. Findings mirroring the source capture are tagged
  `source parity:` — informational, not scored, not gated.
- `scripts/findings.mjs` — record/resolve findings from the external audit sources.
- `scripts/autofix-aem.mjs` — the AEM autofix engine (edits the EDS project).
- `scripts/dashboard.mjs` — design-identity dashboard + `data.json` snapshot.
- `scripts/done-check.mjs` — the completion verdict (Phase I); exit 0 = complete.
- `scripts/block-origin.mjs` — delivered block → source selector (`workspace/mapping.json`);
  required in the migration export.
- `scripts/workspace-manifest.mjs` — the manifest (hashes, handover; refuses after handover,
  exit 3; no handover and exit 2 without mapping.json once captures exist) and the judgement draft.
- `scripts/lib.mjs` — shared IO + roll-up + page-loading + autofix-registry helpers.

## References

- `notes/rollout/PLAN.md` — design, coverage model, phasing, open questions.
- `reference/delivery-gates.md` — Phase C gates + batched-delivery-at-scale flow.
- `skills/dynamics/SKILL.md` + its `reference/` — the dynamic surface: classes, triage axes,
  listings contract + query-index mechanics, pattern catalogue, parity report (B2/D2).
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
