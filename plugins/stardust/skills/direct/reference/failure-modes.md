# stardust:direct: failure modes

The text of this part of `skills/direct/SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

## Failure modes

- **No extracted state.** Abort and recommend `$stardust extract`.
- **Phrase too vague even after two questions.** Persist the partial
  reasoning to `stardust/direction.md` under a `# Pending` section,
  ask the user to refine further, do **not** write `PRODUCT.md` /
  `DESIGN.md` / `DESIGN.json` from incomplete reasoning.
- **Re-direct with prior approved or migrated pages.** Always confirm
  before stale-flagging. The flag is visible to the user and
  reversible (clearing happens automatically on successful re-run of
  prototype or migrate), but a re-direct invalidates work the user
  may have signed off on.
- **Anti-toolbox audit removes too many moves.** If the resolved
  direction collapses to defaults after the audit strips
  unjustifiable hits, surface this to the user and re-prompt for
  reference anchors before writing tokens.
- **(b) Insufficient brand signal for N variants.** Fewer than 3
  distinct amplifiable traits in the captured surface (or
  `signal-thin`) → refuse N ≥ 3 under Mode A and propose 1–2
  variants instead; full contract in `reference/multi-variant.md`
  § Failure mode.
- **(c) Hard rule conflict.** When Mode A is active *and* the
  user's phrase requires violating a Mode A pin (e.g., the user
  asks for *"a completely different palette"* while migration mode
  is active and `--rebrand` was not passed), stop. Name the
  conflict explicitly: *"You asked to keep the brand and to change
  the palette — those are not compatible. Did you mean (a) keep the
  current palette and only refresh execution, (b) rebrand
  (`--rebrand`) and roll a new palette, or (c) Mode A with a
  targeted palette move (single role recolored, rest pinned)?"*
  Wait for explicit answer.
- **(d) Empty improvements list.** When Phase 2.5 produces fewer
  than 3 weaknesses meeting the specificity bar, stop before
  rendering any variant. Variant A's brief depends on the list;
  without it, the *"better"* claim fails. Surface honestly:
  *"the captured site is already at a competent execution level on
  observable dimensions — variant A would reduce to spacing and
  contrast adjustments only."* Ask the user whether to (a) proceed
  with reduced scope (density + contrast only), (b) extract
  additional pages (`extract --cap 25` or higher) to surface more
  weaknesses, or (c) pivot to rebrand mode (`--rebrand`) where the
  brand-fidelity floor doesn't apply.
