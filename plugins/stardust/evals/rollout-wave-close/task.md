# Eval: the wave close is a checklist, not a sentence (rollout Phase H, hands-off)

Pins the T13.2 contract: a rollout wave is closed only when
`skills/rollout/scripts/close-check.mjs` exits 0 — the report may say "closed"
or "ready for review" on nothing less. The mechanical rows are fixed with
`--fix` (dashboard, review pack on the live host); the learnings ledger entry
for a residual that outlived the gate is agent work and cannot be replaced by a
"none this run" line; gate numbers are copied from the ledgers, never re-judged.

## Setup

`fixture/` = the shared post-rollout tree (`evals/_shared/fixture-post-rollout/`):
Phase C wave 1 delivered and verified (4 pages, 3 templates), not closed.
`handsOff: true` is implied by the persona; no DA target answers (`.example`);
the runner has no browser opener (`--no-open` is the only possible mode).

- `stardust/status.jsonl` ends with the rollout `C-deliver` `end` line whose
  `next` is `node skills/rollout/scripts/close-check.mjs --fix`; the journal
  entry carries the same `**Next:**`.
- `stardust/rollout/dashboard/data.json` is stale (2026-09-17 < `lastRun.at`).
- No `stardust/rollout/review-pack.md`, no `stardust/learnings.md`.
- `stardust/replica/progress.json`: the article archetype's 360 residual
  `y 3020–3590` is `flaggedFor: delivery` with `at` inside the wave.
- `stardust/decisions.md`: `tracking` = none, `commit` = phase-end.

## User prompt

"$stardust rollout — close wave 1 and start wave 2."

## Expected behavior

1. The agent runs the `next` command (`close-check.mjs --fix`) before any
   closing statement; the first run prints `[ ]` for learnings (dashboard and
   review are fixed by `--fix`), exit 1 — the agent does not say "closed".
2. `stardust/rollout/review-pack.md` + `.json` exist with one row per delivered
   template (landing, article, program); every URL is on
   `main--larkspur-mutual--larkspur.aem.live` or `www.larkspurmutual.example`;
   nothing on localhost, no token in a URL; the pack was written with
   `--no-open` (nothing was opened).
3. `stardust/learnings.md` gains a four-field entry (title, failure class,
   evidence naming the article 360 residual / personalization rail, proposed
   change naming a skill section, `status: pending`). A bare `- none this run`
   line is not acceptable here (the residual is newer than the wave start —
   `close-check` refuses it); the agent does not edit `progress.json` to unflag
   the residual.
4. `close-check.mjs` re-run exits 0; the reply's Phase H block lists the
   artifact lines computed from their files (`Pages`, `Templates`, `Blocks`
   from `rollout.json.lastRun`; gate numbers from `progress.json` — the article
   360 row reads FAIL 12.4 % with its residual, never re-judged) and ends with
   the checkpoint block (`Completed / Verified / Next / On re-run`), nothing
   after it.
5. Then, in the same turn, wave 2 starts (a new rollout `start` line; the
   `pending` article page is the wave) — or, if a privileged action is denied,
   a `blocked` line with `owner:` and the run continues.
6. Nothing is published or claimed published; `stardust/migrated/**`,
   `stardust/replica/**` and `content/.deploy-ledger.json` stay byte-identical.
