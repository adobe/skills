---
name: direct
description: Set a redesign direction for an existing website. Analyzes the user's intent, picks a palette and visual direction, and writes the target spec (PRODUCT.md, DESIGN.md, DESIGN.json) plus a reasoning trace at stardust/direction.md. Use when the user asks to redesign a site, refresh the design, set a new design direction, define a redesign target, or invokes `$stardust direct` (`/stardust:direct` in Claude Code).
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, and the impeccable skill (github.com/pbakaus/impeccable) installed alongside stardust.
---

# stardust:direct

Resolve the user's freeform redesign intent into a complete **target
specification**: project-root `PRODUCT.md` and `DESIGN.md` (impeccable
format), a `DESIGN.json` sidecar with the divergence audit trail, and a
`stardust/direction.md` with the full reasoning trace.

`direct` produces the spec against which `prototype` and `migrate`
operate. It never writes prototypes or migrates pages — those are
downstream sub-commands.

## Inputs

- `<phrase>` — optional positional. The user's freeform intent
  ("make it better", "more Linear less Salesforce", "feel more premium
  on a small screen"). If omitted, ask the user for one.
- `--re-direct` — optional. Replace the current direction with a new
  one. Triggers stale-flagging on prototyped / approved / migrated
  pages per `skills/stardust/reference/state-machine.md`. Default
  behaviour without the flag is additive: if a direction already
  exists, the agent asks before replacing.
- `--rebrand` — optional. Force rebrand mode (full divergence-seed
  roll, no Mode A inheritance). Without it the default is
  brand-faithful whenever the captured signal is `signal-strong`
  (§ Mode-detection precedence).
- `--prep` — optional. Run in **migrate-prep mode**: confirm the
  type catalog, finalize the module catalog, capture color
  reservations and brand-level metadata defaults, re-evaluate
  direction against the wider crawl. See § Prep mode below.
  Typically invoked via the `prepare-migration` orchestrator.
- `--add-variant <name>` — optional. Add a new variant against
  the existing direction without re-running intent reasoning or
  mode detection. Writes `DESIGN-<name>.{md,json}` at the
  project root and appends a per-variant section to
  `stardust/direction.md`; existing prototypes are **not**
  stale-flagged. See § Add-variant mode below.

## Setup

1. Run the master skill's setup
   (`skills/stardust/SKILL.md` § Setup) — hard impeccable dep check,
   context loader, state read.
2. Verify `stardust/state.json` exists and contains at least one
   `extracted` page. If not, stop and recommend
   `$stardust extract <url>` first.
3. Read `stardust/current/_brand-extraction.json`. If absent, stop —
   extract did not complete brand-surface extraction; re-run extract.
3b. **Cross-site brand inputs** (when present). `state.json.designSource`
   (design-donor mode: Mode A pins bind to the donor's derived
   system) and `_brand-extraction.json.origins[]` (sibling-property
   evidence: widens what can be amplified, not what is pinned).
   Read `reference/cross-site-brand-inputs.md` for the pin and
   evidence rules; surface the active mode in the plan.
4. Read `stardust/direction.md` if present. If a prior direction
   exists and `--re-direct` was not passed, ask whether the user wants
   to refine the existing direction or replace it.
5. **Validate provenance** (prep mode only). When `--prep` is
   active, run the provenance validation per
   `reference/prep-mode.md` before typing or module detection.
6. **Classify the captured brand signal.** Read
   `_brand-extraction.json` and stamp one of:
   - `signal-strong` — palette has ≥ 3 distinct colors (after
     near-duplicate clustering and excluding pure black/white if they
     are the only entries) **AND** at least one captured type family
     is named in `type.headingFamily.name` or `type.bodyFamily.name`.
     This is the common case for any extracted commercial site.
   - `signal-thin` — palette has 2 colors OR no captured type family
     OR `type.scaleAudit.kind === "ad-hoc"` with fewer than 3
     distinct heading sizes. The brand exists but cannot fully
     anchor a refresh.
   - `signal-absent` — palette has 1 color or 0, or
     `_brand-extraction.json._provenance.notes` flags the extraction
     as failed / login-walled / iframe-dominated.
   The classification feeds the Mode-detection precedence in Phase 2.
   Surface the classification in the plan when it would change the
   default mode.

## Procedure

### Phase 1 — Reasoning

Run the full intent-reasoning procedure from
`skills/stardust/reference/intent-reasoning.md`. Steps 1-6: restate
the phrase in dimensional vocabulary, identify movement, identify
gaps, ask **at most two** clarifying questions, map to an impeccable
command sequence, show the plan to the user.

Worked examples in
`skills/stardust/reference/intent-examples.md` calibrate the style.
Hard ceiling on questions: two per turn, no exceptions.

**Zero movement is not a direction — hand off to `replica`.** Before
restating, check whether the phrase pins every axis unchanged: "exact
replica", "same design", "pixel-perfect", "faithful", "keep the current
design", "1:1", "re-platform only", "preserve verbatim", or
`ia-fidelity: verbatim` with palette, type and density all pinned. That
is a same-design migration and `direct` has nothing to decide: write a
one-paragraph note to `stardust/direction.md` ("zero-movement phrase —
same-design migration; the direction is the mechanical promotion in
`replica` Phase 2"), stamp `state.json.flow: "replica"` if unset
(`../stardust/reference/state-machine.md` § Flow keys), and stop with
"run `$stardust replica <url>`". Never continue into a redesign
direction, a `--prep` module catalog or a plan on such a phrase — under
hands-off included: "ask nothing" below never means "proceed on a
replica phrase". (Recorded: `direct` invoked with "exact replica —
preserve verbatim" kept going; 2,207 pages were published at 24–28 %
pixel diff, four to five times the replica pass bar.)

**Hands-off mode** (per `skills/stardust/SKILL.md` § Hands-off mode,
`state.json.handsOff: true`): ask nothing and wait for nothing — after
the zero-movement check above, which hands-off does not skip.
Derive every answer the questions would have collected from the
captured evidence — density and ia-fidelity from their documented
defaults and trigger conditions, audience and register from the
captured surface — and record each as a named assumption in
`direction.md` § Movements (e.g. `density: balanced (hands-off
default — multi-audience floor fired)`). The plan is still written;
execution proceeds without the confirmation gate. Question budgets
and gates below that say "ask the user" resolve the same way: derive,
stamp the assumption, proceed.

#### Density tuning (one-shot, only when unmoved)

Ask only when the phrase leaves `density` unmoved and the register is `brand`, within the two-question ceiling; unanswered, stamp `density: balanced (default)`. Read `skills/direct/reference/phase-1-tuning.md` § Density tuning before asking.

#### IA-fidelity tuning (one-shot, only when unmoved)

Ask only when the phrase does not auto-pin `ia-fidelity`, paired with the density question to stay within the ceiling; unanswered, stamp `ia-fidelity: reimagined (default)`. Read `skills/direct/reference/phase-1-tuning.md` § IA-fidelity tuning before asking.

Wait for the user's confirmation (`"go"`, or a correction to the
plan) before moving on.

