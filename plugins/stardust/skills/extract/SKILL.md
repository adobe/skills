---
name: extract
description: Crawl an existing website (capped, multi-page) and seed stardust/current/ with PRODUCT.md, DESIGN.md, DESIGN.json, a per-page inventory, and the consolidated brand surface — the captured design system, palette, typography, motifs, and voice of the live site. Use when the user wants to analyze an existing site's design, extract or reverse-engineer its design system or brand, capture design tokens from a live site, import a website as the starting point for a redesign, capture the current state before a migration, or invokes `$stardust extract` (`/stardust:extract` in Claude Code). Trigger phrases include "analyze this site", "extract the design tokens", "capture the brand", "crawl the site", "reverse engineer the design". Not for scraping page data or content for its own sake (it captures design evidence, not datasets), and not for the redesign itself — extraction is descriptive; direction and prototyping happen downstream.
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, and the impeccable skill (github.com/pbakaus/impeccable) installed alongside stardust.
---

# stardust:extract

Crawl an existing website, parse each page, extract the brand surface,
and produce a stardust-formatted snapshot of the current state under
`stardust/current/`. The output describes what the site **is**; later
sub-commands consume it to decide what it **should be**.

This skill is **descriptive**: it does not invent direction, it does not
critique, and it does not modify the live site. It writes only under
`stardust/current/` and updates `stardust/state.json`.

## Inputs

`<url>` (required; a path narrows the crawl to that subtree), `--cap <N>` (default 5), `--all`, `--pages <slug,...>`, `--refresh <slug>`, `--single`, `--wait <fast|medium|spec|auto>`, `--no-junk-filter`, `--no-consent-dismiss`, `--dynamics` (migration-bound: set by `prepare-migration`, `replica` and `migrate`, never by a bare extract, `uplift` or `audit`), `--concurrency <n>` (default 4), `--brand-source <url>` (repeatable), `--design-source <url>`, `--prep`. What each does: `skills/extract/reference/inputs.md`.

## Setup

Run the master skill's setup procedure first
(`skills/stardust/SKILL.md` § Setup): impeccable dep check, context
loader, state read.

Additional checks for this sub-command:

