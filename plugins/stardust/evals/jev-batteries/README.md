# jev-batteries — measuring the decision layer

Replays recorded decisions from past stardust runs through `skills/stardust/scripts/decide.mjs`
and reports agreement, so a battery earns its place before any caller gates on it (#127).

```bash
set -a; source ~/.claude/.env; set +a                     # TYPESAFE_API_KEY
node evals/jev-batteries/harvest.mjs --projects <dir with one recorded project per subfolder>
node evals/jev-batteries/replay.mjs --models jev-1.13.0,jev-preview
```

- `harvest.mjs` → `data/items.jsonl`: page types from `state.json` + captured page JSON;
  dynamics triage rows from `dynamic-features.md`; section pairs from `eds-schema/` labelled
  same block (same section name on two pages) or different. Everything under `data/` names real
  sites and is gitignored.
- `replay.mjs` → stdout tables + `data/replay-<ts>.json`: per battery and question, agreement
  with the recorded answer, agreement per confidence bin, the route split, and agreement among
  items the route would have acted on without review. Requests are cached under `data/cache/`;
  re-running with new thresholds is free.

Read the numbers as agreement with what an agent or a person recorded, not as truth: some
recorded answers are themselves wrong. What matters is the shape — agreement rising with
confidence, and a high agreement among `act`-routed items — because that is what confidence
routing depends on. Level 1 of `section-alignment` (variant) is not in the labels; it shows
up as `0→1` or `2→1` disagreement and should be judged by hand from the pairs it names.

## A/B runs (phase 7)

`AB-TEMPLATE.md` is the per-site report: two arms (`STARDUST_DECIDER=off` and `assist`) on the
same 10–20 pages, same day, same prompt; the KPI rows come from the ledgers and the transcripts.
Results are appended to `BASELINE.md` § A/B runs. `fixtures/` hold the hand-written negative
classes the recorded runs do not contain (asserted claims, serial owner questions, out-of-order
steps, fix patterns, invalid rounds); read agreement on them as a separation test.

`collect-ab.mjs --off <project> --assist <project> [--off-transcripts <dir>] [--assist-transcripts <dir>]`
fills the KPI table of the template from the two runs' ledgers and transcripts (wall-clock, phases,
full-bar and pixel-only passes, gate cells and residuals, pre-sorted flags, decisions and Jev cost,
phase-claim reviews, turns, tokens and API-equivalent cost).
