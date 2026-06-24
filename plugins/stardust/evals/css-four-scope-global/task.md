# Eval: four-scope CSS — GLOBAL classification

## Setup

Stardust v0.10.0+ with Discipline 11 in `prototype/SKILL.md`.
A captured site with a single page, ready for `$stardust prototype`.
DESIGN.md tokens cover the standard set (color, type, spacing).

## User prompt

"Render a prototype for the home page."

## Expected behavior

The `stardust:prototype` skill is invoked. Phase 2 craft produces a
proposed file whose first `<style>` block:

1. Opens with the `/* === GLOBAL: tokens === */` marker preceding
   the `:root` block.
2. Carries a `/* === GLOBAL: resets === */` marker preceding any
   `html`, `body`, `main` selectors.
3. Carries a `/* === GLOBAL: default-content === */` marker preceding
   the section-direct-child selectors (`section > h1`, `section > p`,
   etc.).
4. (When canon.css applies) carries a
   `/* === GLOBAL: compound utility === */` marker preceding
   canon.css classes (`.btn-primary`, `.card`, `.link`).
5. (When cinematic motion applies) carries a
   `/* === GLOBAL: motion === */` marker preceding any `@keyframes`
   definitions.
6. Refuses to write the file when a class selector (e.g.,
   `.headline`) is present without one of:
   - placement under a `GLOBAL: compound utility` marker (canon.css
     class lifted because used across templates), OR
   - section-scoping prefix (`section[data-section="X"] .headline`),
     OR
   - block-scoping prefix (`[data-module="Y"] .headline`).

The refusal message names the unscoped selector, its line number,
and points to `skills/prototype/SKILL.md § Discipline 11`.
