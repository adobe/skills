---
name: extract
description: Crawl an existing website (capped, multi-page) and seed stardust/current/ with PRODUCT.md, DESIGN.md, DESIGN.json, a per-page inventory, and the consolidated brand surface.
license: Apache-2.0
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

- `<url>` — required. The origin to crawl. Examples: `https://example.com`,
  `https://example.com/shop`. A path narrows the same-origin crawl to
  that subtree.
- `--cap <N>` — optional. Override the default 5-page cap. The cap
  is intentionally small — a 5-page sample (home + four IA
  pillars/templates) is enough for cross-page brand aggregation,
  system-component detection, and the brand-review HTML to do
  useful work. Lift the cap with `--cap 25` (the previous default)
  or higher when a deeper crawl is genuinely needed.
- `--all` — optional. Lift the cap entirely; extract every
  discovered page after junk filtering. Equivalent to `--cap 0`.
  Use when the user spontaneously asks for a full crawl.
- `--pages <slug,slug,...>` — optional. Restrict the crawl to specific
  paths (slugs derived per `reference/ia-extraction.md`). Bypasses
  the cap.
- `--refresh <slug>` — optional. Re-extract one page that already exists
  in `state.json`.
- `--single` — optional. Equivalent to `--cap 1`. Useful for testing.
- `--wait <fast|medium|spec|auto>` — optional. Wait strategy per page.
  Default `medium`. See `reference/playwright-recipe.md` § Wait modes.
- `--no-junk-filter` — optional. Disable the default junk-page filter
  in discovery (see `reference/ia-extraction.md` § Filtering).
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

1. **Playwright availability.** The extraction step needs a real
   browser. Detect Playwright in this order: a Playwright MCP server,
   then `npx playwright`. If neither is available, stop and tell the
   user how to install Playwright.
2. **Origin collision.** If `stardust/state.json` already records
   `site.originUrl` and the new `<url>` is a different origin, stop and
   ask before clobbering. Stardust does not silently mix two sites in
   one project.

## Procedure

### Phase 1 — Discovery

Discover the page inventory before crawling. Procedure in
`reference/ia-extraction.md`. In summary:

1. Fetch `<origin>/sitemap.xml`, then `<origin>/sitemap_index.xml`,
   then check `robots.txt` for `Sitemap:` directives.
2. If no sitemap is reachable, run a same-origin BFS crawl from
   `<url>`, depth-limited to 3, link-extracting from rendered HTML.
3. Filter the discovered URL list: same origin only, exclude
   `mailto:`, `tel:`, anchor-only links, query-only variations,
   common asset paths (`.css`, `.js`, `.pdf`, image extensions).
4. De-duplicate trailing-slash variations.
5. Apply the junk-page filter (`reference/ia-extraction.md` §
   Junk-page filter) unless `--no-junk-filter` is set. Surface the
   filtered list to the user as overridable.
6. Apply the cap (default 5, or `--cap`, or `--all` for no cap)
   and **proceed silently**. Print an informational summary of
   what was kept and what was cut — but do **not** gate on user
   confirmation. The default cap is small enough that the common
   case is "extract 5 pages and move on"; pausing for a yes/no
   reply on every run is friction without value. Users who want
   different scope set it spontaneously at command time:

   ```
   $stardust extract https://example.com              # default 5 pages
   $stardust extract https://example.com --cap 25     # bump to 25
   $stardust extract https://example.com --all        # lift the cap
   $stardust extract https://example.com --pages home,about,pricing
   $stardust extract https://example.com --single     # just the entry URL
   ```

   The agent reads spontaneous scope intent from the user's prompt
   (e.g. "extract all pages", "look at just the home and pricing",
   "do a full crawl") and applies the equivalent flag. No
   re-confirmation needed once intent is clear.

   Informational output (not a prompt — proceed immediately):

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
following `reference/playwright-recipe.md`. The recipe is mandatory —
in particular, do not skip the wait, scroll, or capture-list steps:

- Viewport 1440 × 900 @ 2× DPR
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
- Content: visible text per section, CTA labels and href targets,
  link inventory (internal vs external)
- Per-section computed style summary: dominant colors, font families
  in use, spacing rhythm, border-radius, shadows
- Media inventory: img/srcset with original URLs and intrinsic
  dimensions, inline SVG count, video/iframe presence
- Interactive elements: forms (with field types), buttons, modals
  detected by ARIA roles

Save to `stardust/current/pages/<slug>.json` with `_provenance` as the
first key. Save referenced media to `stardust/current/assets/media/`
preserving basename plus a short content hash.

Mark the page `extracted` in `state.json` immediately after each
successful page write. If a page fails, record the error in
`_crawl-log.json` and continue — extraction is best-effort per page.

### Phase 3 — Brand-surface extraction

Run once, **after Phase 2 has finished**, so cross-page aggregation
has data to work with. Produces `stardust/current/_brand-extraction.json`
per `reference/brand-surface.md`. Some fields are home-only (logo,
voice samples, register heuristic); the visual tokens that drive
DESIGN.md (palette, radius, shadow, type) are aggregated across **all
extracted pages** to avoid the home-page bias documented in
`brand-surface.md` § Aggregation scope. Captures:

