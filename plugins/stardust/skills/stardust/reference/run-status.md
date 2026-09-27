# Run status — `stardust/status.jsonl`

A deterministic progress surface for a stardust run. Every stardust
skill appends one JSON line to `stardust/status.jsonl` at each phase
start and end, so any harness — a Claude Code session, the stardust
app, CI — can tail the run without parsing model output. Progress is
a file contract, not a model-emitted milestone.

## Line shape

One JSON object per line (JSONL — no wrapping array, no pretty-print):

```json
{ "ts": "2026-07-02T14:03:11Z", "skill": "stardust:migrate", "phase": "render", "event": "start" }
{ "ts": "2026-07-02T14:09:47Z", "skill": "stardust:migrate", "phase": "render", "event": "end", "detail": "12 pages rendered", "artifact": "stardust/migrated/" }
{ "ts": "2026-07-02T14:11:02Z", "skill": "stardust:rollout", "phase": "C-deliver", "event": "blocked", "detail": "DA_TOKEN expired (401) — ledger checkpointed, awaiting re-auth" }
```

| field | required | contents |
|---|---|---|
| `ts` | yes | ISO 8601 timestamp |
| `skill` | yes | the skill writing the line (`stardust:extract`, `stardust:deploy`, …) |
| `phase` | yes | the skill's own phase name, as its SKILL.md names it |
| `event` | yes | `start` \| `end` \| `blocked` |
| `detail` | no | one human-readable line (counts, blocker reason) |
| `artifact` | no | path to the phase's primary output, when one exists |

**Phase names.** A `Phase N — Title` heading uses the title's descriptive
word in lower-case kebab form (`render` for "Phase 2 — Per-page render"); a
`Letter —` or `N.` step heading uses `<Letter or N>-<first word>`
(`C-deliver`, `I-dashboard`, deploy's `1-audit`). The reference list per skill is the `PHASES` table in
`skills/stardust/scripts/ledger.mjs`, which writes the line
(`node skills/stardust/scripts/ledger.mjs <skill> <phase> <start|end|blocked>
[--detail "…"] [--artifact <path>] [--strict]`), writes a known phase in the
table's own form (an alias or a differently-cased name is normalised) and
warns on a name outside the table. Supervising runners key on these strings,
so a skill's final phase must appear exactly as listed.

## Rules

- **Append-only, never rewritten.** A correction is a new line, not an
  edit of history.
- **Absent file = created on first write.** No setup step owns
  creation; the first skill to reach a phase boundary creates it.
- **Failures still emit.** A phase that halts appends
  `event: "blocked"` with the reason in `detail` *before* stopping —
  the ledger never goes silent on the failure path.
- **One line per phase start, one per end.** No intermediate spam;
  per-page progress lives in each phase's own ledgers (e.g., rollout's
  `coverage/pages.json`).
- **The `start` line is the FIRST command of a phase** — written
  before any script of the phase runs, never beside `end` once the
  work is done (a recorded hands-off run wrote a phase's `start` and
  `end` one second apart after 109 minutes of work, so a supervisor
  tailing the ledger saw an idle run the whole time). `ledger.mjs`
  warns on an `end` with no open `start` — no earlier `start` for the
  same skill + phase without a later `end` — and refuses it under
  `--strict` (exit 2, nothing written, one stderr line naming the
  missing start command).
- **Every `end` has a journal section.** `ledger.mjs … end` also warns
  when `stardust/journal.md` (beside the ledger) has no `## ` heading
  naming the phase (case-insensitive) — a warning only, never an
  exit-code change; an absent journal is not checked.
- **Harness-agnostic.** Plugin skills must never reference
  harness-specific progress mechanisms (no `emit_milestone`, no
  session APIs). `stardust/status.jsonl` is the only progress
  contract; anything that wants milestones tails this file.

Unlike other stardust artifacts, `status.jsonl` carries no provenance
block — each line is self-describing via `ts` + `skill`, and the
append-only rule replaces the overwrite protection provenance
normally provides.

- **The claim is read (#127).** When `$STARDUST_DECIDER` is not `off`,
  `ledger.mjs … end` runs the `phase-claim` battery over the `detail` and
  the journal section: does the claim cite instrument output, assert an
  outcome without it, or name a skipped or deferred step? `shadow` and
  `assist` print one `ledger: decide:` line with the probabilities; under
  `gate` with `--strict` a confident asserted or skipped claim (P ≥ 0.85)
  is refused like a missing start — cite the verdict lines or the evidence
  path in `--detail`, or run the step. A decide failure never blocks.

## Decisions ledger — `stardust/decisions.jsonl`

The decision layer (`skills/stardust/SKILL.md` § The decision layer) appends one JSON line per
typed decision, written by `skills/stardust/scripts/decide.mjs`. Same rules as the status
ledger: append-only, created on first write, one line per decision (a cache hit with the same
`ref` still writes, so the run's record is complete).

| field | required | contents |
|---|---|---|
| `at` | yes | ISO 8601 timestamp |
| `runId` | yes | `--run-id`, else `state.json#runId`, else `$STARDUST_RUN_ID`, else the UTC date |
| `mode` | yes | `off` \| `shadow` \| `assist` \| `gate` — how the caller used the answer |
| `battery` / `version` | yes | the battery file's `name` and `version` |
| `model` | yes | the model that answered (`jev-1.13.0`) |
| `ref` | no | what was decided about — a slug, a flag id, a unit name |
| `answers` | yes | the API answers as returned, probabilities included |
| `route` | yes | `{ overall, questions: { <id>: { verdict, … } }, weakest }` on the battery's thresholds |
| `agent` / `agreement` | no | the caller's own answer per question, and per-question true/false/null against the model |
| `shadow` | no | `{ disagree: [<id>…], review: bool }` — a confident disagreement worth a look; changes nothing |
| `usage`, `ms`, `cached`, `stateSha` | yes | tokens, latency without queue wait, cache hit, first 16 hex of the state hash |

`decide.mjs compare [--battery <b>] [--run-id <id>] [--check]` reads it back: per battery and
question, items, items with an agent answer, agreement overall and per confidence bin, the route
split and the shadow-review count; `--check` validates every line and exits 2 on a bad one. The
per-page index of the same decisions is `state.json` `pages[].decisions.<battery>`
(`state.mjs decision`), so migrate and rollout never parse this file.

