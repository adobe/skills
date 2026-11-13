# Shared contracts refactor — run log

Hands-off run started 2026-10-20 evening from `plugins/stardust/notes/refactor-shared-contracts-plan.md`.
One entry per step: started / done / evidence / deviations. No site names here either: the replay set is named by role
(the plan's § Inputs); the local project dirs are listed only in the replay baselines' own COMMANDS.md, outside the repo.

Replay set: five offline projects — an enterprise-SaaS site, a retail site, a bank redesign, a storage-vendor site, a
sports-club site (dynamics only) — and one live spec+dynamics run on the airport site.

Baseline worktree (pre-refactor, pinned to origin/main at start): `/Users/paolo/stardust/source/201026/skills-baseline`.
Eval spend cap: $500. PRs: open against adobe/skills main, stacked refactor/0-prep → 1-lib → 2-drift → 3-model.

## Log

### Phase 0 — started
- plan + run log committed on `refactor/0-prep` (320f8bcb); baseline worktree created at 1af9b4b9; `caffeinate -dims` running.
- three parallel workstreams started: (1) characterization tests → `skills/stardust/scripts/test/contracts-characterize.test.mjs`;
  (2) golden chain `evals/golden/` + offline field replays into `../replay-baseline/` from the baseline worktree, one live
  spec+dynamics run on the airport project; (3) three new evals + `pre-refactor` baseline runs from the baseline worktree
  (hard cap for this step $220 of the $500).
- rule for this phase: no script edits in the EDIT worktree until (1) and (2) have produced their expected tables.
### Phase 0 step 2 + 4 — done
- `evals/golden/` committed: 9-step chain (migrate 3-page fixture → inventory → blocks → plan → delivery-lint; dynamics-plan; spec-knowledge), 49 expected files, fixed-clock preload, `golden.test.mjs` ~0.4 s, two consecutive runs identical. Left out (network/Playwright): spec-inventory/fetch/links, dynamics-detect, rollout deploy/verify.
- field replay baselines under `../replay-baseline/` from the baseline worktree: five offline projects ran (one dynamics-only), the live airport run ran spec-inventory/fetch/parse + dynamics-detect (headless hit redirect loops; `--headed` tier succeeded, 14 findings → 14 plan rows). All exit 0. Local only.
### Phase 0 step 1 — done
- `contracts-characterize.test.mjs` committed: 20 checks, 1.1 s, 102 KNOWN_DIVERGENCE rows (path-key 35, served-url 25, tree/DA/sidecar 11, widget-stem 9, chrome 7, class-label 2, kind-enum 13). Key facts for Phase 1: the nine path normalisers disagree on query, hash, case, `.htm` and host handling; `header` is chrome in rollout/spec/ai-readability but not in qa's default or delivery-lint; rollout's widget id strips only lowercase `.html`.
- step 3 (evals + baseline runs) still running in the baseline worktree.

### Phase 0 step 3 — done
- three new evals committed on `refactor/0-prep` via the `skills-prep` worktree (`deploy-triage-widget`, `dynamics-target`, `spec-kinds`; 7 artifact-judged criteria each); runner SDK bumped to ≥ 0.3.304 (the bundled CLI rejected the environment's fast model).
- baseline label `pre-refactor` (plugin = baseline worktree, N=3, sessions on the environment's fast model — post-refactor runs must use the same): dynamics-target 95.0 (target_column_present 2/3), spec-kinds 100.0, deploy-triage-widget 93.3 (hero_is_block 1/3: two runs read D1 "no repeating units → default content" and made the hero default content although the same paragraph says heroes stay blocks — a real wording divergence for `eds-model.md` § Unit of UI). Spend $11.46 of the $500 cap. The `decided_out` criterion was re-scoped mid-baseline (hands-off runs may not set decided-out on an assumption) and the three run snapshots re-judged; both labels will face the re-scoped rubric.
- not runnable (no fixture, none invented): ai-readability, ew-editability, migrate-incremental.
- Phase 0 complete except PR opening (done with the stack at the end of the run).
- PR 0 opened: https://github.com/adobe/skills/pull/461 (`refactor/0-prep`, base main).

### Resume — 2026-11-13, PR 0 (`refactor/0-prep`)
- started: main moved 0.34 → 0.38.2 during the pause (104 commits). `git rebase origin/main` clean (4 commits).
- golden: one file moved — `rollout/rollout.json` gained `"scope": null` (0.36.0, `#490`, first page first; intended) → re-baselined in its own commit.
- characterization: one new divergence — 0.38.1 (`#575`) added `library-metadata` to davids-model-lint KEY_VALUE_BLOCKS; qa content.mjs still excludes the pair only → pinned as row 103 + the metadataPair output, not fixed (PR 0 changes no behaviour). 102 → 103 rows.
- plan: Phase 1 adopts 0.38.0's (`#573`) Setup step 7 copy of the master `scripts/` instead of `stage.mjs` + `#lib/*`; version bump per PR per AGENTS.md (the 0.35.0-in-PR-3 note is superseded); 82 test files on 0.38.2; 7 lints incl. browser-front-door.
- baseline worktree refreshed to origin/main 5972a44f (runner SDK bump and the three eval copies kept, identical to this branch's); old results archived under `results/_2026-10/`.
- eval baseline `pre-refactor`, N=3, plugin = baseline worktree @ 0.38.2, sessions on the SDK default model — `claude-opus-5-5` this time (October's ran on the fast variant; post-refactor runs must use `claude-opus-5-5`, standard speed): deploy-triage-widget 98.3 (no_site_names 2/3: one log named the DA content host), dynamics-target 100.0, spec-kinds 100.0. Every other criterion 3/3. Session spend $5.83 (cap $40). The October hero_is_block 1/3 did not recur.
- field replay baseline re-taken from 0.38.2 into `../replay-baseline-2026-11/` (the October one predates 0.35–0.38): the same five offline projects, every step exit 0; a second run diffs zero over 402 files modulo ISO stamps (`replay-diff.sh`). Live airport run works with `--headed` (headless still loops): spec S1–S3 5/5, dynamics-detect 17 findings (14 in October — the site changed), plan written; informative only, the site moves between runs.
- tests: lint exit 0; 81 of 82 script test files pass (`dropdown-unreachable` needs Playwright); characterization and golden green.
