# Baseline & abrasion evidence

Durable per-eval records behind the stardust skill-abrasion campaign.

# direct-from-phrase — baseline & abrasion evidence

Durable record of the eval evidence behind the `direct` skill
abrasion (2026-07-23/24). Raw run directories live in
`runner/results/` which is gitignored and local-only — this file is
what reviewers can inspect without rerunning. Runner docs:
`runner/README.md`.

## Baseline (N=3, label `baseline`)

- Skill: `skills/direct/SKILL.md` at 1,597 lines (main @ f934c10).
- Scores: 75 / 85 / 85 — **mean 81.7/100**. ~$8–12 per run.
- Model: claude-fable-5 (session), strong-model judge; criteria
  snapshotted per run (`criteria.json` copied into each run dir).

### Criterion profile

| criterion | w | baseline | character |
|---|---|---|---|
| activated | 5 | 3/3 | stable |
| dimensional_restatement | 10 | 0/3 | **systematic fail** — restatement stays in (redacted) thinking, never user-visible; appears only post-hoc in direction.md |
| gaps_identified | 5 | 1/3 | noisy — judge by rate |
| question_ceiling | 10 | 3/3 | stable |
| plan_shown_before_execution | 15 | 2/3 | noisy — same thinking pathology as restatement: model gates on "confirm the plan above" without rendering the plan as text |
| divergence_resolved | 10 | 3/3 | stable |
| product_md_direct | 10 | 3/3 | stable |
| design_md_direct | 10 | 3/3 | stable |
| direction_md_shape | 10 | 3/3 | stable |
| state_updated | 5 | 3/3 | stable |
| no_silent_command_mapping | 5 | 3/3 | stable |
| no_eds_references | 5 | 3/3 | stable |

Gate used for every abrasion tranche: the 9 stable criteria must
stay 3/3; the noisy pair must not trend below baseline rate
(single flips at N=3 are variance — pool runs before judging);
`dimensional_restatement` is known-fail (improvement = upside).

## Abrasion labels

| label | skill @ | lines | scores | mean | stable 9 | gaps | plan | notes |
|---|---|---|---|---|---|---|---|---|
| baseline | f934c10 | 1597 | 75/85/85 | 81.7 | 9/9 | 1/3 | 2/3 | |
| abraded-t1 | cf0978d | 1540 | 90/75/75 | 80.0 | 9/9 | 3/3 | 1/3 | |
| abraded-t1b | cf0978d | 1540 | 85/75/75 | 78.3 | 8/9¹ | 1/3 | 2/3 | ¹question_ceiling 2/3: one run posed 3 question objects; instruction text untouched by t1 — variance. run-3 drifted into prototype post-completion (persona kept replying "go") |
| abraded-t2 | cb48764 | 1227 | 75/90/75 | 80.0 | 9/9 | 3/3 | 1/3 | relocated refs verified unread |
| abraded-t2b | bb1d7ed | 1234 | 70/70/70 | 70.0 | 9/9 | 0/3 | 0/3 | t2.5 "visibility contract" experiment — **reverted** (87e8380): instruction read but not obeyed |
| abraded-t3 | bf51025 | 999 | 90/75/85 | 83.3 | 9/9 | 2/3 | 2/3 | first label above baseline; refs unread |
| abraded-t4 | 01c5275 | 949 | 85/75/70 | 76.7 | 9/9 | 1/3 | 1/3 | improvements artifact quality held without in-context examples (specificity bar sufficient) |

`dimensional_restatement` was 0/3 in every label (0/21 overall):
fully systematic, not abrasion-sensitive.

Every `plan_shown_before_execution` failure across all labels —
including the baseline's — shares one mechanism: the plan is built
inside thinking and the model gates on "confirm the plan above"
without a visible text rendering. The t2.5 experiment showed that
an explicit in-skill contract does not fix this; treat the
criterion's flips as harness-level noise until the criterion or the
harness changes.

## Token caveat

`compare.mjs` mean input tokens (= fresh cache-creation tokens) are
dominated by turn count and web-search volume: observed 64k–197k
across runs of identical skill text, i.e. ±60k run-to-run at N=3.
The ~7–8k tokens/session saved by the 41% skill-size cut is real but
an order of magnitude below this noise floor — do not read the
per-label token means as the abrasion payoff. The verifiable payoff
is structural: SKILL.md 1,597 → 949 lines, with all six relocated
reference files confirmed **unread** in every eval run (the eval
path never fires those branches; grep of `session.md` per run).

## Operational gotchas

