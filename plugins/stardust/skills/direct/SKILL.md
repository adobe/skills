---
name: direct
description: Set a redesign direction for an existing website. Analyzes the user's intent, picks a palette and visual direction, and writes the target spec (PRODUCT.md, DESIGN.md, DESIGN.json) plus a reasoning trace at stardust/direction.md. Use when the user asks to redesign a site, refresh the design, set a new design direction, define a redesign target, or invokes /stardust:direct.
license: Apache-2.0
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
  roll, no Mode A inheritance) regardless of whether the captured
  brand surface has signal. The default mode is brand-faithful
  whenever `_brand-extraction.json` is `signal-strong` (see § Setup
  step 5 and Phase 2 § Mode-detection precedence); pass `--rebrand`
  to opt out explicitly when the user's phrase is ambiguous about
  whether they want a refresh or a clean-slate redesign.
- `--prep` — optional. Run in **migrate-prep mode**: confirm the
  type catalog, finalize the module catalog, capture color
  reservations and brand-level metadata defaults, re-evaluate
  direction against the wider crawl. See § Prep mode below.
  Typically invoked via the `prepare-migration` orchestrator.

## Setup

1. Run the master skill's setup
   (`skills/stardust/SKILL.md` § Setup) — hard impeccable dep check,
   context loader, state read.
2. Verify `stardust/state.json` exists and contains at least one
   `extracted` page. If not, stop and recommend
   `$stardust extract <url>` first.
3. Read `stardust/current/_brand-extraction.json`. If absent, stop —
   extract did not complete brand-surface extraction; re-run extract.
4. Read `stardust/direction.md` if present. If a prior direction
   exists and `--re-direct` was not passed, ask whether the user wants
   to refine the existing direction or replace it.
5. **Classify the captured brand signal.** Read
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

#### Density tuning (one-shot, only when unmoved)

When the user's phrase does **not** move the `density` axis (per
`reference/intent-dimensions.md` § 4), and the resolved register is
`brand`, ask one short follow-up — count it within the two-question
ceiling:

> Density tuning — (a) airy (NYT-Opinion-tier breathing, ~96px
> section padding), (b) balanced (calm but compact, ~64–72px),
> (c) packed (data-dense, ~40–48px). Default for brand-register
> sites with multi-audience IA is **(b) balanced**; pick (a) only
> when the page is editorial-led with deep per-section density.

If the user answers, stamp the chosen tier in `direction.md` §
Movements as `density: <tier>`. If unanswered, default to
**balanced** (not airy) for brand register and stamp
`density: balanced (default)`.

Skip this question entirely when:
- The user's phrase already moved `density` (any of "make it
  denser", "more breathing room", "compact", "tight", "spacious"
  count as movement).
- The register is `product` (default `packed` per § 4).
- The register is `ambiguous` and resolving it earlier in the
  reasoning is the higher-value question — defer density to the
  next turn rather than burning a question slot.

The tier propagates to `DESIGN.md`'s `spacing.sectionPadding`
deterministically per `intent-dimensions.md` § 4: airy = 96px,
balanced = 64px, packed = 48px. Phase 4 picks the value from this
stamp without re-asking.

Wait for the user's confirmation (`"go"`, or a correction to the
plan) before moving on.

### Phase 2 — Resolve the divergence inputs

Once the plan is confirmed, resolve the divergence-toolkit inputs
from `skills/stardust/reference/divergence-toolkit.md`. Before
rolling the seed, run the mode-detection precedence below to decide
whether the seed needs rolling at all.

#### Mode-detection precedence (run first)

The default mode for `direct` is determined by whether an extracted
brand surface exists with usable signal — **not** by the user's
freeform phrase alone. Stardust's primary use case is migrating an
existing site with a design refresh; "make it modern" / "stunning new
version" / "design fatigue cure" are migration-shaped asks. Treating
those phrases as rebrand triggers (rolling a fresh divergence seed)
produces output that is recognisably a different brand from the one
that asked for the refresh — a published failure mode. The
precedence below catches the common case as the default and reserves
divergence-seed rolls for explicit rebrand requests.

The precedence is asymmetric on purpose: the safer mode (Mode A —
brand-faithful) catches ambiguous phrases, and the riskier mode
(rebrand / full divergence-seed) requires the user to name it.

1. **Site migration / refresh — DEFAULT.** When the captured brand
   signal stamped in § Setup step 5 is `signal-strong`, Mode A is
   active by default. The user's phrase moves *expressive*,
   *distinctiveness*, *tone*, and *density* axes inside Mode A — but
   palette and type are pinned to the captured surface, and the
   image-reuse contract (below) holds. Surface in the plan:
   *"Brand-faithful mode active — palette and type pinned to the
   captured brand surface. Pass `--rebrand` to override."*

2. **Rebrand — explicit opt-in.** Mode A is overridden when **any**
   of the following triggers fire:
   - The user's phrase contains an explicit rebrand signal: any of
     `rebrand`, `new brand`, `clean slate`, `start over`,
     `from scratch`, `replace the brand`, `not brand-faithful`,
     `editorial reimagination`, `completely new`, `redo the brand`.
   - The `--rebrand` flag is passed.
   - Captured signal is `signal-absent` (no usable inheritance).
     Surface this case as an automatic switch with reason; the user
     can correct.

   In rebrand mode, run the standard divergence-seed roll per
   "Default mode (no constraints)" below. Surface in the plan:
   *"Rebrand mode active — full divergence-seed roll. Mode A
   bypassed because <reason>."*

