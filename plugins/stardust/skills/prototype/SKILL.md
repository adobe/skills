---
name: prototype
description: Render a proposed redesign of a page on the current website as a self-contained static HTML file, then iterate via the impeccable craft loop. Per-page, idempotent, stale-aware. Use when the user asks for a redesign prototype, a before/after comparison, a design preview, a page mockup, a visual diff of the redesign, or invokes /stardust:prototype.
license: Apache-2.0
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

`prototype` does **not** author `<slug>-proposed.html` directly. The
heavy creative lift is delegated to `$impeccable craft`, and (when
needed) the structural plan to `$impeccable shape`. Spelling out the
mechanic matters because the carve-out documented in
`skills/stardust/reference/artifact-map.md` (where stardust authors
`PRODUCT.md`, `DESIGN.md`, `DESIGN.json`, `current/PRODUCT.md`,
`current/DESIGN.md` directly, treating impeccable's references as
*format specs*, not runtime commands) is **load-bearing for those
five files only**. It does NOT extend to:

- `stardust/prototypes/<slug>-proposed.html` — must be authored by
  `$impeccable craft`, not by stardust direct authoring.
- Iteration on the proposed file — must be driven through a
  chat-driven invocation of an explicit impeccable command (per
  the iteration paths section).
- Structural planning when a page is complex enough to need it —
  `$impeccable shape`.

The proximate cause of past content fabrication was the agent
over-generalizing the direct-authoring carve-out to the proposed
HTML. Don't.

### Invoking impeccable

When stardust runs in a Claude Code skill context (impeccable
exposed as the `impeccable:impeccable` Skill, not as a CLI), invoke
impeccable via the Skill tool with the sub-command and its args
mirroring the slash-command form:

```
Skill {
  skill: "impeccable:impeccable",
  args: "craft <feature-description>"
}
```

Sub-commands referenced from this skill are all routed through the
same Skill: `craft`, `shape`, plus the iteration commands
(`bolder`, `quieter`, `distill`, `polish`, `colorize`, `typeset`,
`layout`, `adapt`, `animate`, `delight`, `overdrive`, `impeccable`).

When impeccable is **not** available (CLI-only environments,
plugin uninstalled, sandbox without skill access), stop and tell
the user impeccable is required for prototype rendering. Recommend
installing the impeccable plugin. Do not fall back to direct
authoring of `<slug>-proposed.html` — the validation contract
craft enforces (anti-toolbox audit, divergence rules, type ratios,
content sourcing hierarchy) is not reproducible by direct
authoring, and falling back silently ships unverified output.

Stardust's job inside Phase 2 is therefore:

- Compose the inputs craft needs (page content from
  `current/pages/<slug>.json`, target spec from `DESIGN.md` /
  `DESIGN.json`, hard constraints from `direction.md`, content
  sourcing rules from `reference/proposed-file-shell.md` § Content
  sourcing hierarchy).
- Invoke craft via the Skill tool.
- Validate the result against the contract (`:root` block, data
  attributes, divergence audit, impeccable hard rules, content
  sourcing). If validation fails, refuse to write — never paper over
  craft output the agent thinks is "close enough."

The proposed file is whatever craft writes plus the validation
report; it is not stardust's authored artifact.

## Procedure

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

The audit lives in `_provenance.antiTemplatePass[]` with one entry
per captured pattern: `{ pattern, defaultReflex, alternatives[],
picked, rationale }`.

**Discipline 3 — Surprise budget.** The brief declares a `surprise`
field with one of: `low | medium | high`. The bank of non-template
moves is closed — see
`skills/stardust/reference/divergence-toolkit.md` § Non-template
move bank, with worked examples in
`reference/anti-template-bank.md`. Tier semantics:

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

### Phase 2 — Render the proposed page

Render `stardust/prototypes/<slug>-proposed.html` per
`reference/proposed-file-shell.md` § Required structure. Hard
requirements there:

- `:root` token block as the first content of the first `<style>`
  (per `skills/stardust/reference/token-contract.md`).
- Structural data attributes on every section (per
  `skills/stardust/reference/data-attributes.md`).
- Provenance block as the first child of `<head>`.
- Self-contained: no external CSS, no external JS.
- Content preserved from the current page (hero copy, CTAs, nav,
  body) unless `direction.md` authorises content changes.
- **Content sourcing hierarchy** (`reference/proposed-file-shell.md`
  § Content sourcing hierarchy): every literal value rendered must
  come from `current/pages/<slug>.json`, then voice samples, then
  direction-authorised changes — or be rendered with the mandatory
  PLACEHOLDER visual signature. Stats, addresses, quotes, tax IDs,
  hours, prices, named-person words must never be invented. The
  proposed file's `_provenance.unsourcedContent[]` lists every
  placeholder so migrate can refuse to ship unverified content.

