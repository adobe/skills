# Eval: runner output contract on a batch verify

Pins the runner-output contract for batch checks: a gate/QA/fidelity runner
that produces many per-page results reports to the conversation as a
**ranked class table** (class → count → worst example → file pointer), writes
the full per-page listing to `summary.json` + `summary.md` under the owning
skill's `stardust/<skill>/` directory, triages per class, and hands off by
naming those files. Per-page listings never enter the conversation.

Exercised on `rollout`'s offline full-site verify (Phase E, `--root`) over the
shared post-migrate fixture. Criteria marked **(W1 target)** pin the contract
as it will read once the rule lands; they fail on 0.23.0 by design and give
the baseline reader the before/after.

## Setup

`fixture/` is the shared post-migrate tree (`evals/_shared/fixture-post-migrate/`)
with four defect classes seeded on top (`seed-defects.mjs`, sibling of this
file). A fictional regional financial-services site on a `.example` origin —
nothing is live, no network is needed, no EDS target or token exists.

- `stardust/state.json`: `flow: "replica"`, six pages `migrated` (two each of
  `landing`, `article`, `program`), `migrate` block with `selfContained: true`.
- `stardust/replica/progress.json`: `landing` passes, `article` is over the
  bar with cause-logged residuals, `program` was never gated.
- `stardust/journal.md` (four entries) and `stardust/status.jsonl` end on a
  rollout Setup `blocked` for the `program` type; the last `Next:` line says
  to gate `insurance__home` first.
- No `stardust/rollout/` directory — inventory has never run.
- Seeded defects in `stardust/migrated/` (the judge's answer key; the agent
  discovers them through the runner):

  | class | where | what `verify.mjs --root` reports |
  |---|---|---|
  | internal link to a path outside the migrated set (`/claims/`) | every footer (6 pages) | `broken internal links: /claims` on 4 pages — on `business` and `news__annual-report-2025` an earlier check wins and masks it |
  | internal link to a members area (`/members/login/`) | primary nav of both `program` pages | same class, second target on `insurance__home`, `insurance__auto` |
  | second `<h1>` | `news/annual-report-2025/index.html` | `page should render exactly one <h1>, found 2` |
  | `about:error` marker (broken-image ingestion) | `business/index.html` | `about:error in body (#75 broken image)` |
  | page type blocked by the gated-archetype precondition | `insurance/home`, `insurance/auto` | not a verify finding — comes from rollout Setup reading `progress.json` |

Interactive session: the runner answers any question from `answers.md`
(defaults, "go", deliver nothing).

## User prompt

"$stardust rollout — verify links and delivery status for all six migrated pages, offline against the local migrated tree. Don't deliver anything yet."

## Expected behavior

1. Master setup, then `rollout` Setup. `flow` is present, so no
   keep-vs-redesign question. The gated-archetype precondition names the
   `program` type as blocked with its archetype slug (`insurance__home`) and
   the command to gate it; `landing` and `article` may ship. This is not a
   reason to stop: the ask is an offline structural verify that delivers
   nothing, so it covers all six pages.
2. The EDS-target readiness check does not block an offline run: no
   `DA_TOKEN` lookup, no HTTP request, no publish or `POST /live/` call.
3. Phase A: `inventory.mjs` builds `stardust/rollout/coverage/pages.json`
   (six pages, all `pending`).
4. Phase E: `verify.mjs --root stardust/migrated --all` (offline mode, every
   page regardless of delivery status). The agent uses the shipped runner;
   an agent-written link checker would have to be recorded as a named
   deviation in `stardust/direction.md`.
5. **(W1 target)** The report to the user is a ranked class table, one row
   per finding class: class → count → worst example (slug + reason) → file
   pointer (where the affected pages are listed). Rows sorted by count, ties
   by severity. The whole report stays under 60 lines. All five classes from
   the Setup table appear (the two link targets may share one row or have
   one each).
6. **(W1 target)** `summary.json` and `summary.md` are written under
   `stardust/rollout/` (any subdirectory, e.g. `stardust/rollout/verify/`).
   The JSON holds every page × every finding (slug, reason, file pointer)
   plus the class roll-up; the Markdown is the human view of the same data.
   The counts in the conversation equal the counts in the JSON.
7. **(W1 target)** No per-page listing enters the conversation: the runner's
   per-page `✗` lines are summarised, not pasted; `pages.json`,
   `summary.json` and `summary.md` are not echoed; no one-line-per-page
   enumeration beyond the worst example per class. Six pages make a full dump
   short — the contract is judged on shape, not on length.
8. **(W1 target)** Triage happens per class: one recommended action per row
   (e.g. migrate or localize the `/claims/` target; decide the members-area
   link with `dynamics`; demote the second `<h1>`; re-ingest the image), each
   pointing at `summary.md` for the affected pages. No per-page fix list.
9. **(W1 target)** The hand-off note names `summary.json` and `summary.md` by
   path as the place to continue from, and the next command
   (`$stardust replica insurance__home`, then the class actions).
10. Inputs stay read-only: `stardust/migrated/**`, `state.json`,
    `progress.json` and `direction.md` are unchanged; writes land only under
    `stardust/rollout/`, plus an appended `journal.md` entry and
    `status.jsonl` lines.
11. `journal.md` gains a fifth entry (the four prior entries intact) whose
    `Next:` line names the summary files; `status.jsonl` gains rollout
    start/end lines for the phases run.