3. **Brand-faithful + targeted exploration.** When the user requests
   N variants (e.g. *"3 variants"*, *"4 directions"*) and Mode A is
   active, the variant role contract in § Multi-variant fork
   applies. Variant A is locked to **strict Mode A** (palette and
   type pinned, IA preserved, every improvements-list item applied).
   Variants B+ may amplify one **captured** trait (a motif, a photo
   treatment, an IA priority the current site underplays) but
   cannot:
   - introduce a font outside the captured surface,
   - introduce a color outside the captured palette,
   - shift the register from PRODUCT.md.

4. **Signal-thin fallback.** When captured signal is `signal-thin`,
   Mode A activates but warns: *"Captured brand surface is thin —
   {reason}. Variants will inherit what is available; some
   dimensions will need to be filled by the divergence toolkit."*
   The user may either re-run extract with a wider crawl
   (`--cap 25`) or proceed with reduced fidelity.

After mode-detection completes, run the existing mode definitions
below (Mode A procedure, Mode B anchor-reference precedence, Mode C
ground-family override) as applicable.

#### Mode A — Brand-faithful mode

Triggered automatically when the captured brand signal is
`signal-strong` and no rebrand-mode override fired (see
§ Mode-detection precedence above), OR when the user pinned **both**
type and palette (via explicit phrase: "keep typography and palette",
"preserve the existing brand", "brand-faithful redesign"; or via
constraints listing both as anchors).

In this mode, direct does **not** roll the type or palette
dimensions of the seed — they are already locked. Going through
the motions of font-deck and palette picks would be ceremony,
producing `picked_by = "user-constraint"` records that don't
reflect any real choice.

The mode procedure:

1. Record `font_deck.name = "brand-inherited"` and
   `font_deck.picked_by = "user-constraint"`. Do not invoke
   `reference/palette-picker.md`.
2. Record `palette.source = "inherited from _brand-extraction.json"`
   and `palette.picked_by = "user-constraint"`. Apply role-renaming
   per toolkit § 4 if the inherited names violate the brand-native
   rule (this is still useful — role renaming is presentational,
   not a divergence choice).
3. **Still roll** the seed for the **non-locked** dimensions
   (decade, register, ground-family-as-applicable per Mode C
   below). These dimensions still drive divergence — the visual
   register and the era can shift even when type and palette are
   pinned.
4. Auto-emit the `brand_faithful_inversions[]` block in
   `extensions.divergence` per
   `reference/direction-format.md` § Brand-faithful inversions.
   The list is mostly mechanical (see § Brand-faithful inversions
   in direction-format.md for the canonical patterns).
5. Surface in the user report which dimensions had teeth and
   which were inert:

   ```
   Divergence (brand-faithful mode):
     decade           ✓ rolled    → 2025-now
     craft            ✓ rolled    → Riso print
     register         ✓ rolled    → Memoir-adjacent
     ground-family    inherited   → stark-white (brand-native)
     font deck        inherited   → existing site stack
     palette          inherited   → existing 5-color set
   ```

6. **Image-reuse contract.** Captured images are reused via their
   public URLs (or the local copies in
   `stardust/current/assets/media/` written by extract Phase 2)
   **at the same semantic position** as on the source site. Hero
   stays hero. Story-tile portrait stays story-tile portrait.
   Program-card image stays program-card image. Background-motif
   image stays background motif.

   This is part of brand-faithful inheritance, not a separate
   content rule. A variant that swaps a captured subject portrait
   for a gradient placeholder, or moves the captured hero photo to
   a card thumbnail, erases the brand's most load-bearing trust
   signal — the named-people stories that almost every nonprofit /
   service-led site has spent years building.

   The only legitimate ways to deviate from semantic
   position-preservation under Mode A:

   - The captured image is broken (404, blocked by `referrer-policy`,
     CORS-walled, or recorded with `localPath: null` and a
     `downloadError`).
   - The brand-review surfaced the image as a tension (e.g.
     `T-stock-photography` when added — flagging the captured
     image as obviously templated stock that the brand team would
     replace anyway).
   - The improvements list (Phase 2.5) explicitly notes a crop or
     positioning fix for that image — in which case the same
     image is reused at the corrected crop or position.

   Synthesised placeholders are forbidden under Mode A. When a
   captured image cannot be reused, the prototype shape brief
   declares the gap explicitly and the rendered prototype shows a
   placeholder-with-signature element so reviewers see the gap
   rather than a fabricated photo.

