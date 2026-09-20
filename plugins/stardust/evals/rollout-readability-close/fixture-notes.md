# Fixture provenance & known limitations

`fixture/stardust/` is the shared post-migrate tree
(`evals/_shared/fixture-post-migrate/`) advanced by hand to "Phases C–D done,
readability live run captured". Everything under `fixture/` is visible to the
agent; this file and `answers.md` are not.

| path | shape follows | encodes |
|---|---|---|
| `stardust/state.json` `handsOff: true` | master § Hands-off mode | hands-off run |
| `stardust/replica/progress.json` | source-fidelity-gate.md § Residual logging format | program archetype gated; article residuals named so Setup does not block |
| `stardust/rollout/{rollout.json, coverage/*.json}` | rollout schemas | six `deployed` rows |
| `stardust/rollout/ai-readability-live.json` | `ai-readability.mjs --json` (pages[{path, strict, code, blocks} \| {path, error}]) | four ≥ 98, one code 91 (cards +40 words), one HTTP 429 |
| `journal.md` fifth entry, `status.jsonl` four lines | journal-format.md, run-status.md | the `Next:` is the ingest command |
| `stardust/migrated/insurance/{home,auto}/_meta.json` `gatesPassed: ["archetype-gate"]` | fidelity-tiers.md § Declaration | the program archetype is gated here (shared tree: `[]`) |

Copied before the shared tree gained `usage.json` / `usage.md` (T13.4) and
`current/pages/business.html` — absent here; the readability close reads none
of them.

Expected medians over the five scored pages: strict 97, 96, 98, 95, 86 → median
96; code 99, 100, 100, 99, 91 → median 99. (The criteria text quotes what the
instrument prints; if a criterion's number and this note disagree, the
instrument's output wins.)

## Known limitations — not skill bugs

- `verify.mjs --root stardust/migrated` flips `deployed` rows to `verified`
  from the local tree although nothing was fetched — offline-mode quirk.
- No live host answers; the readability artifact is hand-authored in the
  instrument's shape. The eval is text-only.
