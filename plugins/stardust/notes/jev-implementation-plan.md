# Stardust + Jev — implementation plan to a testable build

Written 2026-09-27 against stardust 0.28.0 (branch `research/jev-autonomous-migration`). Companion
to `jev-system-one-research.md` (why) and `../evals/jev-batteries/BASELINE.md` (what is measured).
This is the plan we implement against; each phase names its deliverables, its acceptance test and
what it depends on. Site names never appear here; project folders are referred to by role.

## What "ready to test" means

A hands-off `replica` run on a real site in which:

1. every wired joint runs the decision layer **beside** the agent's own judgment (shadow mode), or
   **in front of it** (assist mode) where the battery has passed its bar, and both answers land in
   `stardust/decisions.jsonl`;
2. the supervisor batteries check every ledger `end`, every subagent brief and every flow
   decision, and `--strict` refuses on a confident finding;
3. the run can be repeated with `STARDUST_DECIDER=off` on the same site, so the two runs are the
   A/B that the KPI table in the research note asks for;
4. each battery in use has a table in `BASELINE.md` and a version; nothing gates on an unmeasured
   battery.

Everything in the plan keeps the rule from the research: Jev decides, code owns the flow, the
agent generates. No gate bar, no instrument and no pass threshold changes because of this work.

## Decider modes (cross-cutting, phase 1)

`STARDUST_DECIDER` — read by `decide.mjs` and by every wired step:

| mode | what a wired step does | when |
|---|---|---|
| `off` | the agent decides as today; no call | default until phase 1 lands; the "without" arm of the A/B |
| `shadow` | the agent decides; the battery runs on the same state; both are logged; disagreement at confidence ≥ bar marks the item `review` in the ledger, changes nothing else | first wiring of every battery |
| `assist` | the battery runs first; the agent receives its answer, probability and route with the state and confirms or overrides in one line; overrides are logged | after a battery's shadow agreement ≥ 90 % at its `act` bar over two runs |
| `gate` | the battery's `act` verdict is taken without the agent; `review` and `escalate` go to the agent | only for supervisor batteries, and only after assist has run clean on two sites |

The mode is per run, stamped in `state.json.decider` and in `direction.md` by the master setup.

## Phase 0 — done (0.28.0)

`decide.mjs` (client, cache, routing, ledger, tests), eleven batteries, `evals/jev-batteries/`
(harvest, replay, BASELINE). Measured: page-type go, dynamics class go, flag-justify go as a
pre-sort; section-alignment and residual-causes not yet; the rest unmeasured. Nothing wired.

## Phase 1 — the wiring contract (2–3 days)

Goal: one way to add a `decide` step to any skill, with the modes above, and a way to read the
ledger back.

Deliverables
- `decide.mjs`: `--mode` from `STARDUST_DECIDER` (`off|shadow|assist|gate`); `--agent <answer json>`
  to record the agent's answer beside Jev's in shadow/assist; `compare [--run <id>] [--battery <b>]`
  subcommand summarising agent-vs-Jev agreement per battery and confidence bin from
  `decisions.jsonl`; `--run-id` stamped on every line (from `state.json.runId`, else a timestamp).
- `decisions.jsonl` schema documented in `skills/stardust/reference/run-status.md` (one section) and
  validated by `decide.mjs compare --check`.
- Master skill Setup: stamp `decider` mode; print the mode in the state report; `stardust status`
  (when it exists) shows decision counts and agreement.
- `state.mjs`: a `decisions` roll-up per page (`agentType`, `jevType`, `confidence`, `route`) so
  migrate and rollout can read it without parsing the ledger.
- Tests for every new path; `--help` text; scripts index row updated; CHANGELOG.

Acceptance: `decide.mjs page-type --mode shadow --agent '{"type":"article"}' --state s.json` writes
one line carrying both answers; `compare` prints the agreement table; lint and tests pass.

Met 2026-09-27 (commit b51be27d + 74034161).

