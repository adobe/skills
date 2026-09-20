# Fixture provenance & known limitations

`fixture/stardust/` is a `cp -R` of the shared post-migrate fixture
(`evals/_shared/fixture-post-migrate/stardust/`, see its README — never
symlinked, never copied with the README) plus two deltas. Everything under
`fixture/` is visible to the agent under test; this note is not. There is no
`answers.md`: the task runs hands-off.

## What this eval adds on top of the shared tree

- `stardust/replica/progress.json` — the `landing` archetype `home` gains a
  `published` block: `published.1440` and `published.360` each `pass: true`
  with `pixelPct`, `structuralRed: 0`, `at` and the published `origin`
  (`source-fidelity-gate.md` § Residual logging format, `published.<bp>`).
  `article` (prototype gates FAIL, no `published` slot) and `program`
  (never gated) are byte-identical to the shared tree.
- `content/.deploy-ledger.json` — the deploy-batch ledger with all six pages
  `previewed` (`put: 201`, `preview: 200`, `verify: 200`, `attempts: 1`,
  `branch: main`), keyed by web path (`/index` for the home page).

`stardust/rollout/` does not exist: Phases A/B create `coverage/*.json` and
`plan.json`; `journal.md` and `status.jsonl` are the shared tree's (the last
rollout line is the shared `blocked` on the `program` archetype).

Copied before the shared tree gained `stardust/usage.json` / `stardust/usage.md`
(T13.4) and `stardust/current/pages/business.html` — absent here (no
`stardust/current/` at all); the resume/usage criteria do not apply.

## What the fixture deliberately makes true

- `inventory.mjs` yields exactly three archetype-keyed groups (`home`,
  `news__storm-season-checklist`, `insurance__home`) with the `renderBranch: A`
  page as representative.
- `update-coverage.mjs --block <landing block> --status verified` is accepted
  (both configured breakpoints pass on the published origin);
  `--block product-hero|article-header --status verified` is refused, exit 2,
  naming `program archetype insurance__home ungated at 1440/360` or the
  article archetype the same way.
- No `blocks/` directory exists and the task has no conversion step, so
  `blocks.mjs` seeds every block `pending`; a correct run leaves the six
  program/article blocks `pending` (not `converted` or `deployed`) — the
  claim gate blocks `verified`, nothing else moves.
- `dashboard.mjs` prints the Phase H `Blocks` line with the `ungated:` clause.

## Known limitations

- `update-coverage.mjs` accepts `pending → verified` directly for the landing
  blocks: the lifecycle `pending → converted → deployed → verified`
  (`coverage-model.md` § Block delivery status lifecycle) is not enforced by
  the claim gate. The eval grades the claim gate only.
- The ledger origin is a fictional `.example`/`aem.live` pair; `--publish`
  cannot reach an admin API and is graded as not run.
- Expected to fail on the 0.24.0-next.3 baseline (no template claim gate):
  the baseline flips every previewed template's blocks to `verified`.
