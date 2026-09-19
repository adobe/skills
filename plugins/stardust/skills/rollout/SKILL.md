---
name: rollout
description: Deploy a WHOLE redesigned site to AEM Edge Delivery Services — the full-site, bulk sibling of `deploy` (which ships one page). Use to roll out, bulk-deploy, or publish an entire migrated stardust site at once ("deploy all pages", "full site deployment", "deploy the whole/entire website to AEM"), not just a single page. Inventories the migrated tree (stardust/migrated/ + _meta.json) into a delivery ledger, dedups blocks, drives `deploy` per page, verifies, and tracks what's done and what's left. Supports archetypes-only mode — when only the template archetype pages are migrated, it deploys all block code immediately and registers the rest as content-pending.
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, playwright-cli on PATH, and optionally the impeccable skill (github.com/pbakaus/impeccable).
metadata:
  impeccable: optional
---

# stardust:rollout — whole site → AEM (Edge Delivery Services)

## Operator card

Phases, in order: Setup → A Inventory → B Block dedup plan → B2 Dynamic surface → C Deliver → D Site assembly → D2 Dynamic features → D3 Multilingual (optional) → E Verify → E2 Link audit → F Optimize → G Autofix → H Report → I Dashboard.

| Phase | Command |
|---|---|
| A | `node skills/rollout/scripts/inventory.mjs --site-url <source-url> [--content <eds-root>/content] [--redirects stardust/redirects.tsv]` (archetypes-only: add `--state stardust/state.json`) |
| B | `node skills/rollout/scripts/blocks.mjs`; `node skills/rollout/scripts/plan.mjs` |
| B2 | `node skills/dynamics/scripts/dynamics-detect.mjs --from-state … --reach stardust/current`; `node skills/dynamics/scripts/dynamics-plan.mjs --target-origin <live host> --migrated stardust/migrated`; `node skills/dynamics/scripts/dynamics-plan.mjs --lint stardust/dynamic-features.md stardust/dynamic-features-plan.md` |
| C | per page: `node skills/rollout/scripts/delivery-lint.mjs --file <html> --path </da/path> --icons-dir icons [--chrome-docs content/nav.html,content/footer.html,…]` (multi-variant sites); `node skills/rollout/scripts/media-reconcile.mjs --file <html> --deploy-host <host> [--apply]`; `node skills/rollout/scripts/section-fidelity.mjs --file <html> --source <url>`; `node skills/rollout/scripts/update-coverage.mjs <slug> --status <s>`; batches: `node skills/deploy/scripts/deploy-batch.mjs --org … --repo … --branch … --content <dir> [--concurrency 4]` (preview); live: same command `--publish` after D1 |
| D | `node skills/rollout/scripts/assemble.mjs`; `node skills/rollout/scripts/redirects.mjs [--post-publish]` |
| D2 | `node skills/dynamics/scripts/dynamics-check.mjs --origin <live host> --gate` |
| E / E2 | `node skills/rollout/scripts/verify.mjs [--base <url> | --root <dir>] [--all] [--report <dir>]`; `node skills/deploy/scripts/localize-links.mjs --source-host <live-host> --content content --redirects stardust/redirects.tsv [--check]` |
| F | `node skills/rollout/scripts/optimize.mjs [--base <url> | --root <dir> | --slug <s> | --all]`; `node skills/rollout/scripts/findings.mjs record … / resolve <id> …` |
| G | `node skills/rollout/scripts/autofix-aem.mjs --project <eds-root> [--dry-run] [--slug s] [--check c]` |
| H | read `rollout.json.lastRun` + `optimize/scorecard.json` + `verify/summary.md`; write `stardust/learnings.md` |
| I | `node skills/rollout/scripts/dashboard.mjs` |

