# stardust:extract: phase 3, brand-surface extraction

The text of this part of `skills/extract/SKILL.md`, which points here. "Above" and "below" refer to the order of the sections in that file.

### Phase 3 — Brand-surface extraction

**Computed-style census — run the shipped instrument; author no
probe.** `node <plugin>/skills/extract/scripts/style-census.mjs`
(copied into the project like `crawl.mjs`, § Setup) measures every
captured page at 1440 and writes
`stardust/current/_computed-styles.json`; add `--width 360` when the
breakpoints include it. One more live pass over every page — run it
ONCE, after the crawl, in the background; it opens the live side
through the shared `browser.mjs` like every other live instrument. Read the
palette, type, motif and hover values from the file's `aggregate` and
cite each from its `sources[]` (`url`, `selector`, `prop`); the
per-page detail sits under `pages[url][width]`.

**Content-cap model — run the shipped probe; author no lift (#124).**
`node stardust/scripts/replica/cap-probe.mjs <archetype-url>… --write-design
stardust/current/DESIGN.json` (replica's script; it needs the master skill's scripts copied too)
renders each archetype at 1440 and at a DERIVED wide width —
max(2560, largest cap × 1.25); a probe AT a cap's width cannot see it — and
records every box that stops growing (kind `shell` / `content` / `module`,
px, authored via, tier) into `extensions.breakpoints`: `containerMaxWidth`
(the `--max-width` source; null when fluid), `probeWidth`, `caps[]`,
`modules[]`. One navigation per archetype after the census (never beside
it), once DESIGN.json is authored (it merges). A cap on the shell or
on every archetype is design intent whatever its value; `capRegister` lists
single-module or archetype-divergent caps for the inconsistency register.
The cap model never records layout breakpoints: a redesign target keeps its own two;
replica keeps the source's, or maps them to `--target-breakpoints`.
Captures:

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
