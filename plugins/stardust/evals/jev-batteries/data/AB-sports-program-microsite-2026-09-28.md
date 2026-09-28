# A/B run report — stardust with the decision layer in `shadow` vs `assist` mode

First live two-arm run of the decision layer (#127). Note the deviation from the protocol: the arms were
`STARDUST_DECIDER=shadow` and `assist`, not `off` and `assist`. Both arms were fully hands-off; the human never
prompted during the run except once to resume after a harness API error (counted below).

## Site and scope

| field | value |
|---|---|
| site role | a sports-program microsite on AEM (clean origin, no bot management, OneTrust consent, licensed brand fonts) |
| pages in scope | the whole site: 4 pages (home, two program pages, 404); 7 URLs captured, 3 excluded as alias / off-origin redirect |
| plugin version / model / date | stardust 0.28.0 (this branch, installed via a local marketplace) / `claude-fable-5-1` / 2026-09-27 (shadow) → 2026-09-28 (assist) |
| prompt (identical) | `/stardust:replica <url> — migrate the whole site (it is small, about 4 pages: crawl and take every page) to EDS keeping its current design, hands-off, no approval gates. Set up a new private EDS repo named <name> with my personal skill. Gate every archetype at 1440 and 360. Run the full chain through deploy, rollout and QA, then post the final report and stop.` plus an isolation rule (work only inside the project directory, no other transcripts or earlier migrations) |

## Per arm

Token totals include subagent transcripts. Prices: Claude Fable 5.1 list, 5-minute cache TTL ($10 in / $50 out /
$0.25 cache read / $12.50 cache write per M) — `promptCacheTtl: 1h` was not set despite the runbook.

| KPI | shadow | assist | how measured |
|---|---|---|---|
| wall-clock, prompt → final report | 12 h 42 min (≈ 5 h 27 min active; 7 h 17 min idle after an API stream stop) | 4 h 33 min | transcript timestamps; `status.jsonl` |
| assistant turns / tool calls | 2 322 / 1 361 | 1 369 / 927 | transcript count, main + 12 subagents vs main + 3 subagents |
| output / cache-read / cache-write tokens | 0.57 M / 428 M / 12.7 M | 1.82 M / 518 M / 23.8 M | transcript usage |
| API-equivalent cost | ≈ $294 | ≈ $519 | list prices above; cache writes 54–57 % of spend in both |
| pages within the full four-criteria bar at the published origin | 3 / 4 at 1440 and 360 (+1 documented units override) | 3 / 4 at 1440, 2 / 4 at 360 (+1 / +2 overrides) | `gates/all-<w>/summary.json` |
| pixel-only passes (calibration) | 4 / 4 both widths | 4 / 4 at 1440, 3 / 4 at 360 | same table |
| independent pixel diff, mean of 8 page×width cells | 2.5 % (max 5.1 %) | 7.1 % (max 24.4 %, Δh −62 px on the second program page at 360) | Playwright + pixelmatch, consent surface removed, run after both arms closed |
| prototypes / archetype gate cells | 4 prototypes, every roster page gated | 3 prototypes; the second program page delivered as a sibling with no prototype | `replica/progress.json`, `prototypes/` |
| gate rounds per archetype; rounds excluded | all within the 3-round cap; 28 flag rounds logged | mean 2.33 iterations, 0 over cap; 0 flag rounds logged | `progress.json`, `decisions.jsonl` |
| flags fixed / justified / left | 2 039 flags: 815 decisive, 1 224 unsure (shadow flag-justify) | — (flag batteries did not run) | `flags-*.json` |
| residuals with a named cause | 16 / 16 | 4 / 4 | `progress.json` |
| supervisor refusals (ledger end) | 0 (36 phase-claim checks, 1 REVIEW ≥ 0.85) | 0 (25 checks, 0 REVIEW) | `decisions.jsonl` |
| human touches | 1 (`continue` after "API Error: The response stopped arriving" at the end of a 162-minute turn) | 0 | transcript |
| Jev requests / tokens / cost / median latency | 2 134 / 3.3 M / $0.14 / 255 ms | 60 / 0.1 M / $0.004 / 297 ms | `decisions.jsonl` |
| agreement per battery among `act`-routed items | n/a (no `--agent` answers logged) | page-type 0 `act` (2/4 agree overall); dynamics-triage 0 `act` (class 21/25, disposition 11/25) | `decide.mjs compare` |
| QA sweep left for the owner | 14 errors un-triaged (5 editability, 5 platform noindex, 2 empty section, 2 redirect to off-origin login) + duplicate home URL | 4 platform-noindex errors; 8 source-parity findings allowlisted with reasons; 8 instrument learnings filed | `qa/report.json`, `learnings.md` |

## Findings

- **assist mode never produced an acted-on content decision.** Of 60 calls, no page-type or dynamics-triage answer was
  routed `act`; the agent decided every one itself, so the arm behaved as shadow. Only supervisors reached `act`
  (phase-claim 19/25, brief-check 1/5). Nothing was refused.
- **Jev's page-type was wrong where it disagreed.** Home → `program` 0.62 (agent `landing`, correct); 404 → `none` 0.63
  (agent `unique`, correct). It agreed on both program pages, which is the classification that cost the second program
  page its prototype (see next). Dynamics-triage: class agreement 21/25; disposition agreement 11/25 (agent chose
  `static-snapshot` for app-settings objects, Jev spread over `data-fed` / `decided-out`).
- **The fidelity gap is archetype coverage, not the decider.** The shadow arm prototyped and gated all four pages. The
  assist arm treated the second program page as a sibling of the first, built three prototypes, and delivered the sibling
  from the first page's blocks through a cross-unit variant round that hit the 3-round cap (24.8 % / Δh +62 at 360,
  documented override). This is the "siblings shipped at 10–30 % after archetype gates passed" failure mode in
  `notes/jev-system-one-research.md`; "gate every archetype" in the prompt did not protect a page never declared one.
