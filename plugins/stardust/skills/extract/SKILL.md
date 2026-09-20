---
name: extract
description: Crawl an existing website (capped, multi-page) and seed stardust/current/ with PRODUCT.md, DESIGN.md, DESIGN.json, a per-page inventory, and the consolidated brand surface — the captured design system, palette, typography, motifs, and voice of the live site. Use when the user wants to analyze an existing site's design, extract or reverse-engineer its design system or brand, capture design tokens from a live site, import a website as the starting point for a redesign, capture the current state before a migration, or invokes `$stardust extract` (`/stardust:extract` in Claude Code). Trigger phrases include "analyze this site", "extract the design tokens", "capture the brand", "crawl the site", "reverse engineer the design". Not for scraping page data or content for its own sake (it captures design evidence, not datasets), and not for the redesign itself — extraction is descriptive; direction and prototyping happen downstream.
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, playwright-cli on PATH, and optionally the impeccable skill (github.com/pbakaus/impeccable).
metadata:
  impeccable: optional
---

# stardust:extract

## Operator card

| phase | command / instrument | gate | writes |
|---|---|---|---|
| Setup 1–4 | `node -e "import('playwright').then(()=>process.exit(0))"`; copy `skills/extract/scripts/{crawl,validate-page,brand-surface,write-design-json,brand-review,state-update}.mjs` as a set → `stardust/scripts/` (+ `skills/stardust/scripts/progress.mjs` → `stardust/scripts/stardust/`); origin-collision and flow guard; consent pre-flight; bot-management probe | flow stamped before a migration crawl | `_crawl-log.json#consent`, `#discovery.fetchTechnique` |
| 1 Discovery | robots sitemaps → standard → conventions → nav union → BFS (`--depth`); subtree from the typed path; junk filter; cap via `--cap <N>` / `--all` / `--pages <slugs>` / `--single` | relay crawl's kept/cut summary; no gate | `stardust/current/_crawl-log.json` |
| 2 Per-page extraction | `node stardust/scripts/crawl.mjs --url <origin> [--pages …] [--cap N \| --all \| --single] [--refresh <slug,…> \| --force] [--headed] [--concurrency N] [--wait <mode>] [--dynamics] [--mobile <mode>] [--dpr N] [--depth N] [--cookie n=v] [--storage-state <file> \| --fresh-state] [--save-state] [--solve-wait <ms>] [--progress <file> \| --no-progress] [--assets intercept\|full\|none \| --no-assets] [--prep]` — in the background; `progress.mjs read stardust/.work/extract/crawl.progress.json`, then its `SUMMARY` line | live-render evidence contract; schema gate `validate-page.mjs` (exit 1 = not `extracted`); synthesis is a Phase 2 failure | `current/pages/<slug>.json` + `.html`, `assets/screenshots/<slug>.png`, `assets/media/`, `state.json` page → `extracted` |
| 2.5 Vision verification | look at each screenshot against its record; `_signals` flags first; escalation ladder (wait mode → next bot-management tier → fresh context); `node plugins/stardust/evals/lint/crawl-log-lint.mjs --dir stardust/current` | verdict `ok` / `recaptured` / `suspect`; never `ok` on DEGRADED / overlay | `_crawl-log.json#visionCheck[]` |
| 3 Brand-surface extraction | `node stardust/scripts/brand-surface.mjs --out stardust/current --home index [--bounded \| --full] [--lift <dir>]` — offline over `pages/*.json`; read its printed notes | exit 1 = no live record; source citation per value; `--pages`/`--single` runs → `_provenance.mode: "bounded"` unless the crawl ran `--prep` or `--full` is given | `current/_brand-extraction.json`, `assets/logo.svg` |
| 4 Seed current-state docs | `node stardust/scripts/write-design-json.mjs --out stardust/current`; author PRODUCT.md / DESIGN.md directly from impeccable's format specs (no `$impeccable init` / `document`) | provenance block first; exit 2 without the brand surface | `current/DESIGN.json`, `current/PRODUCT.md`, `current/DESIGN.md` |
| 5 Brand review | `node stardust/scripts/brand-review.mjs --out stardust/current` — the 13 detectors print `T-xxx: fired \| quiet` | exit 2 without `_brand-extraction.json`; sections without data omitted | `current/brand-review.html` |
| 6 State and report | `node stardust/scripts/state-update.mjs --out stardust/current [--prep] [--legacy] [--vision <file>]` — evidence table, wait summary, `Provenance: <live>/<total> live` | `extracted` only on live provenance + strict schema gate (`--legacy` = the validate-page opt-in); `--prep` exits 1 when live < total | `stardust/state.json`, `status.jsonl`, `_crawl-log.json#visionCheck[]` |
| opt-in | `--brand-source <url>` / `--design-source <url>`; sibling-site discovery; `--prep` (implies `--all`) | prep summary `Provenance: <live>/<total>` line | `current/brand-sources/<host>/`, `stardust/canon-source/`, `state.json.pages[].type` |

