# Eval: phase checkpoint with the one next command

Pins the phase-close contract of a stardust sub-skill: when a phase
finishes, the closing report is a **checkpoint** a fresh session (or a
harness that lost its turn) can resume from without re-deriving anything
— what was completed, what was verified, the one command that continues
the run, and what a re-run would skip because it is already done. The
`direct` phase is the vehicle because it is short, interactive, and ends
with a well-defined next step (`prototype`).

## Setup

The `direct-from-phrase` fixture, unchanged: a project with `extract`
already complete on a fictional B2B bookkeeping SaaS site.

- `stardust/state.json` lists 5 pages, all status `extracted`;
  `direction` is `null`; no `flow` key.
- `stardust/current/PRODUCT.md`, `DESIGN.md`, `DESIGN.json` and
  `_brand-extraction.json` exist (signal-strong brand surface, so
  brand-faithful Mode A fires by default).
- `stardust/journal.md` has one entry (the extract run) whose `Next:`
  line recommends `direct`.
- `stardust/status.jsonl` holds the extract phase lines only.
- No project-root `PRODUCT.md` / `DESIGN.md` / `DESIGN.json`; no
  `stardust/direction.md`.
- Impeccable installed.

A user is present. The persona in `answers.md` accepts every default the
agent proposes and confirms the plan with "go".

## User prompt

"$stardust direct make the type larger and calmer"

## User prompt (run 2 — same prompt, same workspace; not executed by the runner today)

"$stardust direct make the type larger and calmer"

The runner executes only the first prompt (see `runner/README.md`
§ Known caveats). Run 2 is documented so a manual re-run can be judged
against the same rubric; the criteria pin only what run 1's checkpoint
*says* about a re-run, not the re-run itself.

## Expected behavior

**Run 1.** The `direct` skill is invoked with the phrase. It:

1. Runs the master setup (impeccable dependency, state read) and
   restates the phrase in dimensional vocabulary: type scale moves up,
   the expressive axis and tone move toward restrained / calm; density
   and IA fidelity are unmoved.
2. Asks at most two clarifying questions (density tuning and IA
   fidelity, paired), each with options and a stated default. The
   persona takes the defaults.
3. Shows the plan (restatement, assumptions, command sequence, pages
   affected) and waits for "go" before writing anything.
4. Resolves divergence inputs under Mode A (palette and type families
   pinned from the captured surface; the type *scale* is the move).
5. Authors `PRODUCT.md`, `DESIGN.md`, `DESIGN.json` at the project root
   and `stardust/direction.md` with the `# Active direction` section.
6. Updates `stardust/state.json`: all 5 pages `extracted` → `directed`
   with a new history entry each; `direction.resolvedAt`,
   `direction.phrase` (verbatim), `direction.directionFile` set; key
   order preserved.
7. Appends one entry to `stardust/journal.md` (prior entry untouched)
   whose `Next:` line carries the next command.
8. Appends `start` / `end` lines to `stardust/status.jsonl` for its
   phases; the final `end` line carries a `next` field with the same
   command (W1 target).
9. Ends the turn with a **checkpoint block** inside the closing report,
   with four parts:
   - **Completed** — every file written this phase, by path; each path
     exists in the workspace.
   - **Verified** — what was checked after writing and how (files
     re-read or listed, `state.json` parses, the page count re-read from
     the artifact rather than remembered) (W1 target).
   - **Next** — exactly ONE command, printed verbatim so it can be
     pasted (`$stardust prototype` or `$stardust prototype <slug>`),
     with no alternatives and no question attached; identical to the
     journal `Next:` line.
   - **On re-run** — what a second invocation of the same prompt would
     skip because it is done (no re-reasoning, no rewrite of the target
     spec, no state change: the direction exists and the pages are
     already `directed`) and what it would do instead (ask before
     replacing the direction, per the skill's `--re-direct` contract)
     (W1 target).
10. Asks nothing after the checkpoint; the block is the last thing in
    the turn.

**Run 2 (manual).** On the same workspace the agent starts from the
state report, sees the direction is resolved and the pages `directed`,
does not restate axes or ask density / IA questions again, asks whether
to replace the existing direction (persona: keep it), writes no target
spec files, changes no page status, and ends with the same checkpoint
shape whose Completed part says "nothing new" and whose Next part is the
same command as run 1.