Delegate the heavy creative lift to `$impeccable craft`:

- Pass the page content and the resolved direction as the feature
  description.
- Reference DESIGN.md / DESIGN.json as the design system.
- Pass `direction.md` § Anti-references and § Divergence inputs as
  hard constraints (so craft does not silently veer off the resolved
  direction).
- Skip craft's "north star mock" generation step (direction.md is the
  brief). Skip craft's "shape" call (already done if Phase 1 needed
  it).

After craft returns, validate the output:

- `:root` block present and complete (token-contract.md).
- Data attributes on every section (data-attributes.md).
- Anti-toolbox audit clean (each hit justified per divergence-toolkit.md
  § 1; record audit results in `DESIGN.json.extensions.divergence.anti_toolbox_hits`
  with the audit's amendments noted).
- Impeccable hard rules respected (OKLCH, type ratio ≥ 1.25, no
  reflex slop).
- **Content sourcing scan** — every literal value in the rendered
  output traces to one of the allowed sources
  (`reference/proposed-file-shell.md` § Content sourcing hierarchy).
  Any value that doesn't is either wrapped in a `[data-placeholder]`
  element with the mandatory visual signature, or the validation
  fails. Build the `_provenance.unsourcedContent[]` list during
  this scan.

If validation fails, do not write the file. Surface the failure to
the user with the specific rule violated and a suggested fix.

#### Craft-time disciplines (pre-write validators)

Three disciplines fire on the rendered file *before* it lands on
disk. These run after craft returns its output and before the file
is written; failure refuses the write with a substitute proposal
(Discipline 6) or a rule citation (7, 8).

**Discipline 6 — Reflex-reject font pre-flight.** Grep the
declared `font-family` declarations against the reject list in
`skills/stardust/reference/divergence-toolkit.md` § Reflex-reject
fonts. If `≥ 3` reject-list families hit, refuse to write and
propose dimensionally-equivalent off-list substitutes from the
substitute table.

The check fires only on rendered files whose `font-family`
declarations the agent had freedom to pick. **Mode A renders with
captured display + body families pinned (per
`direct/SKILL.md` § Mode A — Brand-faithful mode) bypass the
check** — the inherited families are not a reflex choice. Record
the bypass reason in `_provenance.reflexRejectAudit.bypassed` with
the captured families named.

**Discipline 7 — Variable-font axis engagement.** When the resolved
direction's `expressive` or `distinctiveness` axes have moved past
their default (per
`skills/stardust/reference/intent-dimensions.md` §§ 2 + 5), engage
≥ 1 variable-font axis non-trivially per page using deck recipes
from the divergence toolkit. The toolkit's font decks expose named
axis recipes:

- `serif-luxury` deck → Fraunces axis recipe: `opsz 144, SOFT 100, WONK 1`
- `bauhaus-functional` deck → Bricolage axis recipe: `opsz 96, wght 600`
- `tactile-humanist` deck → Recursive axis recipe: `MONO 1, CRSV 0, CASL 0.5`

Static-weight static-style across all type on a page that claims
expressive or distinctive movement fails the check.

**Static-only-family precedence (friction carve-out #1).** Family
substitution rules when the captured/pinned display font does not
ship a variable axis:

1. If the captured/pinned display font is variable, engage its
   axes per deck recipes (standard path).
2. If the captured display font is **static-only by family**
   (Bellfort, GT Sectra static, hand-lettered custom cuts whose
   `woff2` files don't expose a parseable `fvar` table without
   runtime inspection), **exempt the display family** from the
   check and engage the **body family's axes** instead (typically
   `wght` and `ital` on a workhorse like Public Sans or Hanken
   Grotesk).
3. **Document** the family's static-only status in
   `DESIGN.json.extensions.divergence.font_deck.notes` so downstream
   pages don't re-run the check.

A pre-flight that blindly grep'd for `font-variation-settings`
would fire on every brand-faithful render of a static-only-display
brand. The exemption keeps the spirit of the discipline (engage
variable behavior where it exists) while honoring the letter when
the captured family literally has no axes to engage.

Off-deck accent fonts must ship with named **expressive positions**
(`marginal-tag`, `pointer-scribble`, `headline-callout`,
`badge-fill` — see toolkit § Font deck — expressive positions).
A face introduced without a position is a reflex pick, not an
expressive position.

**Discipline 8 — Fidelity tier (`--fidelity=quick|refined|production`).**

- `quick` (default) — sketch fidelity. Brief decisions land;
  micro-decisions stay provisional.
- `refined` — adds a craft micro-pass per
  `reference/fidelity-refined-pass.md`: formal type scale as CSS
  custom properties, `font-variant-numeric: tabular-nums` on inline
  digits, `text-wrap: balance` on headings + `text-wrap: pretty`
  on body + `hanging-punctuation: first` on `html`, sliding
  left-rule on nav hover, hairline hover on list items,
  kicker + title + baseline-aligned more-link section-head triplet,
  italic display couplet replacing structurally-vague `<b>`,
  bottom-of-sidebar reworked as typographic plate.
- `production` — `refined` + WCAG AA audit on every render + harden
  pass (loading states, error states, content-overflow edges).

The tier is declared in the run invocation; persisted in
`_provenance.fidelity`. Default is `quick`.

### Phases 2.5 – 2.7 — Quality gates: Critique → Audit → Adapt (Discipline 9)

Three mandatory gate phases run by default before any prototype
can advance to `prototyped`. They implement Discipline 9: critique
covers *design*, audit covers *technical correctness*, adapt
covers *viewport behaviour*. P0/P1 findings from **any** of the
three block `prototyped` until acknowledged. None of the three
have an opt-out flag (per § No opt-outs).

| Sub-phase | Focus | Catches |
|---|---|---|
| **2.5 Critique** | Design judgment | AI-slop reflexes, hierarchy regressions, contrast / cognitive issues, register drift |
| **2.6 Audit** | Technical correctness | a11y (alt, focus, contrast ratios computed), responsive overflow at 4–6 viewports, performance (LCP, image weights), JS-dependent-hidden-state |
| **2.7 Adapt** | Viewport behaviour | doc-width · overflow · sticky · grid columns · font scaling at 1920 / 1440 / 1280 / 800 / 414 / 375, mobile-nav-collapse audit |

The wasatch dry-run on 2026-05-13 caught two real bugs the brief
and craft phases missed (a WCAG miscalculation off by 0.27–1.86
points on multiple pairs of /beers variant C, and an LCP image
lazy-loaded on the first catalog entry). Both were caught by the
**audit** half — not by critique. The detector's contrast
computation and responsive performance check are the load-bearing
audits; without them the file would have shipped with quantifiable
WCAG failures.

### Phase 2.5 — Critique

Before opening the proposed file in the browser, run **two parallel
validators** against the rendered proposed file: `critique` and `audit`. They
are explicitly designed as a complementary pair — critique
covers *design* (AI-slop reflexes, hierarchy, brand fit,
cognitive load); audit covers *technical correctness*
(accessibility / performance / theming / responsive /
anti-patterns). Running only critique misses every quantifiable
WCAG / perf / responsive failure; running only audit misses
brand-misalignment and design slop. The pass is a **contract**,
not a courtesy.

The 2026-05-04 nvidia.com home prototype critique returned
1 P0 + 2 P1 + 3 P2; the audit on the same artifact returned
**six additional findings** (no skip-link, theme carousels
without keyboard arrow nav, hero ~3.5MB without responsive
`<picture>`, layout-property animation, JS-gated reveal with
no `<noscript>` fallback, `scroll-behavior: smooth` not
respecting `prefers-reduced-motion`). None were design issues,
none would have been caught by critique alone. Without an
audit gate the page would have been marked `prototyped` with
quantifiable WCAG failures.

Procedure:

1. **Run both validators in parallel.** Invoke `impeccable:impeccable`
   twice in the same Skill-tool batch:

   ```
   Skill { skill: "impeccable:impeccable",
           args: "critique stardust/prototypes/<slug>-proposed.html --json" }

   Skill { skill: "impeccable:impeccable",
           args: "audit stardust/prototypes/<slug>-proposed.html --json" }
   ```

   Each returns a JSON findings list — each finding has
   `priority` (P0 / P1 / P2 / P3), `category` (hierarchy /
   contrast / motion / a11y / perf / responsive / etc.), and a
   one-line description. Capture critique findings into
   `_provenance.critique[]` and audit findings into
   `_provenance.audit[]` on the proposed file (append; never
   overwrite previous runs' entries).

2. **Brand-faithful inversion auto-dismiss.** Both validators
   ship known false positives on Mode A renders — Arial fallback
   reads as "overused-font," eyebrow uppercase reads as
   "all-caps body," pure white / pure black flagged when the
   brand's captured palette includes them. Before surfacing
   findings to the user, diff each finding against
   `DESIGN.json#extensions.divergence.brand_faithful_inversions[]`
   and `DESIGN.md#narrative.rules` (e.g. permitted uppercase
   contexts). Drop findings whose category and target match an
   approved inversion; keep the original list in
   `_provenance.<critique|audit>[]` with a
   `dismissedAsBrandFaithful: true` flag for audit-trail
   purposes. The user-facing report shows only the real hits.

3. **Surface findings in the user-facing report**, grouped by
   priority across both validators with the source attributed
   (`critique:` / `audit:`). List the first 5 P0/P1 verbatim;
   collapse P2/P3 to per-source counts with an "expand to see
   all" pointer. Format:

   ```
   Critique + audit on home-proposed.html

   P0 (1)
     audit:    skip-link missing — header has no <a href="#main"> as first focusable
   P1 (4)
     critique: hierarchy regression — H2 visually heavier than H1 in section #features
     audit:    hero <img> 3.5MB; no responsive <picture> set despite captured srcset
     audit:    transition: width animates layout properties (jank)
     audit:    .hero scroll-behavior: smooth not gated by prefers-reduced-motion
   P2 (3 critique, 1 audit) — expand to see
   P3 (0)
   ```

4. **Gate `prototyped` status on P0/P1 findings from EITHER
   validator.** If the merged-and-deduped findings list (after
   the brand-faithful auto-dismiss) contains any P0 or P1, do
   **not** mark the page `prototyped` in `state.json` yet. The
   proposed file is on disk and openable in the browser, but the
   page stays in `directed` until either:
   - The agent fixes the issue (run a chat-driven impeccable
     command per Phase 4 iteration paths, then re-run Phase 2.5).
   - The user explicitly acknowledges (e.g. "ship as-is" /
     "accept the P1 findings"). Acknowledgement is recorded in
     `_provenance.critique[]` AND `_provenance.audit[]` with the
     verbatim user phrase, so re-runs see the existing
     acknowledgement and don't re-prompt.

   P2/P3 findings do not block `prototyped`. They surface as
   advisory.

5. **Optionally spawn an LLM design-review subagent** for an
   independent take when the user wants more than the
   deterministic detector. Trigger only when the user explicitly
   asks ("give me a deeper critique", "second opinion") or when
   the deterministic pass returns ≥3 P0/P1 findings (signal that
   the render has multiple issues worth a closer look). Default
   off to keep the loop fast.

Both validators are mandatory. There is no opt-out flag — if a
finding bites and the user wants to ship anyway, they say so in
chat ("ship as-is" / "accept the P1 findings") and the
acknowledgement is recorded in `_provenance.critique[]` AND
`_provenance.audit[]` verbatim. The contract is that the gate
runs; the user can override the gate but the override is
explicit and recorded.

Failure handling: when impeccable is unavailable per the
Delegation mechanic, prototype refuses to run (impeccable is a
hard requirement). There is no degraded mode that ships
unverified output.

### Phase 2.6 — Audit (detector specifics)

The audit sub-phase is implemented as the second parallel arm of
the impeccable invocation in § Phase 2.5 above. This section
documents the audit-specific detectors that fire in that arm,
including ones the parallel critique pass does not cover.

**WCAG contrast computation.** Audit recomputes contrast ratios
for every text-on-substrate pair in the file. The previous
brief-time / craft-time hand-estimated `_provenance.wcagContrast`
blocks are NOT authoritative; the audit's computed values are.
Discrepancies of `≥ 0.25` between hand-estimated and computed
ratios surface as a P1 finding. The wasatch dry-run on 2026-05-13
surfaced 0.27–1.86 point discrepancies on /beers variant C; the
audit-driven fix darkened the Cutthroat substrate from `#1c8a7a`
to `#177566` to clear AA body (4.5:1) and recolored the
pour-link from yellow to white.

**Large-text exemption check.** A pair claimed to qualify for
WCAG's "large-text" 3:1 floor (instead of body 4.5:1) must be
`≥ 18pt regular` OR `≥ 14pt bold` at rendered size. The audit
verifies the size at the rendered DOM, not at the source CSS. A
13px Bellfort 700 link claiming the large-text exemption fails
the check (Bellfort 700 at 13px is below the 14pt bold floor); the
finding is P0.

**LCP image audit.** The first image above the fold on the page
must declare `loading="eager"` AND `fetchpriority="high"`. A
lazy-loaded LCP image is a P1 finding. Detection: the first `<img>`
whose computed `getBoundingClientRect()` intersects the initial
viewport must satisfy both attributes.

**JS-dependent-hidden-state detector.** Per
`notes/prototype-broken-by-default-detector-2026-04-29.md`, the
audit catches initial-state CSS that hides content via `clip-path:
inset(0 100% ...)`, `opacity: 0`, or `transform: translateX(-100%)`
where the reveal depends on a JS class flip (typically an
`IntersectionObserver` toggling `.in-view` / `.is-visible` /
`html.js-anim`). When the observer fails (slow JS, blocked CDN,
NoScript), the element stays permanently invisible.

Detection regex over the CSS text:

```
/(clip-path:\s*inset\(0\s+100%|opacity:\s*0\s*[;}]|transform:\s*translate[XY]\(-?100%)/
```

When a hit is found AND no `<noscript>` fallback styles the same
selectors visible AND no `prefers-reduced-motion` rule short-
circuits the hide, the finding is P0 (the page is broken-by-default
for any user whose JS doesn't execute). Mitigations the page may
declare in `_provenance.audit.acknowledged[]`:

- A `<noscript>` block that re-sets the hidden selectors to
  visible.
- A `prefers-reduced-motion: reduce` block that skips the hide
  entirely.
- An animation gate selector pattern (`html.js-anim .selector { ...
  hidden ... }`) where the gate class is set inline in `<head>`
  BEFORE the stylesheet loads, so observer failure doesn't strand
  elements (the wasatch /beers variant C confirms this pattern
  works — detector PASS on all 4 files via the `html.js-anim` gate
  + CDN-failure fallback).

### Phase 2.7 — Adapt (mandatory pre-approval)

Every prototype goes through `$impeccable adapt` and the adapt
audit before the user's approval is accepted. The cascade ships
desktop-only HTML otherwise — viewports are tuned to ~1440×900
through render and iteration, and nothing earlier in the pipeline
produces responsive coverage.

This phase was Phase 5.5 in prior versions of stardust (running
*after* approval). The current spec promotes it to Phase 2.7 so it
gates `prototyped` alongside critique and audit. The substantive
adapt logic is unchanged; only the trigger point moved (pre-
approval vs post-approval). See § Adapt procedure below for the
unchanged implementation.

#### Adapt procedure

Invoke impeccable adapt against the rendered file:

```
Skill {
  skill: "impeccable:impeccable",
  args: "adapt stardust/prototypes/<slug>-proposed.html"
}
```

Pass the captured viewport breakpoints from
`DESIGN.json#extensions.breakpoints` if present; otherwise adapt
picks defaults (640 / 768 / 1024 / 1280 are the stardust spec
defaults — anything above 640 used as a "mobile breakpoint" is a
smell per § Mobile-adapt audit below). The full target list is
**1920 / 1440 / 1280 / 800 / 414 / 375** — adapt validates each
viewport's doc-width · overflow · sticky behaviour · grid columns
· font scaling.

Validate the adapted file against the same contracts Phase 2 ran
(`:root` token block, data attributes, anti-toolbox audit clean,
impeccable hard rules, content sourcing). Adapt is an iteration
over the existing render; it must not reintroduce contract
violations.

Append an entry to the proposed file's `_provenance.adapt[]`
recording: ISO timestamp, the breakpoint list applied, the number
of `@media` rules added, and any layout decisions the adapt pass
surfaced (carousel → stack, sidebar → drawer, hamburger → menu).

#### Mobile-adapt audit

Phase 2.7 also runs a hard audit, separate from the adapt pass
itself, that the resulting file would survive a publish or
migrate. The same audit re-runs at `migrate` and `--publish-sample`
so an adapted-but-broken render can't slip through.

Refuse the file when **any** of:

- `<meta name="viewport" content="width=device-width, ...">` is
  missing or width is set to a fixed pixel value.
- The file declares zero `@media (max-width: ...)` rules at all
  (desktop-only).
- The file declares mobile-targeted breakpoints **above 640px**
  — `@media (max-width: 1024px)` as the *narrowest* breakpoint
  is the recognisable shape of "didn't actually adapt for
  phones." Adapt should produce at least one rule at ≤ 640px.
- **At a 360px-wide rendered viewport:** a landmark causes
  `scrollWidth > clientWidth` on `document.documentElement` or
  `document.body`. Refusal code:
  `audit/responsive: horizontal-overflow-at-360px`.
- **At a 360px-wide rendered viewport:** the computed `font-size`
  of any descendant of a `<nav>` inside a `<header>` is below
  11px. Refusal code: `audit/responsive: nav-readability-floor`.
- **At a 360px-wide rendered viewport:** the computed `gap` (or
  `column-gap`) of any flex/grid `<nav>` inside a `<header>` is
  below 10px. Same refusal code.

The last three conditions require actually rendering the file —
they can't be inferred from CSS text. The canonical check is a
small Playwright snippet (`fixtures/mobile-nav-audit.mjs`) the
agent runs against the file at 360×800. Audit messages must
include a pointer to the stock-template doc:

> Suggested fix: apply the stock hamburger pattern
>   skills/prototype/reference/mobile-nav-collapse.md

#### Mobile nav collapse

When the audit refuses on either of the nav-related codes above,
the agent applies the stock CSS-only hamburger pattern documented
in `reference/mobile-nav-collapse.md` (HTML + CSS + ≤10-line
inline `<script>` for a11y). The header gains
`data-nav-collapse="hamburger"` so downstream consumers can detect
the pattern is applied.

**Source order is load-bearing.** The base
`.ds-nav-burger { display: none; ... }` rule must be placed at
the **top** of the `<style>` block (after `:root`, before any
`@media` rules). The post-injection ordering check is a small
`awk` one-liner documented in `reference/mobile-nav-collapse.md`
§ Source order — it asserts the base rule appears at a lower line
number than the first `@media (max-width: 640px)` rule. Exit 0 =
correct ordering; exit 1 = regression.

The stock pattern is the default; `reference/mobile-nav-collapse.md`
§ Alternative patterns documents priority+overflow, bottom nav,
and side-drawer as valid alternatives the user can request, but
the agent does not pick between them autonomously.

#### Variant-convergence detector (Discipline 10)

When N > 1 variants render, each `<slug>-<id>-shape.md` declares:

- A distinct `dominantDimension` value (no two variants share it;
  per `notes/variant-convergence.md` Tier 1).
- A `compositionDelta` field listing ≥ 2 ways the variant's section
  sequence or layout strategy diverges from each sibling variant.
  Examples:
  - `compositionDelta: ["section-order: hero ↔ stats", "layout: 3-up-grid → vertical-narrative"]`
  - `compositionDelta: ["ia-priority: commercial-conversion → catalog-browse", "hero-layout: split-photo → type-led"]`

If `compositionDelta` is empty or trivial (only token-level
deltas — *"Color A vs Color B"*, *"font weight 400 vs 600"*),
Phase 1 fails the brief and restarts ideation. The validator
checks pairwise: variant pairs `(A,B)`, `(A,C)`, `(B,C)` each
need ≥ 2 structural changes.

**Mode-aware contract** (composes with `ia-fidelity` from
`stardust/reference/intent-dimensions.md` § 9):

- Under `ia-fidelity: verbatim` — A1/A2/A3 differ on **surface**
  axes only (type-weight, type-scale, density, motion-energy,
  color-temperature, spacing-rhythm). Structural deltas (section
  sequence / presence / IA priority / layout strategy) are
  **forbidden** under verbatim. The detector inverts: a surface-
  only delta passes, a structural delta refuses.
- Under `ia-fidelity: reimagined` — A + B + C variants declare
  structural `compositionDelta` with ≥ 2 changes per pair.
  Surface-only deltas **fail** the brief.

The wasatch /beers A / B / C dry-run declared 5 structural deltas
per pair (`compositionDelta_vs_A`, `compositionDelta_vs_B` blocks
in `_provenance`) — substrate-strategy, section-presence, photo-
treatment, section-order, section-completeness. The detector
PASSED on all three pairs.

Single-variant runs (N = 1) skip Discipline 10 entirely.

### Phase 4 — Open and iterate

(Phase numbering skips 3; the former Phase 3 — *Compose the viewer*
— was removed when the per-page before/after viewer was dropped.
Cross-references throughout the docs still name Phases 4, 5, 5.5.)

1. Open the just-written or just-updated `<slug>-proposed.html` (or
   the user-chosen variant suffix when N > 1) in the default
   browser (`open` macOS, `xdg-open` Linux, `start ""` Windows). If
   multiple files were written in one run, open the primary variant
   only. Skip in pipeline-automation mode.
2. Mark the page `prototyped` in `state.json` — **gated on the
   Phase 2.5 critique + Phase 2.6 audit + Phase 2.7 adapt
   result** (Discipline 9). If any of the three returned ≥ 1 P0
   or P1 finding (after the brand-faithful inversion auto-dismiss)
   and the user has not acknowledged, the page stays `directed`
   (not `prototyped`); surface the findings in the report grouped
   by source (`critique:` / `audit:` / `adapt:`) and recommend
   either fixing the issue or acknowledging explicitly. The
   transition itself does not require *approval* (a separate
   later step) — but it does require all three gates to clear,
   since shipping a `prototyped` flag on work that fails P0/P1
   on any gate misleads downstream consumers (migrate, the
   dashboard) about the prototype's quality.
3. Report the prototype path and stop. Iteration happens via
   chat-driven impeccable commands or direct invocation (see
   § Iteration paths below).

#### Iteration paths

Refinement after the initial render takes one of two forms. They
are not mutually exclusive — a single page can move through both
across its lifetime.

1. **Chat-driven (default).** The user gives a refinement phrase
   in chat — *"make the hero bolder for home"*, *"tighten the
   cup-note grid"*, *"less corporate"*. The agent:
   - Reads the phrase against
     `skills/stardust/reference/intent-dimensions.md` to identify
     which axes it moves.
   - Consults
     `skills/stardust/reference/impeccable-command-map.md` to pick
     the matching impeccable command (often `bolder`, `quieter`,
     `distill`, `typeset`, `colorize`, or `layout`).
   - Shows the resolved plan to the user before executing.
   - Runs the chosen command against `<slug>-proposed.html` (or a
     specific section within it, when the phrase scopes one).
   - Re-validates per Phase 2 (`:root` block, data attributes,
     anti-toolbox audit clean, impeccable hard rules) and updates
     the proposed file's provenance.

2. **Direct impeccable invocation.** The user runs an impeccable
   command directly — `$impeccable bolder
   stardust/prototypes/home-proposed.html`. Stardust isn't in the
   loop; the browser tab reloads whatever's on disk. This is fine
   and documented as a supported escape hatch. (Includes
   `$impeccable live` against the proposed file when the user
   wants in-browser picker iteration — that's an external tool
   they invoke directly; stardust does not drive its poll loop.)

The "open and reasoned" principle from the master skill applies to
path 1: the agent reasons publicly about the phrase before running
any command, and never silently maps a refinement to a fixed
command.

### Phase 5 — Approval (+ fold-back, Part III)

Approval is **explicit**. Stardust does not auto-approve.

The user signals approval by saying **"approve <slug>"** or simply
**"approve"** in the conversation. The agent confirms the slug
before writing state, then proceeds.

On approval:

1. Verify the proposed file's provenance block lists the *current
   active* `direction.md` (defensive check — if the direction changed
   during iteration, the user must re-prototype against the new
   direction first).
2. **Run approval fold-back** per
   `reference/approval-fold-back.md` (Part III of the merged spec).
   When the approved variant is non-A AND `ia-fidelity` is
   `reimagined`, the prototype reads the approved file's
   `_provenance.differentiationFromA[andB]` block plus the brief's
   `compositionDelta`, diffs against the active direction, and
   proposes folding any structural moves. The user picks
   `fold site-wide` (default) / `fold page-local` / `don't fold`.
   Under `ia-fidelity: verbatim` the fold-back is a no-op by
   construction (A1/A2/A3 are surface forks; nothing structural to
   fold). Flags: `--auto-fold` skips the gate; `--no-fold` opts out
   entirely.
3. Mark the page `approved` in `state.json`. Append a
   `{ status: "approved", at: <ts> }` history entry.
4. Clear any `stale` flag on the page.
5. Print:
   ```
   home: approved
     proposed: stardust/prototypes/home-proposed.html
     mobile:   adapted at Phase 2.7 (4 @media rules at 640/768/1024/1280)
     fold-back: page-local (substrate-keyed-zine pattern stays on /beers)

   Next: $stardust migrate home  (write final redesigned static HTML)
   ```

Adapt no longer runs at approval time — it ran at Phase 2.7 as a
pre-`prototyped` gate. The `mobile:` line reports the Phase 2.7
result for review continuity.

If multiple pages are in flight, approval is per-page; the user can
approve some and continue iterating on others.

### Phase 5.5 — Adapt for mobile (retired; see Phase 2.7)

Adapt and the mobile-adapt audit moved to **Phase 2.7** as part of
the Discipline 9 critique → audit → adapt cycle, gating
`prototyped` instead of approval. The 2026-05-03 lovesac.com
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

When invoked with `--prep`, prototype runs an extended pass that
fills page-type gaps and writes canon. Discovery-mode runs are
unchanged: per-slug shape brief, render via `$impeccable craft`,
open in browser, iterate, approve.

`--prep` adds three things on top of the standard procedure:

### 1. Fill page-type gaps

Identify every page type in `state.json.pages[].type` that
doesn't yet have an approved archetype. For each gap, prototype
one representative page (the user picks which slug, or the first
page of that type by default):

- `article`-typed pages with no approved article: prototype one
- `listing`-typed pages with no approved listing: prototype one
- `program`, `form`, `static` — same pattern
- `landing` — the home; prototyped first if not already done
- `unique`-typed pages — these don't get archetypes; they're
  rendered as one-offs at migrate time

The user picks one variant per type. Subsequent pages of the
same type are migrated by forking that approval (Path A′ in
`skills/migrate/SKILL.md`).

### 2. Canon write-back on first approval

The first prototype approved (default the home; override with
`--canon-from <slug>`) becomes the **canon-author**. On
approval, extract canon and write back per
`reference/canon-extraction.md`:

1. Chrome HTML → `stardust/canon/header.html`,
   `stardust/canon/footer.html`, optional regions.
2. Compound CSS → `stardust/canon/canon.css`.
3. Pinned tokens → `DESIGN.json.extensions.canon.pinned`.
4. Module canonical renderings →
   `stardust/canon/modules/<id>.html`.
5. Compositional moves (LLM-authored, 3–7 lines) →
   `DESIGN.json.extensions.canon.compositionalMoves`.

Reference all extracted files via `{ path, sha }` in
`DESIGN.json.extensions.canon.files`. Each canon file carries a
`stardust:canon` provenance comment naming source slug, source
prototype, and region.

### 3. Canon write-back on subsequent approvals

For non-canon-author template approvals (article, listing, etc.),
canon-extraction runs in **diff mode** per
`reference/canon-extraction.md` § Conflict resolution:

- **Net-new items** (a module not yet in canon, a new compound
  CSS class, a new compositional move) → append to canon
  additively. Add a history entry naming what was added.
- **Match canon byte-for-byte** → no-op.
- **Conflict with canon** → default is **log as deviation**:
  the migrated/prototyped page carries the deviation inline
  marked with `data-deviation="<reason>"`, and the page's
  `migrationDecisions[]` records a `canon-deviation` entry.
  Canon stays unchanged.

Override the default per-conflict via the prep summary if the
user wants to promote the new variant to canon (which stale-flags
downstream pages that consumed the changed item) or reject and
re-iterate the prototype. Without an explicit override, the
conflict logs as deviation and approval proceeds.

### Prep summary

```
prototype --prep complete
=========================

Approved archetypes:
  landing   home (V01 Polish)            canon-author
  article   news/post-housing-summit
  listing   news (the index)
  program   programs/shelter
  form      donate
  static    about

Canon: stardust/canon/ + DESIGN.json.extensions.canon
  Sources:  home → article (1 deviation logged), listing (clean),
            program (1 deviation logged), form (clean), static (clean)
  Modules:  8 confirmed; canonical renderings written
  Pinned:   sectionPadding, densityTier, typeScale set

Next: $stardust migrate  (apply canon to every page in inventory)
```

Default mode is unchanged.

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
- `reference/fidelity-refined-pass.md` — concrete CSS recipes for
  the `--fidelity=refined` craft micro-pass (Discipline 8).
- `reference/anti-template-bank.md` — worked examples of the
  non-template moves Discipline 3 draws from (typographic
  substitution / substrate-promotion / inversion / document-shape
  / scale-displacement).
- `reference/approval-fold-back.md` — Phase 5 fold-back procedure
  (Part III of the merged spec): diff algorithm, surfacing UX,
  write logic, stale flagging, `--auto-fold` / `--no-fold` flags,
  verbatim no-op gating.
- `fixtures/composition-delta-good.md` — example shape brief with
  a strong structural `compositionDelta` (passes Discipline 10).
- `fixtures/composition-delta-trivial.md` — example shape brief
  with token-only deltas (fails Discipline 10).
- `skills/stardust/reference/token-contract.md` — `:root` token
  block (cross-cutting, used by prototype + migrate).
- `skills/stardust/reference/data-attributes.md` — structural data
  attribute vocabulary (cross-cutting, used by prototype + migrate).
- `skills/stardust/reference/divergence-toolkit.md` —
  anti-mediocrity rules consumed during render and iteration.
- `skills/stardust/reference/intent-dimensions.md` — the 7-axis
  vocabulary used to read a chat-driven refinement phrase
  (iteration path 2).
- `skills/stardust/reference/impeccable-command-map.md` — when to
  reach for each impeccable command. Consulted during chat-driven
  iteration (path 2) to pick the command for a refinement phrase.
- `skills/stardust/reference/state-machine.md` — page lifecycle
  and stale rules.
- `skills/stardust/reference/artifact-map.md` — provenance shape.
- impeccable's `reference/craft.md` and `reference/live.md` — the
  underlying impeccable commands stardust delegates to.