Depends on: nothing.

## Phase 2 — wire the three measured batteries in shadow mode (3–4 days)

Goal: the first real ledger of agent-vs-Jev disagreement from a full run.

Deliverables
- **page-type** in extract prep: after the agent types the roster, a new
  `extract/scripts/type-pages.mjs` builds one state per page (path, title, headings, counts, and
  per type the example paths + lead heading of the archetype and first siblings, exactly as the
  eval harvests it) and runs the battery over the roster (concurrency 6, cached). Shadow: writes
  `jevType`/`confidence` into the state roll-up; disagreement at ≥ 0.9 marks the page `review`.
  Assist (later): the agent sees Jev's type first. Prose: one paragraph in extract § Prep mode.
- **dynamics class** in dynamics Phase 2: `dynamics-plan.mjs` gains `--decide`: the draft's class
  column is pre-filled by the battery with its probability; disposition and reproducibility stay
  the agent's. Prose: one line in dynamics § Phase 2.
- **flag-justify** in the gate: a new `replica/scripts/gate-flags.mjs` reads a round's
  `content-diff-*.txt` and `visual-diff-*.txt`, builds one state per flag with the capture-state
  policy and the register, runs the battery, and prints the flags **pre-sorted**: decisive defect,
  decisive not-a-defect, unsure — with P(defect) on each line. `gate.sh --full` calls it after the
  probes (shadow: printed only; assist: the agent works the decisive-defect list first and must
  justify a decisive-not-a-defect it wants to fix). Prose: two lines in the gate doc § Band
  breakdown.
- Harness-neutral wording; Copilot runs the same scripts.

Acceptance: the three wired steps run in shadow on a recorded project copy in the project-copy
layout (`stardust/scripts/<skill>/`) with zero decide errors; `compare --check` passes and shows
the three batteries; each step costs seconds, not turns (shadow must cost nothing visible). The
full bounded `replica` run in shadow is phase 7's first arm.

Met 2026-09-27: 12 pages typed in 0.8 s (12/12 agree), 84 dynamics rows in 3.8 s (class 78.6 %
agreement with the catalogue, 13 confident disagreements marked review), one gate round's flags
in 0.35 s; zero errors.

Depends on: phase 1.

## Phase 3 — supervisor batteries for workflow reliability (4–6 days)

Goal: the agent's prose at every joint is checked by a literal reader before the joint closes.

Batteries (new, under `scripts/batteries/`)
- `phase-claim`: state = the ledger `end` line's `detail`, the journal section for the phase, and
  the phase's expected evidence list (from `run-status.md`). Nouls: `cites_instrument_output`,
  `asserts_without_evidence`, `declares_skip_or_deferral`, `names_residual_with_cause`. Route: a
  confident `asserts_without_evidence` or `declares_skip_or_deferral` → `review`.
- `brief-check`: state = a subagent brief + the checklist the phase requires (owned paths, gate
  commands, contract sections by name). One noul per checklist item, `missing_any` computed in code.
- `plan-vs-flow`: state = the agent's stated next step + `state.json` flow, phase and unit status.
  Choice over the flow's legal next units + `none`; noul `proposes_out_of_order_step`.
- `decision-batch`: state = a message to the owner. Nouls: `one_batch_not_serial`,
  `each_decision_named`, `interim_recorded`.

Harvest and measure
- `harvest.mjs` gains `phase-claim` (ledger `end` lines + journal sections from the recorded
  projects; label from outcome: the phase was reopened, the page later failed the published gate,
  or the residual was found by the owner → `asserted`; otherwise `evidenced`), `brief-check`
  (briefs from the transcript corpus; label = the recorded omission, e.g. the 27/27 editability
  case), `plan-vs-flow` (first-command misroutes recorded in CHANGELOG 0.23.0 and the resume
  sessions). Target ≥ 300 items per battery. `BASELINE.md` sections for each.

