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
| Setup 1–4 | `node -e "import('playwright').then(()=>process.exit(0))"`; copy `skills/extract/scripts/crawl.mjs` → `stardust/scripts/crawl.mjs` (+ `skills/stardust/scripts/progress.mjs` → `stardust/scripts/stardust/`); origin-collision and flow guard; consent pre-flight; bot-management probe | flow stamped before a migration crawl | `_crawl-log.json#consent`, `#discovery.fetchTechnique` |
| 1 Discovery | robots sitemaps → standard → conventions → nav union → BFS (`--depth`); subtree from the typed path; junk filter; cap via `--cap <N>` / `--all` / `--pages <slugs>` / `--single` | relay crawl's kept/cut summary; no gate | `stardust/current/_crawl-log.json` |
| 2 Per-page extraction | `node stardust/scripts/crawl.mjs --url <origin> [--pages …] [--cap N \| --all \| --single] [--refresh <slug,…> \| --force] [--headed] [--concurrency N] [--wait <mode>] [--dynamics] [--mobile <mode>] [--dpr N] [--depth N] [--cookie n=v] [--storage-state <file> \| --fresh-state] [--save-state] [--solve-wait <ms>] [--progress <file> \| --no-progress]` — in the background; `progress.mjs read stardust/.work/extract/crawl.progress.json`, then its `SUMMARY` line | live-render evidence contract; synthesis is a Phase 2 failure | `current/pages/<slug>.json` + `.html`, `assets/screenshots/<slug>.png`, `assets/media/`, `state.json` page → `extracted` |
| 2.5 Vision verification | look at each screenshot against its record; `_signals` flags first; escalation ladder (wait mode → next bot-management tier → fresh context); `node plugins/stardust/evals/lint/crawl-log-lint.mjs --dir stardust/current` | verdict `ok` / `recaptured` / `suspect`; never `ok` on DEGRADED / overlay | `_crawl-log.json#visionCheck[]` |
| 3 Brand-surface extraction | aggregate across all extracted pages (+ brand-source pages) | source citation per value | `current/_brand-extraction.json`, `assets/logo.<ext>`, `assets/favicon.<ext>` |
| 4 Seed current-state docs | author directly from impeccable's format specs (no `$impeccable init` / `document`) | provenance block first | `current/PRODUCT.md`, `current/DESIGN.md`, `current/DESIGN.json` |
| 5 Brand review | render per template; run the Tensions detectors | template mandatory; sections without data omitted | `current/brand-review.html` |
| 6 State and report | per-page evidence table (`live`, `waitMode`, `media(img/bg)`), wait summary, vision line | every row `live: yes` | `stardust/state.json` |
| opt-in | `--brand-source <url>` / `--design-source <url>`; sibling-site discovery; `--prep` (implies `--all`) | prep summary `Provenance: <live>/<total>` line | `current/brand-sources/<host>/`, `stardust/canon-source/`, `state.json.pages[].type` |

