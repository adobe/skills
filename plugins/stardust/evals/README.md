# Stardust v2 evals

### 0.14.0 rescope notes

The 0.14.0 (Fable 5) refactor changes contracts that several criteria below
hard-pin. The eval definitions are left as-is for now; these criteria need
rescoping before the suite is run against 0.14.0:

- **`no_eds_references` (every eval).** Written when the plugin was
  platform-agnostic end-to-end. The plugin now has an EDS delivery half
  (`deploy`, `rollout`, `diff`, `prepare-migration`), so a plugin-wide EDS ban
  is wrong. Rescope to: the *core* artifacts (extract/direct/prototype/migrate
  outputs under `stardust/current/`, the target spec, prototypes, migrated
  HTML) must stay free of EDS/CMS leakage; delivery skills are exempt.
- **Two-question ceiling (`direct-from-phrase`).** ~~Still valid for the
  interactive flow, but 0.14.0 adds a hands-off production mode that asks
  *zero* questions and resolves ambiguity from captured evidence. Rescope the
  criterion to interactive invocations only.~~ **Rescoped (2026-07-22):** the
  criterion now pins the interactive contract explicitly (self-answered
  "would have been" questions fail), and the eval runner presents sessions
  with an `answers.md` persona as interactive so headless runs exercise that
  branch (see `runner/README.md`).
- **Closed-catalog criteria (uplift/prototype).** Any criterion asserting the
  agent picks strictly from a fixed catalog (e.g. the what-if candidate list)
  conflicts with 0.14.0's opened catalogs, which allow evidence-gated
  extensions. Rescope to: catalog-first, extensions permitted only with cited
  evidence from the brand surface.
- **Seed-roll direction procedure (`direct-from-phrase`).** ~~Direction
  research is now reference-grounded via the optional refero MCP, with the
  seed roll demoted to fallback; criteria that pin the seed roll as *the*
  procedure should accept the reference-research path as the preferred
  branch.~~ **Rescoped (2026-07-22):** `divergence_resolved` is now
  mode-aware (Mode A pins from the captured surface; Mode B / default uses
  the research-first procedure with the seed roll as fallback).
- **Extract cap + wait mode (`extract-multipage`).** **Rescoped
  (2026-07-24):** the eval was written against the 25-page default cap
  with a confirmation gate and the `networkidle + 1.5s` recipe. 0.14.0
  changed the default cap to 5 with a silent-proceed contract (kept +
  cut lists are informational, no yes/no gate) and made the wait
  strategy modal (default `medium` = `domcontentloaded` + 2s grace).
  `page_cap_confirmation`, `playwright_over_webfetch`,
  `discovery_before_crawl`, `current_design_md_direct` (impeccable's
  document.md now specs eight canonical sections, not six; omission of
  irrelevant sections allowed), and `state_json_shape` (`direction`
  may be `null` or `{resolvedAt: null}` at the extracted stage) were
  rescoped accordingly; `answers.md` (defaults-only persona, declines
  sibling brand sources) was added so the runner presents the session
  as interactive.
- **Coverage gaps (informational).** The suite predates `audit`, cross-site
  extraction (`--brand-source` / `--design-source`), vision gates, and the
  merge-by-slug parallelism contract; new evals are needed rather than
  rescoped ones.

Evaluation suite for the four-phase redesign pipeline plus the
"open and reasoned" intent-reasoning principle that governs the
master skill.

The v1 evals (`brand-extract-from-url`, `briefings-from-prompt`,
`prototype-iterate`, `stardust-navigator`, `wireframes-render`) were
tied to v1's stage decomposition (`brand` → `briefings` →
`wireframes` → `prototype`) and have been replaced wholesale to
match the v2 surface.

## Format

Each eval lives in its own directory and contains exactly two files:

- `task.md` — Setup, User prompt, Expected behavior. Human-readable
  scenario specification.
- `criteria.json` — Weighted scoring rubric in the tessl `weighted_checklist`
  schema (`tessl plugin publish` validates it): `context`, `type`, and a
  `checklist` of `{ name, max_score, description }`. The runner reads `name` as
  the criterion id and `max_score` as its weight; the total is the sum. Used by the eval runner to score the agent's
  output.

This format mirrors v1's structure (and the format other Adobe-skills
plugins use), so the eval runner that worked for v1 should work for
v2 evals without modification.

## Evals in this suite

