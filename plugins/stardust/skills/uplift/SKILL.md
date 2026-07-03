---
name: uplift
description: One-shot brand-faithful presales redesign of a website page. The user provides only the URL; everything else — extraction, tension identification, three differentiated variants (one fully cinematic), validation — is derived from the captured brand surface. Use when the user asks to "uplift", "refresh", or "redesign a site for presales" without wanting to coordinate the extract / direct / prototype chain themselves.
license: Apache-2.0
---

# stardust:uplift

One entry point. One URL. Three presales-quality redesign variants.
`uplift` collapses `extract → direct → prototype × 3` into a single
command that picks every variability axis from the captured brand
surface instead of asking the user. Output matches the long-form
chain (state.json, brand-review.html, three proposed files, motion
validation).

## Opinionated defaults

- **Single-page extract** — homepage unless `--page <slug>` overrides.
- **Brand-faithful Mode A** — palette + typography pinned; no invented
  colors, no fonts outside the captured surface.
- **Three variants, fixed role contract** — A green-light,
  B design-team motivator, C visionary cinematic pitch.
- **Cinematic register auto-picked** — from captured PRODUCT.md Brand
  Personality per `../prototype/reference/motion-registers.md`
  § Selection heuristic.
- **"What if…" candidates are evidence-shaped** — B and C each pick
  one captured-but-underused trait from the eight worked candidates
  in `reference/what-if-candidates.md` or a derived candidate per its
  § Extension rule. Different traits per variant.
- **Validation cascade runs** — every gate in `prototype/SKILL.md`
  Phases 2.5–2.8 fires, including cinematic Pass 6 for variant C.

## Inputs

- `<URL>` — required. Page to redesign; a path-less URL means home.
- `--page <slug>` — optional slug override.
- `--cinematic-register <name>` — optional override for variant C:
  one of `arrival`, `kinetic-display`, `live-systems`, `editorial`,
  `kinetic-grid`. Recorded as `registerSource: "user-override"` in
  C's provenance.
- `--two-variants` — render only A and C (skip B), for thin brand
  surfaces where a forced three-way split would produce a weak middle
  (see § Stop conditions).
- `--re-extract` — force a fresh crawl even when a prior extraction
  of the same URL is < 7 days old (see § Setup).

There are no other flags. Everything else is derived from the captured
brand surface or governed by the underlying skills' contracts.

## Setup

1. Run the master skill's setup (`../stardust/SKILL.md` § Setup):
   impeccable dep check, context loader, state read.
2. Verify Playwright is available (`extract` fails without it —
   surface the same install message extract would).