Gates: Setup — gated-archetype precondition under `flow: replica`. B2 — every dynamic row has a disposition; `dynamics-plan.mjs --lint` exit 0. C — delivery-lint P0/P1 blocks the PUT; source-fidelity, image-fidelity, path-safety, source-content hygiene, fidelity tier declared; EW gate `block-roundtrip --ew`; foundation-first gate on the first deployed archetype; chrome crops consume `pass`, never the pct alone. D — `redirects.mjs` exit 2 (a Source shadows a delivered page) blocks the sheet. E — `verify.mjs` exit 1 = a failed page (folder roots probed on both slash forms), exit 2 = usage / no coverage; a 429/503 through the inline retry leaves the page `unverified` (ledger status untouched) and exits 2 — re-run, never a failed page; headless render check per template. E2 — `localize-links.mjs --check` exit 2 = links remain. F — `optimize.mjs` exits non-zero on any open in-scope P1. H — `dynamics-check.mjs --gate` exit 0 before the report closes.

Outputs (under `stardust/rollout/`): `coverage/{pages,templates,blocks}.json` · `plan.json` · `rollout.json` · `verify/{summary.json,summary.md}` · `optimize/{findings,scorecard}.json` · `site/{sitemap.xml,robots.txt,manifest.json,redirects.json}` · `dashboard/{index.html,data.json}` (schemas: `schemas/rollout-*.schema.json`); plus `stardust/redirects.tsv`, `stardust/learnings.md`, EDS-project edits via autofix.

| At phase | Read |
|---|---|
| Setup | `../stardust/reference/state-machine.md` § Flow keys; `../replica/reference/source-fidelity-gate.md` § Residual logging format · § Residual classes |
| A | `reference/coverage-model.md` § Files · § Page delivery status lifecycle · § Artifact type + fidelity tier · § Idempotency rules (inventory) |
| B | `reference/coverage-model.md` § Block delivery status lifecycle · § Dedup contract (plan.json); `reference/operational-learnings.md` § Extending a delivered site |
| B2 / D2 | `../dynamics/reference/triage.md` § Rules; `../dynamics/reference/listings.md` § Why it is a PRE-IMPORT gate · § Block contract; `../dynamics/reference/patterns.md`; `../dynamics/reference/parity-report.md` § Schema |
| C | `reference/delivery-lint.md` § Run it · § Where it sits in Phase C; `reference/delivery-gates.md` § Gate 1 · § Gate 2 · § Gate 3 · § Gate 4 · § Batched delivery at scale; `../deploy/reference/chrome.md` § Chrome states and variants; `../migrate/reference/fidelity-tiers.md` § Declaration (per page); `../migrate/reference/media-reconciliation.md` § The four decisions; waves: `../stardust/reference/fan-out.md` § Worker contract · § Scope and type of delegated agents; `../stardust/reference/harness-quirks.md`; `../deploy/da-deploy-protocol.md` § Two clocks; code-writing waves: `../deploy/reference/block-agents-brief.md` § The brief template · § Shared cores and variants |
| D3 | `reference/multilingual.md` |
| E / E2 | `reference/coverage-model.md` § Verify; `reference/operational-learnings.md` § Two verify checks; `reference/sweep-protocol.md` (site-scale fix loop, after verify); `../stardust/reference/context-hygiene.md` § Runner reports and session hand-off |
| F / G | `reference/audit-sources.md` § The sources · § Recording an external finding · § Fixability → who fixes it · § AEM autofix registry · § The loop; `reference/checks.md`; `reference/coverage-model.md` § Optimize gate (findings lifecycle); `reference/operational-learnings.md` § Optimize-gate learnings |
| H | `../stardust/reference/handoff-report.md` § Gate table first · § Source → target · § Residuals, links, report check; `../replica/reference/source-fidelity-gate.md` § Per-breakpoint procedure; `../dynamics/reference/parity-report.md` rule 8; `../stardust/reference/learnings.md` § Entry shape |

`deploy` ships **one** page; `rollout` drives it per page over `migrate`'s output —
**delivery only**, never redesign (rationale: `notes/rollout/PLAN.md`).

