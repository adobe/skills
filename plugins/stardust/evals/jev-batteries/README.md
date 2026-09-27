# jev-batteries — measuring the decision layer

Replays recorded decisions from past stardust runs through `skills/stardust/scripts/decide.mjs`
and reports agreement, so a battery earns its place before any caller gates on it (#126).

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