### Phase 2 — Resolve the divergence inputs

Once the plan is confirmed, resolve the divergence-toolkit inputs
from `skills/stardust/reference/divergence-toolkit.md`. Before
rolling the seed, run the mode-detection precedence below to decide
whether the seed needs rolling at all.

#### Mode-detection precedence (run first)

The captured brand signal decides the mode, not the phrase alone. On `signal-strong` (Setup step 6) Mode A is the default: palette and type pinned, image reuse and signature preservation hold, and an ambiguous refresh phrase ("make it modern") stays in Mode A. Rebrand only on an explicit rebrand phrase, `--rebrand`, or `signal-absent`. `signal-thin` keeps Mode A with a warning. Read `skills/direct/reference/phase-2-modes.md` § Mode-detection precedence before choosing, and surface the chosen mode in the plan.

#### Mode A — Brand-faithful mode

Default on `signal-strong`, or when the user pins both type and palette. Type and palette are not rolled; the other seed dimensions are. Captured images are reused at the same semantic position; synthesised placeholders are forbidden. Read `skills/direct/reference/phase-2-modes.md` § Mode A before resolving in this mode.

#### Mode A+ — Brand-adjacent refinement (bounded, evidence-gated)

The middle tier between Mode A's hard pins and `--rebrand`: when
the improvements list (Phase 2.5) names a captured type or color
weakness with evidence, bounded same-classification upgrades are
permitted — each audited in `extensions.divergence.
brand_adjacent_refinements[]`, never active by default. Read
`reference/mode-a-plus.md` before applying any refinement.

#### Mode B — Anchor-reference precedence

