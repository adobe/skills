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
| C | per page: `node skills/rollout/scripts/content-acceptance.mjs --slug <slug>`; `node skills/rollout/scripts/delivery-lint.mjs --file <html> --path </da/path> --icons-dir icons`; `node skills/rollout/scripts/media-reconcile.mjs --file <html> --deploy-host <host> [--apply]`; `node skills/rollout/scripts/section-fidelity.mjs --file <html> --source <url>`; `node skills/rollout/scripts/update-coverage.mjs <slug> --status <s>` / `--gate <name> <json>`; batches: `node skills/deploy/scripts/deploy-batch.mjs --org … --repo … --branch … --content <dir> [--concurrency 4]` (preview); page gate: `node skills/rollout/scripts/gate-publish.mjs --all-delivered \| --sample 10 --seed <s> --origin <preview>`; live: same command `--publish --paths <PASS rows>` (hold pending, § Gate 8) |
| D | `node skills/rollout/scripts/assemble.mjs`; `node skills/rollout/scripts/redirects.mjs [--post-publish]` |
| D2 | `node skills/dynamics/scripts/dynamics-check.mjs --origin <live host> --gate` |
| E / E2 | `node skills/rollout/scripts/verify.mjs [--base <url> | --root <dir>] [--all] [--report <dir>] [--gate-report stardust/rollout/gate-report.json]`; `node skills/deploy/scripts/localize-links.mjs --source-host <live-host> --content content --redirects stardust/redirects.tsv [--check]` |
| F | `node skills/rollout/scripts/optimize.mjs [--base <url> | --root <dir> | --slug <s> | --all]`; `node skills/rollout/scripts/findings.mjs record … / resolve <id> …` |
| G | `node skills/rollout/scripts/autofix-aem.mjs --project <eds-root> [--dry-run] [--slug s] [--check c]` |
| H | wave close: `node skills/rollout/scripts/close-check.mjs --fix` (exit 0 closes; runs `open-review-pairs.mjs --per-template 1 --no-open`, `dashboard.mjs`); write `stardust/learnings.md` |
| I | `node skills/rollout/scripts/dashboard.mjs` — once after Phase A, then at every wave close |

Gates: Setup — `gate-ledger-lint.mjs` exit 2 = blocked types under `flow: replica`. B2 — every dynamic row has a disposition; `dynamics-plan.mjs --lint` exit 0. C — `content-acceptance.mjs` exit 2 (dropped content) and delivery-lint P0/P1 block the PUT; source-fidelity, image-fidelity, path-safety, source-content hygiene, fidelity tier declared; EW gate `block-roundtrip --ew`; foundation-first gate on the first deployed archetype; chrome crops consume `pass`, never the pct alone; AI-readability `code < 98` and editability `dead > 0` = `failed` via `update-coverage --gate` (Gates 5–6; unmeasured = re-drive); page gate — `gate-publish.mjs` exit 2 = a FAIL page; publish PASS rows only (Gate 8). D — `redirects.mjs` exit 2 (a Source shadows a delivered page) blocks the sheet. E — `verify.mjs` exit 1 = a failed page (folder roots probed on both slash forms), exit 2 = usage / no coverage; a 429/503 through the inline retry leaves the page `unverified` and exits 2 — re-run, never a failed page; headless render check per template. E2 — `localize-links.mjs --check` exit 2 = links remain. F — `optimize.mjs` exits non-zero on any open in-scope P1. H — `close-check.mjs` exit 0 closes the wave; `dynamics-check.mjs --gate` exit 0 before the report closes; `open-review-pairs.mjs` exit 2 = a localhost/token URL, nothing written.

Outputs (under `stardust/rollout/`): `coverage/{pages,templates,blocks}.json` · `plan.json` · `rollout.json` · `verify/{summary.json,summary.md}` · `optimize/{findings,scorecard}.json` · `site/{sitemap.xml,robots.txt,manifest.json,redirects.json}` · `dashboard/{index.html,data.json}` (schemas: `schemas/rollout-*.schema.json`); plus `stardust/redirects.tsv`, `stardust/learnings.md`, EDS-project edits via autofix.