- **Logo** by the v1 priority chain: inline SVG → `<img>` with
  logo-ish class/id → `apple-touch-icon` → `og:image` → favicon →
  synthesized placeholder. Save to `stardust/current/assets/logo.<ext>`.
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
- **System components** — cross-page repeated DOM blocks (site
  header, site footer, cross-promo strips, persistent CTAs,
  breadcrumbs). Detected by heading-sequence + CTA-label fingerprint
  per `reference/brand-surface.md` § System components. Required —
  these are usually the most load-bearing surfaces and must not
  silently disappear from the redesign target.

Do not invent values. Every captured value cites a source selector or
URL in `_brand-extraction.json` for traceability.

### Phase 4 — Seed `stardust/current/PRODUCT.md` and `DESIGN.md`

The current-state PRODUCT.md and DESIGN.md are **descriptive, not
authored** — there is no interview to run because the user is not
defining intent here, the agent is describing the existing site. Write
them directly using impeccable's format specs:

- For PRODUCT.md, follow the section structure in impeccable's
  `reference/teach.md`. Populate `Register` from the brand surface
  (sites that read as marketing/landing → `brand`; tools/dashboards →
  `product`; ambiguous → `brand` with a note). Populate `Users`,
  `Product Purpose`, `Brand Personality`, `Anti-references`, and
  `Design Principles` from the captured copy and the brand surface.
  Where the agent must infer, mark the section with `_provenance:
  inferred` and a one-line basis sentence.
- For DESIGN.md and DESIGN.json, follow the format spec in
  impeccable's `reference/document.md`. Populate frontmatter
  (`colors`, `typography`, `rounded`, `spacing`, `components`) from
  the captured tokens. The `extensions` block of DESIGN.json carries
  v1's `componentStyle`, `motifs`, and `voice` arrays so nothing is
  lost.

Stardust does **not** invoke `$impeccable teach` or `$impeccable
document` for the current-state files: those commands write to project
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
verify the extraction before committing to a redesign direction.
Misreads in the JSON (a wrong dominant radius, a missing system
component, a single-page palette bias) are obvious to the eye in five
seconds and invisible in JSON until someone notices. Putting the
review at the end of `extract` catches misreads while they are still
cheap to fix — re-extract is fast; re-direct + re-prototype is not.

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
2. Print a one-screen summary:
   ```
   Extracted https://example.com (5/38 pages, sitemap.xml)

   stardust/current/
     PRODUCT.md            (register: brand, inferred from landing)
     DESIGN.md             (5 colors, 2 type families, 3 motifs)
     brand-review.html     (4 tensions surfaced)
     pages/                (5 files)
     assets/logo.svg       (extracted from inline SVG)
     _brand-extraction.json
     _crawl-log.json

   Wait summary: 4 resolved at medium (avg 2.4s), 1 fallback (timed out at 8s)
     → /donate/ may be under-captured; consider --refresh

   Open stardust/current/brand-review.html to verify the extraction
   before running $stardust direct.

   Coverage note: extracted 5 of 38 discovered pages. The brand
   surface and brand-review use cross-page aggregation, so 5 pages
   covering distinct templates is usually sufficient. To extract
   more, re-run with --cap <N> (e.g. --cap 25) or list specific
   slugs with --pages.

   Next: $stardust direct  (resolve a redesign direction)
   ```

   Compute the wait summary by grouping each page's `_provenance.waitMode`
   and averaging `waitMs`. List slugs whose `waitMode` ends in
   `(fallback)` as candidates for `--refresh`.

## Outputs

| Path                                        | Purpose                                             |
|---------------------------------------------|-----------------------------------------------------|
| `stardust/current/PRODUCT.md`               | Descriptive strategy of the existing site (impeccable format) |
| `stardust/current/DESIGN.md`                | Descriptive visual system (Stitch format)           |
| `stardust/current/DESIGN.json`              | Sidecar with extensions for motifs, voice, components |
| `stardust/current/brand-review.html`        | Self-contained visual review of the extraction (first eyeball-able artifact) |
| `stardust/current/pages/<slug>.json`        | Per-page parsed structure + content                 |
| `stardust/current/assets/logo.<ext>`        | Extracted logo                                      |
| `stardust/current/assets/media/`            | Extracted media referenced by pages                 |
| `stardust/current/assets/screenshots/`      | Per-page viewport screenshots (used by brand-review) |
| `stardust/current/_brand-extraction.json`   | Consolidated brand surface (palette, type, motifs, voice, system components) |
| `stardust/current/_crawl-log.json`          | Discovery + crawl audit trail                       |
| `stardust/state.json`                       | Updated with site + per-page status                 |

## Concurrency

Per `state-machine.md`: stardust does not lock. Two concurrent extracts
on the same project are last-write-wins. Document this in the user
report; do not engineer around it.

## Failure modes

