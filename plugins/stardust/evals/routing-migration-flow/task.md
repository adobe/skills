# Eval: routing a migration ask to the right flow

Pins the master skill's § Two migration flows as an *enforced* contract:
the flow is chosen on the ask, recorded in `state.json`, and the
sub-skills refuse to run a migration whose flow was never chosen. Four
phrasings run as four sessions against the same setup.

## Setup

A fresh project directory with no `stardust/` state (`fixture/` is empty).
The stardust plugin is installed. The target is https://stripe.com, the
suite's live crawl target (see `extract-multipage`). Nothing else is
present — no EDS scaffold, no prototypes.

This is a live-network eval: the routing decision itself needs no network,
but a session that proceeds into `replica` or `prepare-migration` will
crawl the target. Reachability drift is expected maintenance.

Prompt 1 is interactive: the runner answers the keep-vs-redesign question
from `answers.md` ("keep the design") and confirms any plan.

## User prompt

"$stardust migrate this page to EDS https://stripe.com"

The persona answers the keep-vs-redesign question with "keep the design".
Three further phrasings exercise the phrase-list routing; the runner
executes only the first prompt today (multi-step evals need a per-step
hook — see `runner/README.md` § Known caveats), so they are documented
here for a future runner and are NOT scored by criteria.json:

## User prompt (run 2)

"$stardust migrate https://stripe.com to EDS keeping the current design"

## User prompt (run 3)

"$stardust build an exact replica of https://stripe.com on EDS, 1:1"

## User prompt (run 4)

"$stardust redesign and migrate https://stripe.com to EDS"

## Expected behavior

**Prompt 1 (plain migration ask).** The first response names both
flows and asks the one keep-vs-redesign question — nothing else — before
any sub-skill loads. No crawl, no `migrate`, no `prepare-migration`, no
`replica` runs before the answer. After an answer ("keep the design"),
`state.json.flow` is `replica` with `flowSource: "question"`, and the
`replica` skill is invoked.

**Prompts 2 and 3 (keep-design phrases).** No question. The first
response states the flow (`replica`) and that `replica` needs no
`prepare-migration` step. `state.json` records `flow: "replica"`,
`flowChosenAt`, `flowSource: "user-phrase"`. The `replica` skill is
invoked; `prepare-migration` is never loaded; `direct` is never invoked
on the replica phrase. If `direct` is reached at all, it writes only the
zero-movement hand-off note and stops.

**Prompt 4 (redesign phrase).** No question. The first response states
the redesign flow; `state.json.flow` is `redesign`; the agent invokes
`prepare-migration` (or `extract` → `direct` → `prototype`) and never
`replica`.

**All prompts.** The agent does not build its own crawler, importer or
compiler; any deviation from a skill phase would have to be recorded as a
named deviation in `stardust/direction.md`. The `migrate` skill is never
the first sub-skill invoked on a fresh project.
