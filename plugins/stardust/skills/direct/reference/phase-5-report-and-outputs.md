# stardust:direct: phase 5 report and outputs

The text of this part of `skills/direct/SKILL.md`, which points here. "Above" and "below" refer to the order of the sections in that file.

### Phase 5 — Write direction.md and update state

Print a one-screen summary report and recommend the next step:

```
direction resolved
==================

Phrase:    "make it more expressive for a young audience"
Audience:  Gen Z college / first-job (resolved via Q1)
Register:  brand (inherited from current/PRODUCT.md)

Movements:
  expressive axis    restrained -> committed
  distinctiveness    familiar  -> distinctive
  tone               serious   -> playful
  density            (unchanged)
  audience           (resolved: Gen Z college / first-job)

Divergence:
  seed         1970s x Riso print x zine x monochrome-tint
  font deck    zine-maximalist
  palette      "Brutalist Dawn" (picked from library)

Wrote:
  PRODUCT.md, DESIGN.md, DESIGN.json
  stardust/direction.md

State:
  25 pages: extracted -> directed
  0 stale prototypes (none exist yet)

Next: $stardust prototype  (defaults to home page)
```

## Outputs

| Path                                  | Purpose                                            |
|---------------------------------------|----------------------------------------------------|
| `PRODUCT.md`                          | Target strategy (impeccable format). Shared across variants when N > 1 under Mode A. |
| `DESIGN.md`                           | Target visual system (Stitch frontmatter + 6 sections). Single-variant runs only. |
| `DESIGN.json`                         | Sidecar with extensions (divergence, componentStyle, voice, iaPriorities) and narrative. Single-variant runs only. |
| `DESIGN-{A,B,C,…}.md`                 | Per-variant DESIGN files when the user requested N > 1 variants (Phase 2.6 active). |
| `DESIGN-{A,B,C,…}.json`               | Per-variant DESIGN sidecars matching the .md files. |
| `stardust/prototypes/<slug>-improvements.md` | Improvements list (Mode A only, written in Phase 2.5). The load-bearing artifact for variant A. |
| `stardust/direction.md`               | Resolved direction + full reasoning trace + per-variant resolutions when N > 1. |
| `stardust/state.json`                 | Updated with direction + per-page status changes + `direction.variantMode` + `direction.variants[]` when N > 1. |
