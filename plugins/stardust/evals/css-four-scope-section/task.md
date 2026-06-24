# Eval: four-scope CSS — SECTION classification

## Setup

Stardust v0.10.0+ with Discipline 11 in `prototype/SKILL.md`.
A captured site with at least two sections needing token redefinition
— typically a hero with a brand-accent background plus a features
section with a different palette.

## User prompt

"Render a prototype for the home page; hero section uses the accent
palette, features section uses the neutral palette."

## Expected behavior

The `stardust:prototype` skill is invoked. Phase 2 craft produces a
proposed file whose first `<style>` block:

1. Carries a `/* === SECTION: hero === */` marker before any
   `section[data-section="hero"] { ... }` rule, with the marker's
   name (`hero`) matching the DOM's `data-section` attribute.
2. Places per-section token redefinition (e.g., `--color-bg`,
   `--heading-xxl`) inside the SECTION group.
3. Places per-section default-content overrides
   (`section[data-section="hero"] > h1 { ... }`) inside the same
   SECTION group (still classifies as section scope per Discipline
   11; the > selector is allowed at section depth).
4. Carries a separate `/* === SECTION: features === */` group with
   the features section's token redefinitions.
5. Cascade works: the hero's `h1` resolves `var(--heading-xxl)`
   against the hero section's lifted value, not the global default.
6. Refuses to write when a section-scoped rule's SECTION marker
   doesn't match the DOM's `data-section` value (typo / orphaned
   section detection); the refusal names the unmatched section name
   and the nearest match by Levenshtein distance.
