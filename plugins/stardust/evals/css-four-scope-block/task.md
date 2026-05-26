# Eval: four-scope CSS — BLOCK classification

## Setup

Stardust v0.10.0+ with Discipline 11 in `prototype/SKILL.md`.
A captured site with at least two `data-module` instances in the DOM
(e.g., `hotline-211` and `donate-band`) and one `data-template`
instance at the page root (e.g., `data-template="article"`).

## User prompt

"Render a prototype for the home page. Include the 211 hotline
module and the donate-band module; the page uses the article
template."

## Expected behavior

The `stardust:prototype` skill is invoked. Phase 2 craft produces a
proposed file whose first `<style>` block:

1. Carries a `/* === BLOCK: hotline-211 === */` marker before any
   `[data-module="hotline-211"] { ... }` rule, with the marker's
   name matching the DOM's `data-module` value.
2. Carries a separate `/* === BLOCK: donate-band === */` group with
   its own selectors.
3. Carries a `/* === BLOCK: article === */` group for the
   `data-template="article"` rules (page-template scope folds into
   BLOCK per Discipline 11 — no separate TEMPLATE scope).
4. Block-internal default-content selectors (e.g.,
   `[data-module="hotline-211"] h2`) classify as BLOCK, not
   default-content (the direct-child combinator does not protect
   them — by design, blocks own their internals).
5. Refuses to write when a BLOCK marker's name has no matching
   `data-module` or `data-template` value in the DOM (dead-block /
   typo detection); the refusal names the unmatched block, the
   nearest match by Levenshtein, and points to Discipline 11.
6. No `data-module` or `data-template` selectors leak into SECTION
   or GLOBAL groups.
