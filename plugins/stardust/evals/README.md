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
- **Two-question ceiling (`direct-from-phrase`).** Still valid for the
  interactive flow, but 0.14.0 adds a hands-off production mode that asks
  *zero* questions and resolves ambiguity from captured evidence. Rescope the
  criterion to interactive invocations only.
- **Closed-catalog criteria (uplift/prototype).** Any criterion asserting the
  agent picks strictly from a fixed catalog (e.g. the what-if candidate list)
  conflicts with 0.14.0's opened catalogs, which allow evidence-gated
  extensions. Rescope to: catalog-first, extensions permitted only with cited
  evidence from the brand surface.
- **Seed-roll direction procedure (`direct-from-phrase`).** Direction research
  is now reference-grounded via the optional refero MCP, with the seed roll
  demoted to fallback; criteria that pin the seed roll as *the* procedure
  should accept the reference-research path as the preferred branch.
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
- `criteria.json` — Weighted scoring rubric. Each criterion has an
  `id`, a `weight`, and a `description`. `total` should equal the
  sum of weights. Used by the eval runner to score the agent's
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
