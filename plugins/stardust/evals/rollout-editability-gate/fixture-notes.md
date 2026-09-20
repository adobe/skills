# Fixture provenance & known limitations

`fixture/stardust/` is the shared post-migrate tree
(`evals/_shared/fixture-post-migrate/`); `fixture/blocks/{header,footer,fragment}`
and `fixture/styles/` come from `evals/ew-editability/fixture/`. Added on top:

| path | encodes |
|---|---|
| `blocks/hero-statement/` | clean node-slotting block |
| `blocks/cards/` | value-slotting block (`h.textContent = …`) — the EW1 defect |
| `content/index.html`, `content/business.html` | the two authored landing pages, not yet pushed |
| `stardust/rollout/ew/{home,business}.json` | `ew-editability-probe.mjs --content … --json` artifacts: home `totals.dead 2` in `cards`; business clean |
| `stardust/rollout/coverage/*.json`, `plan.json` | home + business `converting`, blocks `converted` with `edsBlockName` (coverage-tiles → cards) |
| `journal.md` fifth entry, `status.jsonl` three lines | the `Next:` is the ingest |
| `stardust/replica/progress.json` | all archetypes gated / residuals named so Setup does not block |

## Known limitations — not skill bugs

- The probe artifacts are hand-authored in the instrument's shape; re-running
  the probe needs Chromium (self-skips without it) and would reproduce the same
  totals for `content/index.html`.
- No DA target answers; the PUT itself cannot happen — the criteria judge the
  decision (home held, business eligible), not the push.