| at phase | read |
|---|---|
| Setup 1, 4 | `reference/playwright-recipe.md` § Browser configuration · § Bot-management fallback |
| Setup 3 | `reference/playwright-recipe.md` § Pre-flight: consent dismissal |
| 1 | `reference/ia-extraction.md` § Discovery order · § Junk-page filter · § Page selection · § Incremental re-runs · § `_crawl-log.json` shape |
| 2, 2.5 | `reference/playwright-recipe.md` § Wait modes · § Capture list · § Response validation · `reference/current-state-schema.md` § Live-render evidence · § Signals |
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
   project root. **`npx playwright --version` is NOT sufficient**: ESM
   resolution honours neither a global install nor `NODE_PATH`, so the
   scripts' `import 'playwright'` throws `ERR_MODULE_NOT_FOUND` where the
   CLI succeeds. On failure `npm i -D playwright --no-save
   --legacy-peer-deps` (the flag is required on `aem-boilerplate`
   targets, whose pinned `eslint@8` makes a plain `npm i` exit
   `ERESOLVE`). `--no-save` installs are ephemeral — a later real
   `npm i` prunes them — so every rendering skill (prototype, migrate,
   deploy, diff) re-runs the probe at its own start.
   **Script location matters.** ESM resolves from the *script's*
   directory and the plugin tree ships no `node_modules`: copy
   `crawl.mjs` byte-identical to `stardust/scripts/crawl.mjs` and run
   the copy.

   **Bundled crawler.** `skills/extract/scripts/crawl.mjs` is the
   runnable reference implementation of this sub-command — browser
   config + bot-management fallback, consent dismissal, wait + scroll,
   the capture list, per-page full-page screenshots
   (`assets/screenshots/<slug>.png`, the Phase 2.5 vision gate's
   input), response validation, and the § Capture-hygiene hardening
   (visibility filter, interstitial drop, SPA-shell flag, modal
   `textContent` capture, tracking-pixel discounting, cross-page
   duplicate detection). Invoke it (`node
   skills/extract/scripts/crawl.mjs --url <origin> [--pages …] [--cap N]
   [--concurrency N]`) rather than hand-rolling a Playwright script;
   extend its in-page `capture()` for any recipe field it does not
   yet emit.
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
   `reference/playwright-recipe.md` § Bot-management fallback
   (headless → real Chrome headless → real Chrome off-screen; one
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
- Semantic structure: heading outline, landmark roles, sections
- **Hero headline + lede (resolved)** — `heroHeadline` / `heroLede`
  picked by font-size × hero-region with a junk/hidden-state filter and
  a clean meta-description fallback (per `reference/playwright-recipe.md`
  § Capture list 5-bis). Required for JS-rendered sites whose
  document-order headings surface modal / promo / count junk
  instead of the real tagline.
- Content: visible text per section (full innerText, **no
  truncation** per `reference/playwright-recipe.md` § Capture
  list 7), structured paragraphs (`body[]`), lists, FAQ Q/A
  pairs, and review/testimonial quotes per
  § Capture list 7-bis. Without these structured fields,
  every body region under a heading falls back to placeholder
  signature at migrate time.
- CTA labels and href targets, link inventory (internal vs external)
- Per-section computed style summary: dominant colors, font families
  in use, spacing rhythm, border-radius, shadows
- Media inventory: img with `currentSrc`/`srcset` captured **with
  query strings intact** plus a `resolves` flag (HEAD/GET with browser
  UA + Referer), intrinsic dimensions, inline SVG count, video/iframe
  presence, `cssBackgrounds[]` (including pseudo-element `::before`/
  `::after` walks per § Capture list 11) so `background-image`
  heroes and motifs do not silently disappear and 404ing CDN
  images are flagged before migrate ships `about:error`.
- Font files captured via network-intercept (per § Capture list
  16): every `woff2`/`woff`/`ttf`/`otf` response saved under
  `assets/fonts/` and recorded in `_brand-extraction.json#type.files[]`
  with licensing flag.
- Icon-font detection (per § Capture list 17): when the page
  uses `[class^="icon-"]` with non-default `::before`
  font-family + codepoint, capture the family, save the file,
  and record the `iconClass → codepoint` table in
  `_brand-extraction.json#iconFont`.
- Interactive elements: forms (with field types), buttons, modals
  detected by ARIA roles
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
record's `renderedHtml` field). Capture once, parse offline: importers
and sibling generators iterate against this artifact instead of
re-running live probes per selector guess; live probes stay for
geometry and computed styles. Save referenced media to
`stardust/current/assets/media/` preserving basename plus a short
content hash.

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

Mark the page `extracted` in `state.json` immediately after each
successful page write. If a page fails, record the error in
`_crawl-log.json` and continue.

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

Run after Phases 2–2.5. Aggregation **may proceed incrementally** as
concurrent captures complete (§ Concurrency),
but the written file must reflect every extracted page — including
brand-source pages per § Cross-site brand sources.
Produces `stardust/current/_brand-extraction.json`
per `reference/brand-surface.md`. Some fields are home-only (logo,
voice samples, register heuristic); the visual tokens that drive
DESIGN.md (palette, radius, shadow, type) are aggregated across **all
extracted pages** to avoid the home-page bias documented in
`brand-surface.md` § Aggregation scope. Captures:

- **Logo** by the v1 priority chain: inline SVG → `<img>` with
  logo-ish class/id → `apple-touch-icon` → `og:image` → favicon →
  synthesized placeholder. Save to `stardust/current/assets/logo.<ext>`.
- **Favicon** — ALWAYS captured as its own asset (independent of the
  logo chain) to `stardust/current/assets/favicon.<ext>`, per
  `reference/playwright-recipe.md` § Favicon capture. Downstream,
  `prototype` embeds it in the proposed page head and `deploy` ships
  it to the Edge Delivery site.
- **Palette** — aggregate computed colors across **all extracted
  pages** (background, text, accents, borders, hovers). Frequency-sort,
  cluster near-duplicates, emit a role-named list (background, surface,
  text, primary, secondary, accent).
- **Type** — font families in use with their weights, sizes, and
  computed line-heights. Identify the heading family vs body family.
  Run the modular-scale audit (`brand-surface.md` § Modular-scale
  audit) and emit `scaleAudit.kind = "modular" | "ad-hoc"`.
- **Motifs** — signature border-radius (cross-page mode of non-zero
  values, weighted by element count), shadow stack (top 3 distinct,
  cross-page), gradient inventory, common patterns (chip, badge,
  card, hero-with-image). When the home-only mode disagrees with the
  cross-page mode, surface the divergence in `_provenance.notes`.
- **Voice samples** — first paragraph of body copy, the hero headline,
  3 representative CTA labels, a representative link list. Used by
  `direct` later but extracted now so the network round-trip is over.
- **Hero image** — elevate the home page's primary visual
  asset to `voice.heroImage` (per `reference/brand-surface.md`
  § heroImage resolution), so downstream prototype picks the
  live hero rather than the `og:image` from the raw media list.
- **Hero medium (signature)** — when the hero/first viewport carries a
  *moving* asset (background `<video>` / HLS / canvas / WebGL /
  Lottie / animated SVG / scroll-driven motion), elevate it to
  `voice.heroMedium` (per `reference/brand-surface.md` § heroMedium
  resolution). This is the page's **signature**; without elevation
  downstream prototype flattens it to a static hero. A non-null
  `heroMedium` triggers signature
  preservation (`skills/stardust/reference/intent-dimensions.md`
  § 8b) at prototype time.
- **Icon font** — when detected per `reference/playwright-recipe.md`
  § Capture list 17, populate `_brand-extraction.json#iconFont`
  with family, file path, and the `iconClass → codepoint`
  table so prototypes can render the brand's actual icons.
- **System components** — cross-page repeated DOM blocks (site
  header, site footer, cross-promo strips, persistent CTAs,
  breadcrumbs). Detected by heading-sequence + CTA-label fingerprint
  per `reference/brand-surface.md` § System components. Required —
  these are usually the most load-bearing surfaces and must not
  silently disappear from the redesign target.
- **Origins** — one entry per contributing origin in
  `_brand-extraction.json#origins[]` per `reference/brand-surface.md`
  § Origins. Single-origin runs emit a one-entry array; brand-source
  runs attribute widened evidence per origin.

Do not invent values. Every captured value cites a source selector or
URL in `_brand-extraction.json` for traceability.

### Phase 4 — Seed `stardust/current/PRODUCT.md` and `DESIGN.md`

The current-state PRODUCT.md and DESIGN.md are **descriptive, not
authored** — there is no interview to run because the user is not
defining intent here, the agent is describing the existing site. Write
them directly using impeccable's format specs:

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
- For DESIGN.md and DESIGN.json, follow the format spec in
  impeccable's `reference/document.md`. Populate frontmatter
  (`colors`, `typography`, `rounded`, `spacing`, `components`) from
  the captured tokens. The `extensions` block of DESIGN.json carries
  v1's `componentStyle`, `motifs`, and `voice` arrays so nothing is
  lost.

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
2. Print a one-screen summary:
   ```
   Extracted https://example.com (5/38 pages, sitemap.xml)

   stardust/current/
     PRODUCT.md, DESIGN.md, DESIGN.json, brand-review.html,
     pages/ (5), assets/logo.svg, _brand-extraction.json, _crawl-log.json

   Per-page evidence:
     slug         live  waitMode               waitMs   status  media(img/bg)
     /            yes   medium                 2380     200     38/6
     /pricing     yes   medium                 1940     200     9/0   ⚠ low-media
     /contact     yes   domcontentloaded(fb)   8000     200     3/0
     ...

   Wait summary: 4 resolved at medium (avg 2.4s), 1 fallback (timed out at 8s)
     → /contact may be under-captured; consider --refresh
   Media summary: 1 page flagged low-media (/pricing) — see media-coverage check
   Vision check: 4 ok, 1 recaptured (/pricing) — _crawl-log.json#visionCheck

   Open stardust/current/brand-review.html to verify the extraction
   before running $stardust direct.

   Coverage note: extracted 5 of 38 discovered pages; 5 pages
   covering distinct templates is usually sufficient for the
   cross-page brand surface. Widen with --cap <N> or --pages.

   Next: $stardust direct  (resolve a redesign direction)
   ```

   The **per-page evidence table** is mandatory. `live` is `yes` when
   `_provenance.renderedBy === "playwright"` AND `waitMs > 0`, else
   `no` — the visible defense-in-depth signal for the synthesis
   failure the write-time guard prevents; every row should read `yes`.
   Wait summary: group `_provenance.waitMode`, average `waitMs`; slugs
   whose mode ends in `(fallback)` (`(fb)` in the table) are `--refresh`
   candidates.

   **`media(img/bg)`** prints `<media.imgs> / <media.cssBackgrounds>`
   counts. Flag `⚠ low-media` when a brand/marketing page (register
   `brand`, or a landing/solution/product template) has
   `cssBackgrounds: []` **and** no raster ≥ 600 px wide — the signature
   of a silently failed background / lazy-media walk. Re-run the row
   with `--refresh`, then up the ladder; a
   `brand`-register site with all-zero `bg` counts is suspect, not
   "uses no background images".

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
| `stardust/current/assets/media/`            | Extracted media referenced by pages                 |
| `stardust/current/assets/screenshots/`      | Per-page full-page screenshots, script-captured by `crawl.mjs` (Phase 2.5 vision gate + brand-review) |
| `stardust/current/_brand-extraction.json`   | Consolidated brand surface (palette, type, motifs, voice, system components) |
| `stardust/current/_crawl-log.json`          | Discovery + crawl audit trail (incl. `visionCheck[]`, `siblingCandidates[]`; `dynamicSurface` reach roll-up only with `--dynamics`) |
| `stardust/current/brand-sources/<host>/`    | Shallow same-brand captures (only with `--brand-source`) |
| `stardust/canon-source/`                    | Design-donor capture + descriptive DESIGN.md/json (only with `--design-source`) |
| `stardust/state.json`                       | Updated with site + per-page status (+ `designSource` stamp) |

## Concurrency

Page captures run **concurrently**: the Phase 2 queue is drained by
4–8 parallel browser contexts (`crawl.mjs --concurrency <n>`, default
4), each on the probe's cloned session (Setup step 3); media
`resolves` / HEAD checks batch with `Promise.all`; Phase 3 may
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
  NOT gate assets: probe one media/CSS/font URL with a browser-UA curl
  before reaching for in-page fetch (the fallback, not the default).
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
small cap, no typing, no module detection. The flag is intended for
the `prepare-migration` orchestrator, though direct invocation is
supported.

Core contract (procedure, formats, and detection rules in the
reference):

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
