# Shared contracts refactor — plan

Why: adding one concept (the EDS widget, 0.34.0, PR #458) touched 25 prose files and 17 scripts because the
model of "a unit of UI" is restated per skill and the scripts are forbidden to share. Census (2026-10-20, this
branch's session): nine independent EDS-path normalisers across seven skills, five widget-stem helpers with
three different `.html` regexes, four hard-coded copies of the `metadata|section-metadata` pair, three chrome
id sets with different values, two copies of the dynamics class labels that have drifted, three spec `kind`
enums, and a sidecar contract that documents 17 keys while `migrate.mjs` writes 31. Three names for one thing:
rollout `chrome` = spec `global` = deploy `fragment`.

Goal: the next concept-level change touches five to eight files, not forty. Scope is tiers A and B below.
Tier C (one vocabulary) is deliberately out: it changes sidecars, schemas and in-flight project artifacts.

## Tiers

| Tier | What | Risk to mechanics | Risk to output quality |
|---|---|---|---|
| A | One shared script library under `skills/stardust/scripts/lib/`; one resolver for both layouts; a `stage.mjs` that copies skill script sets and always includes the library | medium, fully testable | none |
| B | One canonical model doc `skills/stardust/reference/eds-model.md`; drift lints; per-skill prose consolidation — the one-sentence decision stays at the decision point, rationale and schema move behind a section link | low | medium — a moved rule is in context only when the pointer is followed; gated by evals |
| C | Rename chrome/global/fragment to one word; reconcile spec `kind`, dynamics `target`, rollout `kind` | high | low | — out of scope |

## Phase 0 — preparation (PR 0, no behaviour change)

1. **Characterization tests** `skills/stardust/scripts/test/contracts-characterize.test.mjs`: one input table
   (folder index, leaf, `.html`, query, hash, trailing slash, uppercase host, `/widgets/…html?…`, reserved
   stems, `-wrapper`/`-container`) fed to every existing implementation of: path normalisation (deploy
   `eds-path.mjs` `pathKey`, `localize-links`, `deploy-batch`, spec `lib.mjs`/`spec-knowledge` `needsEntry`,
   diff `chrome-compare`, qa `routing`/`lib`/`content`, rollout `lib.deliveredUrl`/`inventory`/
   `delivery-lint`/`assemble`/`done-check`/`seed-redirects`, migrate `sidecarFor`/`urlFormOf`, replica
   `gate-evidence.daPath`); widget stem (migrate `widgetsIn`/`widgetHref`, rollout `widgetCodePath`/
   `pageWidgets`, delivery-lint, deploy `widgetStem`/`widgetLinks`, qa `widgetLinks`); chrome ids (rollout
   `CHROME_IDS`, spec `CHROME`, deploy ai-readability `isChrome`, qa default list); class labels (dynamics
   `CLASS_NAMES` vs spec-knowledge `CLASS_NAMES`). Where implementations already disagree the test records
   the pair in a `KNOWN_DIVERGENCE` list and fails only if that list changes. Pure, no browser.
2. **Golden pipeline snapshots** `evals/golden/`: `run.mjs` drives the deterministic chain on fixtures —
   migrate → rollout inventory → blocks → plan → delivery-lint; dynamics-plan on a saved findings file;
   spec-knowledge on a saved spec tree — with `--now` fixed so timestamps are stable, writing to
   `evals/golden/expected/<chain>/`. `golden.test.mjs` asserts byte identity. Fixtures: the migrate test's
   own fixture (extend it with one widget mount and one chrome fragment), the dynamics-plan test fixture,
   the spec-knowledge test fixture. Add a row to `scripts-index.md` only if `run.mjs` is a shipped script
   (keep it under `evals/`, so no row).
3. **Eval baseline**, label `pre-refactor`, N=3: existing `ai-readability`, `ew-editability`,
   `migrate-incremental` (step 1) plus three new pointer-following evals, judged by artifact inspection:
   `deploy-triage-widget` (fixture page with a search section → one `/widgets/…html` link, no block table),
   `dynamics-target` (saved findings → `target` column present and correct), `spec-kinds` (saved component
   list → `widget`/`block`/`default` kinds). Each needs `task.md`, `criteria.json`, `fixture/`, `answers.md`
   (defaults-only persona).
4. **Field replay baseline**: run `spec` and `dynamics` scripts on the capture named in § Inputs; save the
   generated JSON under `evals/golden/field/<site-role>/` locally (gitignored — contains a site name).
5. **Vocabulary decision recorded** in `eds-model.md` § Names: no rename; one mapping table.

## Phase 1 — PR 1, shared script library (tier A)

- `skills/stardust/scripts/lib/paths.mjs` (moved from `deploy/scripts/eds-path.mjs`), `names.mjs`
  (`RESERVED`, `edsName`, `reservedStem`, `widgetStem`, `widgetHref`, `widgetCodePath`), `kinds.mjs`
  (`CODED`, `CHROME_IDS`, `KEY_VALUE_BLOCKS`, `DEFAULT_CONTENT`, the kind enums, `AI_EXCLUDE_DEFAULT`),
  `taxonomy.mjs` (dynamics `TAXONOMY` + `CLASS_NAMES`), `resolve.mjs` (`sibling(skill, file)` — plugin tree
  `../../<skill>/scripts/` or project copy `../<skill>/`; `lib(file)` likewise).
- `skills/stardust/scripts/stage.mjs <skill…> [--to stardust/scripts]`: copies each skill's `scripts/` and
  always `stardust/scripts/lib/`; `--help` before I/O; test; `scripts-index.md` row. Replace the prose copy
  steps (replica SKILL.md setup, handoff-contract § Phase 5, reskin SKILL.md, spec SKILL.md, extract
  `style-census`/`thumb` self-copy) with one line each.
- Swap consumers one skill per commit: deploy, rollout, qa, spec, migrate, dynamics, replica, reskin, diff,
  extract. Each commit deletes the duplicate it replaces; characterization + golden stay green; the old
  entry points (`deploy/scripts/eds-path.mjs`, spec `loadSibling`) become one-line re-exports for one
  release so in-flight project copies keep working. The twelve dual-layout candidate lists become
  `sibling()` calls.
- Layout test `skills/stardust/scripts/test/stage.test.mjs`: stage a temp project tree and import every
  shipped script from the project-copy layout (the layout where sharing has broken before).
- Prose touched: `scripts-index.md` rows, each skill's copy step, `CLAUDE.md`/`AGENTS.md` bullet "resolve
  sibling-skill imports in both layouts" → "import shared rules from `stardust/scripts/lib/` via
  `resolve.mjs`".

## Phase 2 — PR 2, drift lints and a sidecar schema (tier B, mechanics)

- `evals/lint/contract-drift.mjs`, added to `npm run lint:stardust`: (a) the sidecar keys documented in
  `migrate/reference/migration-procedure.md` equal `SIDECAR_KEYS` in `migrate.mjs`; (b) kind enum literals
  appear only in `eds-model.md`, the JSON schemas and `kinds.mjs`; (c) the reserved-name set and chrome id
  set appear only in `names.mjs`/`kinds.mjs`; (d) the metadata/section-metadata pair only in `kinds.mjs`.
- `migrate/schemas/meta.schema.json` generated from `SIDECAR_KEYS` and validated in `migrate.test.mjs`;
  `rollout-pages.schema.json` cross-checked against it in `inventory.test.mjs`.

## Phase 3 — PR 3, canonical model doc and prose consolidation (tier B, prose)

- `skills/stardust/reference/eds-model.md` (~120 lines, tables): § Unit of UI (decision rule verbatim:
  default content / block / widget / chrome), § Names (chrome = global = fragment; reserved names; stem
  rules), § Paths (folder index, leaf, the one sanctioned `.html`), § Sidecar (`_meta.json` keys, generated
  section kept honest by the drift lint), § Widget contract, § Where each skill decides (one line per skill
  pointing at its decision point).
- Consolidate one skill per commit, ordered by eval coverage: deploy, migrate, rollout, qa, spec, dynamics,
  replica, direct, prototype, reskin. Rule per edit: the decision sentence stays in SKILL.md; rationale,
  schema and edge cases move behind `eds-model.md § <section>`; collapse divergent restatements first.
  Prose-delta net negative per skill. Each skill's folded lines listed in the PR body.
- Bump 0.35.0 (minor: the project-copy contract changed) in `plugin.json`, `marketplace.json`, CHANGELOG.

## Validation

| Level | Check | Gate |
|---|---|---|
| every commit | 6 lints + `contract-drift`; all `scripts/test/*.test.mjs` (63 runnable; `dropdown-unreachable` needs Playwright); characterization table; golden byte identity | all green |
| PR 1 | layout test from the project copy; golden identity | identical outputs |
| PR 2 | drift lint passes on main after PR 1; fails on a seeded duplicate (negative test) | both |
| PR 3, per skill | that skill's evals under `post-refactor`, `compare.mjs` vs `pre-refactor` | stable criteria unchanged; noisy ones not trending down across N; session tokens ≤ baseline |
| field replay | spec + dynamics JSON on the capture after PR 1/2 | diff zero; after PR 3 only prose fields may change |
| post-merge (not overnight) | one single-page deploy on a sandbox site; watch `learnings.md` for a moved rule | human review |

Rollback is per PR: PR 1 keeps re-exports, so PR 3 alone can be reverted; PR 2 stops the duplication from
growing back.

## Hands-off run protocol

- Branches off `origin/main`: `refactor/0-prep`, `refactor/1-lib`, `refactor/2-drift`, `refactor/3-model`,
  each based on the previous. Pushed to `fork`. PRs opened against `adobe/skills` main in that order, each
  body carrying the prose-delta line, test and lint output, and (PR 3) the eval comparison table.
- Conventional commits; attribution line per the session rule. No force-push. Never commit `results/` or
  the field-replay outputs.
- Log of every step appended to `notes/refactor-shared-contracts-run.md` (started, done, evidence,
  deviations), so the morning read is one file.
- Stop conditions (write the reason to the run log, leave the branch pushed, continue with the next
  independent item if any): characterization or golden test red that is not explained by the commit's own
  intended change; an eval criterion stable at 3/3 in baseline dropping to ≤1/3; eval spend reaching the cap
  in § Inputs; any `gh pr create` denied by the permission layer (push the branch, leave the body file at
  `/tmp/<branch>-pr.md`, note it); a lint that needs a new site-name allowlist entry (never add one
  unattended).
- Budget: eval runs are the only external spend. Baseline 6 evals × 3 runs + per-skill reruns in PR 3
  (~10 × 3) at the observed ~$8–20 per run.

## Inputs (filled from the owner before the run)

- eval spend cap: **$500** (2026-10-20)
- eval runs enabled overnight: **yes**
- field replay: **several captures, not one** — offline replays re-run the deterministic scripts on saved
  artifacts (dynamics-plan on the saved findings; rollout inventory → blocks → plan → delivery-lint on the
  migrated tree) and diff the JSON. Set (2026-10-20): five offline — an enterprise-SaaS site (100 pages, full
  chain), a retail site (106), a bank redesign (100), a storage-vendor site (4), a sports-club site (9, dynamics
  only) — plus one live spec+dynamics run on the airport site whose arrivals board is the widget case. Outputs
  stay local (site names); the run log names the project dirs.
- PR mode: **open PRs** against `adobe/skills` main, stacked 0 → 3
- vocabulary: **no rename, confirmed**
- version bump: **0.35.0 in PR 3 only, confirmed**