1. **Playwright availability.** The extraction step needs a real
   browser. Detect Playwright in this order: a Playwright MCP server,
   then a project-importable `playwright` module. **The `npx
   playwright` probe is NOT sufficient** — it confirms the CLI
   (which resolves a global install) but the recipe and
   `scripts/crawl.mjs` load `playwright` through `browser.mjs`,
   and ESM module resolution does **not** honour a global install or
   `NODE_PATH` — the import throws `ERR_MODULE_NOT_FOUND` even where
   `npx playwright --version` succeeds. Verify the module is
   import-resolvable from the project root (probe:
   `node -e "import('playwright').then(()=>process.exit(0))"`); if it
   isn't, run `npm i -D playwright pixelmatch pngjs cheerio --legacy-peer-deps`
   (devDependencies, never `--no-save` — #125) or use the Playwright MCP
   server, before crawling. The
   `--legacy-peer-deps` flag is required on `aem-boilerplate` targets
   (their pinned `eslint@8` makes a plain `npm i` exit `ERESOLVE`
   before playwright is even considered). Don't trust the CLI
   probe alone.

   Every downstream skill that renders re-runs this probe. Scripts run from their byte-identical project copy (`stardust/scripts/…`), the master skill's included. `skills/extract/scripts/crawl.mjs` implements this whole sub-command: invoke it rather than hand-rolling a Playwright script. Details: `skills/extract/reference/setup.md`.
2. **Origin collision.** If `stardust/state.json` already records
   `site.originUrl` and the new `<url>` is a different origin, stop and
   ask before clobbering. Stardust does not silently mix two sites in
   one project.
   **Flow guard (migration asks only).** If the ask carries migration
   intent ("migrate", "to EDS", "re-platform", "1:1", "replica") and
   `stardust/state.json` exists — or is about to be created — without
   `flow`, hand back to the master skill § Two migration flows before
   crawling: the flow is chosen and stamped there, and a keep-design
   ask enters through `replica` (which invokes this skill with `--prep`
   itself). A bare `extract <url>` for a redesign, audit or uplift is
   unaffected. (Recorded: `extract` on a raw URL as the entry of a
   same-design migration; the agent then built its own importer beside
   `replica`.)
3. **Browser contexts.** Open a fresh `BrowserContext` per capture
   worker (§ Concurrency; default 4). Run the **consent dismissal
   pre-flight** per `reference/playwright-recipe.md` § Pre-flight:
   consent dismissal *unless* `--no-consent-dismiss` is set.
   Cookies persist within a context but **not across contexts** —
   re-establish consent state per context (re-run the dismissal on
   the worker's first page, or clone the probe context's
   `storageState`). Record the resolved method in
   `_crawl-log.json#consent.method`.
4. **Bot-management probe.** When the first navigation in the run
   returns `ERR_HTTP2_PROTOCOL_ERROR` or `ERR_QUIC_PROTOCOL_ERROR`,
   or hangs through the entire hard-cap on what should be a fast
   origin, **do not retry headless** — switch to headed Chrome per
   § Failure modes → Bot-management block and record the switch in
   `_crawl-log.json#discovery.fetchTechnique` so re-runs start in
   headed mode without rediscovering the issue.

## Procedure

### Phase 1 — Discovery

Sitemap (else a same-origin BFS, depth 3), filter, de-duplicate, junk filter, then the cap (default 5, `--cap`, `--all`; a user-named N goes link-first) and proceed with no confirmation gate. Write the discovery reasoning to `stardust/current/_crawl-log.json`. Steps, flag examples and the informational output: `skills/extract/reference/phase-1-discovery.md`; procedure: `reference/ia-extraction.md`.

### Phase 2 — Per-page extraction

Render every page with Playwright per `reference/playwright-recipe.md`, concurrently (§ Concurrency). The recipe is mandatory per page: never skip the wait, the scroll or the capture list. Save `stardust/current/pages/<slug>.json` (`_provenance` first) and the settled DOM `pages/<slug>.html`; parse that offline instead of re-probing live. Recipe summary, capture list and save rules: `skills/extract/reference/phase-2-per-page-extraction.md`; read it before the first capture.

**Live-render evidence (synthesis is forbidden).** Refuse to mark
a page `extracted` in `state.json` unless its `_provenance`
contains `renderedBy: "playwright"`, an ISO-8601 `fetchedAt`, a
positive integer `waitMs`, a `waitMode` from the recipe, and a
final `httpStatus` in the 2xx/3xx range. These five fields are
the contract enforced by `reference/current-state-schema.md`
§ Live-render evidence and read back by every downstream phase
via `validateProvenance()` per
`skills/stardust/reference/state-machine.md` § Provenance
validation. Synthesizing a page record from
`_brand-extraction.json` plus URL patterns plus captured photos
— the 2026-04-30 e-commerce shortcut — is the failure mode this
guard exists to prevent. When the agent (or a delegated sub-
agent) cannot satisfy the contract for a page, treat the page
as a Phase 2 failure: record under `_crawl-log.json#crawl.failures[]`
with `errorClass: "ProvenanceMissing"` and continue.

Mark the page `extracted` in `state.json` immediately after each
successful page write. If a page fails, record the error in
`_crawl-log.json` and continue — extraction is best-effort per page.

### Phase 2.5 — Vision verification

Before anything downstream is authored, **look** at each captured
page's screenshot (`assets/screenshots/<slug>.png`) — the multimodal
model reads the image — and verify it against the extracted record:

- Does the recorded hero (headline + asset) match what the pixels show?
- Is the extracted palette plausible against the pixels?
- Does a `cssBackgrounds: []` record look believable, or is imagery
  visibly present — a silent capture failure?
- Is the logo captured?
- Is the page actually rendered — not a consent wall, bot-block
  page, or blank SPA shell?

Read each page through its `thumb.mjs` thumbnail, never the full-resolution screenshot, and read the whole page (follow `--offset` while the share is below 100), or run the check in a subagent that returns one line per page. On a mismatch, re-capture up the escalation ladder; record `_crawl-log.json#visionCheck[]` (`ok | recaptured | suspect`). Commands and ladder: `skills/extract/reference/phase-2-5-vision.md`.

### Phase 3 — Brand-surface extraction

Run after the capture phases (2–2.5). Aggregation **may proceed
incrementally** as concurrent page captures complete (§ Concurrency),
but the written file must reflect every extracted page — including
brand-source pages per § Cross-site brand sources.
Produces `stardust/current/_brand-extraction.json`
per `reference/brand-surface.md`. Some fields are home-only (logo,
voice samples, register heuristic); the visual tokens that drive
DESIGN.md (palette, radius, shadow, type) are aggregated across **all
extracted pages** to avoid the home-page bias documented in
`brand-surface.md` § Aggregation scope.

Run the shipped instruments and author no probe: `style-census.mjs` once after the crawl, in the background, then `cap-probe.mjs` (`#124`) once per archetype. Then capture logo, favicon (always, as its own asset), palette, type, motifs, voice samples, hero image, hero medium (the signature), icon font, system components (required) and origins. Commands and capture rules: `skills/extract/reference/phase-3-brand-surface.md`; read it before aggregating.

Do not invent values. Every captured value cites a source selector or
URL in `_brand-extraction.json` for traceability.

### Phase 4 — Seed `stardust/current/PRODUCT.md` and `DESIGN.md`

The current-state PRODUCT.md and DESIGN.md are **descriptive, not
authored** — there is no interview to run because the user is not
defining intent here, the agent is describing the existing site. Write
them directly using impeccable's format specs (impeccable's skill
directory is what `node <plugin>/skills/stardust/scripts/impeccable-version-check.mjs --where`
prints; read each spec by section, not whole):

