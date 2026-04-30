# Palette Picker

Pick a target palette from the bundled library — **no external API, no
LLM-invented colors**. The library was scraped from
`coolors.co/palettes/trending` and classified by deterministic HSL
heuristics. Every palette carries a `source` URL back to its Coolors
page.

Version: **v0.6.0 · 127 palettes · scraped 2026-04-24** (carried from
stardust v1 unchanged).

Distribution by ground family:
- **saturated** 78 · **dark** 20 · **monochrome-tint** 13 · **stark-white** 6 · **cream** 5 · **pale-gray** 5

The library lives at [`palettes/library.json`](palettes/) — a single
file containing all 127 palettes inline with their classification
metadata. (v1 also shipped per-palette files under per-ground-family
directories; v2 ships only the consolidated index since every consumer
reads it as a whole.)

**v1 → v2 adaptation (paths and consumers only — picker logic
unchanged):**
- Consumer: v1's `brand` skill becomes v2's `direct` skill (Phase 2 of
  the `direct` procedure).
- Storage: v1 wrote results into `brand-profile.json._divergence.palette_source`
  and `brand-profile.json.colors.primary[]`. v2 writes results into
  `DESIGN.json.extensions.divergence.palette_source` and
  `DESIGN.md.colors` (Stitch frontmatter, role-named keys per
  divergence-toolkit § 4).
- Pick UI artifact path: v1 wrote `stardust/_palette-pick.html`. v2
  uses the same path (transient artifact, left on disk as audit
  record).
- The pick-ui-template lived at `brand/reference/pick-ui-template.md`
  in v1; v2 inlines the minimum UI contract in § 4 below.

---

## The flow

```
Natural-language description (or explicit flags)
       ↓
§1 · Classifier keywords → 5 descriptor dimensions
       ↓
§2 · Filter palettes/ by descriptor match
       ↓
§3 · Score + rank top 5
       ↓
§4 · Render pick UI (stardust/_palette-pick.html — see § 4)
       ↓
Designer picks a number (1–5)
       ↓
Record in DESIGN.md.colors + DESIGN.json.extensions.divergence.palette_source
```

---

## § 1 · Classifier vocabularies

Keyword matching is **whole-word, case-insensitive**. Score each dimension by counting keyword hits; the value with the highest count wins; ties go to the *bolder* value (higher number or more-intense category).

### Energy (1–5)

| Level | Keywords |
|---|---|
| 5 — high | bold · shocking · loud · energetic · electric · explosive · punk · wild · chaotic · freaking · intense · aggressive · radical · maximal · maximum · carnival · rave |
| 4 | lively · vivid · strong · powerful · bright · punchy · vibrant · active · dynamic |
| 3 | balanced · considered · measured · engaging |
| 2 | refined · composed · subdued · understated · gentle · soft · muted · calm |
| 1 — low | quiet · minimal · hushed · restrained · peaceful · serene · tranquil · whisper · silent |

### Contrast (1–5)

| Level | Keywords |
|---|---|
| 5 | shocking · stark · brutal · extreme · maximum · dramatic · harsh · uncompromising · punchy · bold |
| 4 | strong · crisp · clean · sharp |
| 3 | balanced · harmonious · considered |
| 2 | soft · gentle · gradual · ambient |
| 1 | uniform · monochrome · faded · washed · quiet |

### Saturation (1–5)

| Level | Keywords |
|---|---|
| 5 | saturated · vivid · neon · electric · fluorescent · hot · pop · candy · tropical · carnival |
| 4 | rich · warm · vibrant · deep |
| 3 | natural · earthy · grounded |
| 2 | muted · dusty · faded · pastel · washed · understated |
| 1 | desaturated · quiet · neutral · gray · grey · bleached |

### Hue bias (category)

| Category | Keywords |
|---|---|
| hot | red · pink · magenta · crimson · fire · hot · blood · punk · passionate · ember |
| warm | orange · terracotta · rust · autumn · golden · burnt · amber · copper |
| mustard | yellow · mustard · ochre · sun · honey |
| green | green · forest · sage · botanical · emerald · jungle · moss · olive |
| teal | teal · turquoise · seafoam · cyan · mint · lagoon |
| cool | blue · cobalt · ocean · sky · navy · denim · arctic · glacial |
| violet | purple · violet · lavender · plum · aubergine · iris |
| neutral | gray · grey · neutral · monochrome · monochromatic · achromatic · concrete · slate |
| rainbow | rainbow · playful · eclectic · multicolour · multicolor · kaleidoscope |

### Ground family (category)

| Category | Keywords |
|---|---|
| cream | paper · letterpress · riso · publishing · magazine · book · archival · print · vellum · warm · manuscript · folded · ephemera |
| stark-white | clinical · medical · minimal · minimalist · clean · engineered · technical · modern · architectural · superbly · precise · swiss-pharma |
| pale-gray | concrete · quiet · swiss · brutalist · grey · gray · industrial-quiet |
| dark | night · noir · cinematic · dark · moody · midnight · shadow · underground · late · nocturnal |
| saturated | bold · shocking · loud · maximalist · colorful · colourful · playful · punk · pop · carnival |
| monochrome-tint | sage · dusk · tinted · muted · considered · ambient · natural · earthy · ombre |

