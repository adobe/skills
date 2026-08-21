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

## Opinionated defaults

- **Single-page extract** — the homepage by default (the brand
  owner's first surface) unless `--page <slug>` overrides.
- **Brand-faithful Mode A** — palette + typography pinned. No
  invented colors, no fonts outside the captured surface.
- **Three variants, fixed role contract** — A is the green-light,
  B is the design-team motivator, C is the visionary cinematic
  pitch.
- **Cinematic register auto-picked** — C's motion register is
  selected from the captured PRODUCT.md Brand Personality per
  `../prototype/reference/motion-registers.md` § Selection
  heuristic.
- **"What if..." candidates are evidence-shaped** — B and C each
  pick one captured-but-underused trait, from the eight worked
  candidates in `reference/what-if-candidates.md` or a derived
  candidate per its § Extension rule. Different traits per variant.
- **Validation cascade runs** — every gate in
  `prototype/SKILL.md` Phases 2.5–2.8 fires, including cinematic
  Pass 6 for variant C.

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
- `--re-extract` — optional. Force a fresh crawl even when a prior
  extraction of the same URL is < 7 days old (see § Setup,
  reuse-if-fresh).

There are no other flags. Everything else is derived from the
captured brand surface or governed by the underlying skills'
contracts.

## Setup

1. Run the master skill's setup
   (`../stardust/SKILL.md` § Setup): impeccable dep check, context
   loader, state read.
2. Verify Playwright is available (`extract` will fail without it —
   surface the same install message extract would).
3. Read `stardust/state.json` if present. **Reuse-if-fresh:** when
   a prior extraction of the same URL is < 7 days old, skip Phase 1
   and render against the existing capture, with a one-line notice
   ("reusing extraction from <date> — pass `--re-extract` for a
   fresh crawl"). `--re-extract` forces a fresh crawl regardless of
   age; extractions ≥ 7 days old re-extract without asking.

## Procedure

Six phases plus a reference-grounding interphase. Phases 1, 4, 5
delegate to existing skills; phases 2, 2.5, 3, 6 are owned by
`uplift`.

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

At least **3** specific weaknesses observed in the captured site —
as many as the evidence supports, no fixed count. Same load-bearing
contract as the existing presales workflow: without specifics,
"make it better" has no claim. Category tags (MAY repeat across
items when the evidence supports it):

- `[dated-pattern]` — patterns the design world has moved past (be
  specific: "centered hero with stock photo + double CTA in primary
  blue reads as the SaaS template circa 2019")
- `[ia-clutter]` — cluttered IA / unclear hierarchy / weak CTAs /
  redundant sections
- `[contrast-or-density]` — contrast failures, accessibility gaps,
  density issues
- `[cliché]` — conventions the brand could move past while staying
  recognisably itself
- `[missed-opportunity]` — the captured surface doesn't capitalise
  on its own strengths ("captured photography is excellent but the
  layout crops it to thumbnail-size")

**Specificity bar — every item.** Each item cites a measurement,
tension ID, or screenshot observation from the capture, names the
pattern at fault, and proposes one concrete fix. An item that fails
the bar is cut, not padded.

**Audit consumption.** When `stardust/audit/<domain-slug>/audit.json`
exists for this origin (written by the `stardust:audit` skill),
consume its design findings as candidate improvements instead of
re-deriving them from scratch — cite the finding IDs in the item's
evidence and add the audit file to `readArtifacts`.

Refuse to proceed if fewer than 3 specific weaknesses can be named
(see § Stop conditions).

Format (mirrors the provenance shape used by the rest of stardust):

```markdown
---
_provenance:
  writtenBy: stardust:uplift
  writtenAt: <ISO-8601>
  againstInput: <URL>
  readArtifacts:
    - stardust/current/_brand-extraction.json
    - stardust/current/pages/<slug>.json
    - stardust/current/brand-review.html
---

# Improvements — <URL>

1. **[<category-tag>]** <one-line headline> — <measurement /
   tension ID / screenshot observation> · <pattern at fault> ·
   fix: <one concrete fix>.
2. **[<category-tag>]** … (≥ 3 items; tags may repeat)
```

The bracketed tag preceding each weakness is a category from the
list above. The headline is the one-sentence summary the agent will
restate when variant A's shape brief applies the fix.

#### 2b — `stardust/uplift-questions.md`

Six to eight "what if we leaned into…" candidates derived from the
captured brand surface. Each candidate cites the captured evidence
that makes it concrete. Candidates are drawn from the catalog in
`reference/what-if-candidates.md` — eight worked examples that are
the **floor, not a ceiling**:

1. Display-typography amplification
2. Photography re-foregrounding
3. Live-data promotion
4. Signature-gesture extension
5. Voice-register pivot
6. Color-ladder re-weighting
7. Audience-routing reframe
8. Motif vocabulary swap

An out-of-catalog **derived** candidate is admissible when it
carries the same evidence shape as the catalog entries: ≥ 2
captured citations + an explicit disqualification test + the
variant role it serves (per `reference/what-if-candidates.md`
§ Extension rule). Record each candidate's source —
`catalog | derived` — in the candidate list.

For each candidate the agent generates: a one-line "what if…"
phrasing, the captured evidence that makes the candidate concrete,
the variant role it best serves (B's composition bet vs C's
cinematic bet), and whether the candidate is **disqualified** for
this brand (e.g. "Photography re-foregrounding disqualified — the
captured photography is generic stock; amplifying it would expose
the weakness").

The disqualification step is what keeps the agent from reflexively
picking the same candidate for every brand.

### Phase 2.5 — Reference grounding (owned by `uplift`)

When reference research is available (per
`skills/stardust/reference/reference-research.md` — when to fire,
the 3–5 reference budget, the evidence shape, and provenance
recording are all defined there), ground the Phase 2 claims in
real-world references before Phase 3 picks directions:

(a) **Ground each `[dated-pattern]` claim** in
    `uplift-improvements.md` with a named contemporary
    counter-example — a real site / screen citation showing what
    the pattern's world moved to.
(b) **Anchor variant B's composition bet** with a named real-world
    compositional anchor — a real screen whose composition the bet
    resembles.
(c) **Verify C's register pick** against how motion is actually
    used in the vertical — does the register match observed
    contemporary practice for this kind of brand?

Record the references per reference-research.md's provenance
contract (`_provenance.referencesUsed[]` on the artifact each
grounding serves). When reference research is unavailable, skip
with a one-line note in that provenance and proceed — the phase
degrades gracefully.

This phase never replaces captured-evidence discipline:
**references justify the MOVE, captured evidence justifies the
TRAIT.** A candidate without captured citations is inadmissible no
matter how well-referenced its move is.

### Phase 3 — Pick three variant directions (owned by `uplift`)

Default: three variants (A + B + C). When `--two-variants` is
active, skip § 3c (B's candidate selection) and the direction.md
authored in § 3d declares only A + C. Phase 4 then writes only
`DESIGN-A` and `DESIGN-C` files at the project root, and Phase 5
renders accordingly. All downstream contracts (variant
differentiation, motion validation on C, summary in Phase 6)
operate over the reduced variant set without modification.

#### 3a — Pick the cinematic register for variant C

Read PRODUCT.md Brand Personality (from `stardust/current/PRODUCT.md`)
and apply the heuristic in `../prototype/reference/motion-registers.md`
§ Selection heuristic. Record the picked register + the one-line
rationale.

#### 3b — Pick C's "what if" candidate

The candidate must be the one the picked register **naturally
amplifies through motion**. The per-candidate **Natural register
for C** fields in `reference/what-if-candidates.md` are the single
source of truth for the register→candidate mapping — read the
mapping there (a derived candidate admitted per its § Extension
rule must declare the same field). This file does not duplicate
the table.

**Fallback when C's natural candidates are all disqualified:**
re-pick the second-choice register — the next-best match from
`../prototype/reference/motion-registers.md` § Selection heuristic
— and take its natural candidate. If the second-choice register's
natural candidates are also all disqualified, fall through to
`--two-variants` via stop condition (d): drop B and let C take the
strongest remaining non-disqualified candidate.

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

Render **A first, then B and C**:

1. **Render A** — invoke `stardust:prototype <slug>` scoped to
   variant A. A establishes and **freezes the canon** (tokens,
   chrome, module renderings) that B and C inherit; rendering it
   first removes the ordering race.
2. **Render B, then C** (default: sequential). B and C prototype
   the *same slug*, and same-slug concurrent runs are last-write-
   wins on `state.json` per
   `../stardust/reference/state-machine.md` § Concurrency — so
   in-place parallel rendering is unsafe. **Parallel is permitted
   only via isolated workspace copies**: each subagent gets a copy
   of the project (git worktree or directory copy) containing only
   its own `DESIGN-<id>.json` at the root (siblings stashed), so
   prototype's file-presence detection renders exactly that
   variant. The subagent returns its `<slug>-<id>-shape.md`,
   `<slug>-<id>-proposed.html` (and C's `-cinematic.html`) plus
   provenance; the parent copies the artifacts back and performs
   the **single** `state.json` update for both variants.
3. **Open each prototype as it completes** (via the `open`
   mechanics in Phase 6 step 1) rather than waiting for all three.

Prototype detects the variant set from the per-variant `DESIGN-A`,
`DESIGN-B`, `DESIGN-C` files that `direct` wrote in Phase 4 —
authoring `<slug>-A-shape.md` / `-B-shape.md` / `-C-shape.md` and
emitting `<slug>-A-proposed.html` / `<slug>-B-proposed.html` /
`<slug>-C-proposed.html` per the variant-convergence detector
contract (`../prototype/SKILL.md` § Phase 2.5 / Discipline 10).

**Cinematic motion fires per-variant from the per-variant DESIGN
file**, not from a CLI flag. **Never pass `--cinematic` to
prototype from uplift.** Because Phase 4 wrote
`extensions.motion.register` into `DESIGN-C.json` only (A and B
omit it), prototype's Phase 2.4 (motion application) fires only
for variant C. Variant C emits both `<slug>-C-proposed.html`
(the static reference) and `<slug>-C-cinematic.html` (the
register-applied surface). Variants A and B render static, never
acquiring the motion runtime.

Prototype owns:

- Page-shape brief authoring per Phase 1 of prototype.
- Render via `$impeccable craft` delegation, per variant.
- Phase 2.4 motion application for variants whose `DESIGN-<id>.json`
  declares an `extensions.motion.register`.
- Phases 2.5–2.8 quality gates (critique, audit, adapt, motion)
  per variant.
- Variant C's cinematic-mode gates (Pass 6) per
  `../prototype/reference/motion-validation.md`.
- Variant-convergence detector (≥ 2 structural changes per pair)
  per Discipline 10.

Multi-variant rendering is driven by the presence of multiple
`DESIGN-<id>.json` files at the project root, not by a CLI selector
— prototype has no `--variant <id>` input. That is exactly why the
parallel path in step 2 requires isolated workspace copies with a
single pinned `DESIGN-<id>.json` each: file presence is the only
variant selector prototype has. The A-first ordering above is what
keeps canon consistent across the B and C runs in either path.

### Phase 6 — Open and summarize (owned by `uplift`)

After all three prototypes mark `prototyped` in `state.json`:

1. **Confirm all three are open in the browser** — each variant was
   opened as it completed (Phase 5 step 3); open any that weren't,
   using the `open` shell command (not `playwright-cli open`) so VFS
   paths are served via the preview service worker:
   ```
   open stardust/prototypes/<slug>-A-proposed.html
   open stardust/prototypes/<slug>-B-proposed.html
   open stardust/prototypes/<slug>-C-cinematic.html
   ```
   `playwright-cli open` bypasses the preview service worker and produces
   a FILE NOT FOUND error for VFS paths. Always use `open <vfs-path>` for
   local prototype files.
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
   approve via the standard prototype approval flow (records the
   approval in state.json).
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
- **Site favicon in every variant's head** — when
  `stardust/current/assets/favicon.<ext>` exists, each variant page
  inlines it as a data: URI `<link rel="icon">`. Enforced by
  `prototype/reference/proposed-file-shell.md` § Hard
  requirements #8.
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
├── uplift-improvements.md                  ← load-bearing weakness list (≥ 3 items)
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

## Scope

- One page per run. Multi-page redesigns use the standard
  `extract` → `direct` → `prototype` chain.
- Three review surfaces, not a deployable bundle. After the brand
  owner picks a variant, iterate via chat-driven impeccable
  commands and approve via the standard `prototype` approval flow.
  Migration is `stardust:migrate`.

## References

- `reference/what-if-candidates.md` — the eight worked
  captured-trait amplification candidates that B and C pick from,
  plus the § Extension rule for evidence-shaped derived candidates.
- `skills/stardust/reference/reference-research.md` — procedure for
  sourcing real-world design references (Phase 2.5): when to fire,
  the 3–5 reference budget, the evidence shape, provenance
  recording.
- `../prototype/reference/motion-registers.md` — register catalog
  and selection heuristic used in Phase 3a.
- `../prototype/reference/motion-validation.md` § Pass 6 —
  cinematic-mode validation gates that fire for variant C.
- `../prototype/SKILL.md` — multi-variant rendering and motion
  driven by the per-variant `DESIGN-<id>.json` files `direct` wrote
  in Phase 4, not by a CLI selector or flag (uplift never passes
  `--cinematic`).
- `../direct/SKILL.md` § Phase 2.6 — multi-variant fork; uplift
  passes the three-variant declaration through.
- `../stardust/reference/data-attributes.md` — structural section
  attributes applied by prototype to all three variants.
- `../prototype/reference/proposed-file-shell.md` — content
  sourcing hierarchy and placeholder convention.
