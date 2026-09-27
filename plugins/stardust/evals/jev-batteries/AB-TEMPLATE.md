# A/B run report — stardust with and without the decision layer

Copy this file per site as `AB-<site-role>-<date>.md` under `data/` (site names stay out of the
repo) and append the summary rows to `BASELINE.md` § A/B runs. Two arms, same prompt, same plugin
version, same model, same day; `STARDUST_DECIDER=off` and `STARDUST_DECIDER=assist` (supervisor
batteries in `gate` where BASELINE.md says go). The `off` arm runs first so the origin's
bot-management budget is spent on it equally; if either arm is blocked by the origin, both are
re-run another day rather than compared.

## Site and scope

| field | value |
|---|---|
| site role (never the name) | e.g. "a regional bank, clean origin" / "a pharmacy retailer, bot-managed origin" |
| pages in scope | 10–20, the `--pages` list, identical in both arms |
| plugin version / model / date | |
| prompt (verbatim, identical) | |

## Per arm

| KPI | off | assist | how measured |
|---|---|---|---|
| wall-clock, prompt → final report | | | `status.jsonl` first and last `ts` |
| assistant turns / tool calls | | | transcript count |
| output / cache-read / cache-write tokens, API-equivalent cost | | | transcript usage |
| pages within the full four-criteria bar at the published origin | | | `gates/all-<w>/summary.json` pass / rows |
| pixel-only passes (calibration) | | | same table `pixelOnlyPass` |
| gate rounds per archetype; rounds excluded as invalid | | | `replica/progress.json`, `decide: round` lines |
| flags fixed / justified / left | | | `flags-<label>.json` vs the final round |
| residuals with a named cause | | | `replica/progress.json` |
| supervisor refusals (ledger end) and whether each was right | — | | `decisions.jsonl` phase-claim lines with REVIEW; hand-judged |
| human touches (prompts, token refreshes, decisions) | | | transcript |
| Jev requests / tokens / cost / median latency | — | | `decide.mjs compare`, `decisions.jsonl` usage |
| agreement per battery among `act`-routed items | — | | `decide.mjs compare` |

## Findings

- What the assist arm did differently, with the ledger line or `decide:` line that shows it.
- Defects found in either arm by a human after the run, and which gate should have caught them.
- Anything the supervisor refused or flagged that was wrong (false refusal) or right.

## Verdict

One paragraph: which KPIs moved, which did not, and what that says against the estimates in
`notes/jev-system-one-research.md` § 6.
