# stardust:prototype: phase 1, plan the prototype

The text of this part of `skills/prototype/SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

### Phase 1 — Plan the prototype (page-shape brief)

For each page in scope:

1. Read `stardust/current/pages/<slug>.json` for the page's structure
   and content.
2. Read `stardust/current/_brand-extraction.json` for system
   components and cross-promo data (the page's site-wide repeated
   surfaces).
3. Read `stardust/direction.md` Active section for the resolved
   direction, divergence inputs, and command sequence.
4. Read project-root `DESIGN.md` + `DESIGN.json` for the target
   site system — tokens, abstract component vocabulary, named
   system-component roles. The site system tells the agent *what
   the design language is*; this Phase decides *how it deploys to
   this specific page*.
5. **Author `stardust/prototypes/<slug>-shape.md`** — the per-page
   compositional brief. Format spec:
   `reference/page-shape-brief.md`. The brief carries the section
   list, layout strategy, key states, interaction model, structural
   data attributes, and the unsourced-content list (bridge to the
placeholder contract). Author directly — no interview, no
   impeccable invocation; this is stardust's reasoning about how
   the system deploys to this page given this content.
6. Show the brief to the user and wait for confirmation before
   moving to Phase 2. The user can edit the brief in place
   (rearrange sections, kill open questions, change composition
   decisions); re-rendering Phase 2 will rebuild the proposed file
   from the edited brief.

   **Hands-off compliance.** When `state.json.handsOff` is true,
   the shape brief is still authored and validated but the
   user-confirmation wait is skipped — the brief is its own record.
   Approval (Phase 5) under hands-off follows the mode's contract
   defined in `skills/stardust/SKILL.md` § Hands-off mode.

`$impeccable shape` is **not** invoked in v0.2 (see
`reference/page-shape-brief.md` § Authoring procedure for the
rationale; revisit if per-page hand-authoring proves insufficient
across sites).

The brief decouples site-level concerns (in DESIGN.md) from
page-level deployment (per-page brief). A direction change
invalidates the system; existing briefs are content-aware-stale
only when the system change makes their composition impossible.
This recalibration of stale-flagging is documented in
`skills/stardust/reference/state-machine.md` § Stale flagging.

#### Brief-time disciplines (validator-enforced)

Five disciplines fire when the brief is authored. The brief
validator rejects briefs missing any of them; failure surfaces the
specific rule violated and stops Phase 1 before Phase 2 renders
anything. The disciplines exist to prevent the AI-slop failure mode
where a brief with only `(DESIGN tokens) + (captured content)` as
input produces template-shaped output regardless of brand.

**Discipline 1 — Captured-source lineage per section.** Every
section in `## Sections` declares its captured-source origin. Forms:

- *"subscription-card-on-bay (consolidates captured banner 2 +
  dual-card right of `pages/home.json#landmarks[hero]`)"* — derived
  from one or more captured surfaces
- *"site-wide system-component (carried from `_brand-extraction.json
  #systemComponents[kind=footer]`)"* — chrome inherited from the
  brand-surface
- *"direction-authorized new"* — composed against direction.md, not
  derived from a captured source (require a one-line note naming
  which direction movement justifies the new section)

Sections without lineage are rejected. The lineage list lives in
`_provenance.capturedSourceLineage` in the brief and propagates to
the rendered file.

**Discipline 2 — Anti-template pass.** For each captured component
pattern the page deploys (cards / banners / search rows / CTA bands
/ hero composition), the brief considers 2–3 layout alternatives
and picks the most differentiated. Curated default-patterns-to-escape
flags reflex picks:

- hero-then-bands silhouette (the universal AI silhouette)
- 5-up image-card grid as category nav
- nav-icon glyphs (search / cart / account) in a typographic
  register
- centered-stack hero with two-button CTA pair
- captured-shape mirror-translated into new tokens

