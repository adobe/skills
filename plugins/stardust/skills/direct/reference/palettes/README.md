# Palette library

Curated palette library used by the palette picker
(`../palette-picker.md`). Carried from stardust v1 unchanged.

## Version

**v0.6.0** — 127 palettes, scraped from `coolors.co/palettes/trending`
on 2026-04-24. Every palette carries a `source` URL back to its
Coolors page.

Distribution by ground family:

| Ground family       | Count |
|---------------------|-------|
| saturated           | 78    |
| dark                | 20    |
| monochrome-tint     | 13    |
| stark-white         | 6     |
| cream               | 5     |
| pale-gray           | 5     |
| **Total**           | **127** |

## File

`library.json` — single consolidated file, ~2400 lines, all 127
palettes inline with classification metadata. Read as a whole; do not
parse incrementally.

(v1 also shipped per-palette files under per-ground-family
directories; v2 ships only the consolidated index since every consumer
reads it as a whole.)

## Per-palette schema

```json
{
  "path": "saturated/example.json",
  "name": "Example Palette",
  "source": "https://coolors.co/...",
  "anchor": "#147AFF",
  "hexes": ["#FFFFFF", "#F5F5F5", "#147AFF", "#0A0A0A", "#FFB400"],
  "ground_family": "saturated",
  "saturation_level": 4,
  "hue_bias": "cool",
  "energy": 4,
  "has_cream_family_swatch": false,
  "cream_flagged_hexes": []
}
```

`path` is a v1 artifact (the path inside v1's per-family directory
structure). v2 keeps it for round-trip compatibility but does not use
it for I/O — `library.json` is the only file v2 reads.

`anchor` is the most-saturated swatch in the palette, used as the
visual identifier in the pick UI.

Classification dimensions (`ground_family`, `saturation_level`,
`hue_bias`, `energy`) feed the picker's filter scoring; see
`../palette-picker.md` § 1 for the vocabularies and § 2 for the
scoring rules.

`cream_flagged_hexes` lists any swatches that pass the cream-family
deterministic hex test (lightness 80-97 + warm bias R-B≥5 +
saturation < 40%). Used by the divergence toolkit's cream-family
guardrail.

## Regenerating

The library is **not** regenerated during stardust runs — it is
read-only at runtime. To refresh it, re-scrape coolors.co with the
helpers in `../palette-picker.md` § 3 (HSL helpers) and the v1
scraper script (not bundled with v2; see v1 source if needed).

Stamp any regenerated library with a new version number and update
this README's distribution table.

## Why bundled

The whole point of the picker is "no LLM-invented colors". If the
library lived behind a network call, an offline run would have no
colors to pick from and would fall back to invented hexes. Bundling
the library guarantees the picker is always available and is always
deterministic.