| at phase | read |
|---|---|
| Setup 1, 4 | `reference/playwright-recipe.md` § Browser configuration · § Bot-management fallback |
| Setup 3 | `reference/playwright-recipe.md` § Pre-flight: consent dismissal |
| 1 | `reference/ia-extraction.md` § Discovery order · § Junk-page filter · § Page selection · § Incremental re-runs · § `_crawl-log.json` shape |
| 2, 2.5 | `reference/playwright-recipe.md` § Wait modes · § Capture list · § Response validation · `reference/current-state-schema.md` § Schema gate · § Live-render evidence · § Signals |
| 3 | `reference/brand-surface.md` § Aggregation scope · § Palette (third-party chrome exclusion) · § System components · § Voice |
| 4 | `skills/stardust/reference/artifact-map.md` § Provenance shapes |
| 5 | `reference/brand-review-template.md` § Section contract · § Tensions |
| 6 | `skills/stardust/reference/state-machine.md` § File: `stardust/state.json` |
| opt-in | `reference/cross-site-sources.md` (both sections) · `reference/prep-mode.md` § 1–5 |

Headings: Inputs · Setup · Procedure · Cross-site brand sources · Sibling-site discovery · Outputs · Concurrency · Failure modes · Prep mode (--prep) · References

Crawl an existing website, parse each page, extract the brand surface,
and produce a stardust-formatted snapshot of the current state under
`stardust/current/`. The output describes what the site **is**; later
sub-commands consume it to decide what it **should be**.

This skill is **descriptive**: it does not invent direction, it does not
critique, and it does not modify the live site. It writes only under
`stardust/current/` and updates `stardust/state.json`.

## Inputs

- `<url>` — required. The origin to crawl. Examples: `https://example.com`,
  `https://example.com/shop`. A path scopes the crawl to that subtree
  (the path as typed; a redirected root entry is not scoped).
- `--cap <N>` (alias `--max`) — optional. Override the default 5-page
  cap (home + four IA pillars/templates). The small sample already
  feeds cross-page brand aggregation and the brand-review HTML; raise
  it only when a deeper crawl is needed.
- `--all` — optional. Lift the cap entirely; extract every
  discovered page after junk filtering. Equivalent to `--cap 0`.
- `--pages <path,path,...>` — optional. Crawl exactly these paths
  (`reference/ia-extraction.md` § Incremental re-runs). Bypasses the cap.
- `--refresh <slug,…>` / `--force` — optional. Re-extract the named
  pages / every page in scope; by default pages already `extracted`
  in `state.json` are skipped (`reference/ia-extraction.md`
  § Incremental re-runs).
- `--single` — optional. Equivalent to `--cap 1`.
- `--headed` — optional. Start the bot-management ladder at tier 2
  (`--headed=window`: tier 3); re-runs resume the recorded tier.
- `--depth <1-3>` — optional, default 1. BFS hops (in-page fetches)
  when no sitemap covers the scope; 1 under a bot block.
- `--cookie name=value[;Path=/]` — optional, repeatable. Seeds every
  context (age gates, region pins); names only are logged.
- `--mobile entry|all|none` — optional, default `entry`. Also shoot the
  page at 360×900 (`<slug>-360.png`, same page, no navigation); pass
  `all` for replica runs.
- `--dpr <n>` — optional, default 1 (D4: the gate captures at 1);
  recorded in `_provenance.dpr`.
- `--storage-state <file>` / `--fresh-state` — optional. Load a saved
  session into the probe / start clean; default: the reserved
  `stardust/current/_storage-state.json` when its cookies match the host.
- `--save-state` — optional, default off. Write the probe session to the
  reserved file even without a cleared challenge.
- `--solve-wait <ms>` — optional, unset by default (no interactive
  solve). Tier 3, window visible; wait for a human to clear the wall.
- `--wait <fast|medium|spec|auto>` — optional. Wait strategy per page.
  Default `medium`. See `reference/playwright-recipe.md` § Wait modes.
- `--no-junk-filter` — optional. Disable the default junk-page filter
  in discovery (see `reference/ia-extraction.md` § Filtering).