## When to use

**Full mode** — a fully migrated site at `stardust/migrated/` (per-page HTML +
`_meta.json` from `stardust migrate`), an EDS/AEM project + DA destination; the
**entire** site delivered incrementally and resumably.
**Archetypes-only mode** — one migrated archetype per template plus the full page
inventory in `stardust/state.json` (`type` per page); all block code ships now,
siblings register as `content-pending` and get their content later.
No `stardust/migrated/` tree: `stardust migrate` the archetypes first. Single
page: `stardust deploy`.

## Setup

1. Run the master skill's setup (`skills/stardust/SKILL.md` § Setup). **Flow
   guard:** `stardust/state.json` without `flow` on a migration ask → do not
   roll out; print the master's two-flow table and hand back to its routing
   (`skills/stardust/reference/state-machine.md` § Flow keys).
2. Verify `stardust/migrated/` exists with at least one `*.html` page (full mode:
   all pages; archetypes-only: the archetypes + a `state.json` with `type`
   populated).
   **Gated-archetype precondition (`flow: replica`).** Read
   `stardust/replica/progress.json`: a page type may ship only when its
   archetype has a gate result at every configured breakpoint that is
   `pass: true`, or over the bar only when every residual is a named class
   (`skills/replica/reference/source-fidelity-gate.md` § Residual logging
   format — slug ids from § Residual classes) with `artifacts[]` and
   `acceptedBy`; any other over-bar breakpoint is **FAIL → blocked**. A page
   type whose archetype was never gated, has a configured breakpoint absent
   from `published.<bp>` (`ungated`, never passed), or is over the bar with
   an unaccepted residual is **blocked**: list it with its archetype slug and
   the command to gate it (`$stardust replica <archetype>`), and neither fan
   out its siblings nor `POST /live/` any of them. Hands-off never bypasses an
   ungated archetype (it may self-accept only the table's permanent classes
   as `hands-off-policy:<class>`); thresholds are the gate's.
3. Verify the EDS/AEM target is ready exactly as `deploy` requires (project
   scaffolding, `DA_TOKEN`, code branch pushable). `rollout` adds no new transport.
4. If `state.json.handsOff` is true (`skills/stardust/SKILL.md` § Hands-off
   mode), run full-auto: no per-phase pauses; every gate and verify step runs
   unchanged. A wave close writes the journal entry, the `status.jsonl` `end`
   line and the phase commit, then starts the next wave in the same turn — it
   never ends the turn (master § Hands-off mode → Turn-end contract).

## Procedure

### Phase A — Inventory (build the coverage)

```bash
node skills/rollout/scripts/inventory.mjs --site-url <source-url>
# defaults: --migrated stardust/migrated  --out stardust/rollout  (archetypes-only: operator card)
```

Writes `coverage/pages.json` (one row per page: slug, delivered `path`,
`templateId`, `blocks`, `sourceHash`, `delivery` status), `coverage/templates.json`
(pages grouped by template), and `rollout.json` (target + DA config + `lastRun`).
`--content <eds-root>/content` adds the chrome documents, fragments and sheets
as typed rows (`delivery.type` fragment | index — kept across runs, on the
roster for verify); `--redirects stardust/redirects.tsv` records the served
path of a renamed page (`delivery.deployedPath`).

**Archetypes-only mode** (`--state`): pages only in `state.json` are seeded
`content-pending`, `templateId` from `type`, `blocks` from the archetype sidecar.
Inventory is **idempotent and incremental** (delivery preserved; HTML changed
after delivery → `stale`; `reference/coverage-model.md` § Idempotency rules).
Fill in `rollout.json` `site.da.*` + `site.liveHost` if not inferred.

**Plan gate.** Present every `stardust/decisions.md` row not yet `owner-decided` as
one numbered message, default on each line (`skills/stardust/reference/decisions.md`
§ How phases use it); later phases read the rows, never re-ask.