Mode A is the default whenever § Mode-detection precedence step 1
applies (captured signal is `signal-strong` and no rebrand override
fires). It also activates explicitly when the resolved direction's
constraints list contains `brand-faithful` AND explicit type AND
palette anchors, OR when the user's phrase contains "keep
typography" / "preserve the palette" / equivalent. The agent
surfaces "Brand-faithful mode active" in the plan it shows the
user before executing — the user can correct (e.g. "actually let
me move the palette" or "actually rebrand it") before it locks.

#### Mode B — Anchor-reference precedence

When the user provides anchor references (Q1/Q2 answers like
"Pentagram nonprofits, This American Life, NYT Opinion longform"),
those references **already imply** seed dimensions. Pentagram
implies decade `2025-now` editorial. This American Life implies
register `Memoir`-adjacent. Rolling those dimensions
deterministically and getting an accidental alignment is fragile —
the agent then has to retro-justify the alignment in
`direction.md`.

Precedence rule:

1. If anchor references are present, extract their implied
   dimensions:
   - **Decade** from era of the references (Pentagram → 2025-now;
     vintage Penguin → 1960s).
   - **Craft** from medium of the references (TAL → audio editorial
     ≠ a craft per se, but Bandcamp → web-print hybrid; Riso-print
     anthology → Riso).
   - **Register** from cultural reference set (Memoir, Tabloid,
     Catalogue, etc.).
   - **Ground-family** from typical ground of those references
     (NYT Opinion → cream/parchment; Pentagram nonprofit →
     stark-white or monochrome-tint).
2. Mark each implied dimension as
   `picked_by = "anchor-reference: <ref-name>"`.
3. Roll the seed only for **un-implied** dimensions.
4. Record the anchor → dimension mapping in
   `extensions.divergence.seed.anchors[]`.

Mode B can compose with Mode A: anchor-references narrow the seed,
brand-faithful constraints lock type/palette, the remaining roll
is whatever the anchors didn't already imply.

#### Mode C — Brand-faithful ground-family override

When Mode A is active **and** the seed's `ground_family` roll
disagrees with the brand's existing ground (e.g. seed rolled
`monochrome-tint` but the brand's captured background is
`#ffffff` stark-white), the brand's ground wins. The seed roll is
not discarded — it informs the **alt-section surface** instead
(per `divergence-toolkit.md` § 4 Color roles). Record the override
in `extensions.divergence.seed.ground_family.override` with one
of three reasons:

- `brand-faithful` — Mode A active and brand has a fixed ground.
- `print-paper` — manual override for print/paper categories
  (existing toolkit rule).
- `direction-driven` — seed wins (default; no override).

The three reasons are mutually exclusive; surface the chosen one
in the user report.

#### Default mode (no constraints)

When neither Mode A nor Mode B applies, follow the standard
procedure:

- **Seed.** Roll the 4-dimension seed (decade × craft × register ×
  ground-family) using the deterministic MD5 picker per § 2 of the
  toolkit. Record `picked_by`.
- **Font deck.** Pick from the 10 named decks per § 3. When the
  seed strongly implies a deck (e.g. `1977 + letterpress + tabloid`
  → `retro-italian`) use the implied deck; otherwise pick
  deterministically from the hash.
- **Palette.** If the resolved direction moves the color-energy
  axis or names the existing palette as part of the problem, run
  the palette picker
  (`skills/direct/reference/palette-picker.md`). Otherwise inherit
  the existing palette from
  `stardust/current/_brand-extraction.json`, applying role-renaming
  per toolkit § 4 if the inherited names violate the brand-native
  rule.

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
weaknesses** observed in the captured site. This is the load-bearing
artifact for variant A: without it, *"make it better"* has no claim
the agent can defend, and each variant ends up inventing its own
"better" — producing rebrand-shaped output even with Mode A active.

The improvements list is the brief variant A renders against. It is
**not** prescriptive (it does not declare visual targets); it is
**descriptive of the gap** between the existing site and a competent
2026 execution of the same brand. Variant A's job is to close the
gap; variants B+ honor the list as a floor (they may go further but
not contradict it).

Skip this phase when the resolved mode is rebrand — the improvements
list assumes brand-faithful inheritance, and a rebrand replaces the
site rather than fixing it.

#### What goes in the list

The list draws from five categories. Items should be specific enough
that a downstream `prototype` shape brief can cite them by number.

1. **Dated patterns the design world has moved past.** Specific:
   *"centered hero with stock photo + double CTA in primary blue
   is the SaaS template circa 2019"* — not *"the hero feels dated."*
2. **Cluttered IA, unclear hierarchy, weak CTAs, redundant sections.**
   E.g. *"home page has 4 different donor CTAs, each with a different
   verb (DONATE / GIVE / SUPPORT / CONTRIBUTE), fragmenting the
   conversion funnel."*
3. **Contrast failures, accessibility gaps, density issues.** Pull
   from `brand-review.html` Tensions when present (`T-color-imbalance`,
   `T-img-alt-empty`, etc.). E.g. *"Primary CTA `#008192` on white
   passes AA at 4.6:1 but the same teal on light-grey card surfaces
   drops to 3.1:1 — fails AA on those instances."*
4. **Cliché conventions the brand could move past while staying
   recognisably itself.** E.g. *"All headings render uppercase via
   CSS — the brand voice survives mixed-case headlines, and mixed-case
   reads as more current without changing identity."*
5. **Missed opportunities the existing site doesn't capitalise on.**
   E.g. *"The captured photography of named program participants is
   excellent but the home page renders all 6 portraits as 280×180
   thumbnails in a slick-slider; the photographs support full-bleed
   editorial treatment that would carry the trust signal far more
   effectively."*

#### Specificity bar

A weakness is specific enough when it cites:
- a measurable observation (size, ratio, contrast value, count, or
  named tension ID) drawn from the per-page JSON, the brand-review,
  or the brand-extraction;