- **The arms exercised different battery sets — a confound.** shadow ran the gate-side batteries (flag-justify ×2 039,
  valid-round ×28, fix-pattern ×28; all valid-round and fix-pattern answers `review`/`escalate`) and no page-type; assist
  ran page-type, dynamics-triage, brief-check and zero flag rounds. The pre-sorted-flags hypothesis never ran in assist.
- **Cost.** assist's extra ≈ $225 is cache writes (+$140) and output (+$63). Visible output (tool inputs + prose) is
  similar in both arms, so the 3× output-token gap is hidden thinking in assist's main session, which ran as one
  long-lived agent (105- and 273-minute turns) instead of fanning out to 12 subagents.
- **Autonomy.** Both arms honoured hands-off, committed at each phase end, posted a final report and stopped. shadow's
  only touch was a harness stream stop after a very long turn; assist's long turns were split by subagent hand-backs and
  survived. shadow also met an auto-mode permission denial on a frozen runtime file and deferred two foundation changes
  to the owner rather than routing around it.
- **Secondary quality, in assist's favour:** a 7-block content model with variants (vs 17 mostly single-page blocks and
  5.2 k vs 4.4 k lines of block code), canonical root URL with a 10-row redirect sheet (shadow published a duplicate
  home path), QA triaged with an allowlist, `learnings.md` with 8 instrument findings (width-blind unit cache,
  gate-all page-shape mismatch, landmark-less source, section-schema, qa import layout, pipeline byte drops).
- **Defects a human sees after the run:** assist — second program page at 360 (paragraph wrap −34 px, fixed-size card
  image −29 px), looser spacing from the substitute faces; the published-origin gate caught it and overrode it. shadow —
  none visible; the QA report's two "section renders 0 px" errors are an empty authored section, not a visible defect,
  but were left unexplained.

## Verdict

assist was faster (−54 min active, −17 %) and touch-free but shipped a visibly less faithful site (mean pixel diff 7.1 %
vs 2.5 %) at 1.8× the cost. Neither movement is attributable to the decider: the mode took no content decision, Jev's
own page-type answers were worse than the agent's, and the battery wiring differed between arms. Turns fell (1 369 vs
2 322) for orchestration reasons, not the 5–10 % the § 6 estimate predicted from the sidecar; fidelity changed for the
worse for a reason unrelated to the layer. Before the next pair: (1) gate every roster page, or force a prototype
whenever a sibling-tier decision is below 0.9; (2) run `off` vs `assist` with identical battery wiring and
`promptCacheTtl: 1h` in both arms; (3) keep main-agent turns short via subagent hand-backs to avoid the long-turn
API stop. Experiment closed on this branch; not merged.