Wiring
- `ledger.mjs end`: runs `phase-claim` when `STARDUST_DECIDER` ≠ `off`; under `--strict` a confident
  `review` refuses the `end` and prints the finding (the same shape as the missing-start refusal).
- Deploy Step 7 / rollout fan-out: `brief-check` before dispatch; assist mode prints the missing
  items; gate mode blocks dispatch.
- Master skill routing and resume: `plan-vs-flow` on the first proposed command of a session.
- `dynamics` decision batch: `decision-batch` on the owner message.

Acceptance: on the corpus, `phase-claim` catches ≥ 80 % of the labelled asserted claims at a
false-refusal rate ≤ 5 % on evidenced ones; `ledger.mjs end --strict` refuses a fabricated
"gated by eye" line in the test and accepts a line that cites `pixel-final.txt`.

Depends on: phase 1. Independent of phase 2 (can run in parallel).

## Phase 4 — measure the remaining batteries (4–5 days, mostly harvesting)

Goal: every shipped battery has a BASELINE table or a written reason it cannot have one yet.

- `block-triage` + `block-fit`: harvest from `eds-conversion-log.md` block tables (name, tier,
  notes) joined to `eds-schema/<page>.json` sections; labels: block name (reuse), decode tier,
  default-content sections from D1 rows. Expect ≥ 400 sections.
- `red-adjudication`: harvest from published-regime `content-diff-pub*.txt` flags and the pages'
  `contentDeviations[]`; label from what the run did (fixed / deviation logged / justified).
- `residual-causes` v2: state = the round's `pixel-*.txt` band table + `anchor-*.txt` deltas
  bucketed by code + chrome-parity summary + font-loaded warnings; labels hand-checked on the 247
  keyword labels (one pass, ~2 h).
- `section-alignment` v2: state = per-unit composition (`repeats[].unit`) + item roles with text
  clipped; ~100 pairs hand-labelled including the variant level.
- `metadata-select`: harvest the titles/descriptions the runs authored (from `content/*.html`
  metadata blocks) + candidates from the captured page; label = the authored value when it equals a
  candidate.
- `flow-routing`: harvest first prompts + chosen flow from the transcript corpus (48 sessions),
  including the recorded misroutes as negatives.
- `repair-priority`: hand-rank 30 failing rows of the recorded all-pages table by two people;
  measure rank correlation, not agreement.

Acceptance: BASELINE.md has a section per battery with go / pre-sort / not-yet, and the batteries
README table carries the status column.

Depends on: phase 0 only; parallel to 2 and 3.

## Phase 5 — fix-loop assist (3–4 days)

Goal: fewer wasted gate rounds, consistent diagnosis across parallel archetype agents.

- `valid-round` battery: state = the round's verdict lines and capture notes (exit codes, fonts
  status, challenge markers, doc heights); nouls `instrument_invalidated`, `origin_unsettled`,
  `fonts_fallback_loaded`. Harvest: rounds the runs excluded from the cap vs rounds counted.
- `fix-pattern` battery: choice over the recreation-procedure catalogue (wrap-junction margins,
  span-face fork, scrim luminance, fixed chrome static, granularity parity, sizing model, offset
  contamination, chrome generation, pipeline transform, capture state) + `none`; state = anchor
  deltas bucketed into words + hot band + chrome-parity lines. Labels: ~60 rounds hand-labelled
  from journals and gate dirs.
- `gate.sh --full` prints, after the verdict lines, one `decide:` line per round: valid-round
  verdict, fix-pattern top choice with probability, and the pre-sorted flags from phase 2. Assist
  mode only; the agent still picks the fix.
- `residual-causes` at the cap: the same line names causes with probabilities for the residual
  ledger entry; the agent edits, never types from scratch.

Acceptance: on recorded rounds, `valid-round` flags ≥ 90 % of the rounds the runs later excluded;
`fix-pattern` top-1 agrees with the hand label ≥ 70 % and the label is in the top-2 ≥ 85 %.

