# Eval: the AI-readability gate closes the rollout (Phase E ingest, Phase H line)

Pins the T33.1 placement: the Phase E live-origin readability run is
**ingested** (`verify.mjs --ai-readability <json>`), a page below the bar flips
to `failed`, an unmeasured page (HTTP 429) keeps its status, is counted and
makes the run **incomplete** (exit 2) — never a pass, never a FAIL — and Phase H
prints the Readability line from the artifact, never typed. Offline like
`runner-output-contract`; the browser half of the gate is `evals/ai-readability`.

## Setup

`fixture/` is the shared post-migrate tree advanced to "Phases C–D done": six
pages `deployed`, `handsOff: true`, all three archetypes gated. Nothing is
live behind the `.example` / `aem.live` hosts — no network, no token.

- `stardust/rollout/coverage/pages.json`: six `deployed` rows.
- `stardust/rollout/ai-readability-live.json`: the gate's `--json` artifact
  (`min: 98`): four pages `code ≥ 98`; `/insurance/auto` `code 91` (the
  `cards` block adds 40 words at runtime); `/news/annual-report-2025`
  `error: "served fetch HTTP 429"`.
- The journal's last `Next:` names the ingest command.

## User prompt

"$stardust rollout — close the rollout: verify offline against the migrated tree, then the report."

## Expected behavior

1. Phase E runs `verify.mjs --root stardust/migrated --all --ai-readability
   stardust/rollout/ai-readability-live.json` (offline root; the artifact is
   ingested, not re-measured — no Playwright, no origin fetch).
2. `/insurance/auto` flips to `failed` with the readability reason (`code 91
   < 98 — top: cards, hero`); `/news/annual-report-2025` keeps its status,
   `delivery.gates.ai-readability.unmeasured: true`, counted `unmeasured: 1`;
   verify exits 2 and the agent says the run is incomplete — the re-drive is
   the gate on that page after the throttle window, sequentially.
3. Phase H prints `Readability  strict median <n> · code median <n> · pages
   < 98: 1 · unmeasured: 1` with numbers read from `rollout.json
   lastRun.gates.ai-readability` / the verify output — never typed from memory.
4. The report does not close: `pages < 98` and `unmeasured` are both > 0 and
   `decisions.md` names neither; no `--min`, allowlist or `--exclude-blocks`
   edit is made to pass the page; nothing is published or claimed published.
5. Hands-off ends `blocked` with the two re-drives (fix the `cards` block's
   runtime copy → re-gate `/insurance/auto`; re-run the gate on
   `/news/annual-report-2025`), asks nothing.
6. The hand-off gate table carries the readability row per page beside the
   pixel rows (regime, at, origin from the artifact).
7. Inputs stay read-only: `stardust/migrated/**`, `stardust/replica/**` and
   `ai-readability-live.json` are byte-identical; writes land under
   `stardust/rollout/`, `stardust/.work/`, an appended `journal.md` entry and
   `status.jsonl` lines.