See `runner/README.md` and the runner-gotchas notes: validate
`usage.json` (no `[FALLBACK]` answers, sane `userTurns`) before
trusting a run; killed/partial run dirs (only `criteria.json` +
`workspace/`) must be deleted before `judge.mjs`; `run.mjs`
continues run numbering within a label, so top-ups are safe; the
persona responder answers any trailing question with "go", which
can push a completed session onward into `prototype` — check for
post-completion Skill invocations before trusting cost numbers.

---

# extract-multipage — baseline & abrasion evidence

Evidence record for the `extract` skill abrasion (2026-07-25).
This is a **live-network eval** (crawls stripe.com): slower
(~25 min/run), pricier (~$17–23/run), and noisier than
direct-from-phrase — both the site and the judge's read of
network-dependent artifacts drift between runs. The rubric was
rescoped to the 0.14.0 contracts before baselining (43f2bac; see
"0.14.0 rescope notes" in `README.md`).

## Baseline (N=3, label `baseline`)

- Skill: `skills/extract/SKILL.md` at 921 lines (main @ b5ffb85).
- Scores: 70 / 85 / 75 — **mean 76.7/100**. ~$17–23 per run,
  76–107 turns.
- Model: claude-fable-5 (session), strong-model judge; criteria
  snapshotted per run.

### Live-network variance observed

- **Geo-locale drift.** stripe.com 307-redirects by network
  location and the target itself moved between probes (`/de-ch`
  one day, `/it` the next). Run-1 asked a locale clarifying
  question; runs 2–3 did not. Captured copy/voice is locale-
  dependent — judge content-adjacent criteria by rate, not exact
  attributes.
- **Discovery shape.** `sitemap.xml` is 404; discovery resolves via
  the robots.txt `Sitemap:` directive to a partitioned index
  (~6,400 URLs). The cut list is only representable elided — see
  the `page_cap_confirmation` judge-noise note below.
- Headless Playwright worked in all 3 runs (no bot-management
  fallback triggered).

### Criterion profile

| criterion | w | baseline | character |
|---|---|---|---|
| activated | 5 | 3/3 | stable |
| impeccable_dep_check | 5 | 2/3 | noisy — r1 skipped the upfront check, located impeccable mid-run at Phase 4 |
| discovery_before_crawl | 10 | 3/3 | stable |
| page_cap_confirmation | 10 | 2/3 | noisy, incl. **judge noise**: r1 judge failed a count-only cut summary that r2's judge accepted ("full elision acceptable"); agent behavior was near-identical. Gate on pooled rate only |
| playwright_over_webfetch | 10 | 3/3 | stable |
| per_page_json_shape | 10 | 1/3 | noisy — bundled `crawl.mjs` emits a partial schema (no `themeColor`/`landmarks`/`forms`/`widgets`/`perSectionStyle`; r3 used `styleSummary` instead of `perSectionStyle`); passes only when the agent extends `capture()` per SKILL.md. Script↔schema gap, not prose-fixable by abrasion |
| brand_extraction_shape | 10 | 3/3 | stable |
| logo_locator_chain | 5 | 3/3 | stable |
| current_product_md_direct | 10 | 3/3 | stable |
| current_design_md_direct | 10 | 1/3 | noisy — consistent mechanism in both fails: DESIGN.json missing `schemaVersion`. Extract's SKILL.md Phase 4 never states the schemaVersion-2 contract (it lives in impeccable's document.md / direct's SKILL.md); passes only when the agent infers it. Skill/criterion mismatch — candidate one-line skill fix, out of abrasion scope |
| state_json_shape | 5 | 3/3 | stable |
| provenance_stamped | 5 | 0/3 | **known-fail** — every run misplaces stamps on ≥1 artifact (brand-review.html head block, DESIGN.md above-frontmatter position, `_crawl-log.json` first-key order); artifacts vary per run but the criterion never passes |
| no_eds_references | 5 | 3/3 | stable |

Gate for every abrasion tranche: the **8 stable criteria** (60
weight) must stay 3/3; on any single flip, pool to 6 runs and gate
on rates. The **4 noisy criteria** (impeccable_dep_check 2/3,
page_cap_confirmation 2/3, per_page_json_shape 1/3,
current_design_md_direct 1/3) must not trend below baseline rate.
`provenance_stamped` (0/3) is known-fail and tripwire-exempt —
improvement is upside.

Do not read token/cost means as abrasion payoff (turn-count and
live-network noise dominate; run costs varied $16.96–$22.82 on
identical skill text). Payoff framing: structural line cut +
per-run grep of `session.md` verifying relocated reference files
stayed unread.