- the design pattern at fault (named, e.g. "centered hero + dual CTA");
- one concrete fix the variant A brief will apply.

*"The hero needs work"* fails all three. *"Hero photo is cropped to
280×180 in a 1440-wide viewport when the captured source supports
16:9 full-bleed at 1440×810; variant A fix: render at full-bleed and
move the headline to a left-anchored two-column overlay"* passes all
three.

#### Format

Markdown, with a `_provenance` frontmatter block per the artifact-map
convention. Each item is a numbered list entry with a category tag, a
weakness statement, and a one-line fix. Example:

```markdown
<!--
_provenance:
  writtenBy: stardust:direct
  writtenAt: 2026-04-29T11:00:00Z
  readArtifacts:
    - stardust/current/_brand-extraction.json
    - stardust/current/brand-review.html
    - stardust/current/pages/<slug>.json
  stardustVersion: 0.2.x
-->

# Improvements — <slug>

1. **[dated-pattern]** Centered hero with double CTA pair (DONATE +
   LEARN MORE) is the 2019 nonprofit-template silhouette.
   *Fix:* Replace with a left-anchored editorial composition; one
   primary CTA, one secondary text-link.

2. **[ia-clutter]** 4 distinct donor verbs across the home page
   (DONATE, GIVE, SUPPORT, CONTRIBUTE) fragment the funnel.
   *Fix:* Pick one canonical verb (DONATE, per the CTA frequency
   table); other instances become secondary "see all ways to give"
   links.

3. **[contrast]** Brand teal on light-grey card surfaces resolves to
   3.1:1 — fails WCAG AA. (See `T-color-imbalance` in brand-review.)
   *Fix:* Reserve teal for white-ground only; use deepened teal
   (#005a68) on grey surfaces.

4. **[cliché]** All headings render uppercase via CSS, including
   long-form section openers ("OFFICIAL FOUR STAR CHARITY"). The
   shout reads as urgency at first heading and as fatigue by the
   third.
   *Fix:* Mixed-case for headings ≥3 words; preserve uppercase only
   for short imperative CTAs and eyebrow labels.

5. **[missed-opportunity]** Six named-participant portraits render
   as 280×180 thumbnails in a slick-slider; the captured source
   supports editorial-scale treatment.
   *Fix:* Replace carousel with a 3-column grid; portraits at 4:5
   aspect, 1:1 minimum 480px wide.
```

#### Stopping condition

If after reading the brand-review, the per-page JSON, and the
brand-extraction the agent **cannot name 3 specific weaknesses**
that meet the specificity bar, stop. Variant A has no brief; the
"better" claim fails. See § Failure modes (d).

The agent should not rationalise — *"the hero is dated"* is not an
item, *"the typography could be more modern"* is not an item.
Genuine empty-list cases occur when the captured site is already at
a high execution level on observable dimensions. In that case the
honest answer is to surface the empty list and propose reduced
scope (density-and-contrast adjustments only, or pivot to a single
exploratory variant rather than three).

### Phase 2.6 — Multi-variant fork (when N > 1)

When the user requests N variants (phrase contains *"3 variants"*,
*"4 directions"*, or equivalent), variant slots are
**role-differentiated**, not seed-differentiated. Each slot serves a
distinct decision the customer is making — variants exist to
de-risk a brand decision, not to fan out into N rebrand
explorations.

The previous default behavior (each variant rolls a fresh divergence
seed with anchor references picked per slot) produced what the
internal review called *"three rebrands"* output: each variant was
defensible standalone but none felt like the same brand. The
variant role contract below addresses this directly.

#### Variant role contract

| Slot | Role | Brief |
|---|---|---|
| **A** | **Faithful + improvements** — *"this is what your site should be tomorrow."* | Same IA. Same section sequence. Same composition strategy. Apply every item from `<slug>-improvements.md` exactly — no extras, no embellishment, no creative reach. The brand team should react *"yes, that's us, with the obvious fixes."* This is the variant a risk-averse stakeholder green-lights. |
| **B** | **One captured trait amplified** — *"what if we leaned into X?"* | Pick one specific trait already in the captured brand surface — a motif underused in current execution, a photographic treatment the site doesn't fully exploit, an IA priority the current site underplays, a tonal register that survives in copy but not in layout. Justify in one sentence in the variant's shape brief: *"This variant amplifies <captured trait> in service of <brand personality move from PRODUCT.md>."* |
| **C+** | **Different captured trait amplified** — *"what if we leaned into Y?"* | Different from B by definition. Different captured trait. Different brand-personality move. Forbidden definitions: *"B but more"*, *"bolder fonts"*, *"more empty space"*, *"more brutalist"*, *"more editorial"*. Each subsequent variant must be a defensible standalone proposition. |

Variants beyond C (D, E, …) follow the C+ contract — each amplifies
a distinct captured trait, declared in the shape brief.

#### Variant differentiation contract

Each pair of variants must differ by **≥ 2 substantive changes**
drawn from this set:

- section sequence (which sections appear in which order),
- section presence / absence (a section in one variant, not in another),
- layout strategy of a major section (e.g. hero is split-half vs.
  full-bleed-photo vs. type-led),
- IA priority (which audience leads the home — donor vs. recipient
  vs. volunteer for nonprofits; product vs. story for commerce).

