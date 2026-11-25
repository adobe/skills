# stardust:direct: phase 1, density and IA-fidelity tuning

The text of this part of `skills/direct/SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

#### Density tuning (one-shot, only when unmoved)

When the user's phrase does **not** move the `density` axis (per
`reference/intent-dimensions.md` § 4), and the resolved register is
`brand`, ask one short follow-up — count it within the two-question
ceiling:

> Density tuning — (a) airy (NYT-Opinion-tier breathing, ~96px
> section padding), (b) balanced (calm but compact, ~64–72px),
> (c) packed (data-dense, ~40–48px). Default for brand-register
> sites with multi-audience IA is **(b) balanced**; pick (a) only
> when the page is editorial-led with deep per-section density.

If the user answers, stamp the chosen tier in `direction.md` §
Movements as `density: <tier>`. If unanswered, default to
**balanced** (not airy) for brand register and stamp
`density: balanced (default)`.

Skip this question entirely when:
- The user's phrase already moved `density` (any of "make it
  denser", "more breathing room", "compact", "tight", "spacious"
  count as movement).
- The register is `product` (default `packed` per § 4).
- The register is `ambiguous` and resolving it earlier in the
  reasoning is the higher-value question — defer density to the
  next turn rather than burning a question slot.

Phase 4 reads the stamped tier to set `spacing.sectionPadding`;
it never re-asks.

#### IA-fidelity tuning (one-shot, only when unmoved)

When the user's phrase does **not** auto-pin `ia-fidelity` (per
`reference/intent-dimensions.md` § 9 — i.e. none of *"verbatim"*,
*"same IA"*, *"keep the structure"*, *"swap the surface"*,
*"don't rethink the IA"* and none of *"reimagine"*, *"rethink"*,
*"deeper redesign"*, *"what if"* appear), ask one short follow-up
— count it within the two-question ceiling:

> IA fidelity — (a) verbatim (same section sequence, same content
> beats; variants explore surface only: color, type, density,
> motion), or (b) reimagined (variants may demote / promote / drop
> sections, move IA priorities, take "what if" positions on the
> spine of the page).
> Default (b) for the typical refresh; pick (a) when the customer
> asked to keep their site structurally identical and only swap
> the surface.

If the user answers, stamp the chosen tier in `direction.md` §
Movements as `ia-fidelity: <tier>`. If unanswered, default to
**reimagined** and stamp `ia-fidelity: reimagined (default)`.

Skip this question entirely when:
- The user's phrase already auto-pinned the axis (any trigger phrase
  in § 9 — *"same IA, swap the surface"* → verbatim;
  *"what if we rethought the home page"* → reimagined).
- An existing `direction.md` is being refined (the active tier holds
  unless the user explicitly re-pins).

Phase 4 stamps the tier into `iaPriorities[].mutability`;
downstream `prototype` reads it.

Pair this question with the density-tuning question when both are
unmoved — *"two things to pin before we resolve: (1) density …, (2)
IA fidelity …"* — to stay within the two-question ceiling. If
resolving register (brand vs product) is also outstanding, prioritise
register first; defer one of density / ia-fidelity to the next turn.