PRODUCT.md per impeccable's `reference/init.md` § Write PRODUCT.md, DESIGN.md and DESIGN.json per its `reference/document.md`, the stardust provenance block first and inferred sections marked. File order, sections and the DESIGN.json `extensions`: `skills/extract/reference/phase-4-seed.md`.

Stardust does **not** invoke `$impeccable init` (formerly `teach`) or
`$impeccable document` for the current-state files: those commands write to project
root (the *target*) and run an interview. Stardust authors the
descriptive snapshot directly. The format spec from impeccable is the
contract; the runtime command is not.

The target-state PRODUCT.md and DESIGN.md at the project root are
written by `$stardust direct` in Phase 2 of the pipeline, not here.

### Phase 5 — Render `stardust/current/brand-review.html`

After Phase 4 writes the descriptive PRODUCT.md and DESIGN.md, emit
the current-state brand review per
`reference/brand-review-template.md`.

The brand-review HTML is the **first surface a human can eyeball** to
verify the extraction before committing to a redesign direction —
misreads that are invisible in JSON (a wrong dominant radius, a
missing system component, a single-page palette bias) are obvious to
the eye while they are still cheap to fix (re-extract is fast;
re-direct + re-prototype is not).

The template is mandatory. In particular:

1. Run the **Tensions detectors** listed in
   `reference/brand-review-template.md` § Detectors. Each rule is
   mechanical; emit a tension card whenever the trigger condition
   matches. The review may ship with zero tensions if the data is
   too thin to evaluate, but the detectors must always be run.
2. Render in the brand's **own captured colors and fonts**, not a
   stardust shell.
3. Embed all CSS; do not load external JavaScript or fonts unless
   the live site already does.
4. Cite the source artifact for every section (e.g.
   `_brand-extraction.json § type` under Typography).

If the data for a section is missing, **omit the section** — do not
fabricate placeholders. The coverage callout at the top reflects what
is missing.

### Phase 6 — Update state and report

After all Phase 2-5 writes succeed:

1. Update `stardust/state.json` (schema in
   `skills/stardust/reference/state-machine.md`):
   - `site.originUrl`, `site.extractedAt`, `site.pageCap`,
     `site.totalDiscovered`, `site.crawled`
   - `pages[]` — one entry per crawled page with `status: "extracted"`,
     filled `currentStatePath`, empty `prototypePath` and `migratedPath`
   - `designSource` — only when `--design-source` was used:
     `{ url, capturedAt, path }` per § Cross-site brand sources
2. Print a one-screen summary. Its per-page evidence table (`live` must read `yes` on every row; `media(img/bg)` flags `⚠ low-media`) and its wait summary are mandatory. Format and flag rules: `skills/extract/reference/phase-6-report.md`.

## Cross-site brand sources

Two flags widen extraction beyond the primary origin — **read
`reference/cross-site-sources.md` in full whenever either flag is
present**. Both are opt-in; without them this section is inert.

Core contract (merge rules and capture shapes in the reference):

- `--brand-source <url>` (repeatable) — a **same-brand** sibling
  gets a shallow capture (home + ≤2 nav-linked pages, full recipe +
  provenance) under `stardust/current/brand-sources/<host>/`.
  Evidence, not inventory: never enters `state.json.pages[]`.
  Its palette/type/motif/voice evidence aggregates into
  `_brand-extraction.json` with per-origin attribution
  (`origins[]`); conflicts resolve toward the primary; widened
  traits are attributed, never invented. Excluded from system
  components, `voiceTable`, and cross-promo detection.
- `--design-source <url>` — a design donor is captured to
  `stardust/canon-source/` (same shapes as `current/`, default cap),
  its descriptive DESIGN.md/json derived per Phase 4 rules, and
  `state.json.designSource = { url, capturedAt, path:
  "stardust/canon-source/" }` stamped. `direct` pins the donor
  system as the target (its § Mode A); donor evidence never
  aggregates into the primary `_brand-extraction.json`.

## Sibling-site discovery

After the primary crawl (Phases 2–2.5), harvest candidate same-brand

After the primary crawl, harvest candidate same-brand origins from evidence already captured (no extra navigation) into `_crawl-log.json#siblingCandidates[]`. Interactive: propose them as `--brand-source`. Hands-off: auto-include up to 2 high-confidence candidates. Never balloon the crawl. Details: `skills/extract/reference/sibling-discovery.md`.