Any dimension the description does not trigger keywords for is **left as `null`** — the filter treats nulls as "no constraint".

---

## § 2 · Filter scoring

For each palette in `palettes/<ground-family>/*.json`, compute a score against the classified descriptor:

| Match | Points |
|---|---|
| `ground_family` exact match | **+100** |
| `hue_bias` exact match | +50 |
| `hue_bias` within hue group (see below) | +20 |
| `saturation_level` differs by `d` | `max(0, 30 − 10d)` |
| `energy` differs by `d` | `max(0, 20 − 8d)` |

### Hue groups (loose match)

When the descriptor requested `hue_bias = X`, palettes whose `hue_bias` is in the same group get the +20 "loose match" points:

| Requested | Also matches (loose) |
|---|---|
| hot | hot · warm · mustard · violet |
| warm | warm · mustard · hot |
| cool | cool · teal · violet |
| teal | teal · cool · green |
| green | green · teal · mustard |
| violet | violet · cool · hot |
| mustard | mustard · warm · green |
| neutral | neutral |
| rainbow | rainbow |

Keep only palettes with score > 0. If nothing scores > 0, return the top 10 by raw score (catch-all for descriptions that don't match any palette).

Sort descending by score. Take top 5 as candidates.

### Deterministic pick

For the default "recommended" pick, use `byte[0]` of `MD5(description + today's date)` mod `len(top_5)`. Record the index in `_divergence.palette_source.recommended_index`.

Designer override: they pick any of the 5 by number.

---

## § 3 · HSL helpers for classification of candidate palettes

These helpers are used only when regenerating the library (scraping). At runtime the library is read as-is. Helpers kept here for completeness.

### Hex → HSL

Standard formulae — convert to 0–255 RGB, normalize to 0–1, then `colorsys.rgb_to_hls()` in Python or equivalent. H in 0–360°, S in 0–100%, L in 0–100%.

### Warm-bias test (v0.5.1)

```
is_warm(hex) := raw_R − raw_B ≥ 5
```

In raw 0–255 channels. This catches subtle warms like vellum/kami/oatmeal while excluding pure neutral grays.

### Cream-family test (v0.5.1)

```
is_cream_family(hex) :=
  80 ≤ L ≤ 97
  AND is_warm(hex)
  AND S < 40
```

Any swatch that passes this test anywhere in a palette's `hexes` array is listed in `cream_flagged_hexes` so the consumer skill (`direct` in v2) can refer to it when applying toolkit §1 cream-rule enforcement.

---

## § 4 · UI contract

The pick UI is a self-contained HTML file written to `stardust/_palette-pick.html`. The agent generates it inline; v2 inlines the contract here rather than shipping a separate template (the v1 template at `brand/reference/pick-ui-template.md` is no longer maintained).

Minimum contract:

- Self-contained HTML (no external CSS, no external JS, no fonts).
- Page background = the *recommended pick's* ground color, so the designer sees the candidate in context.
- Show the classified descriptor dimensions at the top so the designer can see why these candidates landed.
- Render 5 numbered candidate cards, largest for #1 (the recommended pick); use a gold or contrasting border on #1 to mark the recommendation.
- Each card shows: index number · 5 swatches with hex + anchor mark · palette name · source URL (link) · classification tags (ground, hue, sat, energy).
- Footer: "Tell the assistant a number (1–5), a palette name, or 'refine' to change the description."
- Open in the default browser immediately after writing (`open` on macOS, `xdg-open` on Linux, `start ""` on Windows). Skipped under pipeline-automation mode.

---

## § 5 · Designer corrections

Authoritative over §1 keyword vocabularies when they conflict.

As designers encounter descriptions that the dictionary misclassifies, add overrides or expansions here. Format:

```markdown
- **[add|remove|annotate]** `<keyword> → <dimension> = <value>` · <date> · <designer>
  — <one-line reason>
```

### Entries

_None yet. v0.6.0 ships with the scraper's initial keyword dictionary._

---

## How skills consume the picker (stardust v2)

- **`direct` skill Phase 2** (Resolve divergence inputs) runs the full flow (classify → filter → render UI → wait → record) when the resolved direction implies a palette change. Otherwise inherits the palette from `stardust/current/_brand-extraction.json` with role-renaming per divergence-toolkit § 4.
- **`prototype` skill** reads `DESIGN.json.extensions.divergence.palette_source` (v2 location for what v1 called `_divergence.palette_source`) to understand where the palette came from; does not re-pick.
- **`migrate`** consumes the resolved colors from `DESIGN.md.colors` (Stitch frontmatter); the picker is invisible to it.
- Other skills may consult `palettes/library.json` directly for anchor hexes matching a specific ground-family / hue-bias combination.

Stamp the library version in `DESIGN.json.extensions.divergence.palette_source.library_version` so future runs can tell which snapshot was in effect.
