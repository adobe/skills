---
name: uplift
description: One-shot brand-faithful presales redesign of a website page. The user provides only the URL; everything else — extraction, tension identification, three differentiated variants (one fully cinematic), validation — is derived from the captured brand surface. Use when the user asks to "uplift", "refresh", or "redesign a site for presales" without wanting to coordinate the extract / direct / prototype chain themselves.
license: Apache-2.0
---

# stardust:uplift

One entry point. One URL. Three presales-quality redesign variants.

`uplift` collapses the `extract → direct → prototype × 3` chain into a
single opinionated command that picks every variability axis from the
captured brand surface rather than asking the user. The output is the
same as the long-form chain (state.json, brand-review.html, three
proposed files, motion validation) — the user just doesn't have to
coordinate it.

## Why this skill exists

The standard chain assumes the user knows enough about stardust to
coordinate: which sub-command runs when, when Mode A applies, when
direct's variant fork engages, how cinematic motion is opted into,
where the load-bearing improvements artifact goes. For presales, that
coordination is friction the user doesn't need to bear.

`uplift` is opinionated about every choice the standard chain leaves
to the user:

- **Single-page extract** — the homepage by default (the brand owner's
  first surface) unless `--page <slug>` overrides.
- **Brand-faithful Mode A** — palette + typography pinned. No
  invented colors, no fonts outside the captured surface.
- **Three variants, fixed role contract** — A is the green-light, B is
  the design-team motivator, C is the visionary cinematic pitch.
- **Cinematic register auto-picked** — C's motion register is read
  from the captured PRODUCT.md Brand Personality per
  `../prototype/reference/motion-registers.md` § Selection
  heuristic. No questions asked.
- **"What if..." candidates pulled from a closed catalog** — B and
  C each pick one captured-but-underused trait from
  `reference/what-if-candidates.md`. Different traits.
- **Validation cascade runs** — every gate in `prototype/SKILL.md`
  Phases 2.5–2.8 fires, including cinematic Pass 6 for variant C.

## Inputs

- `<URL>` — required. The page to redesign. Defaults to homepage when
  the URL has no path (`https://example.com/` → home).
- `--page <slug>` — optional. Override the slug if the URL points
  elsewhere or the user wants a different surface.
- `--cinematic-register <name>` — optional. Override the auto-picked
  register for variant C. One of `arrival`, `kinetic-display`,
  `live-systems`, `editorial`, `kinetic-grid`. Recorded as
  `registerSource: "user-override"` in C's provenance.
- `--two-variants` — optional. Render only A and C (skip B). Useful
  when the brand surface is thin and a forced three-way differentiation
  would produce a weak middle (per the stop condition below).

There are no other flags. Everything else is derived from the
captured brand surface or governed by the underlying skills'
contracts.

## Setup

1. Run the master skill's setup
   (`../stardust/SKILL.md` § Setup): impeccable dep check, context
   loader, state read.
2. Verify Playwright is available (`extract` will fail without it —
   surface the same install message extract would).
3. Read `stardust/state.json` if present. If a previous `uplift`
   ran against the same URL on a recent date, ask whether the user
   wants to refresh the extraction or render against the existing
   capture.

## Procedure

Six phases. Phases 1, 4, 5 delegate to existing skills; phases 2,
3, 6 are owned by `uplift`.

### Phase 1 — Extract (delegate to `stardust:extract`)

Invoke `stardust:extract <URL> --single` (single-page mode).
Extract owns:

- Live Playwright render with the standard wait recipe.
- `stardust/current/_brand-extraction.json` (palette + type + motifs
  + voice + system components + photography).
- `stardust/current/pages/home.json` (full per-page capture).
- `stardust/current/brand-review.html` with the tensions detectors
  applied — this is the load-bearing input for Phase 2.
- `stardust/current/PRODUCT.md` and `DESIGN.md` (descriptive — the
  current state, not the target).

`uplift` does not crawl beyond one page. The brand surface from a
single homepage is sufficient for three variants; multi-page extract
is what `stardust:extract` (without `--single`) is for.

### Phase 2 — Tension and trait identification (owned by `uplift`)

Read `stardust/current/brand-review.html` § Tensions surfaced and
`_brand-extraction.json`. Produce two artifacts:

#### 2a — `stardust/uplift-improvements.md`

Five specific weaknesses observed in the captured site. Same
load-bearing contract as the existing presales workflow: without
specifics, "make it better" has no claim. Categories:

