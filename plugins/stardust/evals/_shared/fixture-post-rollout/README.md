# Shared fixture — post-rollout wave 1 (Larkspur Mutual, .example)

`fixture-post-migrate` frozen one step later: rollout Phase C wave 1 is delivered and
verified but NOT closed. Used by `evals/rollout-wave-close/` and by
`skills/rollout/scripts/close-check.test.mjs`.

| path | encodes |
|---|---|
| `stardust/rollout/rollout.json` | `site.liveHost` set; `lastRun.at` 2026-09-18T16:05:00Z |
| `stardust/rollout/coverage/{pages,templates}.json` | 6 pages / 3 templates: 4 `verified`, 1 `pending`, 1 `content-pending` (seeded from the editability eval coverage, roll-ups re-derived with lib.mjs) |
| `stardust/rollout/dashboard/data.json` | STALE — generatedAt 2026-09-17 (row 6 open) |
| `content/.deploy-ledger.json` | 4 `previewed` rows, newest ts 15:58 (< lastRun.at → coverage current) |
| `stardust/status.jsonl` | + `stardust:rollout C-deliver` start 15:00 / end 16:05 with `next` |
| `stardust/journal.md` | + the wave-close entry whose **Next:** equals that `next` |
| `stardust/replica/progress.json` | the article residual `flaggedFor: delivery` carries `at` 16:10 — newer than the wave start, so a bare "none this run" line is refused |
| `stardust/direction.md` | + the wave plan (no named deviation) |
| `stardust/decisions.md` | tracking = none, commit = phase-end |
| absent | `stardust/learnings.md`, `stardust/rollout/review-pack.{md,json}`, `stardust/rollout/report/` |

Expected `close-check.mjs` as-is: rows learnings, review, dashboard `[ ]` (exit 1); report `[-]`;
tracking `[-]`; commit `[~]` (not a git repository). `--fix` closes review + dashboard; the
ledger entry for the flagged residual is agent work.
