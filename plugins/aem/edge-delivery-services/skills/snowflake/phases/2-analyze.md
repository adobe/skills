# Phase 2 — Analyze

Goal: produce a structural map, a conversion-level recommendation,
and a list of decisions that Generate needs. Decisions are written as
both human prose (in `notes.md`) and a machine-readable artifact
(`decisions.json`) — Generate reads the latter so it doesn't have to
re-parse the prose.

## Knowledge to load

Before making decisions, load (using the override-then-bundled
resolution from `SKILL.md`):
- `methodology.md` §2 (Analyze) — the canonical rules
- `learnings.md` — at minimum skim for entries about structural
  patterns, generator-specific quirks, and known disambiguator rules
- `block-level-feasibility.md` — the five checks for block-level
  conversion (structure, CSS scope, content model, JS independence,
  visual independence)

Resolution: check `.snowflake/knowledge/<file>.md` first (project
override), then `<SKILL_DIR>/knowledge/<file>.md` (bundled).
Don't re-derive things that are documented.

## What to inspect in the source

For the HTML at `<projectsDir>/<NNN>-<slug>/input/index.html`:

1. **Header boundary** — everything from `<body>` start until the
   first content section. Often broader than just `<header>`:
   announcement banners, mega-navs, sticky breadcrumbs all belong
   here. Some sources have no `<header>` tag at all and use a
   `<div class="nav-wrap">` or similar instead — the fragment name
   stays "header" regardless of the source tag.

2. **Footer boundary** — everything from the last content section to
   `</body>` (minus scripts). Often includes sticky CTAs, modal
   markup, etc.

3. **Main sections** — each top-level `<section>` between header and
   footer is a candidate block. If a logical section uses a different
   tag (`<div class="hero-scroll">`), record it — Generate will
   rewrite the outermost element to `<section>`. The substrate engine
   only matches `section[class]`.

4. **First-class collisions** — if multiple sections share their
   first class (e.g. two `<section class="section">`), pick a
   disambiguator from this priority list:
   1. `data-section` attribute (Stardust convention)
   2. `id` attribute on the section
   3. Slug from the most prominent eyebrow / label inside
   4. Positional: `section-N`

