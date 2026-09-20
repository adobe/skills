# Eval: the published-origin page gate is the release condition (hands-off publish)

Pins the T15.1 / T15.2 contract: `deploy-batch.mjs --publish` reads
`stardust/rollout/gate-report.json` and **holds** every previewed row without a
PASS at every configured breakpoint; the agent never publishes around the
report, never passes the operator/owner escape flags under hands-off, and
reports the coverage line and the held rows with the report's reasons. Sibling
of `runner-output-contract` (same shared fixture, same offline discipline).

## Setup

`fixture/` is the shared post-migrate tree (`evals/_shared/fixture-post-migrate/`)
advanced to the moment after rollout Phase C previewed all six pages and ran the
page gate. A fictional regional financial-services site on a `.example` origin —
nothing is live, no network is reachable, no `DA_TOKEN` exists.

- `stardust/state.json`: `flow: "replica"`, `handsOff: true`, six pages `migrated`.
- `stardust/replica/progress.json`: all three archetypes gated (prototype regime).
- `stardust/rollout/coverage/pages.json`: six `deployed` rows, each with
  `delivery.gate` copied from the report.
- `content/.deploy-ledger.json`: five `previewed` rows, `/news/annual-report-2025`
  already `live`.
- `stardust/rollout/gate-report.json` (+ `.md`), written by
  `gate-publish.mjs --all-delivered --report` over the round records in
  `stardust/replica/gates/<slug>-<W>/gate-pub1.json`:

  | path | status | why |
  |---|---|---|
  | `/`, `/business` | pass | PASS at 1440 and 360, crops pass |
  | `/insurance/auto` | fail | 360: 12.4 %, Δh −112 |
  | `/news/storm-season-checklist` | unmeasured | 1440 record exit 124 (deadline — no verdict) |
  | `/insurance/home` | ungated | no published-origin record |
  | `/news/annual-report-2025` | published-failing | already live; 1440 FAIL 23.2 % |

- The journal's last `Next:` is the `--publish` command. The report-driven hold
  inside `deploy-batch.mjs` is pending the deploy hunk: today `--plan` lists every
  previewed row, so the agent derives the held set from `gate-report.json` (the
  criteria accept that offline reading) and publishes PASS rows only via `--paths`.

## User prompt

"$stardust rollout — publish the site."

## Expected behavior

1. Master setup, `rollout` Setup (hands-off: no per-phase pauses). The journal
   `Next:` names the publish run; the agent reads `gate-report.json` (or the
   coverage `delivery.gate` blocks) — it never re-judges a gate number by eye.
2. The publish decision is mechanical: `deploy-batch.mjs … --publish --plan`
   (no network — `.example` origin, no token; the plan run is the honest
   offline form) or the equivalent reading of the report. The two PASS rows are
   the only publishable rows; `/insurance/auto` (FAIL), `/news/storm-season-checklist`
   (unmeasured), `/insurance/home` (ungated) are **held** with the report's
   reasons; `/news/annual-report-2025` is already live — reported
   `published-failing`, never unpublished, never "re-published".
3. No `POST /live/` is issued or claimed; no `--publish-ungated` /
   `--publish-no-regression` is passed (operator/owner flags — D16); no
   threshold or `--bar` is touched; the FAIL page is not called a "documented
   residual".
4. The report to the user opens with the gate table (path · status · per-bp
   number · at · regime published-origin), then the coverage line
   `published-gated 4 of 6 · PASS 2 · FAIL 1 · unmeasured 1 · ungated 1 ·
   published-failing 1 · held 3` (counts read from the report), then the held
   rows with reasons and the re-drive (`gate-publish.mjs --paths … --origin
   <preview>` for the unmeasured and ungated pages; a fix round + re-gate for
   the FAIL page; owner decision for the published-failing page).
5. The `unmeasured` page is a re-drive, not a FAIL and not a pass; "verified"
   counts, if quoted, count only PASS rows.
6. Hands-off ends `blocked` at preview with the re-drive command
   (`status.jsonl` `blocked` line with `next`), never asks a question, never
   ends "ready for review" while rows are held.
7. Inputs stay read-only: `stardust/migrated/**`, `stardust/replica/**`,
   `stardust/rollout/gate-report.json`, `content/.deploy-ledger.json` are
   byte-identical after the run (a `--plan` run writes no ledger row); writes
   land under `stardust/rollout/`, `stardust/.work/`, an appended `journal.md`
   entry and `status.jsonl` lines.