- `--no-consent-dismiss` — optional. Skip the pre-flight consent /
  cookie banner dismissal (see `reference/playwright-recipe.md`
  § Pre-flight: consent dismissal). Use when the redesign scope
  includes the consent surface or the dismissal's side-effects
  (script activation that wouldn't otherwise run) must be
  avoided. Default is to dismiss, keeping screenshots, voice
  aggregation, and per-section style unpolluted by the banner.
- `--dynamics` — optional, **migration-bound**. Record per-page reach
  signals of the dynamic surface (data endpoints, forms, modal
  triggers, player ids; tabs / expanders, shadow roots, empty `data-*`
  config containers, form-less control groups, search shells, chat
  loaders, federated modules, quizzes) in each page JSON `dynamic`
  section and roll them up in `_crawl-log.json#dynamicSurface`. Set by
  `prepare-migration`, `replica` and `migrate`'s safety net; never by a
  bare extract, `uplift` or `audit` — dynamics is a migration concern.
  Depth and classification belong to the stardust `dynamics` skill.
- `--concurrency <n>` — optional. Parallel browser contexts for the
  per-page capture loop. Default 4; sane range 4–8. See
  § Concurrency.
- `--brand-source <url>` — optional, repeatable. An additional
  **same-brand** origin whose brand surface enriches the primary
  extraction (shallow capture: home + up to 2 nav-linked pages).
  See § Cross-site brand sources.
- `--design-source <url>` — optional. Design-donor origin: its
  design system is captured to `stardust/canon-source/` and becomes
  the fixed redesign target while the primary origin supplies
  content. See § Cross-site brand sources.
- `--prep` — optional. Run in **migrate-prep mode**: lift the cap,
  type each page, detect module candidates, capture typed content
  slots, emit the prep summary. See § Prep mode below. Typically
  invoked via the `prepare-migration` orchestrator skill rather
  than directly.

## Setup

Run the master skill's setup procedure first
(`skills/stardust/SKILL.md` § Setup): impeccable dep check, context
loader, state read.

Additional checks for this sub-command:

1. **Playwright availability.** Detect a Playwright MCP server, else a
   project-importable `playwright` module — probe
   `node -e "import('playwright').then(()=>process.exit(0))"` from the
   project root (`npx playwright --version` is NOT sufficient: ESM
   ignores global installs and `NODE_PATH`). On failure run `node
   skills/stardust/scripts/preflight-runtime.mjs` (master Setup step 10):
   one `npm i --prefix stardust` into `stardust/node_modules`, which the EDS
   repo's own `npm i` never prunes (`skills/stardust/reference/runtime-preflight.md`
   § Resolution chain). Never `npm i … --no-save` in the EDS repo.
   **Script location matters.** ESM resolves from the *script's*
   directory and the plugin tree ships no `node_modules`: copy the six
   extract scripts byte-identical, as a set, into `stardust/scripts/`
   (the siblings import `./crawl.mjs` for the consent table and the
   validators) and run the copies.

   **Bundled crawler.** `skills/extract/scripts/crawl.mjs` is the
   runnable reference implementation of this sub-command (browser
   config, bot-management ladder, consent dismissal, wait + scroll,
   the full capture list, screenshots, response validation, the
   § Capture-hygiene hardening). Invoke the copy rather than
   hand-rolling a Playwright script; the schema gate names any field it
   fails to emit.
2. **Origin collision.** If `stardust/state.json` already records
   `site.originUrl` and the new `<url>` is a different origin, stop and
   ask before clobbering.
   **Flow guard (migration asks only).** If the ask carries migration
   intent ("migrate", "to EDS", "re-platform", "1:1", "replica") and
   `stardust/state.json` exists — or is about to be created — without
   `flow`, hand back to the master skill § Two migration flows before
   crawling: the flow is chosen and stamped there, and a keep-design
   ask enters through `replica` (which invokes this skill with `--prep`
   itself). A bare `extract <url>` for a redesign, audit or uplift is
   unaffected.
3. **Browser contexts.** Open a fresh `BrowserContext` per capture
   worker (§ Concurrency; default 4). Run the **consent dismissal
   pre-flight** per `reference/playwright-recipe.md` § Pre-flight:
   consent dismissal *unless* `--no-consent-dismiss`.
   `crawl.mjs` clones the probe context's `storageState` into every
   worker (clearance, consent and A/B cookies ride along), loads
   `stardust/current/_storage-state.json` when its cookies match the
   host (`--storage-state <file>` / `--fresh-state`) and saves it on a
   cleared challenge (again after a mid-crawl escalation) or `--save-state`
   — never tracked; fingerprint-bound
   clearances (PerimeterX/HUMAN) do not replay. Record the resolved method in
   `_crawl-log.json#consent.method` — one of `dismissed:<sel>`,
   `text:<label>`, `none-detected`, `failed` (`skipped` under
   `--no-consent-dismiss`); never `auto`. Replica's gate reads
   `dismissed:` / `text:` as its default `--consent`
   (`../replica/reference/source-fidelity-gate.md` § Hardening rule 6).
4. **Bot-management probe.** On a fingerprint reject or a challenge
   response at the first navigation, climb the escalation ladder in
   `reference/playwright-recipe.md` § Bot-management fallback (one
   hit per tier). `crawl.mjs` does this itself and records the winning
   tier in `_crawl-log.json#discovery.fetchTechnique`; re-runs start there.

