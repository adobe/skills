# Intent reasoning

This file defines the procedure stardust runs whenever the user gives a
freeform redesign phrase. The procedure is mandatory: stardust never
silently maps a phrase to a sequence of commands. It reasons in public,
shows the plan, and only then executes.

---

## Inputs

- The user's freeform phrase (e.g. "make it better", "make it more
  expressive for a young audience", "less corporate", "more Linear, less
  Salesforce").
- The current `stardust/direction.md` if one exists.
- The current `PRODUCT.md` and `DESIGN.md` (target) and
  `stardust/current/PRODUCT.md` and `DESIGN.md` (extracted from existing
  site), if present.
- The page inventory in `stardust/state.json`.
- Impeccable's command registry (`command-metadata.json`) and the per-command
  guide in `impeccable-command-map.md`.

## Procedure

### Step 1 — Restate

Restate the user's phrase in stardust's dimensional vocabulary
(`intent-dimensions.md`). This is the "what I think you mean" sentence.

Output shape:
```
Reading "<phrase>":
  • register:        <brand|product|inherited>
  • expressive axis: <restrained|committed|drenched, direction or fixed>
  • tone:            <serious|neutral|playful, direction or fixed>
  • density:         <airy|balanced|packed, direction or fixed>
  • distinctiveness: <familiar|distinctive|singular, direction or fixed>
  • audience:        <captured tuple or "underspecified">
  • constraints:     <list or "none stated">
```

### Step 2 — Identify movement

For each dimension, mark whether the phrase **moves** it (with direction),
**pins** it (constraint), or **leaves it alone**. A dimension left alone
inherits from the prior `direction.md` if present, otherwise from
`PRODUCT.md`, otherwise from the extracted current state.

### Step 3 — Identify gaps

List the dimensions that are underspecified and would meaningfully change
the redesign if pinned one way or another. Audience is the most common gap
in practice; the expressive axis is the second most common.

### Step 4 — Ask at most two clarifying questions

Pick the **at most two** gaps whose resolution most changes the plan. Skip
questions whose answer the agent can infer with high confidence from
context. Never ask more than two — if more are missing, pick the highest
leverage two and document the rest as assumptions in the plan.

A clarifying question must:
- Be answerable in one short sentence.
- Offer two or three concrete options *and* an "other" escape hatch.
- Cite which dimension it resolves.

### Step 5 — Map to impeccable commands

Given the resolved direction, build a sequence of impeccable commands
using `impeccable-command-map.md` as the reference. The sequence must:

- Start with information gathering if needed
  (`$impeccable critique` against `stardust/current/`,
  `npx impeccable detect --json`).
- Place build-or-refine commands in dependency order
  (`shape` before `craft`; `bolder`/`quieter`/`distill` before `polish`).
- End with `$impeccable polish` unless the user is mid-iteration.
- Include any divergence-toolkit checks that apply (see `direct/reference/divergence-toolkit.md`).
- Cite each command with one short sentence of reasoning ("running `bolder`
  to move the expressive axis from restrained to committed").

### Step 6 — Show the plan

Present the plan to the user as a single block:

```
Plan
====

I read your intent as: <one-sentence summary in dimensional terms>.

Assumptions (defaults I'm using unless you correct me):
  - <assumption 1>
  - <assumption 2>

Commands I'll run, in order:
  1. <command> — <why>
  2. <command> — <why>
  ...

Pages affected: <list, or "all approved pages">.
Pages that will be marked stale: <list, or "none">.

Reply "go" to execute, or correct anything above first.
```

The user's confirmation may be implicit if they were already operating
inside an active sub-command's loop and the plan is small. Use judgement —
when in doubt, ask explicitly.

### Step 7 — Execute, then record

Execute the commands in order. After each command:

- Stream a one-line status to the user.
- Update `stardust/state.json` to reflect any page state transitions.

When the sequence completes, append the resolved direction, the chosen
commands, and the reasoning trace to `stardust/direction.md`. Use the
direction-format described in `direct/reference/direction-format.md`.

If the user changes direction later, mark prototyped or migrated pages
**stale** per `state-machine.md`. Do not auto-re-run.

---

## Hard rules

- Never collapse the user's phrase to a category and look up commands.
  Always reason on dimensions.
- Never run more than what the plan promised. If during execution a new
  command becomes obviously needed, pause and ask.
- Never run a command whose preconditions aren't met. If `$impeccable
  craft` needs a brief and `shape` hasn't run, run `shape` first as part of
  the plan, not as a hidden side effect.
- Two clarifying questions is a hard ceiling per turn. If more are needed,
  the agent's restatement is too coarse and should be refined first.
- Worked examples in `intent-examples.md` teach the *style* of reasoning;
  they are not a vocabulary to match against.
