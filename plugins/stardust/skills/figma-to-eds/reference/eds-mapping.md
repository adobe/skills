# Mapping a Figma design system onto EDS

How the captured canon-source becomes an EDS `styles/` + `blocks/`
tree. The invariant throughout: **blocks consume tokens; only
`styles.css` states raw values.**

## Token transform (variables → CSS custom properties)

Declare one mechanical transform and record it in
`donor-tokens.json` so the probe can assert names, not just values:

- Figma variable path → custom property: lowercase, `/` → `-`,
  spaces and camelCase humps → `-`.
  `color/surface/light` → `--color-surface-light`;
  `color/action/primary/surface/hover` →
  `--color-action-primary-surface-hover`.
- Keep BOTH layers when the kit has them: the global scale
  (`--color-<hue>-<step>`) and the semantic layer
  (`--color-surface-*`, `--color-action-*`). Blocks use the semantic
  layer; the global scale exists so the semantic layer can be
  expressed as references, mirroring the kit's own aliasing.
- Composite type styles become per-style custom-property groups
  (`--type-<style>-size/-line-height/-weight/-letter-spacing`) plus
  element rules per the kit's HTML mapping (below).
- Numeric-only tokens get their unit from the kit's resolved spec
  (`24` + `paragraphSpacing` context → `24px`; `130%` line-height →
  unitless `1.3` is a **declared normalization**, listed in
  `donor-tokens.json#normalizations`, never an ad-hoc conversion).

## Element type ramp

If the kit publishes an HTML-usage mapping (text style → `h1…h6`,
`p`, captions), apply it verbatim in `styles.css` element rules and
record the mapping's source node id. If it doesn't, propose a mapping
from the ramp's hierarchy, write it to `mapping.md`, and flag it as
authored-not-mandated — it is a divergence candidate, not kit law.

## Module ↔ block mapping brief (`stardust/figma-to-eds/mapping.md`)

One row per Figma module, joined against the existing block inventory
(when restyling an existing EDS site) or empty (greenfield):

| column | meaning |
|---|---|
| module | kit name + node id |
| target | `restyle <block>` / `new block <name>` / `variant of <block> (<class>)` / `chrome` (header/footer) / `element styles` (no block needed) |
| variants | the kit's variant axes → EDS block classes (`block-name (variant)` rows in the content model) |
| atoms | which atom components it composes (buttons, cards, badges) — atoms map to shared CSS, not blocks |
| gate frame | the Figma frame id the component diff will render against |

Mapping rules validated in practice:

- **Atoms are not blocks.** Buttons, links, badges, inputs map to
  shared styles (`styles.css` or a shared stylesheet) consumed by
  every block. Making an atom a block fragments the token surface.
- **Navigation modules map to chrome** (header/footer blocks +
  their fragment content), not to page blocks.
- **The kit's exclusion list is a scope contract.** Modules marked
  "future / do not develop" (or equivalent) are listed in
  `mapping.md` with target `excluded` and never built, even when
  they look useful.
- **Orphans go to the register.** An existing block with no kit
  counterpart, or a kit module with no content need, is recorded in
  the divergence register with a proposed resolution (keep-as-is /
  retire / request-design). Silent restyling-by-taste is the failure
  mode this table exists to prevent.
- **One reference component per module** (reskin's pinned-reference
  rule transposed): when a module appears in several kit contexts
  with token disagreements, pick the component-set's main variant as
  the token source and demote the rest to corroboration; record the
  pick in `mapping.md`.

## Apply order

1. `styles.css`: custom properties, fonts, element ramp — then run
   the token probe on a bare page before touching any block.
2. Shared atoms (buttons, cards, form controls).
3. Blocks, one module family at a time, gating each with its
   component diff before starting the next family.

Fonts: the kit names families; licensing/serving (self-hosted,
a hosted font service, fallback stacks) is a project decision recorded in the
project's divergence register, not in this skill.