## Procedure

### Phase 1 — Discovery

Discover the page inventory before crawling (`reference/ia-extraction.md`);
in summary:

1. `robots.txt` `Sitemap:` directives → `sitemap.xml` →
   `sitemap_index.xml` → CMS conventions; first non-empty tier wins,
   all fetched in-page; the probe page's nav links are always unioned.
2. Nothing under the scope → BFS from `<url>` (`--depth`, in-page
   hops). Census, candidates and `navOnly` are logged either way.
3. Filter: same origin only; drop `mailto:`, `tel:`, anchor-only
   links, query-only variations, asset paths (`.css`, `.js`, `.pdf`, images).
4. De-duplicate trailing-slash variations.
5. Apply the junk-page filter (`reference/ia-extraction.md` §
   Junk-page filter) unless `--no-junk-filter`; surface the filtered
   list as overridable.
6. Apply the cap (default 5, `--cap N`, or `--all`) and **proceed
   silently**: print what was kept and cut, do **not** gate on
   confirmation. Scope is set at command time:

   ```
   $stardust extract https://example.com              # default 5 pages
   $stardust extract https://example.com --all        # lift the cap
   $stardust extract https://example.com --pages /,/about,/pricing
   $stardust extract https://example.com --single     # just the entry URL
   ```

   Scope intent in the prompt ("extract all pages", "just home and
   pricing", "full crawl") maps to the equivalent flag; no
   re-confirmation once intent is clear.

   Informational output (not a prompt):

   ```
   Discovered 38 pages on https://example.com (sitemap.xml).
   Filtered as likely junk (5): /test/, /sample-page/, /holiday1/, ...
   Selecting 5 highest-priority pages:
     - / (home)
     - /about
     - /pricing
     - /products
     - /contact

   Cut (28 pages, --all to lift): /blog/post-1, /blog/post-2, ...

   Extracting...
   ```

   Selection heuristic: page-type checklist first, then score-based
   ranking (home + IA-pillar keywords + sitemap priority − archive /
   version markers). See `reference/ia-extraction.md` § Page
   selection and § Priority for the cap. The English-only keyword
   list is a known limitation for localized sites.

7. Write the discovered list to `stardust/current/_crawl-log.json`
   (created if absent) with `_provenance` and the full discovery
   reasoning, including `filteredAsJunk[]` and `userChoice`. This is
   an audit trail, not a state file.

### Phase 2 — Per-page extraction

For each page in the cap-respecting list, render with Playwright
following `reference/playwright-recipe.md`. Captures run
**concurrently** per § Concurrency. The recipe is
mandatory per page — in particular, do not skip the wait, scroll, or
capture-list steps:

- Viewport 1440 × 900 @ DPR 1 (`--dpr`, recorded)
- Wait per the configured wait mode (default `medium`; see § Wait
  modes in `reference/playwright-recipe.md`)
- Disable animations via `prefers-reduced-motion: reduce`
- After the wait resolves, scroll to bottom in 4 viewport-height
  steps with 300 ms pauses, then return to top — this is required
  to trigger lazy-load and IntersectionObserver-driven content
- Record `waitMs` and `waitMode` in the per-page `_provenance`

Capture per page (full schema in `reference/current-state-schema.md`):

- Page metadata (title, meta description, OG tags, theme-color)
- Semantic structure: heading outline (real `h1`–`h6` plus inferred
  display heads, `inferred: true`), landmarks with heading-bounded
  `children[]`, open shadow roots descended (`_signals.shadowRoots`)
- **Hero headline + lede (resolved)** — `heroHeadline` / `heroLede`
  by font-size × hero band with the junk filter and the
  meta-description fallback (§ Capture list 5-bis; the winning source
  is `_provenance.heroSource`).
- Content: full innerText per landmark (**no truncation**, § Capture
  list 7) and per section `body[]`, `lists[]`, `qa[]`, `quotes[]`,
  sanitised `richtext` (§ Capture list 7-bis) — the fields migrate
  renders real body copy from.
- CTA labels and href targets, link inventory (internal vs external)
- Per-section computed style summary: dominant colors, font families
  in use, spacing rhythm, border-radius, shadows
- Media inventory: `media.images[]` with `currentSrc`/`srcset`/
  `<source>` candidates **with query strings intact**, live `rect`,
  intrinsic dimensions and `resolves` read from the rendered state
  (never a second request), `inlineSvgs[]`, video/iframe rects →
  `embedDominance`, `cssBackgrounds[]` objects including the
  `::before`/`::after` walk (§ Capture list 11) so `background-image`
  heroes surface and broken CDN images are flagged before migrate
  ships `about:error`.
- Font files via network-intercept (§ Capture list 16) under
  `assets/fonts/` with `@font-face` descriptors and a licensing flag in
  `assets/_fonts-manifest.json` (Phase 3 copies it into `type.files[]`);
  icon fonts detected family-first from `::before`/`::after` glyphs
  (`_signals.iconFont`, § Capture list 17).
- Interactive elements: `forms[]` with labelled fields (always; the
  `--dynamics` reach shape comes from the same walk), `widgets`,
  `components`, `perSectionStyle[]`, `stats.motifs`
- Screenshots by the bundled crawler after the settle:
  `assets/screenshots/<slug>.png` (banded above 16,000 px, `clipped`
  fallback) and `<slug>-360.png` (`--mobile`); modes and the
  capture-quality flags (`emptyMain`, `subResourceBlock`,
  `overlayCoverPct`, `captureQuality`, `compatMode`) per
  `reference/current-state-schema.md` § Signals

- **Dynamic surface (only with `--dynamics`)** — per-page reach
  signals (families listed under the `--dynamics` flag above) in the
  page JSON `dynamic` section and `_crawl-log.json#dynamicSurface`
  (schema in `reference/current-state-schema.md § Dynamic`). Evidence
  only; the stardust `dynamics` sub-skill probes archetypes in depth
  and decides.

Save to `stardust/current/pages/<slug>.json` with `_provenance` as the
first key. **The bundled crawler also saves the settled rendered DOM
verbatim as `stardust/current/pages/<slug>.html`** (path in the
record's `renderedHtml` field). Capture once, parse offline (live
probes stay for geometry and computed styles). The render's own image
and font bodies are kept from the response stream (zero extra requests)
under `assets/media/` and `assets/fonts/` as `<basename>-<hash>.<ext>`
(`images[].localPath` | `downloadError`; `assets/_media-manifest.json`,
`assets/_fonts-manifest.json`). The ONE exception: the favicon set — at
most 8 icon URLs fetched once per run on the probe page →
`assets/icons/`, `assets/favicon-set.json`. `--assets full` adds capped
in-page fetches for CDN masters and unrequested candidates; `--no-assets`
disables both.

**Live-render evidence (synthesis is forbidden).** Refuse to mark
a page `extracted` in `state.json` unless its `_provenance`
contains `renderedBy: "playwright"`, an ISO-8601 `fetchedAt`, a
positive integer `waitMs`, a `waitMode` from the recipe, and a
final `httpStatus` in the 2xx/3xx range. These five fields are
the contract enforced by `reference/current-state-schema.md`
§ Live-render evidence and read back by every downstream phase
via `validateProvenance()` per
`skills/stardust/reference/state-machine.md` § Provenance
validation. Synthesizing a page record from brand JSON + URL
patterns + captured photos is the failure mode this guard prevents (§ Failure modes, synthesis).
A page that cannot satisfy the contract is a Phase 2 failure:
`_crawl-log.json#crawl.failures[]` with `errorClass:
"ProvenanceMissing"`; continue.

**Schema gate.** The crawler validates every record it writes
(`validate-page.mjs` re-runs the same check offline: exit 0 pass,
1 FAIL, 2 usage; `--legacy` admits pre-schema-2 records, never a
missing provenance field). A FAIL stays on disk as evidence, is logged
as `errorClass: "SchemaError"`, and is **not** marked `extracted`.
Hands-off: `--refresh <slug>` once, then `event: "blocked"` naming
the keys (`reference/current-state-schema.md` § Schema gate). Mark the page `extracted` in `state.json` after each
write that passed; record failures in `_crawl-log.json` and continue.

### Phase 2.5 — Vision verification

Before anything downstream is authored, **look** at each captured
page's screenshot (`assets/screenshots/<slug>.png`; the 360 shot only
for the entry page or when the 1440 verdict is not `ok`) and verify it
against the record: hero vs pixels, palette plausibility, a believable
`cssBackgrounds: []`, the logo, and that the page is rendered — not a
consent wall, bot-block or blank SPA shell. Three rules are code, not judgement (`_signals`, § Signals
in `reference/current-state-schema.md`;
`plugins/stardust/evals/lint/crawl-log-lint.mjs` fails a run that breaks them): a note naming a consent/modal/overlay/
scrim never carries `ok`; `DEGRADED` / `OVERLAY?` pages are re-crawled
(`--refresh <slug>`, one tier up for an edge block) before they are
looked at, then `recaptured` or `suspect`; `banded` is read band by
band and `clipped` is never `suspect` for its missing tail.

