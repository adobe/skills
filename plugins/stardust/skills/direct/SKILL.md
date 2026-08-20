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

**Hands-off mode** (per `skills/stardust/SKILL.md` § Hands-off mode,
`state.json.handsOff: true`): ask nothing and wait for nothing.
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

Phase 4 reads the stamped tier to set `spacing.sectionPadding`;
it never re-asks.

#### IA-fidelity tuning (one-shot, only when unmoved)

When the user's phrase does **not** auto-pin `ia-fidelity` (per
`reference/intent-dimensions.md` § 9 — i.e. none of *"verbatim"*,
*"same IA"*, *"keep the structure"*, *"swap the surface"*,
*"don't rethink the IA"* and none of *"reimagine"*, *"rethink"*,
*"deeper redesign"*, *"what if"* appear), ask one short follow-up
— count it within the two-question ceiling:

> IA fidelity — (a) verbatim (same section sequence, same content
> beats; variants explore surface only: color, type, density,
> motion), or (b) reimagined (variants may demote / promote / drop
> sections, move IA priorities, take "what if" positions on the
> spine of the page).
> Default (b) for the typical refresh; pick (a) when the customer
> asked to keep their site structurally identical and only swap
> the surface.

If the user answers, stamp the chosen tier in `direction.md` §
Movements as `ia-fidelity: <tier>`. If unanswered, default to
**reimagined** and stamp `ia-fidelity: reimagined (default)`.

Skip this question entirely when:
- The user's phrase already auto-pinned the axis (any trigger phrase
  in § 9 — *"same IA, swap the surface"* → verbatim;
  *"what if we rethought the home page"* → reimagined).
- An existing `direction.md` is being refined (the active tier holds
  unless the user explicitly re-pins).

Phase 4 stamps the tier into `iaPriorities[].mutability`;
downstream `prototype` reads it.

Pair this question with the density-tuning question when both are
unmoved — *"two things to pin before we resolve: (1) density …, (2)
IA fidelity …"* — to stay within the two-question ceiling. If
resolving register (brand vs product) is also outstanding, prioritise
register first; defer one of density / ia-fidelity to the next turn.

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
freeform phrase alone. Ambiguous refresh phrases ("make it modern",
"stunning new version", "design fatigue cure") are migration-shaped
asks, not rebrand triggers. The precedence is asymmetric on purpose:
the safer mode (Mode A — brand-faithful) catches ambiguous phrases;
the riskier rebrand mode requires the user to name it.