5. **Slot opportunities per section** — for each block (include ALL
   elements regardless of CSS visibility — hidden tab panels, collapsed
   accordions, inactive carousel slides all contain authorable content):
   - Text in headings, paragraphs, button labels → text slot
   - `<img>` / `<picture>` → image / picture slot
   - `<a>` with text and href → link slot (NOT if the link wraps
     other to-be-slotted children — see learnings: "container vs.
     children" rule)
   - **Mixed-content links**: for each `<a>` identified as a slot
     candidate, inspect children. If the `<a>` contains `<svg>`,
     decorative `<img>`, icon-font `<span>`, or other non-text
     children alongside the authorable text, mark the slot as
     `"mixedContent": true` in `decisions.json`. Generate (Phase 3)
     will use the span-wrapper pattern instead of a direct link slot.
     See learnings entry "link slots with inline decorative elements".
   - Decorative SVGs, icons, hardcoded glyphs → static (not slots)
   - Generator-emitted placeholders (e.g. `data-placeholder="true"`)
     → mark with `data-slot-skip="placeholder"`, never authorable
   - Background-image slots: any element with inline
     `style="background-image:url(…)"` becomes a slot via the
     background-image writer case in the substrate

6. **Head-level resources to lift** into the template's top — font
   preconnects, Google Fonts stylesheets, CDN preconnects. The
   overlay engine copies top-level `<link>`s from the template
   into `<head>` at runtime. List them; Generate will emit them.

7. **Inline `<style>` blocks** — extract to `/styles/<template>.css`.

8. **Inline `<script>` blocks** — extract to
   `/scripts/<template>-animations.js`. The engine HEAD-probes this
   path; 404 is silent.

9. **External libraries** — note any `<script src="...">` for
   third-party libs (Lenis, GSAP, etc.). Decide per-lib whether to:
   - Vendor in repo under `/scripts/<template>-<libname>.js`
   - Reference a public CDN
   - Concatenate into the per-template animations file

10. **Asset references** — count all relative paths
    (`assets/...`, `./images/...`, etc.) and absolute paths to
    external hosts. Decide the asset strategy:
    - **Public source host**: rewrite to absolute URLs pointing at
      that host
    - **Local-only source host** (`localhost`, `127.0.0.1`): two
      paths — vendor to `/assets/` in the repo (proven; ~38 MB
      acceptable for one-off bespoke), or migrate to DA `/media/`
      (out of scope unless asked). Default: vendor.
    - **NOTE**: image URLs INSIDE DA cells must be absolute even
      when template/fragment refs are root-relative (Media Bus
      requires absolute). See `knowledge/learnings.md` 2026-05-19
      Media Bus entry.

## Produce `notes.md`

Append to (or create) the project's `notes.md` with this structure:

```markdown
# Notes — <NNN> <slug>

## Phase: Capture
(summary of what was fetched)

## Phase: Analyze

### Structural map

```
Line   Element
─────  ──────────────────────────────────────
...    (annotated tree from header → footer)
```

### Differences from prior runs

(comparison table or prose — what's new here)

### Decisions surfaced by analysis

1. (numbered decisions for Generate to act on)
```

## Block-level feasibility assessment

After completing the structural inspection above, run the five checks
from `block-level-feasibility.md` on each content section (excluding
header/footer). This assessment always runs regardless of the `level`
parameter — the results are recorded in `decisions.json` and
`notes.md` for every run.

For each content section, evaluate:

1. **Structure** — clear boundary with unique class?
2. **CSS scope** — rules scoped to this section's class?
3. **Content model** — maps to DA block table rows (text, images, links)?
4. **JS independence** — no cross-section JavaScript coupling?
5. **Visual independence** — own background, no overlapping positioned elements?

Record the per-section results and derive a recommendation:

| Result | Recommendation |
|--------|---------------|
| All sections pass all 5 | `block-level` |
| Most pass, 1–2 fail | `hybrid` |
| Most fail | `page-level` |

### Page complexity gate

After counting sections and slots, check whether the page is too large
for reliable page-level conversion. Page-level requires the LLM to hold
the entire page in context at once — large pages with many sections or
deeply nested interactive components (tabs, accordions, carousels) risk
silent content loss from context pressure and repetitive-structure
fatigue. Block-level processes one section at a time and does not have
this limitation.

**Thresholds** (either triggers the gate):
- More than **8 content sections** (excluding header/footer)
- More than **100 slottable elements** across all sections

**Behavior when the gate fires:**

| `level` param | Action |
|---------------|--------|
| `page` (the default, or inferred from neutral phrasing) | **Auto-switch to `block`.** Log in `notes.md`: "Page has N sections / M slots — exceeds page-level thresholds. Auto-switched to block-level." Record `levelParam` = `page`, `conversionLevel` = `block-level`, `complexityGate` = `triggered` in `decisions.json`. Proceed without pausing. |
| `page` (explicitly passed by the user as `level=page`) | **Warn but proceed.** Log in `notes.md`: "Page has N sections / M slots — page-level conversion at this scale risks incomplete content extraction. Block-level is recommended. Proceeding with page-level as explicitly requested." Record `complexityGate` = `warned`. |
| `auto` | The gate does not override `auto` — the feasibility analysis recommendation handles it. But if the analysis recommends `page-level` AND the gate fires, surface the complexity concern alongside the recommendation. |
| `block` or `check` | Gate is irrelevant — block-level or analysis-only. No action. |

### How `level` controls what happens next

| `level` param | Analysis runs? | Transition to Phase 3 |
|---------------|----------------|----------------------|
| `page` (default) | Yes (validation) | Proceed to Phase 3 with page-level. Subject to the complexity gate above — may auto-switch to block. Log a note if analysis shows block-level was feasible. |
| `auto` | Yes | Present recommendation + per-section table to user. Ask to confirm or override. Proceed with confirmed level. |
| `check` | Yes | **Stop here.** Write results to `decisions.json` and `notes.md`. Do not proceed to Phase 3. |
| `block` | Yes (validation) | Proceed to Phase 3 with block-level. Log a warning in `notes.md` if analysis recommends otherwise. |

## Produce `decisions.json`

Write a structured artifact in the project folder. Generate reads
this directly. Suggested shape:

```json
{
  "levelParam": "page",
  "conversionLevel": "block-level",
  "complexityGate": "triggered",
  "sectionCount": 12,
  "slottableElementCount": 147,
  "feasibility": {
    "recommendation": "block-level",
    "sections": [
      {
        "name": "hero",
        "level": "block",
        "checks": {
          "structure": "pass",
          "cssScope": "pass",
          "contentModel": "pass",
          "jsIndependence": "pass",
          "visualIndependence": "pass"
        }
      },
      {
        "name": "booking",
        "level": "fragment",
        "checks": {
          "structure": "pass",
          "cssScope": "pass",
          "contentModel": "fail — 6-field interactive form",
          "jsIndependence": "pass",
          "visualIndependence": "fail — -72px overlap with hero"
        },
        "failReason": "Complex interactive widget with visual coupling"
      }
    ]
  },
  "templateName": "<name>",
  "synthesizeMain": true,
  "sections": [
    {
      "firstClass": "hero",
      "originalTag": "div",
      "rewriteToSection": true,
      "fragments": [],
      "slots": [
        { "name": "eyebrow", "type": "text", "selector": ".hero-text__eyebrow" },
        { "name": "title", "type": "text", "selector": ".hero-text__title" },
        { "name": "body", "type": "text", "selector": ".hero-text__body" }
      ]
    },
    {
      "firstClass": "stories",
      "originalTag": "section",
      "rewriteToSection": false,
      "slots": [
        { "name": "eyebrow", "type": "text", "selector": ".stories__eyebrow" },
        { "name": "title", "type": "text", "selector": ".stories__title" },
        { "name": "body", "type": "text", "selector": ".stories__body" },
        { "name": "card-1.photo", "type": "background-image", "selector": ".story-card:nth-child(1) .story-card__photo" },
        { "name": "card-1.category", "type": "text", "selector": ".story-card:nth-child(1) .story-card__category" }
      ]
    }
  ],
  "headLinks": [
    { "rel": "preconnect", "href": "https://fonts.googleapis.com" },
    { "rel": "preconnect", "href": "https://fonts.gstatic.com", "crossorigin": "" }
  ],
  "inlineStyleLines": [8, 1326],
  "inlineScriptLines": [
    [2162, 2670],
    [2674, 2685]
  ],
  "externalLibs": [
    { "name": "lenis", "css": "assets/lenis.min.css", "js": "assets/lenis.min.js", "strategy": "vendor" }
  ],
  "assetStrategy": "vendor",
  "assetBase": "http://127.0.0.1:8080/path/to/page/",
  "vendorAssetsTo": "assets/"
}
```

The `feasibility` object is always present. The `slots` arrays are
only populated for page-level sections. Block-level sections get
their content model defined during Phase 3 (Generate) instead.

This is a sketch — actual fields evolve per run. Generate phase
reads `decisions.json`, falls back to re-reading `notes.md` if a
field is missing.

## Stripping decisions

Some source elements should NOT make it into the template:
- Dev-tool markup (grid overlays, debug buttons) — strip
- Generator provenance comments — keep or strip per preference
- Generator placeholder elements (Stardust placeholders) — keep but
  mark with `data-slot-skip="placeholder"`

List these explicitly in `notes.md` and in `decisions.json` under
a `strip` array so Generate doesn't accidentally include them.

## Update state and finish

Set `state.phase = "analyze"`, `state.phaseStatus = "complete"`,
`state.analyzeCompletedAt = "<timestamp>"`,
`state.conversionLevel = "<chosen level>"`. Save state.json.

### Transition

- **`level=check`**: stop here. Report the feasibility results to
  the user. Do NOT proceed to Phase 3.
- **`level=auto`**: present the recommendation and per-section table.
  Ask the user to confirm or override. Record the confirmed level in
  `state.conversionLevel`. Then proceed to Phase 3.
- **`level=block`**: proceed to Phase 3 immediately with block-level.
- **`level=page`**: proceed to Phase 3 with page-level, unless the
  complexity gate auto-switched to block (see above).
