# Eval: open and reasoned (no silent intent → command mapping)

This eval specifically tests stardust's "open and reasoned"
principle: every freeform redesign phrase must be reasoned about
in public against the dimensional vocabulary, never silently
mapped to a fixed command lookup. Vague phrases must be
clarified, not guessed.

## Setup

A project where extract has completed:

- `stardust/state.json` lists 5 pages, all `extracted`.
- `stardust/current/` populated.
- No project-root PRODUCT.md / DESIGN.md yet.
- No `stardust/direction.md` yet.
- Impeccable installed.

## User prompt

"$stardust I want it to be amazing"

## Expected behavior

The agent routes this to the freeform-phrase branch of the master
`stardust` skill (per its routing rule). It MUST:

1. **Restate** the phrase in dimensional vocabulary (per
   `intent-dimensions.md`). The restatement should explicitly
   identify that "amazing" moves NO specific axis directionally —
   it is a quality demand without direction.
2. **Distinguish** "amazing" from "better": "better" has a default
   meaning (pass critique + audit cleanly); "amazing" does not.
   So this is one of the cases where asking-then-stopping is
   correct (per `intent-examples.md` Example 10).
3. Ask **at most two** high-leverage clarifying questions, e.g.:
   - "Pick a direction we should push: (a) make it more
     distinctive, (b) more accessible, (c) more performant, (d)
     something else — describe in one sentence."
   - (Optional) "A reference site you find amazing."
4. **Defer the plan** until the user answers. Do NOT:
   - Pick commands without input.
   - Author PRODUCT.md / DESIGN.md / direction.md from incomplete
     reasoning.
   - Fall back to "make it better" defaults silently.
5. Persist the partial reasoning so resuming later is possible.
   Per `direction-format.md`, the agent may write a `# Pending
   direction (<ts>)` section to `stardust/direction.md` with only
   `## Phrase`, `## Reasoning so far`, `## Open questions`.
6. Make explicit that subsequent sub-commands (`prototype`,
   `migrate`) will refuse to run while direction is pending.

## What the agent MUST NOT do

- Silently map "amazing" to a hard-coded command sequence.
- Author tokens from a guessed direction.
- Ask more than two questions in one turn.
- Pick a sequence that "covers all bases" (`bolder + colorize +
  typeset + ...`) to avoid asking. That is the opposite of
  reasoning publicly.
- Fall through to "make it better" defaults by treating "amazing"
  as a synonym.
