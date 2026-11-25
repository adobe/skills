# stardust:uplift: phase 5, what prototype does per variant

The text of this part of `skills/uplift/SKILL.md`, which points here. "Above" and "below" refer to the order of the sections in that file.

### Phase 5 — Prototype × 3 (delegate to the stardust `prototype` skill)

Prototype detects the variant set from the per-variant `DESIGN-A`,
`DESIGN-B`, `DESIGN-C` files that `direct` wrote in Phase 4 —
authoring `<slug>-A-shape.md` / `-B-shape.md` / `-C-shape.md` and
emitting `<slug>-A-proposed.html` / `<slug>-B-proposed.html` /
`<slug>-C-proposed.html` per the variant-convergence detector
contract (`../prototype/SKILL.md` § Phase 2.5 / Discipline 10).

**Cinematic motion fires per-variant from the per-variant DESIGN
file**, not from a CLI flag. **Never pass `--cinematic` to
prototype from uplift.** Because Phase 4 wrote
`extensions.motion.register` into `DESIGN-C.json` only (A and B
omit it), prototype's Phase 2.4 (motion application) fires only
for variant C. Variant C emits both `<slug>-C-proposed.html`
(the static reference) and `<slug>-C-cinematic.html` (the
register-applied surface). Variants A and B render static, never
acquiring the motion runtime.

Prototype owns:

- Page-shape brief authoring per Phase 1 of prototype.
- Render via `$impeccable craft` delegation, per variant.
- Phase 2.4 motion application for variants whose `DESIGN-<id>.json`
  declares an `extensions.motion.register`.
- Phases 2.5–2.8 quality gates (critique, audit, adapt, motion)
  per variant.
- Variant C's cinematic-mode gates (Pass 6) per
  `../prototype/reference/motion-validation.md`.
- Variant-convergence detector (≥ 2 structural changes per pair)
  per Discipline 10.

Multi-variant rendering is driven by the presence of multiple
`DESIGN-<id>.json` files at the project root, not by a CLI selector
— prototype has no `--variant <id>` input. That is exactly why the
parallel path in step 2 requires isolated workspace copies with a
single pinned `DESIGN-<id>.json` each: file presence is the only
variant selector prototype has. The A-first ordering above is what
keeps canon consistent across the B and C runs in either path.
