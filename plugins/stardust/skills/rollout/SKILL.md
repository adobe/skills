---
name: rollout
description: Deploy a WHOLE redesigned site to AEM Edge Delivery Services — the full-site, bulk sibling of `deploy` (which ships one page). Use to roll out, bulk-deploy, or publish an entire migrated stardust site at once ("deploy all pages", "full site deployment", "deploy the whole/entire website to AEM"), not just a single page. Inventories the migrated tree (stardust/migrated/ + _meta.json) into a delivery ledger, dedups blocks, drives `deploy` per page, verifies, and tracks what's done and what's left. Supports archetypes-only mode — when only the template archetype pages are migrated, it deploys all block code immediately and registers the rest as content-pending.
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, and the impeccable skill (github.com/pbakaus/impeccable) installed alongside stardust.
metadata:
  version: "1.4.0"
---

# stardust:rollout — whole site → AEM (Edge Delivery Services)

`deploy` converts **one** page; `rollout` delivers the **whole site**: it
inventories `migrate`'s output, drives `deploy` across every page and tracks
what is done and what is left. Delivery only: it never redesigns. Phases
**A→I**; ledgers, statuses and roll-ups: `reference/coverage-model.md`.

## When to use

- **Full mode** — a migrated site at `stardust/migrated/` (per-page HTML +
  `_meta.json`) and the target `deploy` needs: deliver the **entire** site,
  incrementally and resumably. One page → `stardust deploy`.
- **Archetypes-only mode** — one migrated archetype per template plus the full
  roster in `stardust/state.json` (`type` per page): all block code ships now,
  siblings register as `content-pending` for a later content track.

## Setup

1. Run the master skill's setup (`skills/stardust/SKILL.md` § Setup). **Flow
   guard:** `stardust/state.json` without `flow` on a migration ask → do not
   roll out; print the master's two-flow table and hand back to its routing
   (`skills/stardust/reference/state-machine.md` § Flow keys).
2. Verify `stardust/migrated/` holds at least one `*.html` page (full mode: all
   pages; archetypes-only: the archetypes + a `state.json` with `type`). If
   not, recommend `stardust migrate` on the archetypes and stop.
   **Gated-archetype precondition (`flow: replica`).** Read
   `stardust/replica/progress.json`: a page type may ship only when its
   archetype has a gate result at every configured breakpoint that is
   `pass: true`, or over the bar with every residual carrying a `cause`
   (`skills/replica/reference/source-fidelity-gate.md` § Residual logging
   format). A page type whose archetype was never gated, or is over the bar
   with no residual entries, is **blocked**: list it with its archetype slug
   and the command to gate it (`$stardust replica <archetype>`), and neither
   fan out its siblings nor `POST /live/` any of them. Accepting logged
   residuals under hands-off is not a bypass for an ungated archetype.
   Thresholds are the gate's, unchanged.
3. Verify the EDS/AEM target is ready exactly as `deploy` requires (project
   scaffolding, `DA_TOKEN`, code branch pushable). `rollout` adds no transport.
4. `state.json.handsOff` true (`skills/stardust/SKILL.md` § Hands-off mode):
   no per-phase pauses. Every gate and verify step below runs unchanged —
   hands-off removes waiting, not validation.

## Procedure

### Phase A — Inventory (build the coverage)

```bash
node skills/rollout/scripts/inventory.mjs --site-url <source-url> [--state stardust/state.json]
# --state = archetypes-only mode: the full page roster
```

Writes `coverage/pages.json`, `coverage/templates.json` and `rollout.json`
under `stardust/rollout/` (`reference/coverage-model.md` § Files). Idempotent:
delivery status is kept, a delivered page whose migrated HTML changed becomes
`stale` (§ Idempotency rules). Fill in the DA coordinates in `rollout.json`
(`site.da.org`, `site.site`, `site.da.ref`, `site.liveHost`) if not inferred.

### Phase B — Block dedup plan (FIRST-CLASS, before any conversion)

```bash
node skills/rollout/scripts/blocks.mjs   # → coverage/blocks.json (the dedup unit)
node skills/rollout/scripts/plan.mjs     # → plan.json + a readable conversion plan
```

Each distinct block has a **single conversion point**: the first page in the
plan that uses it CONVERTS it, every later page REUSES it by `edsBlockName`
(`reference/coverage-model.md` § Dedup contract; chrome and widgets there).
A module that maps to EDS **default content** (title, text, image, button,
separator) needs no block: record it `update-coverage.mjs --block <id> --status
converted --eds-name default-content`. Extending a delivered site: audit
`blocks/` and `widgets/` first (`reference/operational-learnings.md`
§ Extending a delivered site).

### Phase B2 — Dynamic surface (PRE-IMPORT GATE — verify the inventory)

