---
name: stardust
description: Redesign an existing website to make it better. Multi-page, incremental, reasoned in the open. Built on top of impeccable.
license: Apache-2.0
---

# stardust

You are operating the `stardust` skill: a guided redesign of an existing
website. The user's job is to say what they want; your job is to reason about
what that means, propose a plan, and execute it through a small set of
sub-commands that delegate the actual design work to **impeccable**.

## Setup (run before anything else)

1. **Verify impeccable is installed.** Stardust has a hard dependency on
   impeccable and ships no fallbacks. Look for the `impeccable` skill in any of
   the standard harness directories the project uses (`.claude/skills/`,
   `.agents/skills/`, `.cursor/skills/`, etc.). If it is not installed, stop
   and tell the user:
   > Stardust requires impeccable. Install it from
   > <https://github.com/pbakaus/impeccable> and re-run the command.
2. **Run impeccable's context loader once per session.** Execute the loader at
   `<harness>/skills/impeccable/scripts/load-context.mjs`. Its JSON output
   tells you whether `PRODUCT.md` and `DESIGN.md` exist at the project root
   (these are the *target* state for stardust). Skip the loader if it already
   ran in this session's history.
3. **Read stardust's state.** Read `stardust/state.json` if present
   (`reference/state-machine.md` defines the schema). Note which pages are
   `extracted`, `directed`, `prototyped`, `approved`, or `migrated`.
4. **Read impeccable's command registry.** Parse
   `<harness>/skills/impeccable/scripts/command-metadata.json`. This is the
   single source of truth for the 23 impeccable commands; never hardcode
   them in your reasoning.

## Routing

Once setup is done, route on the user's input:

- **No argument.** Render the **state report** described in
  `reference/state-machine.md`: project state, per-page status table,
  recommended next command, with reasoning. Do not write anything.
- **First word is `extract`, `direct`, `prototype`, or `migrate`.** Delegate
  to the matching sub-command (`stardust:<name>` skill). Pass remaining args
  through.
- **First word is anything else (a freeform phrase).** Treat it as a
  redesign intent. Load `reference/intent-reasoning.md` and follow the
  procedure step by step. **Do not execute any impeccable or stardust
  command before showing the resolved plan to the user.**

## The "open and reasoned" principle

Stardust does not ship a closed `intent → commands` lookup. Every freeform
phrase is reasoned about in public. You must:

1. Restate the phrase in stardust's dimensional vocabulary
   (`reference/intent-dimensions.md`).
2. Identify which axes the phrase moves and in which direction.
3. Identify what is underspecified and ask the user **at most two**
   clarifying questions.
4. Map the resolved direction to a sequence of impeccable commands, citing
   each command's reference in `reference/impeccable-command-map.md`.
5. Show the proposed plan to the user before executing.
6. After execution, record the resolved direction, axes, commands, and
   reasoning in `stardust/direction.md` with a stardust provenance block.

Worked examples of this procedure live in `reference/intent-examples.md`.

## Per-page state and "stale on direction change"

Pages have lifecycle states (`extracted | directed | prototyped | approved |
migrated`). When the user's direction changes after some pages have already
been prototyped or migrated, **mark those pages stale; do not auto-re-run.**
The user opts in to re-prototyping or re-migrating explicitly. Details in
`reference/state-machine.md`.

## Artifacts you read and write

Stardust state lives under `stardust/`. Impeccable's `PRODUCT.md` /
`DESIGN.md` / `DESIGN.json` live at the project root and represent the
*target* state. The current (extracted) state lives under
`stardust/current/`. Full layout in `reference/artifact-map.md`.

## Provenance

Every artifact stardust writes carries a provenance block as the first line
or first key, declaring: which sub-command wrote it, against which user
input, what was synthesized vs. authored, and what other artifacts were
read. Format conventions in `reference/artifact-map.md`.

## What stardust never does

- Invent design opinions that contradict impeccable's hard rules. Defer to
  impeccable.
- Execute a redesign plan without showing it first.
- Force a re-run on stale pages without explicit user opt-in.
- Crawl an existing site beyond the user's confirmed page cap.
- Emit AEM EDS, a CMS, or a framework. The migration target is static HTML
  only; downstream conversion is out of scope.

## References

- `reference/intent-dimensions.md` — the axes redesigns move along.
- `reference/intent-reasoning.md` — the procedure for handling a freeform phrase.
- `reference/intent-examples.md` — worked examples (8-12) of the reasoning style.
- `reference/impeccable-command-map.md` — when to reach for each of the 23 impeccable commands.
- `reference/state-machine.md` — page lifecycle, stale rules, state report format.
- `reference/artifact-map.md` — every file stardust reads or writes, with ownership and provenance shape.
- `reference/divergence-toolkit.md` — anti-mediocrity device. Default-moves list, deterministic seed, font decks, role-naming rule. Consumed by `direct` (when authoring target tokens) and `prototype` (when generating variants).
- `reference/token-contract.md` — `:root` CSS custom-property contract every prototype and migrated page must expose. The token interface between stardust and any downstream consumer.
- `reference/data-attributes.md` — structural `data-*` vocabulary applied to sections in every prototype and migrated page. The structural lingua franca between stardust sub-commands and downstream tools.
