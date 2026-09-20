# Eval: resume — the state report comes first

Pins the master skill's resume contract as written in `skills/stardust/SKILL.md`
§ Routing ("No argument" and the resume rule), rendered in the shape of
`skills/stardust/reference/state-machine.md` § State report, with the journal
read per `skills/stardust/reference/journal-format.md` § Reading the journal at
session start. Two phrasings run as two sessions against the same setup: the
bare invocation and a plain resume phrase that never says "stardust".

## Setup

A keep-design migration project, frozen right after `replica` + `migrate` ran
on three page types and a rollout attempt was blocked. `fixture/` is a copy of
the shared post-migrate fixture (`evals/_shared/fixture-post-migrate/`, see its
README) plus a pre-seeded `stardust/.gitignore`, so the master skill's Setup
has nothing to write. The site is a fictional regional financial-services
site on a `.example` origin — nothing here is reachable, nothing was crawled.

What the agent finds on disk:

- `stardust/state.json` — `flow: "replica"` (`flowSource: "question"`,
  chosen 2026-09-14); six pages, all `migrated` (two per type: `landing`,
  `article`, `program`); `site.deployUrl: null`; no stale pages.
- `stardust/replica/progress.json` — the per-archetype gate ledger:
  `home` (landing) passes at 1440 and 360; `news__storm-season-checklist`
  (article) is over the bar at both breakpoints with every residual
  cause-logged; `insurance__home` (program) was never gated
  (`gated: false`, empty `breakpoints`).
- `stardust/journal.md` — four entries; the last one (2026-09-14) ends with
  `**Next:** $stardust replica insurance__home — gate the program archetype
  at 1440 and 360, then $stardust rollout.`
- `stardust/status.jsonl` — last line: rollout `setup` `blocked` on the
  program page type.
- `stardust/direction.md`, `stardust/replica/inconsistency-register.md`,
  `stardust/migrated/**` — present and consistent with the above.
- Not present (as in the shared fixture): `stardust/current/`,
  `stardust/prototypes/`, `stardust/replica/gates/`, the root `PRODUCT.md`
  / `DESIGN.md` / `DESIGN.json`. The report may note the absence; it must
  not re-run `extract` to repair it.

The runner presents both sessions as interactive (`answers.md`). Both
scenarios start from the identical fixture; no workspace edit is needed
between them. The runner automates the first `## User prompt` section; run
scenario 2 as a separate invocation of the same eval.

## User prompt (scenario 1 — bare invocation)

"$stardust"

## User prompt (scenario 2 — resume phrase)

"continue where we left off"

## Expected behavior

Both scenarios behave the same once the master skill is entered.

1. **The master skill is entered.** Scenario 1 routes on "no argument".
   Scenario 2 is a resume: `stardust/state.json` exists, so the plain
   phrase enters the stardust master skill too — the agent does not
   answer from memory, from a general-purpose read of the project tree, or
   by grepping skill text without invoking the skill.
2. **Setup runs read-only.** Impeccable check, target-state file check,
   `state.json` read, journal read (last 3–5 entries — the fixture has
   four). The pre-seeded `stardust/.gitignore` is byte-identical to the
   reference, so hygiene has nothing to write.
3. **The state report is the first substantive output**, rendered by
   `node skills/stardust/scripts/status.mjs` (read-only — `--no-probe` is
   fine, the origin is unreachable) in the § State report shape: `Site:` (origin, extracted 2026-09-08), `Direction:`
   (the keep-design phrase, preserve mode, resolved 2026-09-08), a
   `Flow:` line reading `replica` with when and how it was chosen
   (2026-09-14, from the keep-vs-redesign question), then the per-page
   status table (six `migrated`, none stale). No `Repo:` block — the
   workspace is not a git repository.
4. **Last gate numbers per archetype**, copied by the script from
   `progress.json`, not recomputed and not invented: `home` 2.14 % at 1440 and 3.87 % at 360
   (pass); `news__storm-season-checklist` 11.6 % at 1440 and 12.4 % at 360
   (over the bar after three iterations, residuals cause-only — reported
   `FAIL 11.6 % / 12.4 % (residuals unaccepted)`, blocked); `insurance__home`
   never gated.
5. **The journal's last `Next:` line is quoted** and checked against
   state: `insurance__home` is still `gated: false`, `deployUrl` is
   still `null`, the last ledger line is the blocked rollout — so the
   journal is current and the agent says so (it does not claim a
   discrepancy that is not there, nor skip the check).
6. **The recommendation follows the replica-flow rule**, not the redesign
   heuristics. Every page is `migrated`, so the redesign list would say
   "complete — critique `migrated/`"; under `flow: replica` the
   recommendation comes from `progress.json`: one ungated archetype →
   `$stardust replica insurance__home`, with the reason (the program page
   type is blocked until its archetype is gated at both breakpoints),
   and `rollout` named as what follows. It does not recommend
   `prototype`, `migrate --all`, `extract`, `prepare-migration`, or an
   immediate `rollout`.
7. **Nothing is written** before the user answers: no `state.json`
   rewrite, no journal entry, no `status.jsonl` line, no new file under
   `stardust/` (no `.work/run.lock` — the renderer only runs `run-lock.mjs
   check`), no root `PRODUCT.md` / `DESIGN.md`. The report is read-only.
8. **The next phase is entered through its skill.** After the report the
   agent asks whether to proceed (a user is present); the persona says
   "go". The agent then invokes the stardust `replica` skill for
   `insurance__home` — it does not run gate scripts from memory of the
   journal, does not author a gate of its own, and does not re-run
   finished steps (no re-extract, no re-gate of `home` or the article, no
   re-migrate). The fixture's `.example` origin is unreachable, so the
   gate itself fails fast once inside `replica`; grading stops at the
   skill entry.
9. **No skill file is read whole (W1 target).** Every tool-driven read of
   a `skills/**/*.md` file is preceded by a heading list (or is itself a
   section-scoped read) and covers only the sections the current step
   needs — § State report, § Flow keys, § Reading the journal at session
   start, `replica` § Setup / Phase 4. A whole-file read of a `SKILL.md`
   or reference fails this. Text the harness injects when a skill is
   invoked is not a read.
