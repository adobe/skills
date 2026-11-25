# stardust:extract: outputs

The text of this part of `skills/extract/SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

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