On mismatch, re-run that page's capture up the escalation ladder
before proceeding: wait mode one step (`reference/playwright-recipe.md`
§ Wait modes), then the next bot-management tier (§ Bot-management
fallback), then a fresh context. Record the outcome per page
in `_crawl-log.json#visionCheck[]`:

```json
{ "slug": "pricing", "verdict": "recaptured", "notes": "record said zero CSS backgrounds; screenshot shows a full-bleed photo hero" }
```

`verdict` is `"ok" | "recaptured" | "suspect"` — `suspect` means the
mismatch survived the ladder; downstream phases treat that record as
unreliable. Review captures from contact sheets, not one by one:
`node ../replica/scripts/review-image.mjs --sheet assets/screenshots
--per 12` writes `sheet-NN.png` + its `sheet-NN.json` legend;
one verdict per legend row, and open a full page (downscaled whole-page
view, `../stardust/reference/context-hygiene.md` § Image reads) only on
`suspect` / `recaptured` doubt. The heuristic defenses (low-media flag,
`spaShellSuspect`, duplicate hash) are cheap early signals, never gating
alone.

### Phase 3 — Brand-surface extraction

Run after Phases 2–2.5, offline over the page records — never a second
live pass:

    node stardust/scripts/brand-surface.mjs --out stardust/current --home index [--bounded | --full] [--lift <dir>] [--dry-run]

