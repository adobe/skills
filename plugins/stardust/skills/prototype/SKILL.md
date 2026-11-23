---
name: prototype
description: Render a proposed redesign of a page on the current website as a self-contained static HTML file, then iterate via the impeccable craft loop. Per-page, idempotent, stale-aware. Use when the user asks for a redesign prototype, a before/after comparison, a design preview, a page mockup, a visual diff of the redesign, or invokes `$stardust prototype` (`/stardust:prototype` in Claude Code).
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, and the impeccable skill (github.com/pbakaus/impeccable) installed alongside stardust.
metadata:
  version: "1.1.0"
---

# stardust:prototype

For each `directed` page, render a **proposed redesign** as a
self-contained static HTML file at
`stardust/prototypes/<slug>-proposed.html`. Open the file in the
browser; iterate via chat-driven impeccable commands ("make the
hero bolder", "tighten the cup-note grid"). Mark `approved` once
the user signs off in the conversation.

`prototype` is not a renderer of its own design — it composes the
target spec written by `direct` (`PRODUCT.md`, `DESIGN.md`,
`DESIGN.json`, `stardust/direction.md`) onto the page content captured
by `extract` (`stardust/current/pages/<slug>.json`). Visual creativity
is delegated to `$impeccable craft` and the iteration commands
(`bolder`, `quieter`, `distill`, `polish`, `colorize`, `typeset`,
`layout`, `adapt`, `animate`, `delight`, `overdrive`, `impeccable`).

**This file is the outline of the procedure.** The text of each phase is in `skills/prototype/reference/`, in the file the phase names. Read that file in full when you reach the phase; never work from a heading alone.

## Inputs

- `<slug>` — optional positional. Prototype just this page. Without
  it, prototype every `directed` page that is not `stale`.
- `--all` — prototype every `directed` page including stale ones.
- `--prep` — optional. Run in **migrate-prep mode**: fill page-type
  gaps (prototype one representative archetype per type) and, on
  approval, write canon back to `stardust/canon/` and
  `DESIGN.json.extensions.canon`. See § Prep mode below and
  `reference/canon-extraction.md`. Typically invoked via the
  `prepare-migration` orchestrator.
- `--canon-from <slug>` — optional. Override the default canon-
  author (which is the first approved prototype, typically `home`).
  Used when a different page should establish the design canon.
- `--publish-sample <slug>` — submit the named slug to the
  stardust showcase. Triggers the publish-sample sub-flow
  documented in `reference/publish-sample.md`: eligibility checks,
  file staging, PR creation against the upstream stardust repo.
  Requires `gh` installed and authenticated. The showcase is a
  visual demonstration, not a deployable site — placeholder
  content is allowed and recorded in the PR body's § Unsourced
  content section. Design-quality gates stay strict: refuses on
  unjustified anti-toolbox hits, `:root` token contract failure,
  data-attributes contract failure, or impeccable hard-rule
  violations. P0/P1 critique findings warn but don't refuse.
  The showcase publishes via GitHub Pages on merge.
- `--cinematic` — optional. Layer a cinematic motion register
  on top of the static prototype. The register is read from
  `DESIGN.json.extensions.motion.register` (written by `direct`);
  if absent, the prototype phase picks one using the same
  heuristic per `reference/motion-registers.md` § Selection
  heuristic. Output filename is `<slug>-cinematic.html`
  (alongside the static `<slug>-proposed.html`, never replacing
  it). Triggers the cinematic gates in motion validation
  (`reference/motion-validation.md` § Pass 6).
- `--cinematic=<register>` — optional. Same as `--cinematic` but
  forces a specific register (`arrival`, `kinetic-display`,
  `live-systems`, `editorial`, `kinetic-grid`). The override is
  recorded in `_provenance.motion.registerSource = "user-override"`
  so reviewers can spot when direction's heuristic was bypassed.

### No opt-outs

`prototype` does not carry `--no-*` or `--skip-*` flags. The
quality gates (critique, audit, mobile-adapt audit, anti-toolbox
audit, content-sourcing scan) are the product — they're not
optional. If a gate refuses a file, the remediation is to fix
the file or override the gate by editing the file directly, not
to pass a flag that silently lowers the bar. Manual chat
overrides ("ship as-is", "accept the P1 findings") are still
available; the agent records the override verbatim in
`_provenance` so downstream consumers see the explicit
acknowledgement.

## Setup

0. **Playwright re-probe (mandatory first step).** `--no-save` playwright
   installs from earlier phases are pruned by any later real `npm i`
   (extract SKILL.md § Setup → `--no-save` installs are ephemeral). Before
   any rendering step, probe
   `node -e "import('playwright').then(()=>process.exit(0))"` from the
   project root and re-install (`npm i -D playwright --no-save
   --legacy-peer-deps`) on failure.
1. Run the master skill's setup
   (`skills/stardust/SKILL.md` § Setup).
2. Verify `stardust/state.json` exists and contains at least one
   `directed` page. If not, recommend `$stardust direct` and stop.
3. Verify the project-root `DESIGN.md` and `DESIGN.json` exist. If
   not, the direction was not fully authored — recommend
   `$stardust direct` and stop.
4. Verify `stardust/direction.md` has an active (not pending)
   direction. Pending directions block prototype.
5. **Validate provenance on every page in scope.** Call
   `validateProvenance(page)` per
   `skills/stardust/reference/state-machine.md` § Provenance
   validation for every page that this run will render (the
   single `<slug>` argument when present, otherwise every
   non-stale `directed`/`prototyped`/`approved` page). Abort with
   the helper's error when any page lacks live-render evidence
   — re-running `prototype` against a synthesized page record
   silently propagates the synthesis into the rendered prototype.
   Surface `Provenance OK on N pages` once the check passes.
6. Read `stardust/current/DESIGN.md` (the descriptive snapshot of the
   existing site, used as a fallback reference during render when the
   proposed file needs to mirror an aspect of the captured surface).

## Delegation mechanic

Read `skills/prototype/reference/delegation-mechanic.md` in full before you act on this section. It covers: Invoking impeccable.

## Procedure

### Phase 1 — Plan the prototype (page-shape brief)

Read `skills/prototype/reference/phase-1-plan.md` in full before you act on this section. It covers: Brief-time disciplines.

### Phase 2 — Render the proposed page

Read `skills/prototype/reference/phase-2-render.md` in full before you act on this section. It covers: Craft-time disciplines.

### Phase 2.4 — Motion application (when `--cinematic`)

Read `skills/prototype/reference/phase-2-4-motion-application.md` in full before you act on this section. It covers: Output paths; When to use the static-only path.

### Phases 2.5 – 2.8 — Quality gates: Critique → Audit → Adapt → Motion (Discipline 9)

Read `skills/prototype/reference/phase-2-5-to-2-8-quality-gates.md` in full before you act on this section.

### Phase 2.5 — Critique

Read `skills/prototype/reference/phase-2-5-to-2-8-quality-gates.md` in full before you act on this section.

### Phase 2.6 — Audit (detector specifics)

Read `skills/prototype/reference/phase-2-5-to-2-8-quality-gates.md` in full before you act on this section.

### Phase 2.7 — Adapt (mandatory pre-approval)

Read `skills/prototype/reference/phase-2-5-to-2-8-quality-gates.md` in full before you act on this section. It covers: Adapt procedure; Mobile-adapt audit; Mobile nav collapse.

### Phase 2.8 — Motion validation (mandatory when motion declared)

Read `skills/prototype/reference/phase-2-5-to-2-8-quality-gates.md` in full before you act on this section. It covers: Variant-convergence detector.

### Phase 4 — Open and iterate

Read `skills/prototype/reference/phase-4-and-5-iterate-and-approve.md` in full before you act on this section. It covers: Iteration paths.

### Phase 5 — Approval (+ fold-back, Part III)

Read `skills/prototype/reference/phase-4-and-5-iterate-and-approve.md` in full before you act on this section.

### Phase 5.5 — Adapt for mobile (retired; see Phase 2.7)

Adapt and the mobile-adapt audit moved to **Phase 2.7** as part of
the Discipline 9 critique → audit → adapt cycle, gating
`prototyped` instead of approval. A 2026-05-03 e-commerce
showcase failure mode (stakeholders eyeballing variants on a phone
getting the unadjusted desktop layout) is unchanged — the gate just
fires earlier in the lifecycle, so a non-adapted prototype never
lands as `prototyped` in the first place.

The implementation (impeccable adapt invocation, mobile-adapt
audit, mobile-nav-collapse stock pattern) lives in § Phase 2.7
above. This section is retained as an anchor for any external
cross-reference that still names Phase 5.5.

### Stale handling

When `direction.md` changes, the prototype's `againstDirection`
provenance becomes outdated and `state.json` flags the page
`stale: true`. Default behaviour:

- `$stardust prototype` (no slug) skips stale pages and reports the
  count: `2 stale pages (home, about) — re-run with --all.`
- `$stardust prototype home` operates on `home` even if stale.
- `$stardust prototype --all` re-prototypes every directed page
  including stale ones.

When a stale page is successfully re-prototyped, clear its `stale`
flag and update `againstDirection` to the new active direction.

## Outputs

| Path                                          | Purpose                                       |
|-----------------------------------------------|-----------------------------------------------|
| `stardust/prototypes/<slug>-shape.md`         | Per-page compositional brief (Phase 1 output, craft input). |
| `stardust/prototypes/<slug>-proposed.html`    | Proposed redesign (chat-driven iteration target, migration source, user-facing review surface). |
| `stardust/state.json`                         | Updated with page status and approval history. |
| `DESIGN.json`                                 | Updated with `extensions.divergence.anti_toolbox_hits` and any audit amendments from this prototype's render. |

## Failure modes

- **No directed pages.** Recommend `$stardust direct` and stop.
- **Pending direction.** Refuse to run; the user must resolve the
  direction first.
- **Validation failure (:root block missing, data attributes missing,
  unjustified anti-toolbox hit, impeccable rule violation).** Do not
  write the file. Surface the specific failure and a suggested fix.
- **Impeccable not available.** Refuse to run — impeccable is a
  hard requirement (Delegation mechanic). Recommend the user
  install the impeccable plugin and re-invoke.

## Concurrency

Per `state-machine.md`: stardust does not lock. Two concurrent
`prototype` runs on different slugs are safe. Two on the same slug
are last-write-wins; warn the user if they explicitly try.

## Prep mode (--prep)

Read `skills/prototype/reference/prep-mode.md` in full before you act on this section. It covers: 1. Fill page-type gaps; 2. Canon write-back on first approval; 3. Canon write-back on subsequent approvals; Prep summary.

## References

- `reference/page-shape-brief.md` — per-page compositional brief
  format (Phase 1 output, craft input). Page-level deployment
  decisions live here; site-level system decisions live in
  DESIGN.md.
- `reference/canon-extraction.md` — the five-step canon-extraction
  procedure performed on prototype approval in `--prep` mode.
- `reference/proposed-file-shell.md` — proposed-file schema and
  required structure (`:root` token block, data attributes,
  provenance, content sourcing hierarchy, mobile-adapt audit).
- `reference/publish-sample.md` — `--publish-sample` sub-flow:
  eligibility checks, file staging, PR creation against the
  upstream stardust showcase. Lands the prototype as a public
  sample at `https://{owner}.github.io/stardust-2/`.
- `reference/mobile-nav-collapse.md` — stock CSS-only hamburger
  pattern Phase 2.7 auto-applies when the Mobile-adapt audit
  refuses on `horizontal-overflow-at-360px` or
  `nav-readability-floor`. Carries the copy-pasteable
  HTML+CSS+JS, the audit smoke-test command, and the
  alternative-pattern vocabulary.
- `reference/motion-validation.md` — Phase 2.8 procedure:
  scroll-position probe, finding classification, motion-bug
  checks (clipped-container reveal timing, animation-range vs
  reading position, anim-enter trigger reachability,
  reduced-motion override completeness, no-JS state, multi-
  viewport scroll-driven check). Reusable Playwright probe
  patterns documented inline.
- `reference/motion-registers.md` — five brand-faithful motion
  registers (`arrival`, `kinetic-display`, `live-systems`,
  `editorial`, `kinetic-grid`), the selection heuristic that
  maps PRODUCT.md Brand Personality traits to a register, and the
  § Extension rule for bespoke registers derived from the site's
  own captured motion. Consumed by Phase 2.4 (motion application).
- `reference/motion-stack.md` — technology choice for cinematic
  prototypes: Lenis + CSS keyframes + rAF + IntersectionObserver.
  Why not GSAP. Bundle policy + Lenis pinning procedure.
- `reference/motion-attributes.md` — `data-*` vocabulary the
  cinematic runtime consumes (`[data-anim]`, `[data-tile-anim]`,
  `[data-countup]`, `[data-flip]`, `[data-fill]`, `[data-split]`,
  `[data-parallax]`). Annotated per the active register.
- `reference/motion-runtime.md` — the canonical inline runtime
  script that powers every cinematic prototype. Single source of
  truth; embedded verbatim during Phase 2.4.
- `reference/fidelity-refined-pass.md` — concrete CSS recipes for
  the `--fidelity=refined` craft micro-pass (Discipline 8).
- `reference/anti-template-bank.md` — worked examples of the
  non-template moves Discipline 3 draws from (typographic
  substitution / substrate-promotion / inversion / document-shape
  / scale-displacement), plus the § Extension rule for
  evidence-shaped new moves.
- `skills/stardust/reference/reference-research.md` — sourcing
  real-world design references (refero MCP with WebSearch fallback,
  graceful skip when unavailable); consumed by Discipline 2's
  reference-grounded alternatives.
- `reference/approval-fold-back.md` — Phase 5 fold-back procedure
  (Part III of the merged spec): diff algorithm, surfacing UX,
  write logic, stale flagging, `--auto-fold` / `--no-fold` flags,
  verbatim no-op gating.
- `fixtures/composition-delta-good.md` — example shape brief with
  a strong structural `compositionDelta` (passes Discipline 10).
- `fixtures/composition-delta-trivial.md` — example shape brief
  with token-only deltas (fails Discipline 10).
- `../stardust/reference/token-contract.md` — `:root` token
  block (cross-cutting, used by prototype + migrate).
- `../stardust/reference/data-attributes.md` — structural data
  attribute vocabulary (cross-cutting, used by prototype + migrate).
- `../stardust/reference/divergence-toolkit.md` —
  anti-mediocrity rules consumed during render and iteration.
- `../stardust/reference/intent-dimensions.md` — the 7-axis
  vocabulary used to read a chat-driven refinement phrase
  (iteration path 2).
- `../stardust/reference/impeccable-command-map.md` — when to
  reach for each impeccable command. Consulted during chat-driven
  iteration (path 2) to pick the command for a refinement phrase.
- `../stardust/reference/state-machine.md` — page lifecycle
  and stale rules.
- `../stardust/reference/artifact-map.md` — provenance shape.
- impeccable's `reference/craft.md` and `reference/live.md` — the
  underlying impeccable commands stardust delegates to.