- **Network failure mid-crawl.** Continue, record in `_crawl-log.json`,
  end with a partial state. State.json reflects only successfully
  extracted pages. User can re-run; already-extracted pages are
  skipped unless `--refresh <slug>`.
- **HTTP 4xx/5xx, non-HTML content, soft-404s.** Validated explicitly
  per `reference/playwright-recipe.md` § Response validation. Each
  produces a distinct error class (`HTTPError`, `ContentTypeError`,
  `EmptyPageError`) recorded in `_crawl-log.json#crawl.failures[]`.
  Failed pages do **not** appear in `state.json` as `extracted` —
  they appear only in the failure log. Without this validation a 5xx
  page silently lands as an empty success and propagates wrong data
  to `direct` and `prototype`.
- **Login wall.** Do not attempt to authenticate. If the home page
  redirects to a login screen, capture that one page, mark the rest as
  unreachable, and ask the user how to proceed (provide cookies via
  Playwright config, change the entry URL, or scope to public pages).
- **JavaScript-only content.** Playwright already handles this. If
  the configured wait condition never fires within the mode's hard
  cap (`reference/playwright-recipe.md` § Wait modes), fall back to
  `domcontentloaded` and capture what is rendered. Record the
  fallback in the per-page `_provenance.waitMode` and surface in the
  wait-summary line of the final report.

## Prep mode (--prep)

When invoked with `--prep`, extract runs an extended pass that
prepares the inventory for migration. Discovery-mode runs (without
`--prep`) are unchanged: small cap, no typing, no module detection,
presales-friendly. `--prep` is the gesture that says "the user is
committing to migrate; build the data structure migrate consumes."

`--prep` adds five things on top of the standard procedure:

### 1. Lift the cap

`--prep` implies `--all`. Migration coverage requires the full
inventory — the small discovery cap (5 pages) is insufficient. The
cap-respecting selection logic from `reference/ia-extraction.md`
§ Page selection still applies for ordering and junk-filtering;
it just doesn't truncate.

### 2. Page typing

For each extracted page, infer the `type` field from URL pattern
and content shape (LLM judgment). Catalog from
`skills/stardust/reference/state-machine.md` § Page types:
`landing | article | listing | program | form | static | unique`.

Write the inferred type to `state.json.pages[].type`. The user
confirms or refines during `direct --prep`. Discovery-mode runs
leave `type` as `null`.

### 3. Module candidate detection

After Phase 3 (brand-surface extraction), scan extracted pages for
**recurring structural patterns**. A pattern that appears in N+
pages with similar shape (same sequence of elements, same
`data-section` / `data-purpose`, similar text shape) is surfaced
as a module candidate.

Candidate output is a draft entry under
`DESIGN.json.extensions.modules[]`:

```json
{
  "id": "candidate-<short-hash>",
  "slots": [
    { "name": "<inferred>", "type": "text|link|image|...", "required": false }
  ],
  "instances": [
    { "slug": "home",   "selector": "..." },
    { "slug": "donate", "selector": "..." }
  ],
  "status": "candidate"
}
```

The `status: "candidate"` flag distinguishes draft entries from
confirmed modules. `direct --prep` is where the user names them
and promotes (or prunes).

### 4. Typed content slots

Per-page JSON (`current/pages/<slug>.json`) gains a `slots`
section that identifies content slots per page-type:

- `article` pages: `headline`, `deck`, `byline`, `meta`,
  `lead-image`, `body`, `pullquotes[]`, `related[]`
- `listing` pages: `index-headline`, `filter-controls`,
  `card-grid` with typed sub-slots per card
- `program` pages: `program-headline`, `summary`,
  `feature-grid`, `cta-band`
- `landing`, `form`, `static` — typed slots inferred per
  content shape

Schema additions live in `reference/current-state-schema.md`
§ Typed slots (extend that doc separately).

### 5. Prep summary

Replace Phase 6's standard report with the prep summary format:

```
extract --prep complete
=======================

Inventory:    127 pages crawled (5 prior, 122 new)
Page types:   landing 1 · article 84 · listing 6 · program 12 · form 3 · static 18 · unique 3
              (LLM-inferred; refine in direct --prep)

Module candidates: 8
  hotline-211         5 instances  (home, get-help, donate, news, programs)
  donate-band         12 instances (home, donate, news, all article footers)
  story-card          7 instances  (home, news, programs)
  ...

Typed slots:  filled per page-type (see current/pages/<slug>.json § slots)

Next: $stardust direct --prep  (confirm types, name modules)
```

Default mode (no `--prep`) is unchanged. The flag is intended for
the `prepare-migration` orchestrator, though direct invocation is
supported.

## References

- `reference/playwright-recipe.md` — viewport, capture list, logo locator chain.
- `reference/ia-extraction.md` — sitemap + BFS crawl + cap procedure.
- `reference/current-state-schema.md` — per-page JSON schema.
- `reference/brand-surface.md` — consolidated brand-surface schema.
- `reference/brand-review-template.md` — current-state brand-review HTML contract + Tensions detectors.
- `skills/stardust/reference/state-machine.md` — state.json contract.
- `skills/stardust/reference/artifact-map.md` — provenance shape.