## Outputs

| Path                                        | Purpose                                             |

Under `stardust/current/`: `PRODUCT.md`, `DESIGN.md`, `DESIGN.json`, `brand-review.html`, `pages/<slug>.{json,html}`, `assets/` (logo, favicon, media, screenshots), `_brand-extraction.json`, `_crawl-log.json`; `brand-sources/` and `stardust/canon-source/` only with their flags; `stardust/state.json`. What each holds: `skills/extract/reference/outputs.md`.

## Concurrency

Page captures run **concurrently**: the Phase 2 queue is drained by
4–8 parallel browser contexts (`--concurrency`, default 4). Each
worker owns its `BrowserContext`; consent state is re-established per
context (Setup step 3). Media `resolves` / HEAD checks are batched
with `Promise.all`. Brand-surface aggregation (Phase 3) may proceed
incrementally as pages complete, so long as the written
`_brand-extraction.json` reflects every extracted page. The bundled
crawler implements the pool (`crawl.mjs --concurrency <n>`).

Across processes, per `state-machine.md`: stardust does not lock. Two
concurrent extracts on the same project are last-write-wins. Document
this in the user report; do not engineer around it.

## Failure modes

- **Network failure mid-crawl.** Continue, record in `_crawl-log.json`,

- Network failure: continue, record it, end with a partial state.
- HTTP 4xx/5xx, non-HTML, soft-404: a distinct error class in `_crawl-log.json#crawl.failures[]`, never `extracted`.
- Login wall: never authenticate; ask how to proceed.
- Bot-management block: `crawl.mjs` runs the real-Chrome fallback itself; probe one asset with curl before any in-page harvest.
- JavaScript-only content: fall back to `domcontentloaded` and record it.
- Synthesis: forbidden; record `ProvenanceMissing` and continue.

Details: `skills/extract/reference/failure-modes.md`.

## Prep mode (--prep)

When invoked with `--prep`, extract runs an extended pass that
prepares the inventory for migration — **read
`reference/prep-mode.md` in full before running any `--prep`
extraction**. Discovery-mode runs (without `--prep`) are unchanged:
small cap, no typing, no module detection. The flag is intended for
the `prepare-migration` orchestrator, though direct invocation is
supported.

Core contract (procedure, formats, and detection rules in the
reference):

- `--prep` implies `--all` unless the user named N (then `--cap N`,
  `reference/prep-mode.md` § 1) — migration coverage requires the full
  junk-filtered inventory, not the discovery cap.
- Page types (`landing | article | listing | program | form |
  static | unique`) are LLM-inferred into `state.json.pages[].type`
  (discovery-mode runs leave `type` null); the user confirms in
  `direct --prep`.
- Module candidates (cross-page structural repeats, detected by the
  signal-source priority in the reference) are drafted under
  `DESIGN.json.extensions.modules[]` with `status: "candidate"`;
  per-page JSON gains a typed `slots` section per page-type.
- **Locale-root capture gaps are settled before Phase 2 of any flow.** Copy `_crawl-log.json#captureGaps` `roots[]` to `state.json.site.captureGaps` and carry its `detail` verbatim in the ledger `end` line that closes the extraction: `skills/extract/reference/prep-locale-gaps.md`.
- **The header contract is recorded here** (`../diff/SKILL.md` § The header
  contract); its summary line in the prep summary sizes the header.
- The prep summary replaces the Phase 6 report; its
  `Provenance: <live>/<total> live` line is mandatory, and any
  ratio short of `<total>/<total>` means the run failed the
  synthesis guard and is incomplete.
- When delegating extraction to a sub-agent, the sub-agent prompt
  **must** forbid synthesis by name and require the per-page
  evidence table and wait-summary line in its return
  (`reference/prep-mode.md` § Sub-agent prompt requirements);
  missing any of the three is a recipe violation.

## References

- `reference/playwright-recipe.md` — viewport, capture list, logo locator chain.
- `reference/ia-extraction.md` — sitemap + BFS crawl + cap procedure.
- `reference/current-state-schema.md` — per-page JSON schema.
- `reference/brand-surface.md` — consolidated brand-surface schema.
- `reference/brand-review-template.md` — current-state brand-review HTML contract + Tensions detectors.
- `reference/prep-mode.md` — full `--prep` procedure (typing, module candidates, typed slots, prep summary, sub-agent requirements).
- `reference/cross-site-sources.md` — full `--brand-source` / `--design-source` procedure (shallow capture, merge rules, canon-source donor).
- `skills/stardust/reference/state-machine.md` — state.json contract.
- `skills/stardust/reference/artifact-map.md` — provenance shape.