Variants that fail the ≥ 2 changes test are rendered as the same
variant under different chrome — *"variants are barely different"*
is the published failure mode and is grounds for refusing render.
See § Failure modes (b) — when only 1–2 captured traits are
distinct enough to amplify, the agent surfaces this and proposes
1 or 2 variants rather than producing 3 weak ones.

#### The C-cliff failure mode

When defining variant C+, the following definitions are
**render-refusal conditions**:

- *"Everything from B but more"* (B+more is not a direction).
- *"120pt+ display fonts"* (size-as-personality is not a captured
  trait).
- *"96px+ section padding everywhere"* (padding-as-personality is
  not a captured trait — and conflicts with the density floor in
  `intent-dimensions.md` § 4 anyway).
- *"Extreme airy"* / *"extreme dense"* / *"extreme [axis]"* — slider
  positions pushed past the prior variant are not directions.
- Editorial-register vocabulary (*atelier*, *the studio*,
  *mise-en-place*, *the journal*) when the brand register is
  product / commerce / direct-services. See
  `divergence-toolkit.md` § 1 → *Voice-rule moves* →
  `Editorial-register vocabulary applied to non-editorial brands`.

C+ must answer *"what if we leaned into Y?"* with a specific Y
from the captured surface, not a slider position pushed past B.

The C-cliff name comes from the observed pattern where a
3-variant fork has A defensible, B defensible, and C reading as
*"unprofessional"* rather than *"a third proposition."* The fix is
not to soften C — it is to define C against a captured trait
instead of against B.

### Phase 3 — Author target PRODUCT.md

Write `PRODUCT.md` at the project root using impeccable's
`reference/teach.md` as the **format spec** (not as a runtime command
to invoke). Direct authoring is intentional: by the time `direct`
runs, every answer impeccable's interview would surface has already
been resolved through stardust's intent-reasoning + divergence
resolution above.

Sections to populate:

- **Register** — from the resolved direction's `register` axis.
- **Users** — from the resolved audience tuple plus tone signals from
  the extracted brand surface.
- **Product Purpose** — from the user's phrase + extracted hero copy
  + resolved tone, written as a one-line value statement followed by
  one-line scope.
- **Brand Personality** — derived from resolved expressive axis +
  tone + reference set. Weight axes the user explicitly moved over
  inherited values.
- **Anti-references** — the user's stated anti-refs **plus** any
  anti-toolbox guardrails relevant to the resolved direction
  (e.g. "modernise" triggers the Generic-2026-SaaS silhouette
  guardrail; list it explicitly so prototype and polish enforce it).
- **Design Principles** — 3-5, each mapping to a specific axis
  movement. Format: one verb-led principle, one-line elaboration.
- **Accessibility & Inclusion** — populated when the constraint set
  includes `a11y-first`, `RTL-required`, or similar. Otherwise
  inherit impeccable's defaults.

Where a section cannot be populated with confidence from inputs,
mark it `<!-- _provenance: inferred -->` with a one-line basis
sentence. Never invent strategy.

### Phase 4 — Author target DESIGN.md and DESIGN.json (site-level only)

Write `DESIGN.md` at the project root using impeccable's
`reference/document.md` as the format spec — Stitch YAML frontmatter
plus the 6 canonical sections in fixed order.

**Site-level only.** Per `STARDUST-FEEDBACK.md F-015`, `direct`
authors the design **system**, not page-level deployments. Page-
specific composition decisions live in
`stardust/prototypes/<slug>-shape.md` written by `prototype`
Phase 1 — see `skills/prototype/reference/page-shape-brief.md`.

The boundary is **abstract role vs literal deployment**:

