# Eval: four-scope CSS — default-content classification

## Setup

Stardust v0.10.0+ with Discipline 11 in `prototype/SKILL.md`.
A captured site with at least one section that mixes default prose
(direct-child `h2` + `p`) and a `[data-module]` whose internals
include an `h2` (so we can verify the direct-child combinator
isolates default-content rules from block internals).

## User prompt

"Render a prototype where the about section has a default heading
and paragraph, and a 'team-roster' module with a heading inside."

## Expected behavior

The `stardust:prototype` skill is invoked. Phase 2 craft produces a
proposed file whose first `<style>` block:

1. Carries an `/* === GLOBAL: default-content === */` marker before
   the site-wide default-content rules.
2. Default-content rules use the direct-child combinator (`>`):
   `section > h1`, `section > p`, `section > ul`, etc. Element
   selectors WITHOUT the combinator (e.g., `section h1`, plain `h1`)
   either refuse the write or are explicitly allowed only under
   GLOBAL: resets.
3. Per-section default-content overrides
   (`section[data-section="about"] > h2 { ... }`) live inside the
   matching SECTION group, not under GLOBAL: default-content.
4. Rendering verifies isolation: the team-roster module's `h2`
   inside `[data-module="team-roster"]` is NOT styled by
   `section > h2` (the direct-child combinator stops at the
   section's direct children). Block authors style the team-roster
   `h2` under their own BLOCK: team-roster group.
5. Refuses to write when an element selector under
   GLOBAL: default-content lacks the direct-child combinator (e.g.,
   `section p { ... }` with descendant combinator instead of
   `section > p`), naming the offending selector and the
   remediation.
6. Default-content selectors are restricted to the canonical
   element set: h1–h6, p, ul, ol, li, img, picture, figure,
   figcaption, a, blockquote, hr. Other elements (div, span, custom
   tags) refuse under GLOBAL: default-content (they belong in BLOCK
   or as a section-internal rule).