Depends on: phases 1 and 4 (residual-causes v2).

## Phase 6 — repair queue in rollout (2 days)

Goal: after `gate-all`, failing rows are repaired in reader-harm order and cosmetic failures are
queued for a documented override rather than a fix round.

- Port the demo `repair-queue.mjs` into `rollout/scripts/repair-queue.mjs`: reads
  `gates/all-<w>/summary.json` and per-row probes, runs `repair-priority`, writes
  `stardust/rollout/repair-queue.{json,md}` (rank, harm, scope, template-wide, reasons).
- Rollout Phase E/F: fix rounds follow the queue; template-wide rows go to the block owner once;
  cosmetic rows are proposed as `overrides.json` entries with the reason, for the agent (assist)
  or the owner to accept — never silently.
- Handoff contract § 3 row C: one line pointing at the queue after the roster `gate-all`.

Acceptance: on the recorded 96-page table the queue reproduces the demo ordering; a rollout
dry-run consumes it; tests for the script's pure parts.

Depends on: phase 1; phase 4's repair-priority ranking check.

## Phase 7 — the test protocol (1 day to write, 2–4 days to run)

Goal: the A/B that answers the KPI question with numbers, not estimates.

- Two sites: one with a clean origin (no bot management), one hostile (a bot-managed origin), each
  10–20 pages, replica flow, hands-off.
- Arms: `STARDUST_DECIDER=off` and `=assist` (supervisor batteries in `gate` where phase 3 passed),
  same prompt, same plugin version, same model, run on the same day.
- Collected per arm: wall-clock; assistant turns and tool calls; output, cache-read and
  cache-write tokens; pages within the full four-criteria bar at the published origin; gate
  rounds per archetype and rounds excluded as invalid; flags fixed / justified / left; residuals
  with a named cause; human touches; supervisor refusals and whether each was right;
  `decide.mjs compare` agreement per battery; Jev tokens and cost.
- Report template `evals/jev-batteries/AB-TEMPLATE.md`; results appended to `BASELINE.md`.

Acceptance for "ready to test": phases 1, 2 and 3 complete with their acceptance tests; phase 4
tables exist for every battery in use; a shadow run on a recorded project copy completed clean.
Phases 5 and 6 improve the assist arm but are not required to start the A/B.

## Order and milestones

```
phase 1 ──► phase 2 (shadow wiring) ──► M1: first shadow ledger from a full run
   │
   ├──────► phase 3 (supervisor) ─────► M2: ledger.mjs end --strict refuses asserted claims
   │
   └──► phase 4 (measure the rest) ──► phase 5 (fix-loop assist) ──┐
                                        phase 6 (repair queue) ─────┴► M3: assist arm complete
M1 + M2 + phase 4 tables ──► phase 7 ──► M4: A/B report
```

Estimated effort to M4: 20–28 working days of implementation plus 2–4 days of runs, in the
plugin's own conventions (every script answers `--help`, has a test and an index row; prose
additions fold something; CHANGELOG entry and version bump per phase). Jev spend for all
measurement and both test arms: under $10.

## Out of scope for this plan

The code-owned engine (research note § 6, option A2). Everything above is designed so the
`decide` steps, the supervisor batteries and the repair queue are the engine's decision layer
when it is built; none of it has to be redone.

## Risks to watch while implementing

- Shadow mode must be invisible in cost: every battery call runs from a script, never from the
  agent's context, and the agent reads one summary line, not the answers.
- Batteries drift with wording: bump `version` on any change and re-run the replay before wiring.
- Labels from recorded runs are agreement, not truth; hand-labelled sets (residual-causes,
  section-alignment, fix-pattern, repair-priority) are the ones to trust for thresholds.
- The vendor is early access: pin `jev-1.13.0`, keep `off` a one-variable switch, and never let a
  `decide` failure block a run — exit 3 or 4 falls back to the agent, logged.