1. **Site migration / refresh — DEFAULT.** When the captured brand
   signal stamped in § Setup step 6 is `signal-strong`, Mode A is
   active by default. The user's phrase moves *expressive*,
   *distinctiveness*, *tone*, and *density* axes inside Mode A — but
   palette and type are pinned to the captured surface, and the
   image-reuse contract (below) holds. **Signature preservation also
   holds:** a captured signature hero medium (background video /
   canvas / Lottie / scroll-motion, elevated as
   `_brand-extraction.json#voice.heroMedium`) or a site-wide motif is
   reproduced, not flattened — per `skills/stardust/reference/
   intent-dimensions.md` § 8b, and exempt from the `surprise` budget.
   Surface in the plan:
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
   active, the variant role contract in `reference/multi-variant.md`
   applies (trigger: § Phase 2.6). Variant A is locked to **strict Mode A** (palette and
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
dimensions of the seed — they are already locked.

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

   This is part of brand-faithful inheritance: swapping a captured
   portrait for a placeholder, or demoting the hero photo to a
   thumbnail, erases the brand's most load-bearing trust signal.

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

The user can correct the mode at the plan-confirmation gate (e.g.
"actually let me move the palette" or "actually rebrand it")
before it locks.

#### Mode A+ — Brand-adjacent refinement (bounded, evidence-gated)

The middle tier between Mode A's hard pins and `--rebrand`: when
the improvements list (Phase 2.5) names a captured type or color
weakness with evidence, bounded same-classification upgrades are
permitted — each audited in `extensions.divergence.
brand_adjacent_refinements[]`, never active by default. Read
`reference/mode-a-plus.md` before applying any refinement.

#### Mode B — Anchor-reference precedence

When the user provides anchor references (Q1/Q2 answers like
"Pentagram nonprofits, This American Life, NYT Opinion longform"),
those references **already imply** seed dimensions (Pentagram →
decade `2025-now` editorial; This American Life → register
`Memoir`-adjacent). Do not roll dimensions the references already
imply.

**Agent-sourced anchors (default when the user provides none).**
Mode B no longer waits for the user to name references: run the
reference-research procedure
(`skills/stardust/reference/reference-research.md`) to source 3–5
real-world anchors matched to the brand's category, register, and the
resolved direction movement. Researched anchors carry the same
implied-dimension weight as user-provided ones and are recorded as
`picked_by: "reasoned: <anchor>"` with the full citation in
`extensions.divergence.references_used[]`. User-provided references
always outrank researched ones on conflict. When research is
unavailable (ladder exhausted per reference-research.md § 1), Mode B
degrades to the deterministic roll for the un-implied dimensions.

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

When neither Mode A nor Mode B applies (rebrand or thin-signal runs
with no user anchors), the procedure is **research-first, roll as
fallback**:

- **Reference research first.** Run
  `skills/stardust/reference/reference-research.md` to source
  anchors for the brand's category and the resolved direction, and
  derive the dimensions they imply (`picked_by: "reasoned: <basis>"`).
  This is Mode B's machinery applied to agent-sourced anchors — see
  § Mode B above.
- **Seed as fallback + tiebreaker.** Roll the 4-dimension seed
  (decade × craft × register × ground-family) per § 2 of the toolkit
  **only** for dimensions research left un-implied, or entirely when
  research is unavailable. The roll also remains available as a
  deliberate convergence-breaker when the self-audit catches the
  model reproducing its defaults despite research. Record
  `picked_by` per dimension.
- **Font deck.** Pick from the 10 named decks per § 3, letting the
  researched anchors inform the pick the same way a seed implication
  would (e.g. an editorial-serif anchor set → `serif-luxury`). When
  neither research nor seed implies a deck, pick deterministically
  from the hash.
- **Palette.** If the resolved direction moves the color-energy
  axis or names the existing palette as part of the problem: derive
  a full role-ramped palette (text, grounds, borders, accents,
  states) from the primary researched anchor or a library candidate
  — the library (`skills/direct/reference/palette-picker.md`) is an
  **anchor bank**, not a closed menu; the model designs the ramp and
  validates every text-on-ground pair for WCAG AA before it lands
  in tokens (deterministic where it matters — math — not where it
  hurts — taste). Record the derivation basis in
  `extensions.divergence.palette_source`. Otherwise inherit
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
weaknesses** observed in the captured site. It is the brief variant
A renders against: **not** prescriptive (no visual targets), but
**descriptive of the gap** between the existing site and a competent
2026 execution of the same brand. Variants B+ honor the list as a
floor (they may go further but not contradict it).

Skip this phase when the resolved mode is rebrand — the improvements
list assumes brand-faithful inheritance, and a rebrand replaces the
site rather than fixing it.

**Audit reuse.** When `stardust/audit/<domain-slug>/audit.json`
exists for this origin (written by `stardust:audit`), consume its
design findings as candidate improvements instead of re-deriving from
scratch — carry the finding IDs into each item's evidence citation.
The specificity bar below still applies to every carried item.

#### What goes in the list

The list draws from five categories. Items should be specific enough
that a downstream `prototype` shape brief can cite them by number.

1. **Dated patterns** the design world has moved past — name the
   pattern and its era, not a feeling.
2. **Cluttered IA** — unclear hierarchy, weak or redundant CTAs,
   fragmented conversion funnels.
3. **Contrast failures, accessibility gaps, density issues** — pull
   from `brand-review.html` Tensions when present
   (`T-color-imbalance`, `T-img-alt-empty`, etc.).
4. **Cliché conventions** the brand could move past while staying
   recognisably itself.
5. **Missed opportunities** the existing site doesn't capitalise on.

Worked examples per category:
`reference/improvements-list.md`.

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
weakness statement, and a one-line fix. Full worked example in
`reference/improvements-list.md` § Format example.

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

**Site-level only.** `direct` authors the design **system**, not
page-level deployments. Page-specific composition decisions live
in `stardust/prototypes/<slug>-shape.md` written by `prototype`
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
  `breakpoints` — filled from the same sources as DESIGN.md. The
  `motion` block carries the **register selection** (when
  cinematic motion may be applied at prototype time):

  ```json
  "motion": {
    "register": "arrival | kinetic-display | live-systems | editorial | kinetic-grid",
    "registerRationale": "<one-line citation back to PRODUCT.md Brand Personality trait that selected this register>",
    "easings":   { "entrance": "...", "transition": "...", "expo": "..." },
    "durations": { "enter": <ms>, "stagger": <ms> },
    "parallax":  { "translate": <vh>, "fade": <0-1>, "rangeStart": <%>, "range": <%> }
  }
  ```

  Picked per the **register selection heuristic** in
  `skills/prototype/reference/motion-registers.md` § Selection
  heuristic, reading the resolved `PRODUCT.md` § Brand Personality:

  | Personality traits (any match)                                            | Register          |
  |---------------------------------------------------------------------------|-------------------|
  | `civic-formal` + (`institutional` OR `place-led`)                         | `arrival`         |
  | `signage-led` OR `wayfinding-first` OR `display-typography-signature`     | `kinetic-display` |
  | `operationally-transparent` OR `data-led` OR `dashboard-register`         | `live-systems`    |
  | `editorial` OR `slow-paced` OR `publication-register`                     | `editorial`       |
  | `product` OR `SaaS` OR `transactional` OR `modular-catalogue`             | `kinetic-grid`    |
  | (ambiguous / no clear match)                                              | `arrival`         |

  Token defaults per register are sourced from
  `skills/prototype/reference/motion-registers.md` § The five
  registers; `direct` copies them verbatim into the `motion`
  block unless the user has provided overrides during intent
  reasoning. The `registerRationale` field records the one-line
  justification so reviewers can audit the choice. **`direct`
  does not apply the motion** — that happens at prototype time
  under `--cinematic`. `direct` only **selects** the register.
  Pages whose redesign does not need motion can leave
  `register` absent; cinematic prototype will then either ask or
  pick from the heuristic at render time.

  **Per-variant placement (when N > 1 variants).** The `motion`
  block goes into the variant-specific `DESIGN-<id>.json` files,
  not site-level `DESIGN.json` — variants without a `register`
  render static. See `reference/multi-variant.md` § Per-variant
  motion placement.

  When the user's intent phrase contains explicit motion direction
  ("make it cinematic", "feel alive", "move like signage"),
  `direct` picks the register and notes the source in
  `registerRationale` as `"user-phrase: <verbatim>"`.
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
    "scope": "site-wide",
    "mutability": "movable"
  }
]
```

Each entry is a constraint that downstream `prototype` and `migrate`
must honor — a variant whose home shape brief omits the crisis
affordance from the first viewport fails the audit and is rejected.
The audit is the structural enforcement of § 8; without it, IA-
priority preservation is a guideline rather than a contract.

The `mutability` field reflects the `ia-fidelity` stamp from Phase 1
(per `reference/intent-dimensions.md` § 9): `locked` under verbatim
(variants may not move the priority at all — A1/A2/A3 are surface
forks), `movable` under reimagined (variants may demote / promote /
re-shape the priority's deployment, but the § 8 floor still fires).
The field is stamped once at Phase 4 and is the source of truth
prototype reads.

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
- **(b) Insufficient brand signal for N variants.** Fewer than 3
  distinct amplifiable traits in the captured surface (or
  `signal-thin`) → refuse N ≥ 3 under Mode A and propose 1–2
  variants instead; full contract in `reference/multi-variant.md`
  § Failure mode.
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