It writes `stardust/current/_brand-extraction.json` per
`reference/brand-surface.md` — palette (third-party chrome excluded via
crawl.mjs's consent table), type + modular-scale audit, spacing, motifs
from `stats.motifs`, componentStyle, system components, the logo chain
with its banner-wordmark step 1b, `origins[]`, voice / register
(home-only) — plus `assets/logo.svg` when the chain lands on an inline
SVG; `type.files[]` comes from `assets/_fonts-manifest.json` (absent →
`[]`, noted); the favicon is `_crawl-log.json#favicon`. Every value
cites its source. A `--pages` / `--single` crawl is detected as bounded
(`_provenance.mode: "bounded"`): voice, voiceTable, crossPromo and
register are omitted, never guessed — unless the crawl ran `--prep`
(`runs[].args.prep`) or `--full` is given. Exit 1 = no live page record.
Then read the printed notes (divergences, exclusions, skipped records)
and the file before Phase 4 — the script aggregates; you review.

### Phase 4 — Seed `stardust/current/PRODUCT.md` and `DESIGN.md`

The current-state PRODUCT.md and DESIGN.md are **descriptive, not
authored** — there is no interview to run because the user is not
defining intent here, the agent is describing the existing site. Seed
the tokens first — `node stardust/scripts/write-design-json.mjs --out
stardust/current` writes DESIGN.json (schemaVersion 2, frontmatter
tokens, `extensions`) from the brand surface (exit 2 without it); the
prose below is yours, written directly from impeccable's format specs:

- For PRODUCT.md, follow the section structure in impeccable's
  `reference/init.md` § Write PRODUCT.md. File order: stardust's
  `<!-- stardust:provenance … -->` block first (per
  `../stardust/reference/artifact-map.md` § Provenance, as for every
  file this skill writes), then `# Product`, then the
  `<!-- impeccable:product-schema 1 -->` comment verbatim, then
  `Platform` (`web`), `Users`, `Product Purpose`, `Positioning`,
  `Capabilities and Constraints`, `Brand Commitments`, `Evidence on
  Hand`, `Product Principles`, `Accessibility & Inclusion`; omit a
  section rather than pad it. Under `Brand Commitments` record the
  register guess from the brand surface (sites that read as
  marketing/landing → `brand`; tools/dashboards → `product`; ambiguous
  → `brand` with a note), the observed brand personality and the
  observed anti-references. `Evidence on Hand` lists what was captured
  under `stardust/current/` with paths. Populate `Users`, `Product
  Purpose`, `Positioning` and `Product Principles` from the captured
  copy and the brand surface. Where the agent must infer, mark the
  section with `_provenance: inferred` and a one-line basis sentence.
- For DESIGN.md, follow impeccable's `reference/document.md`; its
  frontmatter mirrors the DESIGN.json the script wrote.

Stardust does **not** invoke `$impeccable init` (formerly `teach`) or
`$impeccable document` for the current-state files: those commands write to project
root (the *target*) and run an interview. Stardust authors the
descriptive snapshot directly. The format spec from impeccable is the
contract; the runtime command is not.

The target-state PRODUCT.md and DESIGN.md at the project root are
written by `$stardust direct` in Phase 2 of the pipeline, not here.

### Phase 5 — Render `stardust/current/brand-review.html`

    node stardust/scripts/brand-review.mjs --out stardust/current [--dry-run]

renders the review per `reference/brand-review-template.md` — canonical
section order, brand-faithful chrome from the captured palette and
fonts, embedded CSS, no external JS or fonts (a font `<link>` the home
page already loads is mirrored), sticky nav, coverage callout — and
runs the 13 Tensions detectors, printing `T-xxx: fired|quiet`. Sections
without data are omitted, never fabricated; exit 2 when
`_brand-extraction.json` is missing or has no `_provenance`. It is the
first surface a human eyeballs before `direct`: open it; add nuanced
tensions on top of the mechanical baseline, never ship below it.

### Phase 6 — Update state and report

    node stardust/scripts/state-update.mjs --out stardust/current [--prep] [--legacy] [--vision <file>] [--dry-run]

merges `stardust/state.json` by slug (`site.*` incl.
`extractPhases{captured, visionChecked, brandSurface, docs, review,
scripts}`; `pages[]` → `extracted` + `currentStatePath` ONLY for records
that pass `validateProvenance()` + strict `validateRecord()` — the same
verdict as `validate-page.mjs`; `--legacy` admits pre-schema-2 records on
both, never a provenance field; every other key and entry preserved), appends one `status.jsonl` line (`6-state`,
`end` | `blocked`), records the Phase 2.5 verdicts given as
`--vision <file>` (`[{slug, verdict, notes}]`) into
`_crawl-log.json#visionCheck[]` (union by slug), and prints the
mandatory per-page evidence table (`slug live waitMode waitMs status
media(img/bg)`), wait summary and `Provenance: <live>/<total> live`.
A `no` row is an instrument fact: re-crawl once with `--refresh
<slug>` and re-run; never hand-edit the record. Under `--prep` the
script exits 1 when live < total (synthesis guard). Add
`state.json.designSource` yourself when `--design-source` was used.
Then print the one-screen summary: artefacts written, the script's
table verbatim, `⚠ low-media` where a brand page has `bg` 0 and no
raster ≥ 600 px wide, the coverage note, `Open
stardust/current/brand-review.html …`, `Next: $stardust direct`.

## Cross-site brand sources

Two opt-in flags widen extraction beyond the primary origin — **read
`reference/cross-site-sources.md` in full whenever either is present**
(merge rules and capture shapes live there):

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

After Phases 2–2.5, harvest candidate same-brand origins from evidence
**already captured** — no extra navigation:

- footer / nav links out to other properties
- "our brands" / "our companies" pages
- `hreflang` alternates on other domains
- subdomain families (`shop.`, `careers.`, country subdomains)
- `og:site_name` matches across captured pages

List candidates with confidence + the evidence line in the crawl
report and in `_crawl-log.json#siblingCandidates[]`:

```json
{ "origin": "https://example.co.uk", "confidence": "high", "evidence": "hreflang alternate on 4/5 pages", "decision": "included" }
```

- **Interactive:** propose — *"found 3 candidate sibling properties —
  include as `--brand-source`?"* — and proceed on the answer.
- **Hands-off** (`state.json.handsOff` is true): auto-include up to
  **2 high-confidence** candidates as brand-sources; record the
  decision in `siblingCandidates[].decision`.

Discovery is capped and cheap: harvesting reads captured evidence
only, and each included sibling gets the shallow brand-source
capture (≤ 3 pages). It must never balloon the crawl.

## Outputs

| Path                                        | Purpose                                             |
|---------------------------------------------|-----------------------------------------------------|
| `stardust/current/PRODUCT.md`               | Descriptive strategy of the existing site (impeccable format) |
| `stardust/current/DESIGN.md`                | Descriptive visual system (Stitch format)           |
| `stardust/current/DESIGN.json`              | Sidecar with extensions for motifs, voice, components |
| `stardust/current/brand-review.html`        | Self-contained visual review of the extraction (first eyeball-able artifact) |
| `stardust/current/pages/<slug>.json`        | Per-page parsed structure + content                 |
| `stardust/current/pages/<slug>.html`        | Settled rendered DOM (crawler sidecar; parse offline, never re-scrape) |
| `stardust/current/assets/logo.<ext>`        | Extracted logo                                      |
| `stardust/current/assets/favicon.<ext>`     | Site favicon (first-class asset; prototype head + deploy consume it) |
| `stardust/current/assets/{media,fonts,icons}/` | Harvested bodies (`_media-manifest.json`, `_fonts-manifest.json`, `favicon-set.json` beside them) |
| `stardust/current/assets/screenshots/`      | Per-page full-page screenshots, script-captured by `crawl.mjs` (Phase 2.5 vision gate + brand-review) |
| `stardust/current/_brand-extraction.json`   | Consolidated brand surface (palette, type, motifs, voice, system components) |
| `stardust/current/_crawl-log.json`          | Discovery + crawl audit trail (incl. `visionCheck[]`, `siblingCandidates[]`; `dynamicSurface` reach roll-up only with `--dynamics`) |
| `stardust/current/brand-sources/<host>/`    | Shallow same-brand captures (only with `--brand-source`) |
| `stardust/canon-source/`                    | Design-donor capture + descriptive DESIGN.md/json (only with `--design-source`) |
| `stardust/state.json`                       | Updated with site + per-page status (+ `designSource` stamp) |

## Concurrency

Page captures run **concurrently**: the Phase 2 queue is drained by
4–8 parallel browser contexts (`crawl.mjs --concurrency <n>`, default
4), each on the probe's cloned session (Setup step 3); Phase 3 may
aggregate incrementally as long as `_brand-extraction.json` reflects
every extracted page.

`crawl.mjs` paces every navigation per host and runs **one** worker
under a bot block or after a bare 429 (`reference/playwright-recipe.md`
§ Bot-management fallback has the classes; the ceilings live in the
script header); `stardust/.work/live-<host>.lock` refuses a second live
tool on the same origin (`STARDUST_LIVE_FORCE=1` overrides). `state.json`
itself is never locked — two extracts on one project stay
last-write-wins (`state-machine.md` § Concurrency).

## Failure modes

- **Network failure mid-crawl.** Continue, record in `_crawl-log.json`,
  end with a partial state. State.json reflects only successfully
  extracted pages. User can re-run; already-extracted pages are
  skipped unless `--refresh <slug,…>` / `--force`.
- **HTTP 4xx/5xx, non-HTML content, soft-404s.** Validated explicitly
  per `reference/playwright-recipe.md` § Response validation. Each
  produces a distinct error class (`HTTPError`, `ContentTypeError`,
  `EmptyPageError`) recorded in `_crawl-log.json#crawl.failures[]`.
  Failed pages do **not** appear in `state.json` as `extracted` —
  they appear only in the failure log. Without this validation a 5xx
  page silently lands as an empty success and propagates wrong data
  to `direct` and `prototype`.
- **Login wall.** Do not authenticate. If the home page redirects to
  a login screen, capture that one page, mark the rest unreachable,
  and ask how to proceed (`--cookie`, another entry URL, or public
  pages only).
- **Bot-management block (Akamai / Cloudflare / F5 / Imperva).**
  `ERR_HTTP2_PROTOCOL_ERROR` / `ERR_QUIC_PROTOCOL_ERROR`, a hang
  through the hard cap, or a 403/429/503 with an edge signature on the
  first navigation is fingerprinting or a managed challenge — not
  auth, not network. `crawl.mjs` climbs the ladder itself
  (`reference/playwright-recipe.md` § Bot-management fallback) at the
  probe and again when a worker is challenged mid-crawl, and exits 3
  when tier 3 is still challenged; only then say the origin needs an
  interactive solve (`--solve-wait <ms>` on crawl.mjs or any live
  instrument opens a visible window and waits for you) or a WAF allowlist. A page-level wall usually does
  NOT gate assets: the harvest rides the render's own responses.
- **JavaScript-only content.** Playwright already handles this. If
  the configured wait condition never fires within the mode's hard
  cap (`reference/playwright-recipe.md` § Wait modes), fall back to
  `domcontentloaded` and capture what is rendered. Record the
  fallback in the per-page `_provenance.waitMode` and surface in the
  wait-summary line of the final report.
- **Synthesis attempt (forbidden).** When a real Playwright render is
  impossible for a page (time, token budget, tool/network failure),
  the only correct outcome is a Phase 2 failure (`errorClass:
  "ProvenanceMissing"`) — never a record synthesized from
  `_brand-extraction.json` + URL patterns + captured photos: it is
  indistinguishable from a success and propagates fabricated content
  through every downstream phase.

## Prep mode (--prep)

When invoked with `--prep`, extract runs an extended pass that
prepares the inventory for migration — **read
`reference/prep-mode.md` in full before running any `--prep`
extraction**. Discovery-mode runs (without `--prep`) are unchanged:
small cap, no typing, no module detection.

Core contract (procedure, formats and detection rules in the reference):

- `--prep` implies `--all` — migration coverage requires the full
  junk-filtered inventory, not the discovery cap.
- Page types (`landing | article | listing | program | form |
  static | unique`) are LLM-inferred into `state.json.pages[].type`
  (discovery-mode runs leave `type` null); the user confirms in
  `direct --prep`.
- Module candidates (cross-page structural repeats, detected by the
  signal-source priority in the reference) are drafted under
  `DESIGN.json.extensions.modules[]` with `status: "candidate"`;
  per-page JSON gains a typed `slots` section per page-type.
- The prep summary replaces the Phase 6 report; `state-update.mjs
  --prep` prints its mandatory `Provenance: <live>/<total> live` line
  and exits 1 on any ratio short of `<total>/<total>` (synthesis guard;
  the run is incomplete).
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
- `scripts/validate-page.mjs`, `scripts/brand-surface.mjs`, `scripts/write-design-json.mjs`, `scripts/brand-review.mjs`, `scripts/state-update.mjs` — Phase 2 gate and Phases 3–6, copied with `crawl.mjs` as a set.
