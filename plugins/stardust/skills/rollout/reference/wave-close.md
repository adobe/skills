# Wave close (Phase H) — the checklist contract

A rollout wave (and the run) closes on `scripts/close-check.mjs` exit 0 — a
list of artifact checks, never prose checks. The report may say "closed" or
"ready for review" on nothing less; hands-off starts the next wave only after
it. It blocks **nothing in delivery**: no PUT, no publish, no gate verdict, no
page status changes because of it.

```bash
node skills/rollout/scripts/close-check.mjs --fix        # mechanical rows done, then re-checked
node skills/rollout/scripts/close-check.mjs              # verify only; --json for the rows as data
node skills/rollout/scripts/close-check.mjs --skip <row> --reason "<text>"   # recorded in the journal
```

## The wave window

"This wave" = everything since the last rollout `start` line in
`stardust/status.jsonl` — the newest line with `"skill": "stardust:rollout"` and
`"event": "start"` (no wave id exists). No start line → row 1 fails.

## Rows

| # | row | `[x]` when | on `[ ]` the printed fix is |
|---|---|---|---|
| 1 | status | a rollout `end` line with `next` (or `blocked` with `next` / `owner`) newer than the wave start | write the `end` line (`../../stardust/reference/run-status.md` § Phase close) |
| 2 | journal | an entry with ts ≥ wave start whose `**Next:**` equals that `next` (a blocked wave: `**Blocked on owner:**`) | the journal entry (`journal-format.md` § Entry format) |
| 3 | coverage | `rollout.json.lastRun.at` ≥ the deploy ledger's newest row `ts`; ledger `previewed\|live` vs coverage `deployed\|verified` printed side by side — drift is a **warning**, never a fail | `update-coverage.mjs --from-ledger …` |
| 4 | learnings | `stardust/learnings.md` has ≥ 1 entry dated in the wave, **or** one `- none this run (<ts>): …` line — accepted only when no residual `flaggedFor: delivery` (progress.json) and no named deviation (direction.md) is newer than the wave start; else the offending rows are listed | the four-field entry (`../../stardust/reference/learnings.md` § Entry shape) |
| 5 | review | `review-pack.{md,json}` generated ≥ the last `deployedAt`, ≥ 1 row per delivered `templateId`, every URL on `site.liveHost` or the source host — `localhost` / `127.0.0.1` / a token in a URL fails the row | `open-review-pairs.mjs --per-template 1 --no-open` |
| 6 | dashboard | `dashboard/data.json.generatedAt` ≥ `lastRun.at` | `dashboard.mjs` |
| 7 | report | newest `stardust/rollout/report/*.md` has a gate table and a `report-check:` line; `[-]` while no `report/` dir exists (the Phase H block in the reply is the report until the run-status renderer writes the file) | write the report (`handoff-report.md`) |
| 8 | tracking | only when `decisions.md` row `tracking` ≠ none: `stardust/rollout/tracking.json {issueUrl, commentUrl, at}` updated this wave, or a `blocked` line whose `owner:` is the `gh issue comment …` → `[~]` | the comment, then `tracking.json` |
| 9 | commit | git repo **and** `decisions.md` row `commit` = phase-end: a commit since the wave start touching `stardust/`; otherwise `[~] owner preference` | `git commit` of `stardust/` |
| — | artifacts | `[-]` informational: the published-origin coverage line (`gate-report.json`), `Readability`, `Editability` (`lastRun.gates`) — copied, never re-judged | — |

Marks: `[x]` met · `[ ]` required, open (exit 1) · `[~]` skipped with a
recorded reason / blocked on owner (exit 0) · `[-]` informational. The last
stdout line is `SUMMARY close-check ok=<n> failed=<n> exit=<code> details=<status.jsonl>`.

## Escape hatch

None silent. `--fix` performs the mechanical rows (dashboard, review pack with
`--no-open`) and re-checks; the agent rows — journal, ledger entry, tracking,
commit — stay agent work. `--skip <row> --reason "<text>"` renders `[~]` and
appends the reason to `journal.md` (audit trail); never for `status` (row 1)
and never for `learnings` (row 4 — the conditional "none this run" line is its
honest escape): exit 2. `--reconcile` is informational (`not reconciled (no
token)` is `[x]` with a note — an expired token never blocks a close).

## Hands-off

Never weakens it. The coordinator runs `--fix`, writes the journal and ledger
rows itself from the artifacts (residual row → `evidence`; the owning skill
section → `proposed change`), re-runs, and only then starts the next wave in
the same turn. A `gh` denial on row 8 is master § Hands-off "a denial is not a
blocker": `blocked` + `owner:`, `[~]`, continue. Nothing here asks a question.

## Protected

Gate numbers in the pack and the artifact lines are **copied** from
`progress.json` / `gate-report.json` / `rollout.json` — an archetype without a
verdict prints `no verdict` and never fails a row (the ungated precondition is
Setup step 2). No threshold or residual semantics are touched (B29). The deploy
ledger is read-only here. The pack fetches nothing: URLs, gate numbers and
reference dates come from files; the reviewer's browser loads ≤ 10 source
pages per batch. Previewed and published are counted apart (D1 / D16); the
checklist never publishes.