| At phase | Read |
|---|---|
| Setup | `../stardust/reference/state-machine.md` § Flow keys; `../replica/reference/source-fidelity-gate.md` § Residual logging format · § Residual classes |
| A | `reference/coverage-model.md` § Files · § Page delivery status lifecycle · § Artifact type + fidelity tier · § Idempotency rules (inventory) |
| B | `reference/coverage-model.md` § Block delivery status lifecycle · § Dedup contract (plan.json); `reference/operational-learnings.md` § Extending a delivered site |
| B2 / D2 | `../dynamics/reference/triage.md` § Rules; `../dynamics/reference/listings.md` § Why it is a PRE-IMPORT gate · § Block contract; `../dynamics/reference/patterns.md`; `../dynamics/reference/parity-report.md` § Schema |
| C | `reference/delivery-lint.md` § Run it · § Where it sits in Phase C; `reference/delivery-gates.md` § Gate 1 · § Gate 2 · § Gate 3 · § Gate 4 · § Gate 5 · § Gate 6 · § Gate 7 · § Gate 8 · § Batched delivery at scale; `../deploy/reference/chrome.md` § Chrome states and variants; `../migrate/reference/fidelity-tiers.md` § Declaration (per page); `../migrate/reference/media-reconciliation.md` § The four decisions; waves: `../stardust/reference/fan-out.md` § Worker contract · § Scope and type of delegated agents; `../stardust/reference/harness-quirks.md`; `../deploy/da-deploy-protocol.md` § Two clocks; code-writing waves: `../deploy/reference/block-agents-brief.md` § The brief template · § Shared cores and variants |
| D3 | `reference/multilingual.md` |
| E / E2 | `reference/coverage-model.md` § Verify · § `delivery.gate`; `reference/delivery-gates.md` § Gate 8 → Coverage regime; `reference/operational-learnings.md` § Two verify checks; `reference/sweep-protocol.md` (site-scale fix loop, after verify); `../stardust/reference/context-hygiene.md` § Runner reports and session hand-off |
| F / G | `reference/audit-sources.md` § The sources · § Recording an external finding · § Fixability → who fixes it · § AEM autofix registry · § The loop; `reference/checks.md`; `reference/coverage-model.md` § Optimize gate (findings lifecycle); `reference/operational-learnings.md` § Optimize-gate learnings |
| H | `reference/wave-close.md` § Rows · § Escape hatch; `../stardust/reference/handoff-report.md` § Gate table first · § Source → target · § Residuals, links, report check; `../replica/reference/source-fidelity-gate.md` § Per-breakpoint procedure; `../dynamics/reference/parity-report.md` rule 8; `../stardust/reference/learnings.md` § Entry shape |

`deploy` ships **one** page; `rollout` drives it per page over `migrate`'s output —
**delivery only**, never redesign.

## When to use

**Full mode** — a fully migrated site at `stardust/migrated/` (per-page HTML +
`_meta.json`), an EDS/AEM project + DA destination; the **entire** site delivered
incrementally and resumably. **Archetypes-only mode** — one migrated archetype
per template plus the page inventory in `stardust/state.json` (`type` per page);
block code ships now, siblings register `content-pending`. No `stardust/migrated/`
tree: `stardust migrate` the archetypes first. Single page: `stardust deploy`.

## Setup

1. Run the master skill's setup (`skills/stardust/SKILL.md` § Setup). **Flow
   guard:** `stardust/state.json` without `flow` on a migration ask → do not
   roll out; print the master's two-flow table and hand back to its routing
   (`skills/stardust/reference/state-machine.md` § Flow keys).
