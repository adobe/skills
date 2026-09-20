# Fixture provenance & known limitations

`fixture/stardust/` is a verbatim copy of the shared post-migrate fixture
(`evals/_shared/fixture-post-migrate/stardust/`, copied with `cp -R` per its
README — never symlinked) plus one file this eval adds. Everything under
`fixture/` is copied into the eval workspace and is visible to the agent;
this note and `answers.md` are not.

## What this eval adds on top of the shared tree

- `stardust/.gitignore` — a byte-identical copy of
  `skills/stardust/reference/stardust.gitignore`. The master skill's Setup
  step 6 writes this file when absent; pre-seeding it makes Setup a pure
  read and lets `nothing_written` be judged as "workspace byte-identical"
  rather than "only the hygiene file changed". If the reference file
  changes, refresh this copy (`cmp` the two).

Nothing in the shared tree is edited. Shape provenance for every file is in
the shared README's table; the three gate cases the report must print
(pass / pass-with-cause-logged-residuals / never gated) are described there
too.

## What the fixture deliberately makes true

- All six pages in `state.json` are `migrated`, so the redesign heuristics
  in `state-machine.md` § State report would conclude "complete". The
  correct recommendation comes from `progress.json` under `flow: replica`.
  That divergence is the point of `recommendation_follows_replica_rule`.
- The journal's last `Next:` line is still current (nothing has changed
  since the blocked rollout), so `journal_next_quoted_and_verified` tests
  the check itself, not discrepancy handling. A stale-journal variant would
  edit `progress.json` to gate `insurance__home` and leave the journal
  as-is; it is not part of this eval.
- The workspace is not a git repository, so the report's `Repo:` block
  must be omitted.

## Known limitations — don't mistake these for skill bugs

- The origin is a `.example` host: once the persona says "go" and the
  `replica` skill starts its gate, every live capture fails. Grading stops
  at skill entry; the failure itself is expected and ungraded.
- `stardust/current/`, `stardust/prototypes/`, `stardust/replica/gates/`
  and the root `PRODUCT.md` / `DESIGN.md` / `DESIGN.json` are absent (see
  the shared README). The `replica` skill will notice once entered; the
  state report should at most mention the absence, and `extract` must not
  be re-run to repair it (`no_rerun_of_finished_steps`).
- `state.json` lists six pages while `site.crawled` and the first journal
  entry say nineteen; the thirteen uncaptured siblings are not in the
  state file. Surfacing that gap is acceptable, not required.
- Every sha in the tree is syntactically valid but fabricated; nothing
  hashes to it.
- `_provenance.stardustVersion` is 0.23.0 in `state.json` and 0.22.2 in
  the migrated HTML and `progress.json` — intentional (resumed after a
  plugin upgrade, per the shared README).

## Renderer

`node skills/stardust/scripts/status.mjs --root <fixture> --json --no-probe`
is pinned deterministically by `skills/stardust/scripts/test/status.test.mjs`
against the shared tree: 6 migrated pages, the three
gate cases, `probes: "not probed"`, `reconcile: "not reconciled"`, the
missing-`next` warning on the last blocked line, the replica-flow
recommendation, and a byte-identical fixture after the run. The last
`status.jsonl` line deliberately carries no `next`, so the warning is part
of the expected report — not a fixture defect.