| Directory                    | Stage tested              | What it pins down                                                                                   |
|------------------------------|---------------------------|-----------------------------------------------------------------------------------------------------|
| `extract-multipage/`         | Phase 1 (`extract`)       | Multi-page crawl with cap + Playwright (not WebFetch) + correct file shapes + direct authoring of current PRODUCT.md / DESIGN.md. |
| `direct-from-phrase/`        | Phase 2 (`direct`)        | Dimensional restatement + at most two questions + plan-before-execution + direct authoring of target spec + direction.md trace. |
| `prototype-before-after/`    | Phase 3 (`prototype`)     | One proposed file per page + `:root` block + data attributes + content preserved + delegates to `$impeccable craft` + opens in browser. |
| `migrate-incremental/`       | Phase 4 (`migrate`)       | Both render paths (A and B) + nested index.html output + content preservation + idempotent skip on re-run.                 |
| `migrate-multi-template/`    | Phase 4 (`migrate`)       | Three render branches (Path A / A′ / B) + canon + modules + bespoke-slot promotion + broken-link reporting + color-reservation refusal. |
| `migrate-self-contained-bundle/` | Phase 4 (`migrate`)   | Self-contained zip-and-deploy bundle — six asset detection shapes, nine edge cases, six acceptance criteria, state.json `migrate` block with `selfContained: true`. |
| `intent-reasoning-style/`    | Master skill principle    | "Open and reasoned" — vague phrases get clarified, never silently mapped to commands. Pending direction persisted.          |
| `replica-source-fidelity/`   | Entry point (`replica`)   | Mechanical preserve direction (no `direct`) + inconsistency register + clean re-authoring + the measured source-fidelity gate at both breakpoints + standard handoff. |
| `reskin-content-fidelity/`   | Entry point (`reskin`)    | Donor via `--design-source` + content-model capture with scope guard + mapping-brief contract (≥80% mapped) + programmatic render + dual content/design-adoption gates. |
| `ew-editability/`            | Entry point (`deploy`)    | Experience Workspace editability contract (EW1–EW10): node-slotting not value-slotting, authored elements moved into wrappers, wrapper-descendant selectors, `block-roundtrip --ew` + probe evidence, exemptions declared, fidelity not traded. |
| `ai-readability/`            | Entry point (`deploy`)    | AI readability (#100): presentational carousel clones, document-first index-backed listing, explicit fragment decision, no generated visible text, gate run and reported, correct checker facts (no hidden-text or chrome work for the score). |
| `routing-migration-flow/`    | Master skill routing      | § Two migration flows enforced: keep-design phrases → `replica` without a question, plain asks → one keep-vs-redesign question, redesign phrases → redesign flow; `flow` recorded in state.json; `prepare-migration` never loaded for keep-design; `migrate` never first; no hand-built pipeline. |
| `resume-state-report/`       | Master skill resume       | § Routing "No argument" / resume: state report first (`Flow:` line + per-archetype gate numbers from `progress.json`), journal `Next:` quoted and checked against state, replica-flow recommendation (ungated archetype → `replica <archetype>`), nothing written, next phase entered through its skill, heading-list before any skill-file read (W1 target). |
| `runner-output-contract/`    | Batch reporting (`rollout` Phase E) | Runner-output contract on an offline full-site verify: ranked class table (class → count → worst example → file pointer) in the conversation, full per-page listing in `summary.json` + `summary.md` under `stardust/rollout/`, triage per class, hand-off names the summary files; W1-target criteria fail on 0.23.0 by design. |
| `preflight-credentials/`     | Entry point (`deploy`)    | W1 pre-flight: token (present, unexpired, looked up through env → `.env` → `~/.claude/.env`), pushable code branch and scaffold are checked before any conversion work; one consolidated missing-prerequisite list with exact remediation; token value never printed; no push, no DA write, no fabricated token, no silent skip; `blocked` recorded in status.jsonl. |
| `phase-checkpoint-next-command/` | Phase close (`direct`) | Checkpoint block at phase end: completed files (all `ls`-verifiable) + a verified part + ONE verbatim next command + what a re-run would skip; journal `Next:` and `status.jsonl` `next` carry the same command; pages `extracted` → `directed`. W1-target items fail on the 0.23.0 baseline by design. |

## Coverage map

| Layer of the v2 design                       | Covered by                                                       |
|----------------------------------------------|------------------------------------------------------------------|
| Layer 1 — intent abstraction (open + reasoned) | `intent-reasoning-style`, `direct-from-phrase`                  |
| Layer 2 — navigator orchestrator (4 phases)  | `extract-multipage`, `direct-from-phrase`, `prototype-before-after`, `migrate-incremental` |
| Layer 3 — migration tooling (per-page, incremental, idempotent) | `migrate-incremental`, `migrate-multi-template`                |
| Layer 3 — migrate output contract (self-contained bundle)   | `migrate-self-contained-bundle`                                 |

The cross-cutting properties are pinned across multiple evals:

- **Hard impeccable dependency** — every eval expects the master
  setup to verify impeccable before proceeding.
- **Direct authoring** (no interview duplication via `$impeccable
  teach` / `document` for files stardust seeds) — checked in
  `extract-multipage` and `direct-from-phrase`.
- **Provenance everywhere** — each eval has a provenance criterion.
- **No EDS / framework / CMS leakage** — every eval has a
  `no_eds_references` criterion.
- **Stale-on-direction-change** — covered in
  `migrate-incremental` (the eval can be extended later with a
  re-direct mid-run scenario; for v0.2.0 we test the idempotent
  baseline).

## Running

The eval runner is not bundled with this plugin (it lives elsewhere
in adobe/skills). Each eval is self-describing: a runner reads
`task.md` for the scenario, executes it against a clean stardust
project, and scores the output against `criteria.json`.

A criterion passes if its `description` is satisfied as judged by
the runner. Per-criterion verdicts are combined as a weighted sum
out of `total` (100 per eval).

### Lints

`npm run lint:stardust` (repo root) runs ten static checks over `skills/`,
each a plain ESM script under `lint/` that exits 1 with one line per finding,
then the fixture tests under `fixtures/` (plain `node:assert` scripts that
import a script's exported pure functions — no playwright needed):

- `harness-neutral.mjs` — no namespaced sibling-skill references or
  Claude-only tool names outside lines marked "Claude Code".
- `script-paths.mjs` — every plugin-internal script or reference path a
  skill doc names exists in the plugin tree.
- `deploy-lint-fixtures.mjs` — runs `deploy/scripts/davids-model-lint.mjs` over
  `lint/fixtures/davids-model-lint-shapes/` and `deploy/scripts/block-lint.mjs`
  over `lint/fixtures/block-lint/`, pinning the pipeline-shape codes (TABLE,
  branch-host / protocol-relative D4, STYLE-SPACE, JSON, SOLE-EMPH, META,
  HBR, TEXT-LEAK, TEXT, CHROME, CONTENT) and the block codes (BL-CSS,
  BL-MEDIA, BL-GUARD, IMG-HARDCODED with `@fixed-asset`), their tiers and
  exit codes, against a clean page and a clean block that must stay silent.
- `doc-size.mjs` — byte caps on `SKILL.md` and `reference/*.md`, an
  `## Operator card` heading ahead of the procedure, the always-on total and
  the per-skill delta versus the last release tag; its temporary allowlist
  must shrink with each release.
- `davids-model-lint-fixtures.mjs` — runs `deploy/scripts/davids-model-lint.mjs`
  over `lint/fixtures/davids-model-lint/` and pins the icon/variant rule tiers
  (ICON-PREFIX, ICON-MISSING, VARIANT-COLLIDE), the once-per-token report and
  the exit codes (2 on 🔴, 1 on a usage error, 0 on a legitimate page).
- `impeccable-dep.mjs` — every `SKILL.md` declares `metadata.impeccable`
  (`required` | `optional` | `none`); a `none` skill's docs carry no
  `$impeccable <cmd>` invocation (lines or fences marked `impeccable-dep:
  ignore` exempt), a `required` skill's carry at least one, and the
  `compatibility:` clause matches the level.
- `permissions-shapes.mjs` — the permissions-snippet generator runs, emits
  valid JSON, and every script path it or the harness-permissions card names
  resolves to a shipped file.
- `flag-parity.mjs` — every `--flag` a doc passes to a `<skill>/scripts/*.mjs`
  has a case in that script's parser; a documented numeric default (the
  extract page cap) equals the parser's.
- `launch-ladder.mjs` — the bot-management ladder (`TIERS`, stealth and
  off-screen args, `launchTier`) is identical in `live-session.mjs` and
  `crawl.mjs`, and no other script contains `headless: false`.
- `fixtures/crawl-slugify.test.mjs`, `fixtures/crawl-log-merge.test.mjs` —
  pin crawl.mjs's slug derivation (root → `index`, 200-char cap, `-<hash4>`
  collision suffix) and the append-only `_crawl-log.json` merge.
- `redirects-smoke.mjs` — runs `rollout/scripts/redirects.mjs` over
  `lint/fixtures/redirects/redirects.tsv`: the row expansion, the exit-2
  shadow verdict (a Source that is also a delivered page) and `--check`
  writing nothing.

## What stardust v2 evals deliberately do NOT test

- **Visual quality of the redesigned output.** That's
  `$impeccable critique` and `$impeccable audit` territory; running
  them as a side effect of a stardust eval is not the right boundary.
  A redesign that is technically correct (passes all criteria) can
  still be ugly; that's a different evaluation.
- **Specific brand outcomes.** The evals pin the *procedure* and the
  *artifacts*, not whether the resulting brand identity is "good for
  Stripe" or "young enough" — those are user judgements.
- **Live URL availability.** The `extract-multipage` eval uses
  stripe.com as a stable, public, well-structured target. If
  stripe.com changes structure dramatically the eval may need
  updating; that's expected maintenance.