| In DESIGN.md / DESIGN.json (site system) | In `<slug>-shape.md` (page deployment) |
|---|---|
| Token vocabulary (colors, typography, spacing, radii) | Per-page section list and order |
| Voice rules ("Mixed-Case-Headlines"), anti-refs | Literal copy per section (sourced from current/pages/<slug>.json) |
| Anti-toolbox audit, divergence trace | Page-specific layout decisions ("hero is 5/3 split on home") |
| Abstract component vocabulary: `button-primary`, `button-secondary`, `card`, `input`, `badge`, `link` (default treatment, density, sizing — NO page-specific dimensions or content) | Section-level component dimensions (`the211Panel` at 320×260 with dock points per viewport) |
| Named system-component **roles** (a `header` exists, a `footer` exists, a `cta-band` pattern exists) | System-component **deployment** (literal tile labels in fixed order, link targets, copy variants) |
| Default visual treatment for each abstract component | Per-page composition (statRow with literal "100 YEARS · 18,400 PEOPLE HOUSED · …") |
| Voice samples (do/don't, tone exemplars) | Per-page interaction model and key states |

Concrete examples of items that **must not** appear in DESIGN.md /
DESIGN.json:

- Literal tile labels for any system-component pattern.
- Section-level pixel dimensions, dock points, breakpoint-specific
  widths.
- Stat numbers, addresses, quotes, named-person references.
- "On home, the hero is X" — that's a home-page deployment.
- Per-page copy variants ("on the donate page the CTA reads Y").

If a redesign demands a section-level dimension or a literal label
that feels site-wide ("every page has a 211 panel docked at the
bottom-right"), encode it as an **abstract role** in DESIGN.json
(e.g. `extensions.systemComponentRoles.persistent-help` with
purpose / position-class but no literal copy or dimensions) and let
each page's shape brief specify the deployment.

Token sources:

- **`colors`** — from the picked palette (palette-picker.md output)
  or the inherited palette with role-renaming. Role names must
  satisfy toolkit § 4 (brand-native, no `Primary` / `Secondary` /
  `Alarm` etc. as sole role names).
- **`typography`** — from the chosen font deck. Sizes scaled by the
  resolved expressive axis (drenched → ratio ≥ 1.333; committed →
  ratio 1.25; restrained → ratio 1.125-1.2). Heading vs body
  assignments inherit from the deck.
- **`rounded`** — derived from extracted brand-surface
  `borderRadius.primary` mode, unless the direction moves
  distinctiveness toward `singular` (in which case re-derive from the
  font deck's tonal cousins).
- **`spacing`** — 4pt base scale; `sectionPadding` propagated from
  the density tier stamped in Phase 1 (`reference/intent-dimensions.md`
  § 4):
  - `airy` → `sectionPadding.desktop: 96px`, `tablet: 72px`, `mobile: 48px`
  - `balanced` → `sectionPadding.desktop: 64px`, `tablet: 48px`, `mobile: 32px`  ← brand-register default
  - `packed` → `sectionPadding.desktop: 48px`, `tablet: 36px`, `mobile: 24px`  ← product-register default

  The agent does **not** re-ask the density question here — the tier
  was resolved in Phase 1 (asked once when the phrase didn't move
  the axis, defaulted to balanced for brand register if unanswered).
  Pick the value deterministically from the stamp.

  **Hard floor enforcement.** When the captured page inventory shows
  >5 sections OR >2 audience tracks (per
  `reference/intent-dimensions.md` § 4 → "Hard floor for
  brand-register multi-audience sites"), the resolved
  `sectionPadding.desktop` is bounded at ≤ 64px and ≥ 40px on every
  variant including the highest-divergence one. If Phase 1 stamped
  `airy` despite the trigger conditions firing, surface the conflict
  before writing tokens — *"density tier `airy` was selected but the
  captured inventory triggers the multi-audience hard floor; pick (a)
  override floor (`density: airy (user-pinned)` in direction.md) or
  (b) accept the floor (sectionPadding capped at 64px)."* Default to
  (b) when the user does not respond.
- **`components`** — 4-6 canonical components (`button-primary`,
  `button-secondary`, `card`, `input`, `badge`, `link`) populated
  from extracted brand-surface `componentStyle`, with values
  adjusted for direction movements.

Write `DESIGN.json` (schemaVersion 2) with:

- `extensions.colorMeta`, `typographyMeta`, `shadows`, `motion`,
  `breakpoints` — filled from the same sources as DESIGN.md.
- `extensions.divergence` — full audit trail per the v2 storage shape
  in `divergence-toolkit.md`. Includes the brand-faithful inversion
  log (per `reference/direction-format.md` § Divergence inputs)
  capturing pure-color or hex-format retentions.
- `extensions.componentStyle` — the **abstract** v1 fields
  (`buttons`, `cards`, `inputs`, `dualCTAPattern`). **Default**
  treatment per component, no per-page dimensions or literal copy.
- `extensions.systemComponentRoles` — the **abstract roles** for
  named cross-page patterns (e.g. `persistent-help`, `cta-band`,
  `header`, `footer`). Each role carries purpose, position class,
  and any site-wide constraint — **not** literal copy, dimensions,
  or per-viewport dock points (those are page-deployment, in
  `<slug>-shape.md`).
- `extensions.voice` — sampled DOs and DON'Ts derived from
  `_brand-extraction.json` voice samples + the resolved tone.
- `narrative.northStar`, `overview`, `keyCharacteristics`, `rules`,
  `dos`, `donts` — derived from the resolved direction. Toolkit § 7
  Optional House Standards land here in `narrative.rules[]`.

Every component HTML/CSS snippet in `components[]` must be
self-contained, use `ds-` class prefixes, and respect impeccable's
hard rules (OKLCH only, no pure black/white, no glassmorphism, no
side stripes, no gradient text, ≥ 1.25 type ratio for brand
register).

#### IA-priority preservation audit (Mode A)

After tokens are drafted but before they land in the variant DESIGN
files, run the IA-priority preservation audit per
`reference/intent-dimensions.md` § 8. For each captured signal that
fires a trigger condition (commercial conversion, search-led IA,
donation funnel, crisis affordance, audience routing), record an
`extensions.iaPriorities[]` entry in `DESIGN.json`:

```json
[
  {
    "signal": "crisis-affordance",
    "evidence": "pages/home.json#landmarks[hero] contains heading 'Looking for immediate shelter?' + phone 801-990-9999",
    "preserveAs": "first-viewport",
    "scope": "site-wide"
  }
]
```

Each entry is a constraint that downstream `prototype` and `migrate`
must honor — a variant whose home shape brief omits the crisis
affordance from the first viewport fails the audit and is rejected.
The audit is the structural enforcement of § 8; without it, IA-
priority preservation is a guideline rather than a contract.

#### Multi-variant DESIGN files (when N > 1)

When the user requested N variants (Phase 2.6 active), Phase 4
writes per-variant design files at the project root instead of a
single pair:

```
PRODUCT.md                  ← shared across variants (strategy doesn't change)
DESIGN-A.md / DESIGN-A.json ← variant A (faithful + improvements)
DESIGN-B.md / DESIGN-B.json ← variant B (one captured trait amplified)
DESIGN-C.md / DESIGN-C.json ← variant C (different captured trait amplified)
```

`PRODUCT.md` is shared because audience, register, and content
strategy are per-brand, not per-variant. Each variant's DESIGN
files inherit the shared `extensions.iaPriorities[]` audit from the
above step — variants cannot opt out of IA-priority preservation
within Mode A.

When the resolved mode is rebrand (`--rebrand` or rebrand-trigger
phrase), the multi-variant fork still writes per-variant DESIGN
files but PRODUCT.md may also vary — rebrand permits the strategy
to shift, not just the visual treatment.

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

Print a one-screen summary report and recommend the next step:

```
direction resolved
==================

Phrase:    "make it more expressive for a young audience"
Audience:  Gen Z college / first-job (resolved via Q1)
Register:  brand (inherited from current/PRODUCT.md)

Movements:
  expressive axis    restrained -> committed
  distinctiveness    familiar  -> distinctive
  tone               serious   -> playful
  density            (unchanged)
  audience           (resolved: Gen Z college / first-job)

Divergence:
  seed         1970s x Riso print x zine x monochrome-tint
  font deck    zine-maximalist
  palette      "Brutalist Dawn" (picked from library)

Wrote:
  PRODUCT.md, DESIGN.md, DESIGN.json
  stardust/direction.md

State:
  25 pages: extracted -> directed
  0 stale prototypes (none exist yet)

Next: $stardust prototype  (defaults to home page)
```

## Outputs

| Path                                  | Purpose                                            |
|---------------------------------------|----------------------------------------------------|
| `PRODUCT.md`                          | Target strategy (impeccable format). Shared across variants when N > 1 under Mode A. |
| `DESIGN.md`                           | Target visual system (Stitch frontmatter + 6 sections). Single-variant runs only. |
| `DESIGN.json`                         | Sidecar with extensions (divergence, componentStyle, voice, iaPriorities) and narrative. Single-variant runs only. |
| `DESIGN-{A,B,C,…}.md`                 | Per-variant DESIGN files when the user requested N > 1 variants (Phase 2.6 active). |
| `DESIGN-{A,B,C,…}.json`               | Per-variant DESIGN sidecars matching the .md files. |
| `stardust/prototypes/<slug>-improvements.md` | Improvements list (Mode A only, written in Phase 2.5). The load-bearing artifact for variant A. |
| `stardust/direction.md`               | Resolved direction + full reasoning trace + per-variant resolutions when N > 1. |
| `stardust/state.json`                 | Updated with direction + per-page status changes + `direction.variantMode` + `direction.variants[]` when N > 1. |

## Failure modes

- **No extracted state.** Abort and recommend `$stardust extract`.
- **Phrase too vague even after two questions.** Persist the partial
  reasoning to `stardust/direction.md` under a `# Pending` section,
  ask the user to refine further, do **not** write `PRODUCT.md` /
  `DESIGN.md` / `DESIGN.json` from incomplete reasoning.
- **Re-direct with prior approved or migrated pages.** Always confirm
  before stale-flagging. The flag is visible to the user and
  reversible (clearing happens automatically on successful re-run of
  prototype or migrate), but a re-direct invalidates work the user
  may have signed off on.
- **Anti-toolbox audit removes too many moves.** If the resolved
  direction collapses to defaults after the audit strips
  unjustifiable hits, surface this to the user and re-prompt for
  reference anchors before writing tokens.
- **(b) Insufficient brand signal for N variants.** When the
  captured brand surface has fewer than 3 distinct moves to
  amplify (e.g., monochrome palette, single type face, no
  distinctive motifs, or `signal-thin` per § Setup step 5), refuse
  to render N ≥ 3 variants under Mode A. Surface honestly:
  *"the captured surface has 2 distinct traits to amplify; producing
  3 variants would force one to invent moves not present in the
  brand."* Propose 1 or 2 variants and let the user choose, or
  recommend extract with a wider crawl. Better one strong variant
  than three weak ones.
- **(c) Hard rule conflict.** When Mode A is active *and* the
  user's phrase requires violating a Mode A pin (e.g., the user
  asks for *"a completely different palette"* while migration mode
  is active and `--rebrand` was not passed), stop. Name the
  conflict explicitly: *"You asked to keep the brand and to change
  the palette — those are not compatible. Did you mean (a) keep the
  current palette and only refresh execution, (b) rebrand
  (`--rebrand`) and roll a new palette, or (c) Mode A with a
  targeted palette move (single role recolored, rest pinned)?"*
  Wait for explicit answer.
- **(d) Empty improvements list.** When Phase 2.5 produces fewer
  than 3 weaknesses meeting the specificity bar, stop before
  rendering any variant. Variant A's brief depends on the list;
  without it, the *"better"* claim fails. Surface honestly:
  *"the captured site is already at a competent execution level on
  observable dimensions — variant A would reduce to spacing and
  contrast adjustments only."* Ask the user whether to (a) proceed
  with reduced scope (density + contrast only), (b) extract
  additional pages (`extract --cap 25` or higher) to surface more
  weaknesses, or (c) pivot to rebrand mode (`--rebrand`) where the
  brand-fidelity floor doesn't apply.

## Prep mode (--prep)

When invoked with `--prep`, direct runs an extended pass that
finalizes the inventory data structures migrate consumes.
Discovery-mode runs are unchanged: intent reasoning, divergence-
toolkit resolution, target-spec authoring.

`--prep` adds five things on top of the standard procedure:

### 1. Type catalog confirmation

Surface the page-type catalog inferred by `extract --prep` (in
`state.json.pages[].type`). Show counts per type and a sample of
slugs per type:

```
Page types from extract:
  landing  1   (home)
  article  84  (news/post-2026-04-15-housing-summit, news/post-2026-04-08-..., ...)
  listing  6   (news, programs, events, ...)
  program  12  (programs/shelter, programs/case-management, ...)
  form     3   (donate, contact, volunteer)
  static   18  (about, team, financials, ...)
  unique   3   (404, search, faq)

Confirm catalog (yes / refine "<phrase>")?
```

User can confirm or refine. Refinements: rename a type, split a
type into finer-grained ones (e.g., `article-feature` vs.
`article-press`), merge two types, mark specific pages as
`unique`. Updates land in `state.json.pages[].type`.

### 2. Module catalog finalization

Surface the module candidates proposed by `extract --prep`
(`DESIGN.json.extensions.modules[]` with `status: candidate`).
For each candidate:

```
hotline-211 (5 instances)
  Slot candidates: phone, hours, headline, cta-label
  Found in: home, get-help, donate, news, programs

  Confirm? (name "<id>" / promote / prune / refine slots)
```

User actions per candidate:

- **Confirm.** Promote `status: candidate → confirmed`. Module
  ID, slots, defaults are accepted as-is.
- **Rename.** Change the auto-generated ID to a brand-native name.
- **Prune.** Remove from the catalog (the candidate was a
  spurious match; instances will render as inline content).
- **Refine slots.** Mark slots required, set defaults, add or
  remove slots, adjust types.

Confirmed modules become the catalog migrate consumes.

### 3. Color reservations

If the resolved direction reserves any color to a specific
module/lockup (e.g., centennial-red `#DC323D` reserved to the
`trh-100-lockup` module), capture in
`DESIGN.json.extensions.colorReservations[]`:

```json
[
  { "color": "#DC323D", "reservedFor": ["module:trh-100-lockup"] }
]
```

Migrate validates that reserved colors appear only in their
declared contexts; violations refuse the page.

### 4. Wider direction re-evaluation

Discovery mode resolved direction against a 5-page sample. Prep
mode has the full inventory. Re-read the broader content surface
and check:

- Does the resolved register still hold? (e.g., did discovery
  miss a service-led section that pulls toward a different
  register?)
- Are there new tensions surfaced by the wider crawl that affect
  direction?
- Do any anti-references need updating?

If the re-evaluation surfaces a meaningful divergence from the
discovery-mode direction, surface to the user. If the user wants
to re-direct, they run `$stardust direct --re-direct` separately;
the prep run itself is non-destructive.

### 5. Site-level metadata defaults

Capture brand-level metadata defaults in
`DESIGN.json.extensions.metadata`:

- `siteName` — brand name (typically from `<title>` patterns or
  `og:site_name`)
- `defaultOgImage` — default OG image when a page doesn't have
  its own
- `themeColor` — typically already in DESIGN.md
- `organization` — `Organization` JSON-LD entry (name, url,
  logo, sameAs)
- `locale` — default locale

These are composed with per-page metadata at migrate time. See
`skills/migrate/reference/metadata-and-jsonld.md` for the
composition rules.

### Prep summary

```
direct --prep complete
======================

Type catalog:        confirmed (7 types, 127 pages)
Module catalog:      confirmed (8 modules, slot vocabularies set)
Color reservations:  1 (#DC323D reserved to trh-100-lockup)
Brand metadata:      set (siteName, defaultOgImage, themeColor, organization, locale)
Direction:           no change (wider crawl confirmed)

Next: $stardust prototype --prep  (fill template gaps, write canon)
```

Default mode is unchanged.

## References

- `skills/stardust/reference/intent-dimensions.md` — the 8 axes
  (the 7 axes plus § 8 IA-priority preservation, the Mode A
  constraint that fires on captured commercial-conversion / crisis /
  audience-routing signals).
- `skills/stardust/reference/intent-reasoning.md` — the procedure.
- `skills/stardust/reference/intent-examples.md` — worked examples.
- `skills/stardust/reference/impeccable-command-map.md` — when to
  reach for each impeccable command (used when building the plan).
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

## Default-mode-flip note (2026-04-29)

This skill changed its default behavior in 2026-04-29 to make Mode A
(brand-faithful) the default whenever the captured brand surface is
`signal-strong`, rather than activating only on explicit user
signals. The full rationale and prior-state migration notes live in
`notes/brand-faithful-default-2026-04-29.md`. Behavior summary:

- Before: ambiguous phrases like *"make it more modern"* rolled the
  full divergence seed and produced rebrand-shaped output.
- After: ambiguous phrases default to Mode A; rebrand requires
  explicit phrase signal or `--rebrand` flag.

The flip was driven by dogfood evidence that the typical stardust
use case (presales refresh of an existing site for a brand owner
with design fatigue) was getting the wrong default.