### Phase B — Block dedup plan (FIRST-CLASS, before any conversion)

```bash
node skills/rollout/scripts/blocks.mjs   # → coverage/blocks.json (the dedup unit)
node skills/rollout/scripts/plan.mjs     # → plan.json + a readable conversion plan
```

- `blocks.mjs` collapses every block instance (per-page `modules` + chrome) into
  the **distinct** set with a canonical `edsBlockName` (kebab, reserved-class
  guard per deploy #15) and `usedByPages` / `instanceCount`. Chrome
  (`header`/`nav`/`footer`) is `kind: chrome` → the authored `/nav`, `/footer`
  documents. In archetypes-only mode the archetype sidecars determine the block
  set; `content-pending` pages add none.
- `plan.mjs` orders pages **representative-first per template** and gives each
  distinct block a **single conversion point**: the first page CONVERTS it, every
  later page REUSES it by name — the per-page `convert`/`reuse` lists are
  `deploy`'s Step-7 brief input, so each block converts once **without changing
  deploy**. `content-pending` pages are always `convert: []`.

### Phase B2 — Dynamic surface (PRE-IMPORT GATE — verify the inventory)

**Before Phase C.** `stardust/dynamic-features.md` (from prepare-migration 4.5 or replica
Phase 2) must exist with a disposition on every row; verify it against fresh evidence here —
`dynamics-detect.mjs --from-state … --reach stardust/current` and `dynamics-plan.mjs
--target-origin <live host> --migrated stardust/migrated` (host-bound APIs, rows the capture
already delivered). New evidence → new rows. Then `dynamics-plan.mjs --lint` (operator card) must
exit 0 (every inventory row placed exactly once in the plan) before Phase C. The listings contract (per-type `<meta>` fields +
`helix-query.yaml`) is emitted by Phase C's `deploy` brief per page: retrofitting metadata across
published pages is a second migration. Missing inventory → run the stardust `dynamics` skill Phases 1–3 now.

### Phase C — Deliver the site (drive `deploy` per page, per the plan)

**Blocked on Phase B2** — author each page's metadata contract into its metadata
block during delivery, so the indexes are rich at import time.

Walk `plan.json.steps` in order (representative pages first). For each page:

1. **Convert + push** the migrated HTML (`source.migratedHtml`) to AEM via the
   `deploy` methodology. **Pass the plan step into deploy's brief**: create only the
   blocks in `convert`; for each block in `reuse`, REUSE the existing block by its
   `edsBlockName` (do not recreate). **The brief MUST carry the Experience Workspace
   editability contract** (`skills/deploy/reference/block-js-scaffold.md` § Experience Workspace editability contract, EW1–EW10): every converted block
   moves authored elements into wrappers (never rebuilds from text) and passes the
   EW gate (`block-roundtrip --ew`) before it counts as delivered.

   **`content-pending` pages** (archetypes-only): no migrated HTML — skip the
   document push entirely (no shell/placeholder), record `content-pending`, surface
   as "awaiting content track" (block code is already deployed via the archetype).

2. **Static contract lint (pre-PUT, deterministic).** Before the push, run the
   delivery-contract linter — it catches the cheap, deterministic failures
   (wrapper, one-CTA-per-`<p>`, trailing-slash, path-safety, `/img/` src,
   `about:error`) offline so a broken page never reaches preview. Mechanics in
   `reference/delivery-lint.md`. **A P0/P1 blocks the PUT.**
   `node skills/deploy/scripts/block-lint.mjs blocks/ --styles styles/styles.css` exits 0 once per code-writing wave (EW-* static signatures; a 🔴 capped by a declared `@ew-exempt` item is `block-roundtrip --ew`'s call) — before any block's round-trip.
   ```bash
   node skills/rollout/scripts/delivery-lint.mjs --file <html> --path </da/path> --icons-dir icons [--chrome-docs content/nav.html,content/footer.html,…]
   node skills/rollout/scripts/media-reconcile.mjs --file <html> --deploy-host <branch>--<repo>--<owner>.aem.live [--apply]
   ```
   `media-reconcile` resolves every image on the network and decides
   optimize/keep/rewrite/omit (`skills/migrate/reference/media-reconciliation.md`)
   — the authoritative form of the image-fidelity gate below.

   **Chrome guard set.** Before chrome is signed off, every top-level trigger is
   opened on the deployed page (`chrome-parity --open <sel>`) and the open-state
   crop passes the same bar as the rest-state crop (#115); `aria-current="page"`
   is set by the header block; a page on a multi-variant site names its
   `nav:`/`footer:` rows (P1 `chrome-variant`, P2 `chrome-variant-count`) —
   `../deploy/reference/chrome.md` § Chrome states and variants.

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
   **Gate on preview, then publish explicitly.** The driver's default run is
   `PUT → preview`; live publish is the separate `deploy-batch.mjs … --publish` run
   after the page gate passes (D1) or when `decisions.md` records publish-to-live
   (D16) — hands-off stops at preview. Any query-index (Phase D2) builds from the
   **live** tree, so run `--publish` before an index is checked. On failure: `--status
   failed --error "<reason>"` and continue (one page's failure never aborts the rollout). A denied push or
   publish under hands-off goes to `stardust/.work/ship.sh`
   (`skills/deploy/reference/ship-script.md`), not a retry loop.

**Foundation-first gate (hard block, once per rollout).** When the FIRST
archetype page flips to `deployed`, stop and prove the foundation before
authoring any second page: run the stardust `diff` skill (both probes) against its
prototype, **plus computed-style invariants in a headless render** — grid
containers compute `display: grid` (not stacked single-column), sections are
full-bleed where the design says so, and the CTA/button classes are actually
styled (per `stardust/runtime-contract.json`, `skills/deploy/SKILL.md`
§ Runtime-detection probe). A wrong runtime assumption (block wrapper class,
button classes) is silent and sitewide; this one gate separates fixing one
page from rebuilding every template.

**Execution model: waves.** Deliver in waves of parallel **author-only** agents
— each agent curls its source pages and writes files only, never deploys or
edits blocks — template clusters concurrently (non-overlapping pages),
representative-first so blocks exist to be reused, and **a family's
listing/index pages ship in its first wave**, before its volume wave (posts
delivered ahead of their category/author pages bounce every in-page link, and
a later stub wave can overwrite the rich pages); then a **central deploy**
per page; then background batches on the same ledger. For clusters of 6–20+ siblings, the full flow is
`reference/delivery-gates.md` § Batched delivery. The central deploy step
runs the bundled, resumable driver, never a serial loop:
`node skills/deploy/scripts/deploy-batch.mjs --org <org> --repo <repo>
--branch <branch> --content <dir>` (concurrency pool, persistent path + body-hash
ledger — only changed files and FAILs re-drive; retry/backoff, append-only log, delivered-`.plain.html` check),
then, once the page gate passed (or `decisions.md` records publish-to-live), the
separate `… --publish` run. Two clocks: code first on the ref the user will look at, then
content; the publish report names the 2 h code-cache window end (`skills/deploy/da-deploy-protocol.md` § Two clocks).
The driver and every batch run in the background; `stardust/.work/deploy/deploy-batch.progress.json`
is the progress file (`skills/stardust/scripts/progress.mjs read <file>`) and its
stdout `SUMMARY` line the completion; after a blip, re-run the same command.
Then reconcile the ledger into coverage with `update-coverage.mjs`.
Every wave agent follows `skills/stardust/reference/fan-out.md` § Worker contract
(liveness, resume-once, finisher) and § Scope and type of delegated agents; every
shell loop, runner and delivery step in a wave follows
`skills/stardust/reference/harness-quirks.md`. When a wave must write code
(converter encoders, per-group stylesheets, helpers), the deploy brief's ownership
protocol applies — `skills/deploy/reference/block-agents-brief.md` § The brief
template (ownership table, block-name claim) and § Shared cores and variants;
author-only waves inherit the shared cores read-only, and the lead merges the
per-agent `eds-conversion-log-<id>.md` files.

### Phase D — Site assembly (whole-site artifacts)

```bash
node skills/rollout/scripts/assemble.mjs   # → rollout/site/{sitemap.xml,robots.txt,manifest.json}
```

Generates `sitemap.xml` (live page rows at their served path) + `robots.txt`, and
a fragments manifest mapping chrome blocks to the authored chrome documents
(`content/nav.html`, `content/footer.html`) with their `canon/*.html` source —
unpublished chrome 404s sitewide.
**Redirects:** `node skills/rollout/scripts/redirects.mjs` turns
`stardust/redirects.tsv` into `site/redirects.json` (one row per request form
per source; exit 2 = a Source shadows a delivered page — fix before Phase E);
upload it as the `/redirects.json` sheet; `--post-publish` probes every page and
both slash forms of a folder root (`reference/delivery-gates.md` § Gate 3).

### Phase D2 — Dynamic features (`dynamics` Phases 4–5)

Implement the plan's reproducibility-`self` rows from the pattern catalogue
(`skills/dynamics/reference/patterns.md` — index-backed listings and search, modal loader,
media as URL, client-compute blocks, owner-facing tag config disabled, off-origin data tiers,
sheet sync); emit every other row as **one owner decision batch** and ship its interim tier.
Query indexes build from the **published** tree — the Phase C `--publish` run, then poll `total`.
Each feature ends with a parity row in `stardust/dynamics/parity.json` carrying a replayable check;
`dynamics-check.mjs --origin <live host> --gate` runs before Phase H and the report carries its table.
Failed replays are `dynamic-gap` / `api-dependency` learnings, never silent passes.
Index-backed listings ship **document-first** (authored rows, index for non-text and top-up —
`dynamics/reference/listings.md`); the deploy AI-readability gate runs on every listing page.

### Phase D3 — Multilingual (optional)

Language trees (`/fr/…`, `/en/…`) are parallel content trees that REUSE the same
block library — only authored content and a little wiring change (language-routed
chrome documents, per-language indexes and path-safety): `reference/multilingual.md`.

### Phase E — Full-site verify

```bash
node skills/rollout/scripts/verify.mjs            # uses rollout.json site.liveHost
# or: --base <url> (explicit host) | --root <dir> (offline, local export or migrated tree)
```

`verify` confirms each delivered row renders (200, no `about:error`, typed
render check) and its internal links resolve, then flips it to `verified` or
`failed`. Its summary lines (`unverified`, `not delivered`, `pending-target
links`, `outside-inventory links` — each printed only when non-zero), which
rows, link classes, the `links.outsideInventory` policy and the exit map:
`reference/coverage-model.md` § Verify.
Read `stardust/rollout/verify/summary.md`, triage per class — the per-page
rows sit below its table, never in the conversation (`skills/stardust/reference/context-hygiene.md`
§ Runner reports and session hand-off).

**Headless render check (per template).** A 200 `.plain.html` can still render
blank — decoration failures (missing script, wrong wrapper class, 404 chrome)
are invisible to a text check. On the FIRST delivered page of each template
(home included), load the live URL headless and assert decoration ran:
`body.appear` set (per `stardust/runtime-contract.json`), `main .section` > 0,
zero `pageerror` events, zero broken images.

**Site-scale fix loop** (sample → class triage → tail → confirmation sweep
against preview): `reference/sweep-protocol.md`.

### Phase E2 — Link-audit completeness

`verify.mjs` checks the links on delivered rows; this phase closes the link
**targets** a roster-driven batch misses (`reference/operational-learnings.md`
§ Two verify checks):

- **Nav/footer/landing targets are NOT archetype siblings.** Enumerate every
  `href` in the `/nav` + `/footer` rows (Phase A `--content`) plus each
  section's landing page; each must be **deployed + published + verified**,
  the chrome rows included.
- **Localize source-site bounce links** with the deploy stage, not by hand:
  `node skills/deploy/scripts/localize-links.mjs --source-host <live-host>
  --content content --redirects stardust/redirects.tsv`; **re-run over the
  WHOLE tree after every wave** (earlier pages gain targets only when a later
  wave ships them). `--check` is the gate (exit 2 = links remain).
- **Strip trailing slashes and `.html` from internal links** (EDS 404s both
  while `.plain.html` passes); repoint `.html` links with no local page at the
  working source URL.
- **The audit GETs each href against the LIVE tree** — ledger resolution misses
  the trailing-slash and case defects only delivery exposes.

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
2. **`impeccable:critique` + `impeccable:audit`** — design quality + a11y/perf
   (optional — note absence and use the rest).
3. **The marketing SEO skills** — `seo-audit`, `schema`, `ai-seo`,
   `site-architecture` (optional, likewise).
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

All sources share one id space, dedup, scorecard and the **detect → fix → verify
loop** (read table F / G). The gate **exits non-zero if any open P1 is in
scope** — delivery-clean = verify passes *and* no open P1.

> At ~1k-page scale: `reference/operational-learnings.md` § Optimize-gate learnings.

The judgment layers (brand-tensions, design-ux, content-conversion) score `null`
until the impeccable/tensions sources populate them — not-assessed, never faked.

### Phase G — AEM autofix (close the loop)

```bash
node skills/rollout/scripts/autofix-aem.mjs --project <eds-root>   # [--dry-run] [--slug s] [--check c]
```

The platform autofix engine (AEM-EDS, v1 — aggressive): for every open finding
whose `check` has a registered EDS fixer (read table F / G) it edits the EDS
**project** files, logs the change on
`finding.autofix` and stages the finding `in-progress`. `--dry-run` first; after
applying, **re-deploy** the edited pages and re-run **verify** + **optimize** —
staged findings flip to `fixed`.

### Phase H — Report

Hand-off shape: `skills/stardust/reference/handoff-report.md` — gate table first,
source → target per page, report-check line last; review links open on the live
host, the human logging in (`skills/deploy/da-deploy-protocol.md` § Site auth).
Quote the content tree's vocabulary census in one line — `node skills/deploy/scripts/davids-model-lint.mjs content/ --json` → `census.styles.length` section styles, `census.blocks.length` blocks (the locked vocabulary the conversion log pastes).

Include the dynamic parity table (`stardust/qa/dynamics-report.md`, from Phase D2)
next to the delivery ledger: per feature its class, reach, status, owner decision
and the replayed check — honest about what the site *does*, not only *shows*.
`dynamics-check.mjs --origin <live host> --gate` must exit 0 before the report closes
(exit 3 = `parity.json` missing or a `self` row still pending — `skills/dynamics/reference/parity-report.md`
rule 8); hands-off sets unshipped `self` rows to `interim` with a one-line reason
and a named owner decision, never `pending`. The report lists unplayable media by
page (`media-reconcile.mjs` rows `unplayable` / `needs-credential`).

Read `rollout.json.lastRun` + `optimize/scorecard.json`:

```
rollout — <site> → aem-eds
==================================================
Gate        <archetype> <bp>: FAIL <n> % (register: R-nn <title>) · <archetype> <bp>: ungated   ← failing/ungated rows first; none → all gated
Archetypes  published-gated A of T at <bp> · ungated: <slug@bp …>   (read from stardust/replica/progress.json, never retyped)
Live drift  <n> pages recaptured · <n> masks kept
Pages       <N> total · <v> verified · <d> deployed · <p> pending · <cp> content-pending · <s> stale
Templates   <T> (per-template delivered/total)
Blocks      <B> total · <c> converted · <p> pending
Quality     health <H>/100 · open P1 <n> / P2 <n> / P3 <n>
To deliver  <list of remaining slugs>
Content     <cp> pages awaiting content track (block code deployed, document not yet pushed)
```

The `Gate` and `Archetypes` lines are copied from `stardust/replica/progress.json`
(`published.<bp>` absent = `ungated`); `Live drift` counts the round records
carrying `liveDrift{}` and the `--mask` suggestions kept from `variance.json`
(`skills/replica/reference/source-fidelity-gate.md` § Per-breakpoint procedure).
Surface `pending`/`stale`/`failed` as the "what's missing" list; for failed
rows point at `stardust/rollout/verify/summary.md` — no per-page list.
`content-pending` pages are listed separately — not failures.

**Also write/refresh `stardust/learnings.md`** per
`skills/stardust/reference/learnings.md`: one entry per failure class this run
surfaced (evidence, proposed skill + section to change, `status: pending`) —
the entries plugin maintainers harvest into skill diffs.

### Phase I — Dashboard

```bash
node skills/rollout/scripts/dashboard.mjs    # → dashboard/index.html + data.json
```

A **self-contained, no-external-JS** dashboard in the project's design identity
(brand tokens from a migrated page's `:root`). Centerpiece: a **page tree** of
every identified page, nested by URL path, each node colour-coded by the
most-advanced stage it reached — `identified → prototyped → deployed → optimised`
— spanning `state.json` (identified/prototyped), rollout coverage
(`deployed`/`verified` → deployed) and optimize (`optimised` = verified **and** no
open findings); a `content-pending` sibling stays at `identified`. Legend counts
are **cumulative**; archetypes badged `T`; open findings a red count; plus a
templates table + the quality scorecard. `dashboard/data.json` is the snapshot —
regenerate at every iteration boundary (`state.json` read-only, optional).

## Inputs

| Input | Source | Used for |
|---|---|---|
| `stardust/migrated/*.html` | `migrate` | the pages to deliver (read-only) |
| `stardust/migrated/**/_meta.json` | `migrate` | `templateId` (`template`/`type`), `blocks` (`modules`), `title` |
| `stardust/state.json` | stardust core | *(archetypes-only mode)* full page roster + `type` for pages not yet migrated |
| `stardust/rollout/rollout.json` | rollout / user | DA target coordinates |

## Outputs

The operator card's Outputs line is the list (schemas in `schemas/`). `rollout`
writes under `stardust/rollout/` and — only via `autofix-aem` — to the **EDS
project**; the agnostic core, `state.json` and `migrated/` are read-only inputs.
The EDS site itself is `deploy`'s output per page. Phase F's audit sources are
referenced, not vendored (`reference/audit-sources.md`).

## What rollout does NOT do

- **No upstream redesign** — `design-pass` findings are surfaced, not fixed; autofix
  touches only platform-fixable findings in the EDS project.
- **No new transport** — `deploy`'s DA Source API path, unchanged.
- **No full pre-migration requirement** — archetypes-only mode is first-class;
  `content-pending` pages advance as `migrate` emits their HTML, no restart.

## Scripts

One per operator-card row; `lib.mjs` holds the shared IO, roll-up and
autofix-registry helpers. `update-coverage.mjs` is the only
writer of the coverage ledger; `section-fidelity.mjs` informs the gate, never decides.

## References

- `notes/rollout/PLAN.md` — design, coverage model, phasing, open questions.
- `reference/*.md` — per phase in the operator card's read table (`checks.md` = the `rollout:baseline` catalog).
- `skills/dynamics/SKILL.md` + its `reference/` — the dynamic surface (B2/D2).
- `skills/deploy/SKILL.md` · `skills/deploy/da-deploy-protocol.md` — the single-page methodology rollout drives; the DA Source API transport.
- `skills/migrate/SKILL.md` — produces the `migrated/` + `_meta.json` inputs.
- `schemas/*.schema.json` — the coverage + config contracts.
