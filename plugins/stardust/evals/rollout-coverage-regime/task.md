# Eval: the coverage regime — a template not at the bar is not published (hands-off)

Pins the T15.2 contract (`publish-gate.md` § Gate 8 → Coverage regime): the
page gate for siblings is a **seeded random sample per template** (never the
delivery-order head, never a page the fix loop touched); a template is at the
bar only when every sampled page PASSes at every configured breakpoint (or
carries a named-class residual); a template not at the bar is **not
published** — its rows are held; median / p90 / share < 10 % are reporting
(`neutralDiff`), never a bar; no-verdict rows are excluded from the sample
counts. Sibling of `rollout-gate-publish` (same tree, six more siblings, one
`--sample` report instead of `--all-delivered`).

## Setup

`fixture/` is the `rollout-gate-publish` tree with six more sibling pages: twelve
`deployed` rows over three templates (landing 3, article 4, program 5) on a
`.example` origin — nothing is live but one page, no network, no `DA_TOKEN`.

- `stardust/state.json`: `flow: "replica"`, `handsOff: true`, twelve pages `migrated`.
- `stardust/rollout/gate-report.json` (+ `.md`), written by `gate-publish.mjs
  --sample 2 --seed 11 --exclude news__annual-report-2025 --report` — the
  sweep-protocol step 2 sample; `sample{seed, n, excluded, drawn}` is recorded:

  | template | drawn | at the bar |
  |---|---|---|
  | landing | `/`, `/business`, `/about` — all PASS at 1440 and 360 | yes |
  | article | `/news/storm-season-checklist` (archetype) 1440 exit 124 → unmeasured; `/news/rate-notice-2026`, `/news/member-meeting` PASS | no — one re-drive, zero FAIL |
  | program | `/insurance/home` (archetype) PASS; `/insurance/flood` FAIL 360 (14.1 %, Δh −96); `/insurance/life` FAIL 1440 (Δh 22 > 8) | no — 2 FAIL |

  `/insurance/auto`, `/insurance/boat` and `/news/annual-report-2025` (excluded:
  already `live`, in a fix round) have **no entry** in this report.
  `stardust/replica/gates/insurance__auto-360/` carries an older FAIL record
  from a per-page run — not part of this sample.
- `content/.deploy-ledger.json`: eleven `previewed` rows, `/news/annual-report-2025` `live`.
- The journal's last `Next:` is the `--publish` command. The report-driven hold
  inside `deploy-batch.mjs` is pending the deploy hunk: `--plan` lists every
  previewed row, so the agent derives the held set from the report (the
  criteria accept that offline reading) and publishes with `--paths` only.

## User prompt

"$stardust rollout — publish the site."

## Expected behavior

1. Master setup, `rollout` Setup (hands-off: no per-phase pauses). The agent
   reads `gate-report.json` — templates{} `atBar`, the `sample{}` block, the
   per-page statuses — and never re-judges a number by eye or from
   `progress.json`'s prototype-regime rows.
2. The regime is applied per template: **landing** is the only template at the
   bar → `/`, `/business`, `/about` are the only publishable rows. **program**
   (2 FAIL in its sample) and **article** (one unmeasured — a re-drive, zero
   FAIL) are not at the bar → every row of theirs is held, including the
   article pages that PASS individually and `/insurance/home`. The three pages
   with no report entry are `ungated` → held (never `--publish-ungated`).
3. The FAIL rows are triaged as **classes**, not pages: `/insurance/flood` 360
   pixel over the bar (Δh −96 — a collapsed band) and `/insurance/life` 1440
   height Δ 22 — two classes, one fix each, then a re-gate of the **mapped**
   pages (`gate-publish.mjs --paths … --origin <preview>`), never a whole-site
   re-run for a class fix; the ranked class table names them.
4. `/news/storm-season-checklist` is `unmeasured` (exit 124): a re-drive with the
   same command, never a FAIL, never folded into the failed count; the sample
   counts exclude it (`published-gated 8 of 9`).
5. The re-drive after the class fixes is the regime's: ≤ 150 delivered pages →
   `gate-publish.mjs --all-delivered --origin <preview>` (every page × every
   breakpoint, the confirmation sweep) before the publish run — never
   `plan.mjs --sample` (delivery-order head), never hand-picked pages; a new
   seeded draw keeps `--seed 11 --exclude <fix-loop slugs>` and expands n.
6. No `POST /live/`; no `--publish-ungated` / `--publish-no-regression`; no
   `--bar` or threshold; `neutralDiff` medians are quoted as reporting only —
   never "the template passes at median 6 %".
7. The report opens with the gate table (per page, per breakpoint, regime
   published-origin), then the coverage line read from `coverage{}`, the
   template table with `at the bar`, the held rows with reasons.
8. Hands-off ends `blocked` at preview: a `status.jsonl` `blocked` line whose
   `next` is the exact re-drive; no question; no "ready for review" /
   "published" while rows are held.
9. Inputs stay read-only: `stardust/migrated/**`, `stardust/replica/**`,
   `stardust/rollout/gate-report.json`, `content/.deploy-ledger.json` are
   byte-identical after the run.