3. Read `stardust/state.json` if present. **Reuse-if-fresh:** when a
   prior extraction of the same URL is < 7 days old, skip Phase 1 and
   render against the existing capture, with a one-line notice
   ("reusing extraction from <date> — pass `--re-extract` for a fresh
   crawl"). `--re-extract` forces a fresh crawl regardless of age;
   extractions ≥ 7 days old re-extract without asking.

## Procedure

Six phases plus a reference-grounding interphase. Phases 1, 4, 5
delegate to existing skills; phases 2, 2.5, 3, 6 are owned by
`uplift`.

### Phase 1 — Extract (delegate to `stardust:extract`)

Invoke `stardust:extract <URL> --single`. Extract owns: the live
Playwright render (standard wait recipe);
`stardust/current/_brand-extraction.json` (palette + type + motifs +
voice + system components + photography);
`stardust/current/pages/home.json`;
`stardust/current/brand-review.html` with tensions detectors applied
(the load-bearing input for Phase 2); and descriptive PRODUCT.md /
DESIGN.md (current state, not target).

`uplift` never crawls beyond one page — a single homepage suffices
for three variants; multi-page extract is plain `stardust:extract`.

### Phase 2 — Tension and trait identification (owned by `uplift`)

Read `stardust/current/brand-review.html` § Tensions surfaced and
`_brand-extraction.json`. Produce two artifacts:

#### 2a — `stardust/uplift-improvements.md`

At least **3** specific weaknesses observed in the captured site — as
many as the evidence supports, no fixed count. Without specifics,
"make it better" has no claim. Category tags (MAY repeat):

- `[dated-pattern]` — patterns the design world has moved past (be
  specific: "centered hero with stock photo + double CTA in primary
  blue reads as the SaaS template circa 2019")
- `[ia-clutter]` — cluttered IA / unclear hierarchy / weak CTAs /
  redundant sections
- `[contrast-or-density]` — contrast failures, accessibility gaps,
  density issues
- `[cliché]` — conventions the brand could move past while staying
  recognisably itself
- `[missed-opportunity]` — the surface doesn't capitalise on its own
  strengths ("captured photography is excellent but the layout crops
  it to thumbnail-size")

**Specificity bar — every item.** Each item cites a measurement,
tension ID, or screenshot observation from the capture, names the
pattern at fault, and proposes one concrete fix. An item that fails
the bar is cut, not padded.

**Audit consumption.** When
`stardust/audit/<domain-slug>/audit.json` exists for this origin
(written by `stardust:audit`), consume its design findings as
candidate improvements instead of re-deriving them — cite finding IDs
as evidence and add the audit file to `readArtifacts`.

Refuse to proceed if fewer than 3 specific weaknesses can be named
(§ Stop conditions). READ `reference/output-templates.md`
§ Improvements file and write the artifact in exactly that format
(provenance frontmatter; tagged, headline-first items).

#### 2b — `stardust/uplift-questions.md`

Six to eight "what if we leaned into…" candidates derived from the
captured brand surface, each citing the captured evidence that makes
it concrete. READ `reference/what-if-candidates.md` — its eight
worked candidates (display-typography amplification, photography
re-foregrounding, live-data promotion, signature-gesture extension,
voice-register pivot, color-ladder re-weighting, audience-routing
reframe, motif vocabulary swap) are the **floor, not a ceiling**.

An out-of-catalog **derived** candidate is admissible when it carries
the same evidence shape: ≥ 2 captured citations + an explicit
disqualification test + the variant role it serves (per that file's
§ Extension rule). Record each candidate's source —
`catalog | derived` — in the candidate list.

For each candidate generate: a one-line "what if…" phrasing, the
captured evidence, the variant role it best serves (B's composition
bet vs C's cinematic bet), and whether it is **disqualified** for this
brand (e.g. "Photography re-foregrounding disqualified — the captured
photography is generic stock; amplifying it would expose the
weakness"). The disqualification step keeps the agent from reflexively
picking the same candidate for every brand.

### Phase 2.5 — Reference grounding (owned by `uplift`)

READ `skills/stardust/reference/reference-research.md` (when to fire,
the 3–5 reference budget, evidence shape, provenance recording).
When reference research is available, ground the Phase 2 claims
before Phase 3 picks directions:

(a) **Ground each `[dated-pattern]` claim** in
    `uplift-improvements.md` with a named contemporary
    counter-example — a real site / screen showing what the pattern's
    world moved to.
(b) **Anchor variant B's composition bet** with a named real-world
    compositional anchor — a real screen the bet resembles.
(c) **Verify C's register pick** against observed contemporary motion
    practice for this kind of brand.

Record references per reference-research.md's provenance contract
(`_provenance.referencesUsed[]` on the artifact each grounding
serves). When reference research is unavailable, skip with a one-line
note in that provenance and proceed — the phase degrades gracefully.

This phase never replaces captured-evidence discipline: **references
justify the MOVE, captured evidence justifies the TRAIT.** A candidate
without captured citations is inadmissible no matter how
well-referenced its move is.

### Phase 3 — Pick three variant directions (owned by `uplift`)

Default: three variants (A + B + C). Under `--two-variants`: skip
§ 3c, declare only A + C in § 3d; Phase 4 writes only `DESIGN-A` /
`DESIGN-C`, Phase 5 renders accordingly, and all downstream contracts
(differentiation, motion validation on C, Phase 6 summary) operate
over the reduced set unmodified.

#### 3a — Pick the cinematic register for variant C

Read Brand Personality in `stardust/current/PRODUCT.md` and apply
`../prototype/reference/motion-registers.md` § Selection heuristic.
Record the picked register + one-line rationale.

#### 3b — Pick C's "what if" candidate

The candidate must be the one the picked register **naturally
amplifies through motion**. READ the per-candidate **Natural register
for C** fields in `reference/what-if-candidates.md` — the single
source of truth for the register→candidate mapping (a derived
candidate must declare the same field). This file does not duplicate
the table.

**Fallback when C's natural candidates are all disqualified:** re-pick
the second-choice register — the next-best match from
`../prototype/reference/motion-registers.md` § Selection heuristic —
and take its natural candidate. If that register's natural candidates
are also all disqualified, fall through to `--two-variants` via stop
condition (d): drop B and let C take the strongest remaining
non-disqualified candidate.

#### 3c — Pick B's "what if" candidate

Pick from the remaining (non-disqualified, non-C) candidates in
`uplift-questions.md`. Prefer:

1. A candidate that addresses a tension surfaced in
   `brand-review.html` § Tensions.
2. A candidate whose visual move is **composition / IA / voice**
   rather than motion (so B and C differ by axis, not intensity).

#### 3d — Author `stardust/direction.md`

READ `reference/output-templates.md` § direction.md variant
declarations and write the resolved direction with one declaration
block per variant (A: same IA + improvements, static; B: trait +
evidence + layout strategy, static; C: register + trait + evidence,
identical IA to A, cinematic).

### Phase 4 — Direct (delegate to `stardust:direct`)

Invoke `stardust:direct` with the resolved direction, passing the
three-variant declaration as the input phrase ("uplift presales
redesign — three variants per stardust/direction.md"). Direct owns:

- Mode A authoring of PRODUCT.md, DESIGN.md, DESIGN.json (root).
- Per-variant DESIGN-A / DESIGN-B / DESIGN-C files.
- The motion register block in DESIGN-C.json (from direction.md).
- IA-priority preservation audit.
- Density floor enforcement.
- Anti-toolbox audit.
- Variant differentiation contract.

`uplift` does not duplicate any of those checks; it relies on direct's
validators to refuse if the variants violate the brand-faithful
contract.

### Phase 5 — Prototype × 3 (delegate to `stardust:prototype`)

Render **A first, then B and C**:

1. **Render A** — invoke `stardust:prototype <slug>` scoped to
   variant A. A establishes and **freezes the canon** (tokens, chrome,
   module renderings) that B and C inherit; rendering it first removes
   the ordering race.
2. **Render B, then C** (default: sequential). B and C prototype the
   *same slug*, and same-slug concurrent runs are last-write-wins on
   `state.json` per `../stardust/reference/state-machine.md`
   § Concurrency — in-place parallel rendering is unsafe. **Parallel
   is permitted only via isolated workspace copies**: each subagent
   gets a project copy (git worktree or directory copy) containing
   only its own `DESIGN-<id>.json` at the root (siblings stashed) —
   file presence is the only variant selector prototype has (no
   `--variant` flag exists). The subagent returns its
   `<slug>-<id>-shape.md`, `<slug>-<id>-proposed.html` (and C's
   `-cinematic.html`) plus provenance; the parent copies artifacts
   back and performs the **single** `state.json` update for both.
3. **Open each prototype as it completes** (via the `open` mechanics
   in Phase 6 step 1) rather than waiting for all three.

Prototype detects the variant set from the per-variant `DESIGN-A` /
`DESIGN-B` / `DESIGN-C` files direct wrote in Phase 4 — authoring
`<slug>-<id>-shape.md` and emitting `<slug>-<id>-proposed.html` per
the variant-convergence detector contract (`../prototype/SKILL.md`
§ Phase 2.5 / Discipline 10).

**Cinematic motion fires per-variant from the per-variant DESIGN
file, never from a CLI flag — never pass `--cinematic` to prototype
from uplift.** Because Phase 4 wrote `extensions.motion.register`
into `DESIGN-C.json` only (A and B omit it), prototype's Phase 2.4
(motion application) fires only for variant C, which emits both
`<slug>-C-proposed.html` (static reference) and
`<slug>-C-cinematic.html` (register-applied surface). A and B render
static, never acquiring the motion runtime.

Prototype owns: page-shape brief authoring (its Phase 1); render via
`$impeccable craft` per variant; Phase 2.4 motion application for
variants declaring `extensions.motion.register`; Phases 2.5–2.8
quality gates (critique, audit, adapt, motion) per variant; variant
C's cinematic-mode gates (Pass 6) per
`../prototype/reference/motion-validation.md`; and the
variant-convergence detector (≥ 2 structural changes per pair) per
Discipline 10.

### Phase 6 — Open and summarize (owned by `uplift`)

After all three prototypes mark `prototyped` in `state.json`:

1. **Confirm all three are open in the browser** — open any that
   weren't opened as they completed, using the `open` shell command:
   ```
   open stardust/prototypes/<slug>-A-proposed.html
   open stardust/prototypes/<slug>-B-proposed.html
   open stardust/prototypes/<slug>-C-cinematic.html
   ```
   Never use `playwright-cli open` for local prototype files — it
   bypasses the preview service worker and produces FILE NOT FOUND
   for VFS paths; only `open <vfs-path>` serves them correctly.
2. **Print the three-pitch summary** in the chat. READ
   `reference/output-templates.md` § Three-pitch summary and emit
   that exact shape (per-variant pitch + file + bet, differentiation
   check line, validation line, next-steps line).

The summary is the user's only direct touchpoint with the three
variants. Keep it short — the work is on disk and openable.

## The three-variant role contract (hard)

| Variant | Pitch | Composition | Motion | Stakeholder |
|---|---|---|---|---|
| A | "Tomorrow's version." | Same IA + improvements applied | Static | Risk-averse green-light buyer |
| B | "What if we amplified `<captured trait>`?" | One captured-but-underused trait foregrounded in IA / composition / voice | Static | Design team that wants brand exploration |
| C | "What if motion was part of the identity?" | Same IA as A | Fully cinematic, register from brand surface | Visionary buyer + design lead |

This contract is **non-negotiable**. The "C is cinematic" rule is how
`uplift` reliably ships a third proposition defensibly different from
A and B, rather than the C-cliff failure mode of "everything from B
but bigger."

If the captured brand surface can't support three differentiated
variants (e.g. one-color palette, a two-section page, a brand register
that maps to no motion register), reduce to two variants (A + C) via
`--two-variants` rather than ship three weak ones.

## Hard constraints

Inherited from the underlying skills — `uplift` does not re-state
them but relies on them being enforced:

- **Mode A pinning** — palette + typography from captured brand
  surface. Enforced by `direct/SKILL.md` § Mode A.
- **IA priority preservation** — configurator stays above the fold,
  crisis affordances stay first-viewport, etc. Enforced by
  `direct/SKILL.md` § IA-priority preservation audit.
- **Density floor** — brand-register pages with > 5 sections cap
  `sectionPadding.desktop` at ≤ 64px. Enforced by `direct/SKILL.md`
  § Hard floor enforcement.
- **Variant differentiation** — each variant differs from the others
  by ≥ 2 changes. Enforced by `direct/SKILL.md` § Variant
  differentiation contract.
- **Captured images reused in semantic positions** — hero stays hero,
  story image stays story image. Enforced by
  `prototype/reference/proposed-file-shell.md` § Content sourcing
  hierarchy.
- **No fabricated content** — stats, addresses, quotes, named persons
  rendered as `[data-placeholder]`, not invented. Enforced by
  `prototype/SKILL.md` Phase 2 § Content sourcing scan.
- **C-cliff refusal for variant C** — C bets on motion, not on
  "everything from B but more." Enforced by
  `prototype/reference/motion-validation.md` § Pass 6f motion C-cliff
  detector.
- **Reduced-motion fallback for variant C** — every motion element is
  neutralized under `prefers-reduced-motion: reduce`. Enforced by
  `prototype/reference/motion-validation.md` § Pass 6b.

When any of these gates refuses, `uplift` surfaces the refusal
verbatim from the underlying skill — the user sees the specific
violation, not a generic "uplift failed" message.

## Stop conditions

Stop and ask only if:

(a) **Extract fails** — site unreachable, structure unparseable,
    bot-management blocks past the headed-Chrome fallback.
(b) **Brand surface insufficient** — palette has fewer than 2
    distinct colors after clustering; OR the captured page has fewer
    than 3 sections; OR the captured PRODUCT.md Brand Personality
    maps to none of the five motion registers. Surface honestly:
    "the captured brand surface is too thin for three differentiated
    variants — render one strong variant instead?"
(c) **Improvements list empty** — Phase 2a cannot name 3 specific
    weaknesses. Without specifics, variant A has no brief and
    "uplift" has no claim. Surface honestly.
(d) **Two candidates equally weak** — if B's "what if…" candidate and
    C's cinematic candidate would amplify the same captured trait,
    the variants would not differentiate. Switch to `--two-variants`
    (A + C only).
(e) **Hard rule conflict** — captured palette has a single color,
    captured typography has no display register, captured site has no
    system components. Brand-faithful constraint impossible without
    invention. Surface and ask.

The skill **does not** stop for confirmation in normal flow. The
"PROCEED. Run all phases without stopping" property of the original
presales prompt is preserved.

## Outputs

`stardust/`: state.json (extracted + 3× prototyped), direction.md,
uplift-improvements.md (≥ 3 items), uplift-questions.md (6–8
candidates), `current/` (extract capture), `prototypes/`
(`<slug>-<id>-shape.md` + `-proposed.html` per variant, plus
`<slug>-C-cinematic.html` and the lenis runtime files). Project root:
shared PRODUCT.md / DESIGN.md / DESIGN.json plus per-variant
DESIGN-A/B/C files (DESIGN-C.json carries `motion.register`). To
verify a completed run, READ `reference/output-templates.md`
§ Output tree for the exact layout.

## Scope

- One page per run. Multi-page redesigns use the standard
  `extract` → `direct` → `prototype` chain.
- Three review surfaces, not a deployable bundle. After the brand
  owner picks a variant, iterate via chat-driven impeccable commands
  and approve via the standard `prototype` approval flow. Migration
  is `stardust:migrate`.

## References

- `reference/what-if-candidates.md` — eight worked trait candidates
  + § Extension rule for derived candidates.
- `reference/output-templates.md` — exact formats: improvements file,
  direction.md declarations, three-pitch summary, output tree.
- `skills/stardust/reference/reference-research.md` — Phase 2.5
  procedure (when to fire, budget, evidence shape, provenance).
- `../prototype/reference/motion-registers.md` — register catalog +
  selection heuristic (Phase 3a).
- `../prototype/reference/motion-validation.md` § Pass 6 —
  cinematic-mode gates for variant C.
- `../prototype/SKILL.md` — multi-variant rendering + motion driven by
  per-variant `DESIGN-<id>.json` files, never a CLI selector or flag.
- `../direct/SKILL.md` § Phase 2.6 — multi-variant fork; uplift passes
  the three-variant declaration through.
- `../stardust/reference/data-attributes.md` — structural section
  attributes applied to all variants.
- `../prototype/reference/proposed-file-shell.md` — content sourcing
  hierarchy and placeholder convention.