**Before Phase C.** `stardust/dynamic-features.md` must exist with a
disposition on every row (`skills/dynamics/reference/triage.md`; missing → run
the stardust `dynamics` skill Phases 1–3 now); verify it against fresh evidence — `dynamics-detect.mjs --from-state
… --reach stardust/current` and `dynamics-plan.mjs --target-origin <live host>
--migrated stardust/migrated`. New evidence → new rows. The listings contract
(`skills/dynamics/reference/listings.md`) goes into Phase C's `deploy` brief
per page: retrofitting metadata across published pages is a second migration.

### Phase C — Deliver the site (drive `deploy` per page, per the plan)

**Blocked on Phase B2.** Walk `plan.json.steps` in order (representative pages
first). For each page:

1. **Convert + push** `source.migratedHtml` via the `deploy` methodology. The
   brief carries: the plan step (create only the blocks in `convert`; REUSE
   each block in `reuse` by its `edsBlockName`, never recreate it); the
   Experience Workspace editability contract
   (`skills/deploy/reference/step-8-block-js.md`, EW1–EW10 — a block counts as
   delivered only after `block-roundtrip --ew` passes); the page's metadata
   contract (Phase B2); and the archetype's
   `captureState[].restoreAtDelivery` list (replica `progress.json`) — a
   freeze the gate needed is a behaviour to deliver, never the spec.
   - **Deploy first, judge on the preview origin.** The local harness serves
     structural asserts only; every pixel or visual judgment runs against the
     page's preview URL after `PUT → preview` (deploy SKILL.md § Step 10).
   - **Chrome and fragment documents carry `Robots | noindex`:** `nav`,
     `footer`, per-locale `nav-*` / `footer-*` and any locale shell that is
     not a page get the metadata row
     `<div><div>Robots</div><div>noindex</div></div>`, or the served sitemap
     lists them as pages.
   - **`content-pending` pages** (archetypes-only): no document push, no shell
     or placeholder; record `content-pending`, report "awaiting content track".
2. **Static contract lint, before the PUT** (`reference/delivery-lint.md`).
   **A P0/P1 blocks the PUT.** Then the image resolver:
   ```bash
   node skills/rollout/scripts/delivery-lint.mjs --file <html> --path </da/path>
   node skills/rollout/scripts/media-reconcile.mjs --file <html> --deploy-host <branch>--<repo>--<owner>.aem.live [--media-ledger <file>] [--apply]
   ```
3. **Run the delivery gates** before flipping a page to `deployed`
   (`reference/delivery-gates.md`, § Gate 1 to § Gate 4): source-fidelity
   (`section-fidelity.mjs --file <html> --source <url>`, a static outline
   check, not replica's pixel gate: no section the source lacks, never a
   fabricated fact);
   image-fidelity (a src that does not return 200 is omitted, never shipped
   as `<img src="about:error">`); path-safety (record original→normalized in
   `stardust/redirects.tsv`); source-content hygiene (a dead source URL is
   skipped, a bodyless one authored thin, never padded with invented prose);
   and the page's `fidelityTier` declared
   (`skills/migrate/reference/fidelity-tiers.md`).
4. **Record outcomes** with the state-writer (never hand-edit the ledger):
   ```bash
   U=skills/rollout/scripts/update-coverage.mjs
   node $U <slug> --status converting
   node $U --block <id> --status converted --eds-name <name>
   node $U <slug> --status deployed --url <branch-preview-url>
   node $U <slug> --status content-pending   # no document push
   ```
   **Publish in the loop (`PUT → preview → live`), don't stop at preview** —
   query indexes (Phase D2) and chrome build from the **live** tree. On
   failure: `--status failed --error "<reason>"` and continue with the next
   page.

**Foundation-first gate (hard block, once per rollout).** When the FIRST
archetype page flips to `deployed` (after PUT + preview), stop before authoring
any second page and prove the foundation on its preview URL, never on a local
harness: the stardust `diff` skill (both probes) against its prototype;
computed-style invariants in a headless render per
`stardust/runtime-contract.json` (`skills/deploy/SKILL.md` § Runtime-detection
probe) — grid containers compute `display: grid`, sections are full-bleed
where the design says so, the CTA/button classes are styled; and `qa.mjs
--checks metadata` on the origin (`favicon-default` = the site's icon never
shipped).