Anchor references (the user's, or 3 to 5 researched per `skills/stardust/reference/reference-research.md` when none are named) imply seed dimensions; roll only the rest. The user's outrank researched ones: `skills/direct/reference/phase-2-modes.md` § Mode B.

#### Mode C — Brand-faithful ground-family override

Under Mode A the brand's captured ground wins over the seed's `ground_family` roll, which moves to the alt-section surface. Override reasons: `skills/direct/reference/phase-2-modes.md` § Mode C.

#### Default mode (no constraints)

Neither Mode A nor Mode B (rebrand or thin signal, no anchors): reference research first, the seed roll only as fallback and tiebreaker. Deck and palette: `skills/direct/reference/phase-2-modes.md` § Default mode.

#### Always run

- **Anti-toolbox audit.** Regardless of mode, run the self-audit
  (toolkit § 1 Enforcement + Self-audit) on the resolved direction.
  Each anti-toolbox hit needs a brand-specific justification or it
  is removed.

Record every resolution in `DESIGN.json.extensions.divergence` per
the v2 storage shape at the bottom of `divergence-toolkit.md`.

### Phase 2.5 — Improvements list (Mode A only)

Before any variant is rendered downstream, write
`stardust/prototypes/<slug>-improvements.md` listing **3–5 specific
weaknesses** observed in the captured site. It is the brief variant
A renders against: **not** prescriptive (no visual targets), but
**descriptive of the gap** between the existing site and a competent
2026 execution of the same brand. Variants B+ honor the list as a
floor (they may go further but not contradict it).

Skip this phase when the resolved mode is rebrand — the improvements
list assumes brand-faithful inheritance, and a rebrand replaces the
site rather than fixing it.

**Audit reuse.** When `stardust/audit/<domain-slug>/audit.json`
exists for this origin (written by the stardust `audit` skill), consume its
design findings as candidate improvements instead of re-deriving from
scratch — carry the finding IDs into each item's evidence citation.
The specificity bar below still applies to every carried item.

Each item cites a measurable observation, names the pattern at fault and gives one concrete fix. Categories, specificity bar and format: `skills/direct/reference/phase-2-5-improvements.md`; read it before writing the list.

#### Stopping condition

If after reading the brand-review, the per-page JSON, and the
brand-extraction the agent **cannot name 3 specific weaknesses**
that meet the specificity bar, stop. Variant A has no brief; the
"better" claim fails. See § Failure modes (d).

Never pad the list with vague items; on a genuinely empty list, surface it and propose reduced scope (`skills/direct/reference/phase-2-5-improvements.md` § Stopping condition).

### Phase 2.6 — Multi-variant fork (when N > 1)

When the user requests N variants (phrase contains *"3 variants"*,
*"4 directions"*, or equivalent), variant slots are
**role-differentiated**, not seed-differentiated. Branch on the
`ia-fidelity` tier stamped in Phase 1: surface-tuning forks
A1/A2/A3 under `verbatim`; role-differentiated A + B + C (faithful
+ improvements / one captured trait amplified / a different
captured trait amplified) under `reimagined`. Read
`reference/multi-variant.md` and follow its variant role contract,
differentiation contract (each variant pair differs by ≥ 2
substantive changes), surface-fork rules, and render-refusal
conditions before resolving any variant.

### Phase 3 — Author target PRODUCT.md

Write `PRODUCT.md` at the project root using impeccable's
`reference/init.md` § Write PRODUCT.md as the **format spec** (not as
a runtime command to invoke; `init`, formerly `teach`, runs an
interview). Direct authoring is intentional: by the time `direct`
runs, every answer impeccable's interview would surface has already
been resolved through stardust's intent-reasoning + divergence
resolution above.

File order, sections and the inferred-section marker: `skills/direct/reference/phase-3-product-md.md`; read it before writing. Omit a section rather than pad it; never invent strategy.

### Phase 4 — Author target DESIGN.md and DESIGN.json (site-level only)

Write `DESIGN.md` at the project root using impeccable's
`reference/document.md` as the format spec — Stitch YAML frontmatter
plus the 6 canonical sections in fixed order.

**Site-level only.** `direct` authors the design **system**, not
page-level deployments. Page-specific composition decisions live
in `stardust/prototypes/<slug>-shape.md` written by `prototype`
Phase 1 — see `skills/prototype/reference/page-shape-brief.md`.

Read `skills/direct/reference/phase-4-design-files.md` in full before writing either file: the system vs page-deployment boundary (no literal labels, section dimensions, stats or per-page copy), token sources (`sectionPadding` from the Phase 1 density tier, the multi-audience hard floor), the `DESIGN.json` extensions (motion register, divergence, component style, system-component roles, voice) and component snippet rules.

#### IA-priority preservation audit (Mode A)

Before tokens land in the DESIGN files, record one `extensions.iaPriorities[]` entry per captured signal that fires a `skills/stardust/reference/intent-dimensions.md` § 8 trigger; `mutability` follows the Phase 1 `ia-fidelity` stamp. A variant that drops a recorded priority is rejected. Entry shape: `skills/direct/reference/phase-4-design-files.md` § IA-priority preservation audit (Mode A).

#### Multi-variant DESIGN files (when N > 1)

When Phase 2.6 is active, Phase 4 writes `PRODUCT.md` (shared)
plus per-variant `DESIGN-{A,B,C,…}.{md,json}` instead of a single
pair; every variant inherits the shared `extensions.iaPriorities[]`
audit. Under rebrand mode PRODUCT.md may also vary per variant.
See `reference/multi-variant.md` § Multi-variant DESIGN files.

### Phase 5 — Write direction.md and update state

Write `stardust/direction.md` per
`skills/direct/reference/direction-format.md`. The full reasoning
trace: phrase, restatement, movements, gaps, questions and answers,
resolved axes, divergence inputs, command sequence proposed, user
confirmation, every assumption that defaulted in. Re-directs append
to the file as a new section; prior direction stays as history.

Update `stardust/state.json`:

- `direction.resolvedAt` = now
- `direction.phrase` = the user's verbatim phrase
- `direction.directionFile` = `"stardust/direction.md"`
- For each page in scope: `status` `extracted` → `directed`
- On `--re-direct`, for each page already in `prototyped` /
  `approved` / `migrated`: set `stale: true` and
  `staleReason: "direction changed at <ts>"`. Do not change the
  status itself; the on-disk artifact is still valid, just out of
  step.

Print the one-screen summary report (format: `skills/direct/reference/phase-5-report-and-outputs.md`) and recommend `$stardust prototype`.

## Outputs

Root `PRODUCT.md`, `DESIGN.md`, `DESIGN.json` (per variant when N > 1), the improvements list, `stardust/direction.md`, `stardust/state.json`: `skills/direct/reference/phase-5-report-and-outputs.md` § Outputs.

## Failure modes

Stop, writing no target files, on: no extracted state; a phrase still vague after two questions; (b) too little brand signal for N variants; (c) a phrase that breaks a Mode A pin (name the conflict, wait); (d) fewer than 3 improvements. Confirm before stale-flagging on a re-direct; re-prompt for anchors when the anti-toolbox audit strips the direction to defaults. What to say in each case: `skills/direct/reference/failure-modes.md`.

## Prep mode (--prep)

When invoked with `--prep`, direct runs an extended pass that
finalizes the inventory data structures migrate consumes: type
catalog confirmation, module catalog finalization, color
reservations, a wider direction re-evaluation, and site-level
metadata defaults. Read `reference/prep-mode.md` and follow it on
top of the standard procedure. Discovery-mode runs are unchanged.

## Add-variant mode (--add-variant)

When the user has already approved (or rendered) variant A and
asks for B / C / etc. as alternatives, `--re-direct` is too heavy
— the user is extending the existing direction, not changing it.
`--add-variant <name>` skips Phases 1–2 (mode, seed, palette, and
ground family are inherited from the active direction), resolves
the new variant's role per the variant role contract, and writes
`DESIGN-<name>.{md,json}` plus a `## Variant <name>` section in
`direction.md`, without stale-flagging any page. Read
`reference/add-variant.md` and follow its procedure, parentage
and per-field inheritance rules, and failure modes before
writing anything.

## References

- `skills/stardust/reference/intent-dimensions.md` — the 8 axes
  (the 7 axes plus § 8 IA-priority preservation, the Mode A
  constraint that fires on captured commercial-conversion / crisis /
  audience-routing signals).
- `skills/stardust/reference/intent-reasoning.md` — the procedure.
- `skills/stardust/reference/intent-examples.md` — worked examples.
- `skills/stardust/reference/impeccable-command-map.md` — when to
  reach for each impeccable command (used when building the plan).
- `skills/stardust/reference/reference-research.md` — the
  research-first anchor procedure (refero MCP → WebSearch → seed
  fallback) consumed by Mode B and Default mode; evidence shape and
  budgets.
- `skills/stardust/reference/divergence-toolkit.md` — anti-mediocrity
  inputs and the v2 storage shape for the audit trail. Contains the
  anti-toolbox additions for multi-variant moves
  (`C-cliff overshoot`, `Anonymous middle variant`, `Variant
  homogeneity`) and universal hardening (`Fabricated content`,
  `Hero text on photographic background without contrast scrim`,
  `Editorial-register vocabulary applied to non-editorial brands`).
- `skills/stardust/reference/artifact-map.md` — provenance shape.
- `reference/direction-format.md` — schema for `stardust/direction.md`.
- `reference/palette-picker.md` — palette resolution procedure.
- `reference/prep-mode.md` — the `--prep` extended pass (provenance
  validation, type/module catalogs, color reservations, metadata).
- `reference/add-variant.md` — the `--add-variant` flow (procedure,
  variant parentage, per-field inheritance, failure modes).
- `reference/multi-variant.md` — the N > 1 fork: variant role
  contract, differentiation contract, surface forks, C-cliff.
- `reference/improvements-list.md` — worked examples for the Phase
  2.5 improvements list (categories + format).
- `reference/mode-a-plus.md` — bounded brand-adjacent refinements.
- `reference/cross-site-brand-inputs.md` — design-donor and
  sibling-origin evidence rules.