2. Verify `stardust/migrated/` has at least one `*.html` page (archetypes-only:
   the archetypes + a `state.json` with `type` populated).
   **Gated-archetype precondition (`flow: replica`).** Run
   `node skills/replica/scripts/gate-ledger-lint.mjs --state stardust/state.json`
   (the reader of `stardust/replica/progress.json`;
   `skills/replica/reference/source-fidelity-gate.md` § Residual logging format —
   a shape it cannot read is not a pass). Exit 2 lists each blocked type with
   its archetype slug and the command to gate it (`$stardust replica <archetype>`):
   neither fan out its siblings nor `POST /live/` them; other types proceed.
   Hands-off never bypasses a blocked type (self-accepts only the table's
   permanent classes as `hands-off-policy:<class>`); thresholds are the gate's.
3. Verify the EDS/AEM target is ready exactly as `deploy` requires (`DA_TOKEN`,
   code branch pushable). `rollout` adds no new transport.
4. If `state.json.handsOff` is true (`skills/stardust/SKILL.md` § Hands-off
   mode), run full-auto: no per-phase pauses; every gate and verify step runs
   unchanged. A wave close = `close-check.mjs` exit 0 (Phase H), then the next
   wave in the same turn — it never ends the turn (master § Hands-off mode →
   Turn-end contract).

## Procedure

### Phase A — Inventory (build the coverage)

```bash
node skills/rollout/scripts/inventory.mjs --site-url <source-url>   # defaults --migrated stardust/migrated --out stardust/rollout
```

Writes `coverage/pages.json` (one row per page: slug, `path`, `templateId`,
`blocks`, `sourceHash`, `delivery`), `coverage/templates.json` and `rollout.json`
(target + DA config + `lastRun`).
`--content <eds-root>/content` adds the chrome documents, fragments and sheets
as typed rows (`delivery.type` fragment | index — kept across runs, on the
roster for verify); `--redirects stardust/redirects.tsv` records the served
path of a renamed page (`delivery.deployedPath`).

**Archetypes-only mode** (`--state`): pages only in `state.json` are seeded
`content-pending`, `templateId` from `type`, `blocks` from the archetype sidecar.
Inventory is **idempotent and incremental** (HTML changed after delivery →
`stale`; `reference/coverage-model.md` § Idempotency rules). Fill in
`rollout.json` `site.da.*` + `site.liveHost` if not inferred; run `dashboard.mjs`
once here (snapshot).

**Plan gate.** Present every `stardust/decisions.md` row not yet `owner-decided` as
one numbered message with defaults (`skills/stardust/reference/decisions.md` § How
phases use it); later phases read the rows, never re-ask.

### Phase B — Block dedup plan (FIRST-CLASS, before any conversion)

```bash
node skills/rollout/scripts/blocks.mjs   # → coverage/blocks.json (the dedup unit)
node skills/rollout/scripts/plan.mjs     # → plan.json + a readable conversion plan
```

- `blocks.mjs` collapses every block instance (per-page `modules` + chrome) into
  the **distinct** set with a canonical `edsBlockName` (kebab, reserved-class
  guard) and `usedByPages` / `instanceCount`; chrome (`header`/`nav`/`footer`)
  is `kind: chrome` → the authored `/nav`, `/footer` documents. Archetypes-only:
  the archetype sidecars determine the set; `content-pending` pages add none.
- `plan.mjs` orders pages **representative-first per template** and gives each
  distinct block a **single conversion point**: the first page CONVERTS it, every
  later page REUSES it by name — the per-page `convert`/`reuse` lists are
  `deploy`'s Step-7 brief input. `content-pending` pages are always `convert: []`.

### Phase B2 — Dynamic surface (PRE-IMPORT GATE — verify the inventory)

**Before Phase C.** `stardust/dynamic-features.md` (prepare-migration 4.5 or replica
Phase 2) must exist with a disposition on every row; verify it against fresh evidence —
`dynamics-detect.mjs --from-state … --reach stardust/current` and `dynamics-plan.mjs
--target-origin <live host> --migrated stardust/migrated`; new evidence → new rows. Then
`dynamics-plan.mjs --lint` (operator card) exits 0 (every row placed once) before Phase C.
The listings contract (per-type `<meta>` + `helix-query.yaml`) is emitted by Phase C's
`deploy` brief per page — retrofitting metadata across published pages is a second
migration. Missing inventory → the stardust `dynamics` skill Phases 1–3 now.

