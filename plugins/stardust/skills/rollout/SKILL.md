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
  authored documents (`/nav`, `/footer`) fed to the header/footer blocks. In
  archetypes-only mode the archetype sidecars fully determine the
  block set; `content-pending` pages add none. A module that maps to EDS **default
  content** (title, text, image, button, separator — deploy's D1) needs no block: record
  it `update-coverage.mjs --block <id> --status converted --eds-name default-content`;
  such a row is never counted pending, whatever its status.
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
`dynamics-detect.mjs --from-state … --reach stardust/current` and `dynamics-plan.mjs
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
   it skipped the contract on 27/27 blocks of a real site.

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
   published documents, and the `/sitemap.xml` it serves, list them as pages: a
   recorded hands-off run served 58 sitemap urls for a 36-page site (every page
   plus 22 chrome documents). Phase D verifies the served sitemap.

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
   node skills/rollout/scripts/update-coverage.mjs --block <id> --status converted --eds-name default-content   # maps to default content, no block
   node skills/rollout/scripts/update-coverage.mjs <slug> --status deployed --url <branch-preview-url>
   node skills/rollout/scripts/update-coverage.mjs <slug> --status content-pending   # no document push
   ```
   **Publish in the loop (`PUT → preview → live`), don't stop at preview** — any
   query-index (Phase D2) builds from the **live** tree, so a preview-only delivery
   leaves indexes empty. On failure: `--status failed --error "<reason>"` and
   continue (one page's failure never aborts the rollout).

**Foundation-first gate (hard block, once per rollout).** When the FIRST
archetype page flips to `deployed`, stop and prove the foundation before
authoring any second page: run the stardust `diff` skill (both probes) against its
prototype, **plus computed-style invariants in a headless render** — grid
containers compute `display: grid` (not stacked single-column), sections are
full-bleed where the design says so, and the CTA/button classes are actually
styled (per `stardust/runtime-contract.json`, `skills/deploy/SKILL.md`
§ Runtime-detection probe). `deployed` means after PUT + preview: the gate's
probes run against the page's preview URL, never a local harness — a
pre-deploy harness pixel diff is NOT this gate. A wrong runtime assumption (block wrapper class,
button classes) is silent and sitewide — typography still looks fine while
every grid stacks. This one gate is the difference between fixing one page
and rebuilding every template.

**Execution model: waves.** Deliver in waves of parallel **author-only** agents
— each agent curls its source pages and writes files only, never deploys or
edits blocks — template clusters concurrently (non-overlapping pages),
representative-first so blocks exist to be reused; then a **central deploy**
per page; then background batches with a per-page OK/FAIL ledger, re-driving
FAILs only. For clusters of 6–20+ siblings, the full flow is
`reference/delivery-gates.md` § Batched delivery (it also names the one
variant where cluster agents deploy themselves — replica's Phase 5 fan-out,
per-cluster deploy ledgers, lock-safe shared ledgers). The central deploy step
should run the bundled, resumable driver rather than a serial loop:
`node skills/deploy/scripts/deploy-batch.mjs --org <org> --repo <repo>
--branch <branch> --content <dir>` (concurrency pool, persistent ledger that skips
already-live pages, retry/backoff, append-only log, delivered-`.plain.html` check).
The driver and every batch run in the background; its log and ledger are the
progress file. Check them at most every 4 minutes and never with a fixed `sleep`
of 5 minutes or more (the prompt-cache window) — the master skill's wait
discipline; recorded batch waits of 9–10 minutes re-wrote a ~650k prefix each time.
After a transient blip, re-run the same command — it re-drives only the FAILs.
Then reconcile the ledger into coverage with `update-coverage.mjs`.
**Foundation first:** lint AND commit `styles.css`, header/footer CSS and the
contract file BEFORE the first agent spawns; no token or custom-property rename
after fan-out (a recorded rename under three running agents cost seven
coordination messages). **Disjoint clusters spawn concurrently** — a wave waits
only on a real dependency (a recorded second wave idled 14 min behind an
unrelated first). **Every tool call stays under 4 minutes, the main agent's
included** (the prompt cache holds 5; calls of 5.2 and 6.6 min re-wrote the whole
context, and so did one 338 s foreground turn on the main agent that ran a pixel
loop beside a deploy-batch start + wait): a long instrument (gate rounds, pixel
loops, Playwright captures, deploy batches) goes through `run-bg.mjs start`, and
`wait` is the NEXT tool call — it returns within its `--max` (100 s by default); never two long instruments
as parallel tool calls in one turn, never two `wait`s in one command.

### Phase D — Site assembly (whole-site artifacts)

```bash
node skills/rollout/scripts/assemble.mjs   # → rollout/site/{sitemap.xml,robots.txt,manifest.json} — the EXPECTED set
node skills/rollout/scripts/assemble.mjs --verify-origin https://<branch>--<repo>--<owner>.aem.live   # vs the SERVED /sitemap.xml; exit 1 on a mismatch
```

Generates site-wide artifacts: `sitemap.xml` + `robots.txt` from delivered paths,
and a fragments manifest mapping chrome blocks to the authored chrome documents
(`content/nav.html`, `content/footer.html`) with their `canon/*.html` source
(`deploy` authors + deploys the documents through the normal content chain —
they MUST be published or the chrome 404s sitewide).

**The assembled sitemap is never the served one.** `stardust/rollout/` is in
`.hlxignore`, so `site/sitemap.xml` is a local artifact — the EXPECTED url set.
The platform serves its own `/sitemap.xml`, built from its index of every
published document, chrome documents included unless each carries `Robots |
noindex` (Phase C). A recorded hands-off run read the local file, reported
"sitemap 36 urls" and shipped a served sitemap of 58 (36 pages + 22 `nav` /
`footer` documents). Two remedies, the first required:
- **Authoring:** every chrome/fragment document — `/nav`, `/footer`, per-locale
  `nav-*` / `footer-*`, locale shells that are not pages — carries the metadata
  row `Robots | noindex`; a document already published without it is re-authored
  and re-published (preview → live) before the check below.
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
`dynamics-check.mjs --origin <live host>` runs before Phase H and the report carries its table.
Failed replays are `dynamic-gap` / `api-dependency` learnings, never silent passes.
Index-backed listings ship **document-first** (authored rows, index for non-text and top-up —
`dynamics/reference/listings.md`); the deploy AI-readability gate runs on every listing page.

**A missing query index is a code-branch gap, not a configuration-service problem.**
`/query-index.json` answering 404 means the project ships no `helix-query.yaml` (the
demo boilerplate does not). The FIRST remedy: author `helix-query.yaml` at the code
branch root indexing the delivered content roots into `target: /query-index.json`
(`title` from `og:title`, `description`, `image`, `lastModified`; chrome and search
documents excluded — skeleton in `skills/dynamics/reference/listings.md` § Getting an
index at all), push the branch, make sure the pages are published LIVE, then poll
`/query-index.json` no more often than every 5 s for at most 10 minutes until `total`
settles at the page count. No admin-configuration write is part of this — the indexer
builds from live-published pages; a 403 from the configuration service with the
migration token is expected and is not a reason to stop. Only when the code branch is
NOT writable does the sheet-backed interim index ship (recorded `interim`, decision
named). A recorded hands-off run probed the configuration service, read its 403 as "no
index can be configured" and built the interim index — the fix was one committed yaml.

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
decoration ran: the runtime's `body.appear` class is set (per
`stardust/runtime-contract.json`), `main .section` count > 0,
zero `pageerror` events, zero broken images.

**Published-origin gate over the roster (#125).** `verify` proves the pages render; the
DELIVERY verdict is replica's `gate-all.mjs` (pixel + height + clip + content per deployed page,
`../replica/reference/source-fidelity-gate.md` § The all-pages published-origin gate). Record
`delivery.gate` from its `summary.json`, never from the pixel number alone.

### Phase E2 — Link-audit completeness

`verify.mjs` checks the links on delivered pages; this phase closes the set of
link **targets** a roster-driven batch misses
(`reference/operational-learnings.md` § Two verify checks):

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
  absolute (no local page — a bounce beats a 404). **Re-run over the WHOLE
  tree after every wave**: earlier waves' pages gain newly valid targets only
  when a later wave ships them. `--check` is the gate (exit 2 = localizable
  links remain).
- **Strip trailing slashes and `.html` from internal links.** EDS serves
  extensionless documents with no trailing slash, so `/x/y/` and `/x/y.html`
  both 404 (render the 404 block) while `.plain.html` still passes — nav reads
  green, every link is dead. Normalize every internal `href` (keep bare `/`);
  repoint `.html` links with no local page at the working source URL.
- **The audit GETs each href against the LIVE tree.** Structural resolution
  against the ledger misses trailing-slash and case defects that only
  delivery exposes.
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
out-of-scope` with the evidence prefix `source parity:` and listed in their own report
section: informational, excluded from the health score and the open P1/P2/P3 counts,
never gated, never auto-fixed. A recorded hands-off run accepted 63 such findings by
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

Use `--dry-run` first. After applying, **re-deploy** the edited pages, then re-run
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
| `stardust/migrated/**/_meta.json` | `migrate` | `templateId` (`template`; an archetype with `template: null` groups under its own slug; else `type`), `blocks` (`modules` — the inventory report counts sidecars with an empty list: fill them before Phase B), `title` |
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