The brief justifies any reach for a default-pattern with a
captured-source citation that makes the pattern brand-appropriate
(e.g., *"5-up grid preserved because the captured site's grid IS
the brand's signature catalogue shape; the alternative consideration
was a vertical ledger which the brand register rejects"*).

The alternatives SHOULD be reference-grounded when reference
research is available (per
`skills/stardust/reference/reference-research.md`): an alternative
cites a real reference screen in the entry's `reference?` field
using that file's evidence shape. Taste-only alternatives remain
valid when research is unavailable.

The audit lives in `_provenance.antiTemplatePass[]` with one entry
per captured pattern: `{ pattern, defaultReflex, alternatives[],
picked, rationale, reference? }`.

**Discipline 3 — Surprise budget.** The brief declares a `surprise`
field with one of: `low | medium | high`. Moves come from the bank
of non-template moves — see
`skills/stardust/reference/divergence-toolkit.md` § Non-template
move bank, with worked examples in
`reference/anti-template-bank.md` — or an evidence-shaped extension
per the bank's § Extension rule. Tier semantics:

- `low` — brand-faithful + improvements only. Variant A's role
  under reimagined; all of A1/A2/A3 under verbatim.
- `medium` (default for B variants under reimagined) — one captured
  cliché replaced by one move from the bank.
- `high` (default for C variants under reimagined) — two clichés
  replaced + one document-shape substitution.

Under `ia-fidelity: verbatim` (per
`skills/stardust/reference/intent-dimensions.md` § 9), the per-page
surprise budget is **capped at `low` site-wide**. The validator
refuses any verbatim-direction brief with `surprise: medium` or
`high`.

**`low` ≠ generic.** The budget bounds *added* divergence, not craft
or fidelity. `low` means **brand-faithful + improvements + full
signature preservation**, NOT "the most obvious faithful
interpretation." The recurring failure mode (a fintech migration)
is the agent reading `low` / `verbatim` as license to strip the page
to a plain type-hero on a flat ground — the result is faithful but
forgettable and under-sells the redesign. Hold the craft bar at `low`:
keep the brand's distinctive elements, apply the improvements list,
and reproduce the signature.

**Signature preservation is mandatory and budget-exempt.** When the
captured page has a signature hero medium (background video / canvas /
WebGL / Lottie), signature motion (scroll / parallax / kinetic), or a
signature visual motif (per `intent-dimensions.md` § 8b), the brief
**must** reproduce it — with a static fallback, `prefers-reduced-
motion` alternative, and (for overlaid text) a legibility scrim. This
does **not** consume the `low` allowance: carrying the brand's own
signature forward is fidelity, not divergence (§ 8b § Surprise-budget
exemption). Record the kept signatures in
`_provenance.signatureElements[]` as `{ kind, capturedSource,
mechanism, fallback }`. **Render-refusal:** a brief that flattens a
captured video/canvas/animation hero to a still, gradient, or
type-only hero — or drops a site-wide motif — is rejected at the
shape-brief audit; reproduce the signature instead.

**Type-scale yield clause.** When a tier-`medium`-or-higher variant's
captured-trait amplification structurally conflicts with a
brand-level type-scale rule from `DESIGN.md` (e.g. a
"Names-At-Headline-Scale" rule, or any other named type-scale
floor / ceiling), the brand-level rule may yield per-page. The
yield must be cited in `_provenance.surpriseTier_typeScaleYields[]`
with: `{ rule, variantDominantDimension, capturedTraitAmplified,
yieldedTo, rationale }`. The brand-level yield clause itself
(the named exception in `DESIGN.md`) is project-side, not
spec-side; the spec only requires the per-page citation when the
yield fires. See § Friction carve-out #4 below.

**Discipline 4 — Substrate transitions are deliberate, named, and
rare.** Default: single substrate across the page. Each substrate
exception requires a named purpose in the brief (*"highlights the
featured-coffee promotional moment"*). **More than two substrate
transitions per page fails the brief.** The transitions live in
`_provenance.substrateTransitions` as `{ default, exceptions[] }`.

**Exception — substrate-keyed document-shapes (friction carve-out
#2).** When the variant's `surprise: high` move is a
substrate-keyed document-shape (zine, catalog-card,
poster-sequence), the per-section substrate IS the document-shape's
structural rhythm. The ≤ 2-transition cap does not apply; each
section's substrate must instead carry a **per-section
captured-source citation** (typically a per-SKU label color, a
per-page brand color, or a per-content-type ground convention from
the captured site). The exception is recorded in
`_provenance.substrateTransitions.note` with the document-shape
named and the citation source. The validator accepts > 2 transitions
when:

1. `surprise: high` is declared, AND
2. the picked move from the bank is `document-shape` with a
   substrate-keyed sub-kind (zine / catalog-card / poster-sequence),
   AND
3. every transition in `exceptions[]` carries a per-section
   captured-source citation.

If any of the three conditions fails, the cap re-engages.

**Discipline 5 — Heading hierarchy + voice classification tracked
per section.** The brief requires:

- H1 declared once per page; subsequent sections H2; H3 children.
- Every literal value in copy classified as one of:
  `captured-verbatim`, `direction-authorized rewrite`, or
  `placeholder`. No section ships with copy without a classification.

The classification list lives in `_provenance.voiceClassification[]`
as `{ section, classification, copy?, source? }` and propagates to
the rendered file.

**Placeholder-ribbon labels (friction carve-out #3).** System-
component honesty-signal labels (placeholder ribbons, "TBD" badges,
"from the brand team at migrate" markers) are **direction-authorized
chrome**, not placeholder content. They label placeholder prose /
data; the prose / data is what gets enumerated in
`_provenance.unsourcedContent[]`. The ribbon text itself does not.
Classify the ribbon labels as
`direction-authorized chrome (per friction #3)` so the placeholder
enumerator stays clean (no double-counting across every component
instance).
