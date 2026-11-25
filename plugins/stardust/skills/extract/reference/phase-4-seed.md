# stardust:extract: phase 4, seed PRODUCT.md and DESIGN.md

The text of this part of `skills/extract/SKILL.md`, which points here. "Above" and "below" refer to the order of the sections in that file.

### Phase 4 — Seed `stardust/current/PRODUCT.md` and `DESIGN.md`

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
  lost, and `breakpoints` — the cap-probe sizing model — verbatim.