**Archetype first, per template (#126).** A template's archetype is deployed
and passes its full gate row on the preview URL (`gate-all.mjs --only`) before
any of its siblings is rendered or converted — the recorded unit `C-archetype`
(`skills/replica/reference/handoff-contract.md` § 3, row C). Fix rounds follow
`skills/replica/reference/source-fidelity-gate.md` § Iteration discipline:
three counted rounds per page, width and stage (the first and two fix
rounds); `gate.sh` exits 6 past them until `rounds.mjs decide` records a
decision, and a `gate-all.mjs` round is decided with `--stage all-pages`.

**Execution model: waves** (`reference/delivery-gates.md` § Batched delivery
at scale; replica's fan-out and its discipline:
`skills/replica/reference/handoff-contract.md` § 3). Parallel **author-only**
agents write files and never deploy or edit blocks; then a **central deploy**
in the background, `node skills/deploy/scripts/deploy-batch.mjs --org <org>
--repo <repo> --branch <branch> --content <dir>`, then `update-coverage.mjs`
per page. Lint AND commit `styles.css`, header/footer CSS and the contract
file BEFORE the first agent spawns; no token or custom-property rename after
fan-out. **Every tool call stays under 4 minutes, the main agent's
included:** a long instrument goes through `run-bg.mjs start` with `wait` as
the NEXT tool call, never two in one turn (`skills/stardust/SKILL.md`
§ Hands-off mode, wait discipline).

### Phase D — Site assembly (whole-site artifacts)

```bash
node skills/rollout/scripts/assemble.mjs   # → site/{sitemap.xml,robots.txt,manifest.json}: the EXPECTED set
node skills/rollout/scripts/assemble.mjs --verify-origin https://<branch>--<repo>--<owner>.aem.live   # the SERVED sitemap; exit 1 = mismatch
node skills/rollout/scripts/da-library.mjs   # the DA library (#160): whenever a block, variant or template ships
```

Mechanics, and the redirects sheet: `reference/operational-learnings.md`
§ Site-assembly learnings. **D-site checklist**, all before the `D-site end`
line, which names the SERVED sitemap count:

- `assemble.mjs --verify-origin` exits 0. **Verify the SERVED sitemap, never
  the local file**; re-run after each fix.
- Every chrome document carries `Robots | noindex` and is published (else
  the chrome 404s sitewide).
- `stardust/redirects.tsv` is wired into the redirects sheet, and the sheet
  is published. The root MUST answer: a source root that serves a page is
  delivered as the root `index` document, never also as a `/` Source row.
- `da-library.mjs` exits 0 (archetypes-only: once the archetypes are
  delivered).
- `curl -sIL https://<branch>--<repo>--<owner>.aem.page/` ends in 200.

### Phase D2 — Dynamic features (`dynamics` Phases 4–5)

Implement the plan's reproducibility-`self` rows from the pattern catalogue
(`skills/dynamics/reference/patterns.md`); emit every other row as **one owner
decision batch** and ship its interim tier. Each feature ends with a parity
row in `stardust/dynamics/parity.json` carrying a replayable check;
`dynamics-check.mjs --origin <live host>` runs before Phase H. A failed replay
is a learning, never a silent pass. Index-backed listings ship
**document-first** (`skills/dynamics/reference/listings.md`).

- `/query-index.json` answering 404 is a code-branch gap (no
  `helix-query.yaml`); a 403 from the configuration service is expected
  (`reference/operational-learnings.md` § Dynamic-features learnings).
- Search parity is count + titles, not presence
  (`skills/dynamics/reference/patterns.md` § search-index-backed).
- **Pages built here enter coverage**, or they stay outside verify, optimize
  and the sitemap. Once per page:
  ```bash
  node skills/rollout/scripts/update-coverage.mjs --new search --path /search --template search --origin dynamics --title "Search"
  ```

### Phase D3 — Multilingual (per-language trees) — optional

Language trees (`/fr/…`, `/en/…`) are parallel content trees that REUSE the
same block library: `reference/multilingual.md`.

### Phase E — Full-site verify

```bash
node skills/rollout/scripts/verify.mjs   # rollout.json site.liveHost; or --base <url> | --root <dir> (offline export)
```

Flips each delivered page to `verified` or `failed`
(`reference/coverage-model.md` § Verify); exits non-zero if any page failed.

**Headless render check (per template).** A 200 `.plain.html` can still
render blank. On the FIRST delivered page of each template (home included),
load the live URL in a headless browser and assert: the runtime's
`body.appear` class (per `stardust/runtime-contract.json`), `main .section`
count > 0, zero `pageerror` events, zero broken images, and every
`restoreAtDelivery` entry of the archetype holds — an `autoplay` `<video>` at
least a quarter visible is playing (`currentTime` advancing), a rotating
carousel advances untouched.

**Published-origin gate over the roster (#125).** The DELIVERY verdict is
replica's `gate-all.mjs`
(`skills/replica/reference/source-fidelity-gate.md` § The all-pages
published-origin gate). `update-coverage.mjs --gate
stardust/replica/gates/all-<w>/summary.json` writes each row into
`delivery.gate` and flips a failing page to `failed`; `verify` never marks it
`verified` while the gate fails.

### Phase E2 — Link-audit completeness

Closes the set of link **targets** a roster-driven batch misses
(`reference/operational-learnings.md` § Two verify checks):

- Every `href` in `/nav`, `/footer` and each section's landing page is
  **deployed + published + verified**; so are the chrome documents.
- Localize source-site bounce links with `node
  skills/deploy/scripts/localize-links.mjs --source-host <live-host> --content
  content --redirects stardust/redirects.tsv`, not by hand. **Re-run over the
  WHOLE tree after every wave**; `--check` is the gate (exit 2 = localizable
  links remain).
- The audit GETs each href, at its served URL, against the LIVE tree.
- A target missing from the capture is a capture gap or a scope extension,
  recorded in `direction.md` as a named decision. Any captured page — a
  `stardust/state.json` row, `duplicateOf` shells and locale roots included —
  is delivered, never repointed. Never leave a 404.

### Phase F — Optimize: multi-source audit + gate (delivery quality)

The in-flow **quality gate**: findings from existing audit skills go into one
ledger (`optimize/findings.json` + `optimize/scorecard.json`). Sources, the
`findings.mjs record` form and fixability routing:
`reference/audit-sources.md`.

```bash
node skills/rollout/scripts/optimize.mjs   # rollout:baseline + the gate; or --base <url> | --root <dir> | --slug <s> | --all
node skills/rollout/scripts/findings.mjs resolve <id> --status accepted --note "…"
```

The gate **exits non-zero if any open P1 is in scope** — a page is
delivery-clean only when verify passes *and* the ledger has no open P1.
`design-pass` findings go upstream (surface only). Findings the SOURCE shares
are tagged `source parity:` — not gated, never auto-fixed, nothing to accept
by hand (`reference/checks.md` § Source parity). At ~1k-page scale:
`reference/operational-learnings.md` § Optimize-gate learnings.

### Phase G — AEM autofix (close the loop)

```bash
node skills/rollout/scripts/autofix-aem.mjs --project <eds-root>   # [--dry-run] [--slug s] [--check c]
```

For every open finding whose `check` has a registered fixer
(`reference/audit-sources.md` § AEM autofix registry) it edits the EDS
**project** files and stages the finding `in-progress`. **Use `--dry-run`
first.** After applying, **re-deploy** the edited pages, then re-run
**verify** + **optimize** — staged findings flip to `fixed`.

### Phase H — Report

Read `rollout.json.lastRun` + `optimize/scorecard.json` (or re-run
`inventory.mjs`):

```
rollout — <site> → aem-eds
Pages       <N> total · <v> verified · <d> deployed · <p> pending · <cp> content-pending · <s> stale
Templates   <T> (per-template delivered/total)
Blocks      <B> total · <c> converted · <p> pending
Quality     health <H>/100 · open P1 <n> / P2 <n> / P3 <n>
Pixel table prototypes <p>/<P> PASS · deployed <d>/<D> PASS (pixel-only <x>/<D>) — gates/{prototypes,all}-1440/summary.md
To deliver  <list of remaining slugs>
Content     <cp> pages awaiting content track
```

Surface `pending` / `stale` / `failed` as the explicit "what's missing" list;
`content-pending` pages are listed separately, not as failures. The
pixel-table line comes from the two `summary.json` totals (`pass`,
`pixelOnlyPass`, `pages`); a deployed page missing from
`all-1440/summary.json` is ungated and belongs in that list (#125). Include
the dynamic parity table (`stardust/qa/dynamics-report.md`).

**Also write/refresh `stardust/learnings.md`** per
`skills/stardust/reference/learnings.md`: one entry per failure class this
run surfaced.

### Phase I — Dashboard

```bash
node skills/rollout/scripts/dashboard.mjs    # → dashboard/index.html + data.json
```

What it shows: `reference/coverage-model.md` § Dashboard stages.

**Done is one verdict:** the rollout is complete when `node
skills/rollout/scripts/done-check.mjs` exits 0; otherwise it prints one gap
per line.

## What rollout does NOT do

- **It never modifies the agnostic core, `state.json` or `migrated/`:** those
  are read-only inputs. It writes under `stardust/rollout/` and — only via
  `autofix-aem` — to the **EDS project** it delivers to.
- **No upstream redesign, no new transport.** `design-pass` findings are
  surfaced, not fixed; delivery is `deploy`'s DA Source API path
  (`skills/deploy/da-deploy-protocol.md`), unchanged.

## References

Every script answers `--help` and has a row in
`skills/stardust/reference/scripts-index.md`; the ledger contracts are
`schemas/*.schema.json`; design rationale: `notes/rollout/PLAN.md`. Each
`reference/` file is named at the phase that needs it.