### Phase C — Deliver the site (drive `deploy` per page, per the plan)

**Blocked on Phase B2** — author each page's metadata contract into its metadata
block during delivery. Walk `plan.json.steps` (representative pages first; Setup-blocked
types are absent). For each page:

1. **Convert + push** the migrated HTML (`source.migratedHtml`) to AEM via the
   `deploy` methodology. **Pass the plan step into deploy's brief**: create only the
   blocks in `convert`; REUSE each block in `reuse` by its `edsBlockName`. **The
   brief MUST carry the Experience Workspace editability contract**
   (`skills/deploy/reference/block-js-scaffold.md` § Experience Workspace
   editability contract, EW1–EW10): authored elements move into wrappers, never
   rebuilt from text; `block-roundtrip --ew` passes before a block counts as delivered.

   **`content-pending` pages** (archetypes-only): no migrated HTML — no document
   push, no shell/placeholder; record `content-pending` ("awaiting content track";
   block code is already deployed via the archetype).

2. **Static contract lint (pre-PUT, deterministic).** Before the push, the
   delivery-contract linter catches the cheap failures offline so a broken page
   never reaches preview (`reference/delivery-lint.md`). **A P0/P1 blocks the PUT.**
   Once per code-writing wave, before any round-trip: `node skills/deploy/scripts/block-lint.mjs blocks/ --styles styles/styles.css` exits 0 (a 🔴 capped by a declared `@ew-exempt` item is `block-roundtrip --ew`'s call).
   Once per wave over the converted content: `node skills/deploy/scripts/davids-model-lint.mjs content/` — a 🟡 D-CONST (a row identical on ≥ 80 % of a block's instances) is decided ONCE per block (`decisions.md`), never page by page.
   ```bash
   node skills/rollout/scripts/content-acceptance.mjs --slug <slug>        # source vs migrated role counts; exit 2 = P1, no PUT
   node skills/rollout/scripts/delivery-lint.mjs --file <html> --path </da/path> --icons-dir icons [--allow-no-h1] [--chrome-docs content/nav.html,content/footer.html,…]
   node skills/rollout/scripts/media-reconcile.mjs --file <html> --deploy-host <branch>--<repo>--<owner>.aem.live [--apply]
   ```
   `content-acceptance` is the content-count gate (`reference/delivery-gates.md` § Gate 7):
   a dropped class not covered by `contentDeviations[]`, or words ratio < 0.9, is 🔴.
   `media-reconcile` resolves every image and decides optimize/keep/rewrite/omit
   (`skills/migrate/reference/media-reconciliation.md`) — the image-fidelity gate's
   authoritative form.

   **Chrome guard set.** Before chrome is signed off, every top-level trigger is
   opened on the preview page (`chrome-parity --open <sel>`) and the header,
   footer and open-state crops pass against the cached live capture
   (`--live-cache`); `aria-current="page"` set by the header block; multi-variant
   pages name their `nav:`/`footer:` rows (P1 `chrome-variant`). A push touching
   `styles/`, `blocks/header`, `blocks/footer` or a block with `usedByPages > 1` →
   re-run `chrome-parity --live-cache` on two pages of different templates before
   the next wave; consume `pass`, never the pct alone — `../deploy/reference/chrome.md`.

3. **Run the delivery gates** before flipping a page to `deployed`. One-line
   rules here; mechanics + helpers in `reference/delivery-gates.md`:
   - **Source-fidelity** — never add sections the source lacks or fabricate
     facts. `node skills/rollout/scripts/section-fidelity.mjs --file <html> --source <url>`
   - **Image-fidelity** — every authored `<img>` src returns 200 or is omitted;
     never `<img src="about:error">` (`media-reconcile.mjs`, step 2).
   - **Path-safety** — AEM-Edge-safe paths (lowercase, no trailing `-`/`_`, no
     `--` segment); original→normalized rows in `stardust/redirects.tsv`.
   - **Source-content hygiene** — skip dead source URLs; bodyless/PDF-only
     sources render thin and faithful (tier `thin`), never padded.
   - **Fidelity tier declared** — each page's `fidelityTier`
     (archetype/sibling/thin; `skills/migrate/reference/fidelity-tiers.md`).
   - **AI-readability** — `code ≥ 98` on the preview origin per wave page:
     `node skills/deploy/scripts/ai-readability.mjs --origin <preview> --paths <wave> --min 98 --json stardust/rollout/ai-readability-<wave>.json`
     → `update-coverage.mjs --gate ai-readability <json>`; below = `failed`, out
     of `--publish`; `unmeasured` = re-drive, never a pass (Gate 5).
   - **Editability** — `node skills/deploy/scripts/ew-editability-probe.mjs --content <html> --blocks-dir blocks --json > stardust/rollout/ew/<slug>.json`
     → `update-coverage.mjs --gate editability <json>`; dead > 0 = `failed`;
     probe exit 2 = `unmeasured` → URL mode on preview (Gate 6).

4. **Record outcomes** with the state-writer (never hand-edit the ledger):
   ```bash
   node skills/rollout/scripts/update-coverage.mjs <slug> --status converting
   node skills/rollout/scripts/update-coverage.mjs --block <id> --status converted --eds-name <name>
   node skills/rollout/scripts/update-coverage.mjs --from-ledger content/.deploy-ledger.json --url-base <branch-preview-origin>
   node skills/rollout/scripts/update-coverage.mjs <slug> --status content-pending   # no document push
   ```
   **Gate on preview, then publish explicitly.** The default run is `PUT →
   preview`; the page gate is `gate-publish.mjs` (every delivered page ≤ 150, else
   archetypes + the seeded sample — `reference/delivery-gates.md` § Gate 8); the
   separate `deploy-batch.mjs … --publish` run takes the PASS rows only (`--paths`;
   report hold pending — § Gate 8) unless `decisions.md` records publish-to-live
   (D16) — hands-off stops at preview, never passes the escape flags (indexes:
   Phase D2).
   On failure: `--status failed --error "<reason>"` and continue (one page never
   aborts the rollout). A denied push or publish under hands-off goes to
   `stardust/.work/ship.sh` (`skills/deploy/reference/ship-script.md`), not a retry loop.

**Foundation-first gate (hard block, once per rollout).** When the FIRST
archetype page flips to `deployed`, prove the foundation before any second page:
the stardust `diff` skill (both probes) against its prototype, **plus
computed-style invariants in a headless render** — grids compute `display:
grid`, sections full-bleed where the design says so, CTA/button classes styled
(`stardust/runtime-contract.json`, `skills/deploy/SKILL.md` § Runtime-detection probe).

**Execution model: waves.** Parallel **author-only** agents (each writes files
only — never deploys or edits blocks) work template clusters concurrently,
representative-first; **a family's listing/index pages ship in its first wave**
(posts ahead of their category pages bounce every in-page link). Then a
**central deploy** runs the bundled, resumable driver, never a serial loop:
`node skills/deploy/scripts/deploy-batch.mjs --org <org> --repo <repo> --branch
<branch> --content <dir>` (path + body-hash ledger — only changed files and FAILs
re-drive); then the page gate; then the separate `… --publish` run. Clusters of
6–20+ siblings: `reference/delivery-gates.md` § Batched delivery. Two clocks: code
first on the ref the user will look at, then content
(`skills/deploy/da-deploy-protocol.md` § Two clocks). Every batch runs in the
background: `stardust/.work/deploy/deploy-batch.progress.json` is the progress
file (`skills/stardust/scripts/progress.mjs read <file>`), the stdout `SUMMARY`
line the completion; after a blip, re-run the same command. Then
`update-coverage.mjs --from-ledger content/.deploy-ledger.json` reconciles the
ledger into coverage (one write; `reference/coverage-model.md` § Page delivery
status lifecycle).
Every wave agent follows `skills/stardust/reference/fan-out.md` § Worker contract
and § Scope and type of delegated agents; every shell loop and runner follows
`skills/stardust/reference/harness-quirks.md`. When a wave must write code, the
deploy brief's ownership protocol applies — `skills/deploy/reference/block-agents-brief.md`
§ The brief template and § Shared cores and variants; author-only waves inherit
the shared cores read-only, and the lead merges the per-agent
`eds-conversion-log-<id>.md` files.

### Phase D — Site assembly (whole-site artifacts)

```bash
node skills/rollout/scripts/assemble.mjs   # → rollout/site/{sitemap.xml,robots.txt,manifest.json}
```

Generates `sitemap.xml` (live page rows at their served path), `robots.txt` and a
fragments manifest mapping chrome blocks to the authored chrome documents
(`content/nav.html`, `content/footer.html`) — unpublished chrome 404s sitewide.
**Redirects:** `node skills/rollout/scripts/redirects.mjs` turns
`stardust/redirects.tsv` into `site/redirects.json` (one row per request form;
exit 2 = a Source shadows a delivered page); upload it as the `/redirects.json`
sheet; `--post-publish` probes every page and both slash forms of a folder root
(`reference/delivery-gates.md` § Gate 3).

### Phase D2 — Dynamic features (`dynamics` Phases 4–5)

Implement the plan's reproducibility-`self` rows from the pattern catalogue
(`skills/dynamics/reference/patterns.md`); emit every other row as **one owner
decision batch** and ship its interim tier. Query indexes build from the
**published** tree — the Phase C `--publish` run, then poll `total`. Each feature
ends with a parity row in `stardust/dynamics/parity.json` carrying a replayable
check; `dynamics-check.mjs --origin <live host> --gate` runs before Phase H.
Failed replays are `dynamic-gap` / `api-dependency` learnings, never silent passes.
Index-backed listings ship **document-first** (`dynamics/reference/listings.md`);
every listing page goes through the Phase C AI-readability line.

### Phase D3 — Multilingual (optional)

Language trees (`/fr/…`, `/en/…`) REUSE the block library — only authored content
and wiring change (routed chrome, per-language indexes): `reference/multilingual.md`.

### Phase E — Full-site verify

```bash
node skills/rollout/scripts/verify.mjs            # uses rollout.json site.liveHost
# or: --base <url> (explicit host) | --root <dir> (offline, local export or migrated tree)
```

`verify` confirms each delivered row renders (200, no `about:error`, typed
render check) and its links resolve, then flips it `verified` or `failed`.
`--gate-report` merges `delivery.gate` and, under `flow: replica`, keeps a row
without a gate PASS at `deployed` (read, never re-judged); `--ai-readability
<live-run json>` flips `code < 98` to `failed`, leaves `unmeasured` untouched and
exits 2 while any remain (≤ 150 pages: all; above: listing pages + the Gate 8
sample). The qa `editability` check (URL mode) runs on the first delivered page
per template, ingested with `--gate`. Its summary lines (each printed only when non-zero), which rows, link
classes, the `links.outsideInventory` policy and the exit map:
`reference/coverage-model.md` § Verify.
Read `verify/summary.md`, triage per class — per-page rows stay in the file,
never in the conversation (`skills/stardust/reference/context-hygiene.md`
§ Runner reports and session hand-off).

**Headless render check (per template).** A 200 `.plain.html` can still render
blank (missing script, wrong wrapper class, 404 chrome). On the FIRST delivered
page of each template (home included), load the live URL headless and assert
decoration ran: `body.appear` set (`stardust/runtime-contract.json`), `main
.section` > 0, zero `pageerror` events, zero broken images.

**Site-scale fix loop** (sample → class triage → tail → confirmation sweep):
`reference/sweep-protocol.md`.

### Phase E2 — Link-audit completeness

`verify.mjs` checks links on delivered rows; this phase closes the link
**targets** a roster-driven batch misses (`reference/operational-learnings.md`
§ Two verify checks):

- **Nav/footer/landing targets are NOT archetype siblings.** Every `href` in
  the `/nav` + `/footer` rows (Phase A `--content`) and each section's landing
  page must be **deployed + published + verified**, chrome rows included.
- **Localize source-site bounce links** with the deploy stage, not by hand:
  `node skills/deploy/scripts/localize-links.mjs --source-host <live-host>
  --content content --redirects stardust/redirects.tsv`; **re-run over the
  WHOLE tree after every wave**. `--check` is the gate (exit 2 = links remain).
- **Strip trailing slashes and `.html` from internal links** (EDS 404s both);
  repoint `.html` links with no local page at the working source URL.
- **GET each href against the LIVE tree** — ledger resolution misses the
  trailing-slash and case defects only delivery exposes.

### Phase F — Optimize: multi-source audit + gate (delivery quality)

The in-flow **quality gate**: findings from **existing audit skills** land in one
ledger (`optimize/findings.json` + `optimize/scorecard.json`), tagged by
**fixability**. Sources (`reference/audit-sources.md`):

1. **`rollout:baseline`** — built-in deterministic detectors:
   `node skills/rollout/scripts/optimize.mjs` (uses `site.liveHost`; or `--base <url>
   | --root <dir> | --slug <s> | --all`).
2. **`impeccable:critique` + `impeccable:audit`** — design quality + a11y/perf (optional).
3. **The marketing SEO skills** — `seo-audit`, `schema`, `ai-seo`, `site-architecture` (optional).
4. **`stardust:tensions`** — mechanical design tensions from `stardust/current/brand-review.html`.

Normalize each source's findings with the writer:

```bash
node skills/rollout/scripts/findings.mjs record \
  --source marketing:seo-audit --layer seo --check thin-content \
  --severity P2 --fixability platform-migration \
  --scope-ids blog/post --evidence "…" --recommend "…"
node skills/rollout/scripts/findings.mjs resolve <id> --status accepted --note "…"
```

One id space, dedup, scorecard and **detect → fix → verify loop** (read table
F / G). The gate **exits non-zero on any open in-scope P1** — delivery-clean =
verify passes *and* no open P1.

> At ~1k-page scale: `reference/operational-learnings.md` § Optimize-gate learnings.

Judgment layers (brand-tensions, design-ux, content-conversion) score `null`
until their sources populate them — not-assessed, never faked.

### Phase G — AEM autofix (close the loop)

```bash
node skills/rollout/scripts/autofix-aem.mjs --project <eds-root>   # [--dry-run] [--slug s] [--check c]
```

The platform autofix engine (AEM-EDS, aggressive): every open finding whose
`check` has a registered EDS fixer (read table F / G) gets its EDS **project**
file edited, the change logged on `finding.autofix`, the finding staged
`in-progress`. `--dry-run` first; then **re-deploy** the edited pages and re-run
**verify** + **optimize** — staged findings flip to `fixed`.

### Phase H — Report (the wave close)

**Close = `node skills/rollout/scripts/close-check.mjs --fix` exit 0**
(`reference/wave-close.md`): nine artifact rows (status, journal, coverage,
learnings, review, dashboard, report, tracking, commit); open rows print their
fix; never say "closed" before exit 0. Hand-off
shape: `skills/stardust/reference/handoff-report.md` — gate table first, source
→ target per page, report-check last. **Review pairs:** `open-review-pairs.mjs
--per-template 1` (`--random 10` before the first live publish) writes
`stardust/rollout/review-pack.md` — source ↔ delivered pairs with copied gate
numbers, opened on the live host where the human logs in
(`skills/deploy/da-deploy-protocol.md` § Site auth; localhost / token URLs are
refused). Defects go through the gate, not around it: one budgeted fix round,
re-gate mapped pages. The checkpoint block
(`skills/stardust/reference/run-status.md` § Phase close) is last. One census
line — `davids-model-lint.mjs content/ --json` → `census.styles.length` section
styles, `census.blocks.length` blocks (the conversion log's locked vocabulary).

Dynamic parity table (`stardust/qa/dynamics-report.md`) beside the delivery
ledger; `dynamics-check.mjs --origin <live host> --gate` exits 0 before
the report closes (exit 3 = `parity.json` missing or a `self` row pending —
`skills/dynamics/reference/parity-report.md` rule 8); hands-off sets unshipped
`self` rows to `interim` with a named owner decision, never `pending`. List
unplayable media by page (`media-reconcile.mjs` `unplayable` / `needs-credential`).

Read `rollout.json.lastRun` + `optimize/scorecard.json`:

```
rollout — <site> → aem-eds
==================================================
Gate        <archetype> <bp>: FAIL <n> % (register: R-nn <title>) · <archetype> <bp>: ungated   ← failing/ungated rows first; none → all gated
Archetypes  published-gated A of T at <bp> · ungated: <slug@bp …>   (read from stardust/replica/progress.json, never retyped)
Pages gated published-gated P of M · PASS p · FAIL f · unmeasured u · ungated r   (gate-report.json)
Readability strict median <n> · code median <n> · pages < 98: <n> · unmeasured: <n>   (lastRun.gates.ai-readability)
Editability <editable>/<authored> · dead <n> · exempt <n> · unmeasured <n>   (lastRun.gates.editability)
Content-count <p> passed · <c> covered · <f> failed · <u> unmeasured   (migrated/_acceptance/summary.md)
Live drift  <n> pages recaptured · <n> masks kept
Pages       <N> total · <v> verified · <d> deployed · <p> pending · <cp> content-pending · <s> stale
Templates   <T> (per-template delivered/total)
Blocks      <B> total · <c> converted · <p> pending
Quality     health <H>/100 · open P1 <n> / P2 <n> / P3 <n>
To deliver  <list of remaining slugs>
Content     <cp> pages awaiting content track (block code deployed, document not yet pushed)
```

One line per artifact, in this order, computed from its file, never typed:
`Gate`/`Archetypes` from `stardust/replica/progress.json`
(`published.<bp>` absent = `ungated`); `Live drift` from the round records'
`liveDrift{}` + `variance.json` masks (`skills/replica/reference/source-fidelity-gate.md`
§ Per-breakpoint procedure). `pending`/`stale`/`failed` are the "what's missing"
list — failed rows point at `verify/summary.md`, never a per-page list;
`content-pending` is listed apart, not a failure.

**`stardust/learnings.md`** (`skills/stardust/reference/learnings.md`): one
entry per failure class this run surfaced; `- none this run (<ts>)` only when no
residual `flaggedFor: delivery` / named deviation is newer than the wave start
(close-check row 4 refuses it otherwise).

### Phase I — Dashboard

```bash
node skills/rollout/scripts/dashboard.mjs    # → dashboard/index.html + data.json
```

A **self-contained, no-external-JS** dashboard in the project's design identity:
a **page tree** of every identified page, nested by URL path, colour-coded by the
stage reached — `identified → prototyped → deployed → optimised` (`optimised` =
verified **and** no open findings; a `content-pending` sibling stays
`identified`); cumulative legend counts, archetypes badged `T`, templates table,
scorecard.
`dashboard/data.json` is the snapshot — regenerated after Phase A and at every wave close.

## Inputs

| Input | Source | Used for |
|---|---|---|
| `stardust/migrated/*.html` + `**/_meta.json` | `migrate` | pages to deliver (read-only); `templateId`, `blocks`, `title` |
| `stardust/state.json` | stardust core | *(archetypes-only)* page roster + `type` for pages not yet migrated |
| `stardust/rollout/rollout.json` | rollout / user | DA target coordinates |

## Outputs

The operator card's Outputs line is the list (schemas in `schemas/`). `rollout`
writes under `stardust/rollout/` and — only via `autofix-aem` — to the **EDS
project**; the agnostic core, `state.json` and `migrated/` are read-only.
The EDS site itself is `deploy`'s output per page. Phase F's audit sources are
referenced, not vendored (`reference/audit-sources.md`).

## What rollout does NOT do

- **No upstream redesign** — `design-pass` findings are surfaced, not fixed.
- **No new transport** — `deploy`'s DA Source API path, unchanged.
- **No full pre-migration requirement** — archetypes-only mode is first-class;
  `content-pending` pages advance as `migrate` emits their HTML.

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