- Dated patterns the design world has moved past (be specific:
  "centered hero with stock photo + double CTA in primary blue
  reads as the SaaS template circa 2019")
- Cluttered IA / unclear hierarchy / weak CTAs / redundant sections
- Contrast failures, accessibility gaps, density issues
- Cliché conventions the brand could move past while staying
  recognisably itself
- Missed opportunities the captured surface doesn't capitalise on
  ("captured photography is excellent but the layout crops it to
  thumbnail-size")

Refuse to proceed if fewer than 3 specific weaknesses can be named
(see § Stop conditions).

#### 2b — `stardust/uplift-questions.md`

Six to eight "what if we leaned into…" candidates derived from the
captured brand surface. Each candidate cites the captured evidence
that makes it concrete. Candidates are picked from the closed
catalog in `reference/what-if-candidates.md`:

1. Display-typography amplification
2. Photography re-foregrounding
3. Live-data promotion
4. Signature-gesture extension
5. Voice-register pivot
6. Color-ladder re-weighting
7. Audience-routing reframe
8. Motif vocabulary swap

For each candidate the agent generates: a one-line "what if…"
phrasing, the captured evidence that makes the candidate concrete,
the variant role it best serves (B's composition bet vs C's
cinematic bet), and whether the candidate is **disqualified** for
this brand (e.g. "Photography re-foregrounding disqualified — the
captured photography is generic stock; amplifying it would expose
the weakness").

The disqualification step is what keeps the agent from reflexively
picking the same candidate for every brand.

### Phase 3 — Pick three variant directions (owned by `uplift`)

#### 3a — Pick the cinematic register for variant C

Read PRODUCT.md Brand Personality (from `stardust/current/PRODUCT.md`)
and apply the heuristic in `../prototype/reference/motion-registers.md`
§ Selection heuristic. Record the picked register + the one-line
rationale.

#### 3b — Pick C's "what if" candidate

The candidate must be the one the picked register **naturally
amplifies through motion**:

| Picked register | Natural candidate |
|---|---|
| `arrival` | Signature-gesture extension OR Photography re-foregrounding |
| `kinetic-display` | Display-typography amplification |
| `live-systems` | Live-data promotion |
| `editorial` | Photography re-foregrounding OR Voice-register pivot |
| `kinetic-grid` | Motif vocabulary swap |

#### 3c — Pick B's "what if" candidate

Pick from the remaining (non-disqualified, non-C) candidates in
`uplift-questions.md`. Prefer:

1. A candidate that addresses a tension surfaced in
   `brand-review.html` § Tensions.
2. A candidate whose visual move is **composition / IA / voice**
   rather than motion (so B and C are differentiated by axis,
   not just intensity).

#### 3d — Author `stardust/direction.md`

Write the resolved direction with three variant declarations:

```markdown
## Variant A — Faithful + improvements

Role: risk-averse green-light. "Yes, that's us, with the obvious
fixes."
Composition: same as captured.
Motion: static (no cinematic layer).
Improvements applied: <list from uplift-improvements.md>.

## Variant B — What if we amplified <captured trait>?

Role: design-team motivator. The brand's underused capability
foregrounded.
What if: "<one-line "what if…" framing>"
Captured trait amplified: <trait from uplift-questions.md>
Evidence: <captured citation>
Composition: <specific layout strategy that amplifies the trait>
Motion: static (no cinematic layer).

## Variant C — What if motion was part of the identity?

Role: visionary pitch. The brand's third dimension — kinetic.
What if: "<one-line "what if…" framing tied to the register>"
Cinematic register: <register> (auto-picked from PRODUCT.md
Brand Personality)
Captured trait amplified: <trait — the one register naturally
amplifies>
Evidence: <captured citation>
Composition: identical IA to A; the bet is motion, not layout.
Motion: cinematic, register <register>.
```

### Phase 4 — Direct (delegate to `stardust:direct`)

Invoke `stardust:direct` with the resolved direction. Pass the
three-variant declaration as the input phrase ("uplift presales
redesign — three variants per stardust/direction.md"). Direct owns:

- Mode A authoring of PRODUCT.md, DESIGN.md, DESIGN.json (root).
- Per-variant DESIGN-A / DESIGN-B / DESIGN-C files.
- The motion register block in DESIGN-C.json (read from the
  direction.md declaration).
- IA-priority preservation audit.
- Density floor enforcement.
- Anti-toolbox audit.
- Variant differentiation contract.

`uplift` does not duplicate any of those checks; it relies on
direct's existing validators to refuse if the variants violate
the brand-faithful contract.

### Phase 5 — Prototype × 3 (delegate to `stardust:prototype`)

Invoke prototype three times:

1. `stardust:prototype <slug> --variant=A` → `<slug>-A-proposed.html`
2. `stardust:prototype <slug> --variant=B` → `<slug>-B-proposed.html`
3. `stardust:prototype <slug> --variant=C --cinematic` →
   `<slug>-C-proposed.html` PLUS `<slug>-C-cinematic.html`

Prototype owns:

- Page-shape brief authoring per Phase 1 of prototype.
- Render via `$impeccable craft` delegation.
- Phase 2.4 motion application for variant C (reads
  `DESIGN-C.json.extensions.motion.register`).
- Phases 2.5–2.8 quality gates (critique, audit, adapt, motion).
- Variant C's cinematic-mode gates (Pass 6) per
  `../prototype/reference/motion-validation.md`.

Run all three in sequence (not parallel) so the canon-fold-back
in prototype Phase 5 carries through A → B → C consistently.

### Phase 6 — Open and summarize (owned by `uplift`)

After all three prototypes mark `prototyped` in `state.json`:

1. **Open all three in the browser** (`open <slug>-A-proposed.html
   <slug>-B-proposed.html <slug>-C-cinematic.html`).
2. **Print the three-pitch summary** in the chat:

   ```
   uplift complete — three variants for <URL>

   A · Tomorrow's version of the site you have today.
      Improvements applied: <count>.
      File: stardust/prototypes/<slug>-A-proposed.html
      Pitch: "yes, that's us, fixed."

   B · What if we amplified <captured trait>?
      Trait: <name>.
      Composition bet: <one-line summary>.
      File: stardust/prototypes/<slug>-B-proposed.html
      Pitch: "the brand's underused capability, foregrounded."

   C · What if motion was part of the identity?
      Cinematic register: <register>.
      Motion bet: <one-line summary>.
      File: stardust/prototypes/<slug>-C-cinematic.html
      Pitch: "the brand's third dimension."

   Differentiation: A vs B ≥ 2 changes (✓), A vs C ≥ 2 changes (✓),
   B vs C ≥ 2 changes (✓).

   Validation: all three pass critique + audit + adapt; C additionally
   passes motion validation Pass 6.

   Next: iterate any variant via chat ("make B's hero quieter") or
   approve via /stardust:prototype <slug> --variant=<X> (records
   the approval in state.json).
   ```

The summary is the user's only direct touchpoint with the three
variants. Keep it short — the work is on disk and openable.

## The three-variant role contract (hard)

| Variant | Pitch | Composition | Motion | Stakeholder |
|---|---|---|---|---|
| A | "Tomorrow's version." | Same IA + improvements applied | Static | Risk-averse green-light buyer |
| B | "What if we amplified `<captured trait>`?" | One captured-but-underused trait foregrounded in IA / composition / voice | Static | Design team that wants brand exploration |
| C | "What if motion was part of the identity?" | Same IA as A | Fully cinematic, register from brand surface | Visionary buyer + design lead |

This contract is **non-negotiable**. The "C is cinematic" rule is
how `uplift` reliably ships a third proposition that's defensibly
different from A and B (rather than the C-cliff failure mode of
"everything from B but bigger").

If the captured brand surface can't support three differentiated
variants (e.g. the palette has only one color, the captured page
has only two sections, the brand register doesn't map cleanly to
any motion register), reduce to two variants (A + C) via
`--two-variants` rather than ship three weak ones.

## Hard constraints

Inherited from the underlying skills — `uplift` does not re-state
them but relies on them being enforced:

- **Mode A pinning** — palette + typography from captured brand
  surface. Enforced by `direct/SKILL.md` § Mode A.
- **IA priority preservation** — configurator stays above the
  fold, crisis affordances stay first-viewport, etc. Enforced
  by `direct/SKILL.md` § IA-priority preservation audit.
- **Density floor** — brand-register pages with > 5 sections cap
  `sectionPadding.desktop` at ≤ 64px. Enforced by
  `direct/SKILL.md` § Hard floor enforcement.
- **Variant differentiation** — each variant differs from the
  others by ≥ 2 changes. Enforced by `direct/SKILL.md` § Variant
  differentiation contract.
- **Captured images reused in semantic positions** — hero stays
  hero, story image stays story image. Enforced by
  `prototype/reference/proposed-file-shell.md` § Content sourcing
  hierarchy.
- **No fabricated content** — stats, addresses, quotes, named
  persons rendered as `[data-placeholder]` not invented. Enforced
  by `prototype/SKILL.md` Phase 2 § Content sourcing scan.
- **C-cliff refusal for variant C** — variant C bets on motion,
  not on "everything from B but more." Enforced by
  `prototype/reference/motion-validation.md` § Pass 6f motion
  C-cliff detector.
- **Reduced-motion fallback for variant C** — every motion
  element is neutralized under `prefers-reduced-motion: reduce`.
  Enforced by `prototype/reference/motion-validation.md` § Pass 6b.

When any of these gates refuses, `uplift` surfaces the refusal
verbatim from the underlying skill — the user sees the specific
violation, not a generic "uplift failed" message.

## Stop conditions

Stop and ask only if:

(a) **Extract fails** — site unreachable, structure unparseable,
    bot-management blocks past the headed-Chrome fallback.
(b) **Brand surface insufficient** — palette has fewer than 2
    distinct colors after clustering; OR the captured page has
    fewer than 3 sections; OR the captured PRODUCT.md Brand
    Personality maps to none of the five motion registers.
    Surface honestly: "the captured brand surface is too thin
    for three differentiated variants — render one strong variant
    instead?"
(c) **Improvements list empty** — Phase 2a cannot name 3 specific
    weaknesses. Without specifics, variant A has no brief and
    "uplift" has no claim. Surface honestly.
(d) **Two candidates equally weak** — if B's "what if…" candidate
    and C's cinematic candidate would amplify the same captured
    trait, the variants would not differentiate. Switch to
    `--two-variants` (A + C only).
(e) **Hard rule conflict** — captured palette has a single color,
    captured typography has no display register, captured site
    has no system components. Brand-faithful constraint
    impossible without invention. Surface and ask.

The skill **does not** stop for confirmation in normal flow. The
"PROCEED. Run all phases without stopping" property of the
original presales prompt is preserved.

## Outputs

```
stardust/
├── state.json                              ← extracted + 3× prototyped
├── direction.md                            ← resolved direction + 3 variant declarations
├── uplift-improvements.md                  ← load-bearing 5-weakness list
├── uplift-questions.md                     ← 6–8 "what if…" candidate list with disqualifications
├── current/                                ← from extract
│   ├── PRODUCT.md
│   ├── DESIGN.md
│   ├── DESIGN.json
│   ├── brand-review.html
│   ├── _brand-extraction.json
│   ├── _crawl-log.json
│   ├── pages/<slug>.json
│   └── assets/
└── prototypes/
    ├── <slug>-A-shape.md
    ├── <slug>-A-proposed.html              ← faithful + improvements
    ├── <slug>-B-shape.md
    ├── <slug>-B-proposed.html              ← "what if amplifying <trait>"
    ├── <slug>-C-shape.md
    ├── <slug>-C-proposed.html              ← static fallback for C
    ├── <slug>-C-cinematic.html             ← cinematic variant C
    ├── lenis.min.js                        ← copied from skill assets
    └── lenis.min.css

PRODUCT.md                                  ← shared (Mode A)
DESIGN.md / DESIGN.json                     ← shared
DESIGN-A.md / DESIGN-A.json
DESIGN-B.md / DESIGN-B.json
DESIGN-C.md / DESIGN-C.json                 ← carries motion.register
```

## What this skill is NOT

- It is not a renderer. The actual rendering is delegated to
  `prototype` (via `$impeccable craft`).
- It is not a re-implementation of direct's intent reasoning. The
  resolved direction is constructed mechanically from the
  brand-surface inputs + the closed candidate catalog; the
  reasoning lives in `direction.md` as a record, not in an
  interview.
- It is not multi-page. Uplift is the one-page presales tool. For
  multi-page redesigns, the standard chain
  (`extract` → `direct` → `prototype`) is the right shape.
- It is not a migration tool. Migration produces a deployable
  bundle; uplift produces three review surfaces for a presales
  conversation.
- It is not a substitute for `direct` and `prototype`. After the
  brand owner picks a variant, the user iterates that variant via
  `prototype <slug>` chat-driven impeccable commands, and
  approves via the standard approval flow.

## References

- `reference/what-if-candidates.md` — the closed catalog of 8
  captured-trait amplification candidates that B and C pick from.
- `../prototype/reference/motion-registers.md` — register catalog
  and selection heuristic used in Phase 3a.
- `../prototype/reference/motion-validation.md` § Pass 6 —
  cinematic-mode validation gates that fire for variant C.
- `../prototype/SKILL.md` § Inputs — `--cinematic` and
  `--variant` flags passed through from uplift.
- `../direct/SKILL.md` § Phase 2.6 — multi-variant fork; uplift
  passes the three-variant declaration through.
- `../stardust/reference/data-attributes.md` — structural section
  attributes applied by prototype to all three variants.
- `../prototype/reference/proposed-file-shell.md` — content
  sourcing hierarchy and placeholder convention.
