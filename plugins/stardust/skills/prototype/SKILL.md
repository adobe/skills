---
name: prototype
description: Render a proposed redesign of a page on the current website as a self-contained static HTML file, then iterate via the impeccable craft loop. Per-page, idempotent, stale-aware. Use when the user asks for a redesign prototype, a before/after comparison, a design preview, a page mockup, a visual diff of the redesign, or invokes /stardust:prototype.
license: Apache-2.0
---

# stardust:prototype

For each `directed` page, render a **proposed redesign** as a
self-contained static HTML file at
`stardust/prototypes/<slug>-proposed.html`. Open it in the browser;
iterate via chat-driven impeccable commands ("make the hero bolder",
"tighten the cup-note grid"); mark `approved` once the user signs
off in the conversation.

`prototype` is not a renderer of its own design — it composes the
target spec written by `direct` (`PRODUCT.md`, `DESIGN.md`,
`DESIGN.json`, `stardust/direction.md`) onto the page content
captured by `extract` (`stardust/current/pages/<slug>.json`). Visual
creativity is delegated to `$impeccable craft` and the iteration
commands (`bolder`, `quieter`, `distill`, `polish`, `colorize`,
`typeset`, `layout`, `adapt`, `animate`, `delight`, `overdrive`,
`impeccable`).

## Inputs

- `<slug>` — optional positional. Prototype just this page. Without
  it, prototype every `directed` page that is not `stale`.
- `--all` — prototype every `directed` page including stale ones.
- `--prep` — run in **migrate-prep mode**: fill page-type gaps (one
  representative archetype per type) and, on approval, write canon
  back to `stardust/canon/` and `DESIGN.json.extensions.canon`.
  **When `--prep` is passed, READ `reference/prep-mode.md`** before
  proceeding — it carries the gap-fill procedure, canon write-back
  rules, and prep summary. See also `reference/canon-extraction.md`.
  Typically invoked via the `prepare-migration` orchestrator.
- `--canon-from <slug>` — override the default canon-author (the
  first approved prototype, typically `home`).
- `--publish-sample <slug>` — submit the named slug to the stardust
  showcase per `reference/publish-sample.md`: eligibility checks,
  file staging, PR creation against the upstream stardust repo.
  Requires `gh` installed and authenticated. The showcase is a
  visual demonstration, not a deployable site — placeholder content
  is allowed and recorded in the PR body's § Unsourced content
  section. Design-quality gates stay strict: refuses on unjustified
  anti-toolbox hits, `:root` token contract failure,
  data-attributes contract failure, or impeccable hard-rule
  violations. P0/P1 critique findings warn but don't refuse.
  Publishes via GitHub Pages on merge.
- `--cinematic` — layer a cinematic motion register on top of the
  static prototype. The register is read from
  `DESIGN.json.extensions.motion.register` (written by `direct`);
  if absent, pick one per `reference/motion-registers.md`
  § Selection heuristic. Output is `<slug>-cinematic.html`
  alongside the static `<slug>-proposed.html` — never replacing it.
  Triggers the cinematic gates in `reference/motion-validation.md`
  § Pass 6.
- `--cinematic=<register>` — same, forcing a register (`arrival`,
  `kinetic-display`, `live-systems`, `editorial`, `kinetic-grid`).
  Record `_provenance.motion.registerSource = "user-override"` so
  reviewers can spot when direction's heuristic was bypassed.

### No opt-outs

`prototype` does not carry `--no-*` or `--skip-*` flags. The
quality gates (critique, audit, mobile-adapt audit, anti-toolbox
audit, content-sourcing scan) are the product — not optional. If a
gate refuses a file, the remediation is to fix the file or edit it
directly, never a flag that silently lowers the bar. Manual chat
overrides ("ship as-is", "accept the P1 findings") are still
available; the agent records the override verbatim in `_provenance`
so downstream consumers see the explicit acknowledgement.

## Setup

0. **Playwright re-probe (mandatory first step).** `--no-save`
   playwright installs from earlier phases are pruned by any later
   real `npm i` (extract SKILL.md § Setup). Before any rendering
   step, probe
   `node -e "import('playwright').then(()=>process.exit(0))"` from
   the project root; on failure re-install
   `npm i -D playwright --no-save --legacy-peer-deps`.
1. Run the master skill's setup (`skills/stardust/SKILL.md` § Setup).
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
   validation for every page this run will render (the single
   `<slug>` when present, otherwise every non-stale
   `directed`/`prototyped`/`approved` page). Abort with the helper's
   error when any page lacks live-render evidence — re-running
   `prototype` against a synthesized page record silently propagates
   the synthesis into the rendered prototype. Surface
   `Provenance OK on N pages` once the check passes.
6. Read `stardust/current/DESIGN.md` (descriptive snapshot of the
   existing site; fallback reference when the proposed file must
   mirror an aspect of the captured surface).

## Delegation mechanic

`prototype` does **not** author `<slug>-proposed.html` directly. The
heavy creative lift is delegated to `$impeccable craft`, and (when
needed) the structural plan to `$impeccable shape`. The carve-out in
`skills/stardust/reference/artifact-map.md` — where stardust authors
`PRODUCT.md`, `DESIGN.md`, `DESIGN.json`, `current/PRODUCT.md`,
`current/DESIGN.md` directly, treating impeccable's references as
*format specs* — is **load-bearing for those five files only**. It
does NOT extend to:

- `stardust/prototypes/<slug>-proposed.html` — authored by
  `$impeccable craft`, never by stardust direct authoring.
- Iteration on the proposed file — driven through a chat-driven
  invocation of an explicit impeccable command (§ Iteration paths).
- Structural planning when a page needs it — `$impeccable shape`.

The proximate cause of past content fabrication was the agent
over-generalizing the direct-authoring carve-out to the proposed
HTML. Don't.

### Invoking impeccable

In a Claude Code skill context (impeccable exposed as the
`impeccable:impeccable` Skill, not a CLI), invoke via the Skill tool
with the sub-command and args mirroring the slash-command form:

```
Skill {
  skill: "impeccable:impeccable",
  args: "craft <feature-description>"
}
```

All sub-commands route through the same Skill: `craft`, `shape`,
plus the iteration commands (`bolder`, `quieter`, `distill`,
`polish`, `colorize`, `typeset`, `layout`, `adapt`, `animate`,
`delight`, `overdrive`, `impeccable`).

When impeccable is **not** available (CLI-only environment, plugin
uninstalled, sandbox without skill access), stop and tell the user
impeccable is required; recommend installing the plugin. Do not
fall back to direct authoring of `<slug>-proposed.html` — the
validation contract craft enforces (anti-toolbox audit, divergence
rules, type ratios, content sourcing hierarchy) is not reproducible
by direct authoring, and falling back silently ships unverified
output.

Stardust's job inside Phase 2 is therefore:

- Compose the inputs craft needs (page content from
  `current/pages/<slug>.json`, target spec from `DESIGN.md` /
  `DESIGN.json`, hard constraints from `direction.md`, content
  sourcing rules from `reference/proposed-file-shell.md` § Content
  sourcing hierarchy).
- Invoke craft via the Skill tool.
- Validate the result against the contract (`:root` block, data
  attributes, divergence audit, impeccable hard rules, content
  sourcing). If validation fails, refuse to write — never paper
  over craft output that looks "close enough."

The proposed file is whatever craft writes plus the validation
report; it is not stardust's authored artifact.

## Procedure

### Phase 1 — Plan the prototype (page-shape brief)

For each page in scope:

1. Read `stardust/current/pages/<slug>.json` — page structure and
   content.
2. Read `stardust/current/_brand-extraction.json` — system
   components and cross-promo data (site-wide repeated surfaces).
3. Read `stardust/direction.md` Active section — resolved direction,
   divergence inputs, command sequence.
4. Read project-root `DESIGN.md` + `DESIGN.json` — the target site
   system (tokens, abstract component vocabulary, named
   system-component roles). The site system says *what the design
   language is*; this phase decides *how it deploys to this page*.
5. **Author `stardust/prototypes/<slug>-shape.md`** — the per-page
   compositional brief, format per `reference/page-shape-brief.md`:
   section list, layout strategy, key states, interaction model,
   structural data attributes, unsourced-content list (bridge to
   the placeholder contract). Author directly — no interview, no
   impeccable invocation; this is stardust's reasoning about how
   the system deploys to this page given this content.
6. Show the brief to the user and wait for confirmation before
   Phase 2. The user can edit the brief in place (rearrange
   sections, kill open questions, change composition decisions);
   re-rendering Phase 2 rebuilds the proposed file from the edited
   brief.

   **Hands-off compliance.** When `state.json.handsOff` is true,
   the brief is still authored and validated but the confirmation
   wait is skipped — the brief is its own record. Approval
   (Phase 5) under hands-off follows
   `skills/stardust/SKILL.md` § Hands-off mode.

`$impeccable shape` is **not** invoked in v0.2 (rationale:
`reference/page-shape-brief.md` § Authoring procedure; revisit if
per-page hand-authoring proves insufficient across sites).

The brief decouples site-level concerns (DESIGN.md) from page-level
deployment (per-page brief). A direction change invalidates the
system; existing briefs are content-aware-stale only when the system
change makes their composition impossible (see
`skills/stardust/reference/state-machine.md` § Stale flagging).

#### Brief-time disciplines (validator-enforced)

Five disciplines fire when the brief is authored. The brief
validator rejects briefs missing any of them; failure surfaces the
specific rule violated and stops Phase 1 before Phase 2 renders
anything. They exist to prevent the AI-slop failure mode where
`(DESIGN tokens) + (captured content)` alone produces
template-shaped output regardless of brand.

**Discipline 1 — Captured-source lineage per section.** Every
section in `## Sections` declares its captured-source origin. Forms:

- *"subscription-card-on-bay (consolidates captured banner 2 +
  dual-card right of `pages/home.json#landmarks[hero]`)"* — derived
  from one or more captured surfaces
- *"site-wide system-component (carried from
  `_brand-extraction.json#systemComponents[kind=footer]`)"* —
  chrome inherited from the brand-surface
- *"direction-authorized new"* — composed against direction.md, not
  derived from a captured source (requires a one-line note naming
  which direction movement justifies the new section)

Sections without lineage are rejected. The lineage list lives in
`_provenance.capturedSourceLineage` in the brief and propagates to
the rendered file.

**Discipline 2 — Anti-template pass.** For each captured component
pattern the page deploys (cards / banners / search rows / CTA bands
/ hero composition), the brief considers 2–3 layout alternatives
and picks the most differentiated. Curated
default-patterns-to-escape flags reflex picks:

- hero-then-bands silhouette (the universal AI silhouette)
- 5-up image-card grid as category nav
- nav-icon glyphs (search / cart / account) in a typographic register
- centered-stack hero with two-button CTA pair
- captured-shape mirror-translated into new tokens

Any reach for a default pattern must be justified with a
captured-source citation that makes the pattern brand-appropriate
(e.g. *"5-up grid preserved because the captured grid IS the
brand's signature catalogue shape; the alternative considered was a
vertical ledger, which the brand register rejects"*).

Alternatives SHOULD be reference-grounded when reference research is
available (per `skills/stardust/reference/reference-research.md`):
an alternative cites a real reference screen in the entry's
`reference?` field using that file's evidence shape. Taste-only
alternatives remain valid when research is unavailable.

The audit lives in `_provenance.antiTemplatePass[]`, one entry per
captured pattern: `{ pattern, defaultReflex, alternatives[],
picked, rationale, reference? }`.

**Discipline 3 — Surprise budget.** The brief declares
`surprise: low | medium | high`. Moves come from the bank of
non-template moves (`skills/stardust/reference/divergence-toolkit.md`
§ Non-template move bank; worked examples in
`reference/anti-template-bank.md`) or an evidence-shaped extension
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

**`low` ≠ generic.** The budget bounds *added* divergence, not
craft or fidelity. `low` means **brand-faithful + improvements +
full signature preservation**, NOT "the most obvious faithful
interpretation." The recurring failure mode is reading `low` /
`verbatim` as license to strip the page to a plain type-hero on a
flat ground — faithful but forgettable (moneyhub — see
`reference/lessons.md`). Hold the craft bar at `low`: keep the
brand's distinctive elements, apply the improvements list, and
reproduce the signature.

**Signature preservation is mandatory and budget-exempt.** When the
captured page has a signature hero medium (background video /
canvas / WebGL / Lottie), signature motion (scroll / parallax /
kinetic), or a signature visual motif (per `intent-dimensions.md`
§ 8b), the brief **must** reproduce it — with a static fallback,
`prefers-reduced-motion` alternative, and (for overlaid text) a
legibility scrim. This does **not** consume the `low` allowance:
carrying the brand's own signature forward is fidelity, not
divergence (§ 8b § Surprise-budget exemption). Record kept
signatures in `_provenance.signatureElements[]` as `{ kind,
capturedSource, mechanism, fallback }`. **Render-refusal:** a brief
that flattens a captured video/canvas/animation hero to a still,
gradient, or type-only hero — or drops a site-wide motif — is
rejected at the shape-brief audit; reproduce the signature instead.

**Type-scale yield clause.** When a tier-`medium`-or-higher
variant's captured-trait amplification structurally conflicts with
a brand-level type-scale rule from `DESIGN.md` (e.g. a
"Names-At-Headline-Scale" rule, or any named type-scale floor /
ceiling), the brand-level rule may yield per-page. Cite the yield
in `_provenance.surpriseTier_typeScaleYields[]` with `{ rule,
variantDominantDimension, capturedTraitAmplified, yieldedTo,
rationale }`. The brand-level yield clause itself (the named
exception in `DESIGN.md`) is project-side, not spec-side; the spec
only requires the per-page citation when the yield fires. See
friction carve-out #4.

**Discipline 4 — Substrate transitions are deliberate, named, and
rare.** Default: single substrate across the page. Each exception
requires a named purpose in the brief (*"highlights the
featured-coffee promotional moment"*). **More than two substrate
transitions per page fails the brief.** Transitions live in
`_provenance.substrateTransitions` as `{ default, exceptions[] }`.

**Exception — substrate-keyed document-shapes (friction carve-out
#2).** When the variant's `surprise: high` move is a substrate-keyed
document-shape (zine, catalog-card, poster-sequence), the
per-section substrate IS the document-shape's structural rhythm.
The ≤ 2-transition cap does not apply; each section's substrate must
instead carry a **per-section captured-source citation** (typically
a per-SKU label color, per-page brand color, or per-content-type
ground convention from the captured site). Record the exception in
`_provenance.substrateTransitions.note` with the document-shape
named and the citation source. The validator accepts > 2 transitions
when:

1. `surprise: high` is declared, AND
2. the picked move from the bank is `document-shape` with a
   substrate-keyed sub-kind (zine / catalog-card / poster-sequence),
   AND
3. every transition in `exceptions[]` carries a per-section
   captured-source citation.

If any condition fails, the cap re-engages.

**Discipline 5 — Heading hierarchy + voice classification per
section.** The brief requires:

- H1 declared once per page; subsequent sections H2; H3 children.
- Every literal value in copy classified as `captured-verbatim`,
  `direction-authorized rewrite`, or `placeholder`. No section
  ships copy without a classification.

The classification list lives in
`_provenance.voiceClassification[]` as `{ section, classification,
copy?, source? }` and propagates to the rendered file.

**Placeholder-ribbon labels (friction carve-out #3).**
System-component honesty-signal labels (placeholder ribbons, "TBD"
badges, "from the brand team at migrate" markers) are
**direction-authorized chrome**, not placeholder content. They
label placeholder prose/data; the prose/data is what gets
enumerated in `_provenance.unsourcedContent[]` — the ribbon text
itself does not. Classify ribbon labels as
`direction-authorized chrome (per friction #3)` so the placeholder
enumerator stays clean (no double-counting per component instance).

### Phase 2 — Render the proposed page

Render `stardust/prototypes/<slug>-proposed.html` per
`reference/proposed-file-shell.md` § Required structure. Hard
requirements:

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
  hours, prices, named-person words must never be invented.
  `_provenance.unsourcedContent[]` lists every placeholder so
  migrate can refuse to ship unverified content.

Delegate the heavy creative lift to `$impeccable craft`:

- Pass the page content and the resolved direction as the feature
  description.
- Reference DESIGN.md / DESIGN.json as the design system.
- Pass `direction.md` § Anti-references and § Divergence inputs as
  hard constraints (so craft does not silently veer off the
  resolved direction).
- Skip craft's "north star mock" step (direction.md is the brief).
  Skip craft's "shape" call (already done if Phase 1 needed it).

**Modern-web-guidance consult.** When the render implements
scroll-driven animation, view transitions, anchor positioning,
container queries, or perf-sensitive hero media, and the
`modern-web-guidance` plugin is installed, search it
(`npx -y modern-web-guidance@latest search "<query>"`), follow the
retrieved guide, and cite the guide id in
`_provenance.guidesConsulted[]`. Skip silently when absent.

After craft returns, validate the output:

- `:root` block present and complete (token-contract.md).
- Data attributes on every section (data-attributes.md).
- Anti-toolbox audit clean (each hit justified per
  divergence-toolkit.md § 1; record results in
  `DESIGN.json.extensions.divergence.anti_toolbox_hits` with the
  audit's amendments noted).
- Impeccable hard rules respected (OKLCH, type ratio ≥ 1.25, no
  reflex slop).
- **Content sourcing scan** — every literal value in the rendered
  output traces to an allowed source (hierarchy above). Any value
  that doesn't is either wrapped in a `[data-placeholder]` element
  with the mandatory visual signature, or validation fails. Build
  `_provenance.unsourcedContent[]` during this scan.

If validation fails, do not write the file. Surface the specific
rule violated and a suggested fix.

#### Craft-time disciplines (pre-write validators)

Four disciplines fire on the rendered file after craft returns and
*before* it lands on disk. Failure refuses the write with a
substitute proposal (Discipline 6) or a rule citation (7, 8);
Discipline 9 registers detector ignores rather than refusing.

**Discipline 6 — Reflex-reject font pre-flight.** Grep declared
`font-family` values against the reject list in
`skills/stardust/reference/divergence-toolkit.md` § Reflex-reject
fonts. If ≥ 3 reject-list families hit, refuse to write and propose
dimensionally-equivalent off-list substitutes from the substitute
table.

Fires only on files whose `font-family` declarations the agent had
freedom to pick. **Mode A renders with captured display + body
families pinned (per `direct/SKILL.md` § Mode A) bypass the check**
— inherited families are not a reflex choice. Record the bypass in
`_provenance.reflexRejectAudit.bypassed` with the captured families
named.

**Discipline 7 — Variable-font axis engagement.** When the resolved
direction's `expressive` or `distinctiveness` axes moved past their
default (per `skills/stardust/reference/intent-dimensions.md`
§§ 2 + 5), engage ≥ 1 variable-font axis non-trivially per page
using deck recipes from the divergence toolkit:

- `serif-luxury` deck → Fraunces: `opsz 144, SOFT 100, WONK 1`
- `bauhaus-functional` deck → Bricolage: `opsz 96, wght 600`
- `tactile-humanist` deck → Recursive: `MONO 1, CRSV 0, CASL 0.5`

Static-weight static-style across all type on a page that claims
expressive or distinctive movement fails the check.

**Static-only-family precedence (friction carve-out #1).** When the
captured/pinned display font ships no variable axis:

1. If the captured/pinned display font is variable, engage its axes
   per deck recipes (standard path).
2. If the captured display font is **static-only by family**
   (Bellfort, GT Sectra static, hand-lettered custom cuts whose
   `woff2` files don't expose a parseable `fvar` table without
   runtime inspection), **exempt the display family** and engage
   the **body family's axes** instead (typically `wght` and `ital`
   on a workhorse like Public Sans or Hanken Grotesk).
3. **Document** the static-only status in
   `DESIGN.json.extensions.divergence.font_deck.notes` so
   downstream pages don't re-run the check.

A pre-flight that blindly grep'd for `font-variation-settings`
would fire on every brand-faithful render of a static-only-display
brand; the exemption keeps the discipline's spirit (engage variable
behavior where it exists) while honoring the letter when the family
has no axes.

Off-deck accent fonts must ship with named **expressive positions**
(`marginal-tag`, `pointer-scribble`, `headline-callout`,
`badge-fill` — toolkit § Font deck — expressive positions). A face
introduced without a position is a reflex pick.

**Discipline 8 — Fidelity tier
(`--fidelity=quick|refined|production`).**

- `quick` (default) — sketch fidelity. Brief decisions land;
  micro-decisions stay provisional.
- `refined` — adds the craft micro-pass per
  `reference/fidelity-refined-pass.md` (formal type scale as CSS
  custom properties; `tabular-nums` on inline digits;
  `text-wrap: balance`/`pretty` + `hanging-punctuation: first`;
  nav / list hover refinements; kicker + title + more-link
  section-head triplet; italic display couplet replacing vague
  `<b>`; sidebar bottom as typographic plate — apply that file's
  recipes).
- `production` — `refined` + WCAG AA audit on every render + harden
  pass (loading states, error states, content-overflow edges).

The tier is declared in the run invocation and persisted in
`_provenance.fidelity`. Default `quick`.

**Discipline 9 — Copy-cadence detector bypass under verbatim
fidelity.** Extends Discipline 6's Mode-A reasoning from fonts to
prose. impeccable's design detector ships prose-voice rules
(`em-dash-overuse`, `marketing-buzzword`, and similar copy-cadence
checks) that assume the copy is the agent's to rewrite. Under
`ia-fidelity: verbatim` — or any faithful/Mode-A render where body
copy is `captured-verbatim` — that assumption is false by
construction: the prose is the source brand's, reproduced exactly
per the content-sourcing hierarchy, and rewriting it to satisfy a
cadence rule *is* the fabrication the fidelity setting prevents. So
when the rendered file's copy classification is `captured-verbatim`
(per Discipline 5's `voiceClassification`), register those
copy-cadence rules as intentional ignores for the
`<slug>-proposed.html` files before the design hook fires. Scope
the ignore to the proposed files only, **never** to the project's
own source (blocks, styles, components), where the rules still
apply because that copy *is* the agent's. Record the bypass in
`_provenance.copyCadenceBypass` with the rules ignored and the
classification basis. (Motivating run: knack.com 2026-06-26 — see
`reference/lessons.md`.)

Bound the bypass: it covers prose-cadence rules only. Structural
and craft detector rules (`design-system-radius`, contrast
failures, reflex layout slop) are *not* exempted by verbatim
fidelity — those govern the agent's own CSS and structure, which
faithful mode does not freeze. Listing a rule under this bypass
requires it be a copy-voice rule whose subject is the captured
prose.

### Phase 2.4 — Motion application (when `--cinematic`)

Fires only when `--cinematic` (with or without an explicit
register) was passed, OR when
`DESIGN.json.extensions.motion.register` was authored by `direct`
and the user did not opt out. Produces
`stardust/prototypes/<slug>-cinematic.html` **alongside** the
static `<slug>-proposed.html` — the static prototype is never
replaced.

Procedure:

1. **Resolve the register.** Single-variant runs: read
   `DESIGN.json.extensions.motion.register`. **Multi-variant runs**
   (when `DESIGN-<id>.json` files exist at the project root): read
   `DESIGN-<id>.json.extensions.motion.register` for the variant
   being rendered — each variant may carry its own register or omit
   it (variant renders static). `--cinematic=<register>` at the CLI
   wins **only for the variants in scope** (every variant when no
   `<slug>` filter is set, otherwise the matching variant(s)).

   Record `_provenance.motion.registerSource` (`"direct"` for
   per-variant DESIGN-authored, `"user-override"` for CLI). If
   neither path resolves a register, fall through to
   `reference/motion-registers.md` § Selection heuristic. If the
   heuristic itself returns no register (the variant's PRODUCT.md
   Brand Personality maps to none of the five registers and no
   evidence-shaped extension register applies per that file's
   § Extension rule), skip Phase 2.4 for that variant — render it
   static.

   Per-variant resolution is what lets `uplift` produce a
   three-variant set where only variant C engages motion: `direct`
   writes the register into `DESIGN-C.json` only, and Phase 2.4
   fires for C alone.

2. **Stage Lenis assets.** Copy
   `skills/prototype/assets/motion/lenis.min.js` and
   `lenis.min.css` into `stardust/prototypes/` (idempotent — skip
   if shas match). Cinematic prototypes load these via relative
   paths.

3. **Read the canonical runtime.** Embed the inline script from
   `reference/motion-runtime.md` § The canonical script verbatim,
   with `animConfig` constants rewritten per the active register's
   token defaults (`reference/motion-registers.md` § The five
   registers § Token defaults).

4. **Layer the register's CSS.** Append the register-specific
   keyframes and class rules (entrance keyframes, parallax custom
   properties, marquee/pulse animations) to the file's `<style>`
   block. The keyframe set is closed per register
   (`reference/motion-runtime.md` § Per-register tuning).

5. **Annotate target HTML.** Walk the rendered DOM and emit the
   motion `data-*` attributes per the register's vocabulary —
   apply the full per-register attribute matrix in
   `reference/motion-registers.md` § Data-attributes consumed.
   Summary:
   - `arrival`: `[data-anim]` on section heads / body copy / CTAs /
     tile cards; `[data-countup]` on numerics; `[data-parallax]` on
     the hero photograph.
   - `kinetic-display`: `[data-anim]` on most sections;
     `[data-split]` on display-cap headlines; `[data-flip]` on
     terminal codes / gate numbers; `.word` spans for clip-path
     word wipes.
   - `live-systems`: `[data-tile-anim]` on every ops-tile/card;
     `[data-countup]` on every numeric; `[data-fill]` on bar
     inners; `.live-sweep` on the live-data container;
     `.marquee__track` on the top ticker.
   - `editorial`: `[data-anim]` only; reduced-magnitude
     `[data-parallax]` on hero imagery; never `[data-flip]` /
     `[data-fill]` / `[data-split]`.
   - `kinetic-grid`: `[data-tile-anim]` on cards; `[data-anim]` on
     section heads.

6. **Inject the `<noscript>` fallback** from
   `reference/motion-runtime.md` § No-JS fallback into `<head>` so
   the file degrades to its static-end state without JavaScript.

7. **Update `_provenance`** with the `motion` block:

   ```json
   "motion": {
     "register": "<register-name>",
     "registerSource": "direct | user-override | heuristic | extension",
     "runtimeVersion": "v1",
     "lenisAssets": { "js": "lenis.min.js", "css": "lenis.min.css" },
     "attributesEmitted": ["data-anim", "data-countup", ...]
   }
   ```

8. **Hand off to Phase 2.8** (motion validation). The cinematic
   gates in `reference/motion-validation.md` § Pass 6 fire
   automatically because the file declares
   `_provenance.motion.register`.

#### Output paths

| File | Owner phase | When |
|---|---|---|
| `stardust/prototypes/<slug>-proposed.html` | Phase 2 (always) | Always written. |
| `stardust/prototypes/<slug>-cinematic.html` | Phase 2.4 (`--cinematic`) | Written alongside; static remains. |
| `stardust/prototypes/lenis.min.js` | Phase 2.4 (`--cinematic`) | Copied from skill assets. |
| `stardust/prototypes/lenis.min.css` | Phase 2.4 (`--cinematic`) | Copied from skill assets. |

#### When to use the static-only path

The static prototype remains the load-bearing artifact for:

- Brand-faithful inheritance reviews (motion is additive — the
  static prototype is the canonical "yes, that's us, refreshed"
  surface).
- Accessibility audits (motion-driven pages are harder to evaluate
  in their reduced-motion state).
- Migration consumption (`migrate` reads the static prototype as
  its primary source; it does **not** merge the cinematic layer —
  per `skills/migrate/SKILL.md` § Phase 2 → Cinematic sibling it
  carries the motion assets through to `migrated/assets/motion/`
  and records `cinematic-variant-not-consumed` in the sidecar).

The static prototype must pass every gate independently — the
cinematic layer cannot rescue a static prototype that fails
Phases 2.5–2.7.

### Phases 2.5 – 2.8 — Quality gates: Critique → Audit → Adapt → Motion (Discipline 9)

Four mandatory gate phases run by default before any prototype can
advance to `prototyped`. Critique covers *design*, audit covers
*technical correctness*, adapt covers *viewport behaviour*, motion
covers *scroll- and time-driven choreography correctness*. P0/P1
findings from **any** of the four block `prototyped` until
acknowledged. None have an opt-out flag (§ No opt-outs).

| Sub-phase | Focus | Catches |
|---|---|---|
| **2.5 Critique** | Design judgment | AI-slop reflexes, hierarchy regressions, contrast / cognitive issues, register drift |
| **2.6 Audit** | Technical correctness | a11y (alt, focus, contrast ratios computed), responsive overflow at 4–6 viewports, performance (LCP, image weights), JS-dependent-hidden-state |
| **2.7 Adapt** | Viewport behaviour | doc-width · overflow · sticky · grid columns · font scaling at 1920 / 1440 / 1280 / 800 / 414 / 375, mobile-nav-collapse audit |
| **2.8 Motion** | Scroll / time-driven correctness | clipped-container reveal timing, animation-range vs reading position, anim-enter trigger reachability, reduced-motion override completeness, no-JS fallback, multi-viewport scroll-driven check |

Phase 2.8 fires only when the rendered file declares ≥ 1 named
choreography (per the page-shape brief's motion stack) OR uses
`animation-timeline:`, `@scroll-timeline`,
IntersectionObserver-driven entry triggers, or rAF loops reading
`getBoundingClientRect()`, **OR** when Phase 2.4 emitted a
`<slug>-cinematic.html` with motion attributes per
`reference/motion-attributes.md`. Cinematic prototypes additionally
trigger the cinematic-mode gates in
`reference/motion-validation.md` § Pass 6 (Lenis bootstrap,
reduced-motion fallback completeness, scroll-jack check,
three-position screenshots, register-match audit, motion C-cliff
detector). Static prototypes skip the discipline entirely.

The audit half — not critique — caught the two real bugs in the
wasatch dry-run (2026-05-13 — see `reference/lessons.md`); the
detector's contrast computation and responsive performance check
are the load-bearing audits.

### Phase 2.5 — Critique

Before opening the proposed file in the browser, run **two parallel
validators** against it: `critique` and `audit`. They are a
complementary pair — critique covers *design* (AI-slop reflexes,
hierarchy, brand fit, cognitive load); audit covers *technical
correctness* (accessibility / performance / theming / responsive /
anti-patterns). Running only critique misses every quantifiable
WCAG / perf / responsive failure; running only audit misses
brand-misalignment and design slop. The pass is a **contract**, not
a courtesy. (Evidence: nvidia.com 2026-05-04, where audit found six
findings critique missed — see `reference/lessons.md`.)

Procedure:

1. **Run both validators in parallel.** Invoke
   `impeccable:impeccable` twice in the same Skill-tool batch:

   ```
   Skill { skill: "impeccable:impeccable",
           args: "critique stardust/prototypes/<slug>-proposed.html --json" }

   Skill { skill: "impeccable:impeccable",
           args: "audit stardust/prototypes/<slug>-proposed.html --json" }
   ```

   Each returns a JSON findings list — `priority` (P0–P3),
   `category` (hierarchy / contrast / motion / a11y / perf /
   responsive / etc.), one-line description. Capture critique
   findings into `_provenance.critique[]` and audit findings into
   `_provenance.audit[]` (append; never overwrite previous runs'
   entries).

2. **Brand-faithful inversion auto-dismiss.** Both validators ship
   known false positives on Mode A renders — Arial fallback reads
   as "overused-font," eyebrow uppercase as "all-caps body," pure
   white / pure black flagged when the captured palette includes
   them. Before surfacing findings, diff each against
   `DESIGN.json#extensions.divergence.brand_faithful_inversions[]`
   and `DESIGN.md#narrative.rules` (e.g. permitted uppercase
   contexts). Drop findings whose category and target match an
   approved inversion; keep the original list in
   `_provenance.<critique|audit>[]` flagged
   `dismissedAsBrandFaithful: true` for audit trail. The
   user-facing report shows only real hits.

3. **Vision gate.** Screenshot the proposed file and study it NEXT
   TO the captured source screenshot
   (`stardust/current/assets/screenshots/<slug>.png` when present).
   Judge visually, not from the DOM: **brand-fit** (would the brand
   owner say "that's us"?), **signature preservation** (hero medium
   / motif carried, per Discipline 3's signature clause), and
   **hierarchy at a glance** (does the eye land where the brief
   says?). Record `_provenance.visionCheck = { verdict: pass|fail,
   observations[] }`; a `fail` is a P1 finding through the same
   gate mechanics. The vision gate complements — never replaces —
   the deterministic critique/audit pair.

4. **Surface findings in the user-facing report**, grouped by
   priority across both validators with the source attributed
   (`critique:` / `audit:`). List the first 5 P0/P1 verbatim;
   collapse P2/P3 to per-source counts with an "expand to see all"
   pointer. Format:

   ```
   Critique + audit on home-proposed.html

   P0 (1)
     audit:    skip-link missing — header has no <a href="#main"> as first focusable
   P1 (2)
     critique: hierarchy regression — H2 visually heavier than H1 in #features
     audit:    hero <img> 3.5MB; no responsive <picture> despite captured srcset
   P2 (3 critique, 1 audit) — expand to see
   P3 (0)
   ```

5. **Gate `prototyped` on P0/P1 findings from EITHER validator.**
   If the merged-and-deduped list (after auto-dismiss, plus a
   vision-gate `fail`, which counts as P1) contains any P0 or P1,
   do **not** mark the page `prototyped` yet. The file is on disk
   and openable, but the page stays `directed` until either:
   - The agent fixes the issue (run a chat-driven impeccable
     command per Phase 4, then re-run Phase 2.5).
   - The user explicitly acknowledges ("ship as-is" / "accept the
     P1 findings"). Record the acknowledgement verbatim in
     `_provenance.critique[]` AND `_provenance.audit[]` so re-runs
     see it and don't re-prompt.

   P2/P3 findings do not block `prototyped`; they surface as
   advisory.

6. **Optionally spawn an LLM design-review subagent** for an
   independent take — only when the user explicitly asks ("give me
   a deeper critique", "second opinion") or when the deterministic
   pass returns ≥ 3 P0/P1 findings. Default off to keep the loop
   fast.

Both validators are mandatory; no opt-out flag exists. The user can
override the gate in chat, but the override is explicit and
recorded. When impeccable is unavailable per the Delegation
mechanic, prototype refuses to run — there is no degraded mode that
ships unverified output.

### Phase 2.6 — Audit (detector specifics)

The audit sub-phase is the second parallel arm of the Phase 2.5
invocation. Audit-specific detectors:

**WCAG contrast computation.** Audit recomputes contrast ratios for
every text-on-substrate pair. Earlier hand-estimated
`_provenance.wcagContrast` blocks are NOT authoritative; the
audit's computed values are. Discrepancies ≥ 0.25 between
hand-estimated and computed ratios surface as a P1 finding.
(Wasatch dry-run evidence: `reference/lessons.md`.)

**Large-text exemption check.** A pair claiming WCAG's "large-text"
3:1 floor (instead of body 4.5:1) must be ≥ 18pt regular OR ≥ 14pt
bold at **rendered** size — verified at the rendered DOM, not
source CSS. A 13px Bellfort 700 link claiming the exemption fails
(below the 14pt bold floor); the finding is P0.

**LCP image audit.** The first image above the fold must declare
`loading="eager"` AND `fetchpriority="high"`. A lazy-loaded LCP
image is a P1 finding. Detection: the first `<img>` whose computed
`getBoundingClientRect()` intersects the initial viewport must
satisfy both attributes.

**JS-dependent-hidden-state detector.** Per
`notes/prototype-broken-by-default-detector-2026-04-29.md`, catch
initial-state CSS hiding content via `clip-path: inset(0 100% ...)`,
`opacity: 0`, or `transform: translateX(-100%)` where the reveal
depends on a JS class flip (typically an IntersectionObserver
toggling `.in-view` / `.is-visible` / `html.js-anim`). When the
observer fails (slow JS, blocked CDN, NoScript), the element stays
permanently invisible.

Detection regex over the CSS text:

```
/(clip-path:\s*inset\(0\s+100%|opacity:\s*0\s*[;}]|transform:\s*translate[XY]\(-?100%)/
```

When a hit is found AND no `<noscript>` fallback styles the same
selectors visible AND no `prefers-reduced-motion` rule
short-circuits the hide, the finding is P0 (broken-by-default for
any user whose JS doesn't execute). Mitigations the page may
declare in `_provenance.audit.acknowledged[]`:

- A `<noscript>` block re-setting the hidden selectors visible.
- A `prefers-reduced-motion: reduce` block skipping the hide.
- An animation gate selector pattern
  (`html.js-anim .selector { ... hidden ... }`) where the gate
  class is set inline in `<head>` BEFORE the stylesheet loads, so
  observer failure doesn't strand elements (pattern confirmed on
  wasatch /beers variant C — see `reference/lessons.md`).

### Phase 2.7 — Adapt (mandatory pre-approval)

Every prototype goes through `$impeccable adapt` and the adapt
audit before approval is accepted — otherwise the cascade ships
desktop-only HTML (viewports are tuned to ~1440×900 through render
and iteration, and nothing earlier produces responsive coverage).

This phase was Phase 5.5 (post-approval) in prior versions; the
current spec promotes it to Phase 2.7 so it gates `prototyped`
alongside critique and audit. The adapt logic is unchanged — only
the trigger point moved.

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
smell per § Mobile-adapt audit). The full target list is
**1920 / 1440 / 1280 / 800 / 414 / 375** — adapt validates each
viewport's doc-width · overflow · sticky behaviour · grid columns ·
font scaling.

Validate the adapted file against the same contracts Phase 2 ran
(`:root` token block, data attributes, anti-toolbox audit clean,
impeccable hard rules, content sourcing) — adapt must not
reintroduce contract violations.

Append to `_provenance.adapt[]`: ISO timestamp, breakpoint list
applied, number of `@media` rules added, and any layout decisions
surfaced (carousel → stack, sidebar → drawer, hamburger → menu).

#### Mobile-adapt audit

Phase 2.7 also runs a hard audit, separate from the adapt pass,
that the file would survive a publish or migrate. The same audit
re-runs at `migrate` and `--publish-sample` so an adapted-but-broken
render can't slip through.

Refuse the file when **any** of:

- `<meta name="viewport" content="width=device-width, ...">` is
  missing or width is a fixed pixel value.
- Zero `@media (max-width: ...)` rules at all (desktop-only).
- Mobile-targeted breakpoints **only above 640px** —
  `@media (max-width: 1024px)` as the *narrowest* breakpoint is the
  recognisable shape of "didn't actually adapt for phones." At
  least one rule at ≤ 640px.
- **At a 360px-wide rendered viewport:** a landmark causes
  `scrollWidth > clientWidth` on `document.documentElement` or
  `document.body`. Refusal code:
  `audit/responsive: horizontal-overflow-at-360px`.
- **At 360px:** computed `font-size` of any descendant of a `<nav>`
  inside a `<header>` below 11px. Refusal code:
  `audit/responsive: nav-readability-floor`.
- **At 360px:** computed `gap` (or `column-gap`) of any flex/grid
  `<nav>` inside a `<header>` below 10px. Same refusal code.

The last three require actually rendering the file — they can't be
inferred from CSS text. The canonical check is the Playwright
snippet `fixtures/mobile-nav-audit.mjs`, run against the file at
360×800. Audit messages must include:

> Suggested fix: apply the stock hamburger pattern
>   skills/prototype/reference/mobile-nav-collapse.md

#### Mobile nav collapse

When the audit refuses on either nav-related code, apply the stock
CSS-only hamburger pattern from `reference/mobile-nav-collapse.md`
(HTML + CSS + ≤10-line inline `<script>` for a11y). The header
gains `data-nav-collapse="hamburger"` so downstream consumers can
detect the pattern.

**Source order is load-bearing.** The base
`.ds-nav-burger { display: none; ... }` rule must sit at the
**top** of the `<style>` block (after `:root`, before any `@media`
rules). The post-injection ordering check is the `awk` one-liner in
`reference/mobile-nav-collapse.md` § Source order — it asserts the
base rule appears at a lower line number than the first
`@media (max-width: 640px)` rule. Exit 0 = correct; exit 1 =
regression.

The stock pattern is the default; `reference/mobile-nav-collapse.md`
§ Alternative patterns documents priority+overflow, bottom nav, and
side-drawer as alternatives the user can request — the agent does
not pick between them autonomously.

### Phase 2.8 — Motion validation (mandatory when motion declared)

The static-DOM gates (2.5–2.7) read the file at `scrollY=0` with no
time elapsed; they cannot catch motion-specific failures: content
stuck `opacity: 0` because an anim-enter trigger fires past the
reading position; content rendered outside an `overflow: clip`
parent because a translateY magnitude exceeds the parent's slack;
scroll-driven animations whose `animation-range` completes only
after the section scrolled past; rAF loops with stale baseline
measurements drifting on resize / font-load / lazy-image-load;
section overlaps caused by transforms invisible in static DOM;
`prefers-reduced-motion` regressions leaving elements at the hidden
"from" state; no-JS regressions where the hidden initial state has
no `<noscript>` fallback.

The full procedure (5 passes — scroll-position probe, finding
classification, motion-bug checks, no-JS state, multi-viewport
scroll-driven check) lives in `reference/motion-validation.md`.

Phase 2.8 fires when the rendered file declares ≥ 1 named
choreography (per `_provenance.motion.choreographies[]`) OR
contains any of: `animation-timeline:`, `@scroll-timeline`,
IntersectionObserver with
`target.classList.add('anim-enter-visible')` patterns, or rAF loops
driven by `getBoundingClientRect()`. Static prototypes skip.

Findings are classified **by-design** (the choreography is supposed
to produce this state at this position; explained by a named
choreography in the brief) or **bug** (unintended state). Bugs
block `prototyped` until acknowledged or fixed.

When a bug cannot be auto-fixed within 3 iterations of the
recursive loop, surface to the user with the finding, the
classification reasoning, the 3 fix attempts tried, and a proposed
remediation requiring user input. Do not silently lower the gate.

Append to `_provenance.motionValidation`: ISO timestamp, probe
positions run, viewports tested, findings (hiddenInViewport,
sectionOverlaps, clippedReveals, rangeMismatches) with per-finding
classification, and `fixesApplied[]`. Save clean-pass screenshots
to `stardust/validation/<slug>/motion-<viewport>.png`.

#### Variant-convergence detector (Discipline 10)

When N > 1 variants render, each `<slug>-<id>-shape.md` declares:

- A distinct `dominantDimension` value (no two variants share it;
  per `notes/variant-convergence.md` Tier 1).
- A `compositionDelta` field listing ≥ 2 ways the variant's section
  sequence or layout strategy diverges from each sibling variant,
  e.g. `compositionDelta: ["section-order: hero ↔ stats",
  "layout: 3-up-grid → vertical-narrative"]`.

If `compositionDelta` is empty or trivial (only token-level deltas
— *"Color A vs Color B"*, *"font weight 400 vs 600"*), Phase 1
fails the brief and restarts ideation. The validator checks
pairwise: variant pairs `(A,B)`, `(A,C)`, `(B,C)` each need ≥ 2
structural changes.

**Mode-aware contract** (composes with `ia-fidelity` from
`stardust/reference/intent-dimensions.md` § 9):

- Under `ia-fidelity: verbatim` — A1/A2/A3 differ on **surface**
  axes only (type-weight, type-scale, density, motion-energy,
  color-temperature, spacing-rhythm). Structural deltas (section
  sequence / presence / IA priority / layout strategy) are
  **forbidden**. The detector inverts: a surface-only delta passes,
  a structural delta refuses.
- Under `ia-fidelity: reimagined` — A + B + C variants declare
  structural `compositionDelta` with ≥ 2 changes per pair.
  Surface-only deltas **fail** the brief.

(Worked pass: wasatch /beers A/B/C, 5 structural deltas per pair —
see `reference/lessons.md`.) Single-variant runs (N = 1) skip
Discipline 10 entirely.

### Phase 4 — Open and iterate

(Numbering skips 3 — the former *Compose the viewer* phase was
removed with the per-page before/after viewer; cross-references
elsewhere still name Phases 4, 5, 5.5.)

1. Open the just-written `<slug>-proposed.html` (or the user-chosen
   variant suffix when N > 1) in the browser via the
   `open <vfs-path>` shell command. This routes VFS paths through
   the preview service worker — **do not use `playwright-cli open`**
   for local prototype files; it bypasses the service worker and
   produces FILE NOT FOUND. Skip in pipeline-automation mode.
2. Mark the page `prototyped` in `state.json` — **gated on the
   Phase 2.5 critique + 2.6 audit + 2.7 adapt + 2.8 motion (when
   fired) results** (Discipline 9). If any gate returned ≥ 1 P0/P1
   finding (after the brand-faithful auto-dismiss) and the user has
   not acknowledged, the page stays `directed`; surface the
   findings grouped by source (`critique:` / `audit:` / `adapt:` /
   `motion:`) and recommend fixing or explicit acknowledgement. The
   transition does not require *approval* (a separate later step) —
   but all gates must clear, since a `prototyped` flag on work that
   fails P0/P1 misleads downstream consumers (migrate, the
   dashboard) about quality.
3. Report the prototype path and stop. Iteration happens via
   chat-driven impeccable commands or direct invocation (below).

#### Iteration paths

Not mutually exclusive — a page can move through both.

1. **Chat-driven (default).** The user gives a refinement phrase —
   *"make the hero bolder for home"*, *"less corporate"*. The agent:
   - Reads the phrase against
     `skills/stardust/reference/intent-dimensions.md` to identify
     which axes it moves.
   - Consults
     `skills/stardust/reference/impeccable-command-map.md` to pick
     the matching impeccable command (often `bolder`, `quieter`,
     `distill`, `typeset`, `colorize`, `layout`).
   - Shows the resolved plan to the user before executing.
   - Runs the command against `<slug>-proposed.html` (or a specific
     section when the phrase scopes one).
   - Re-validates per Phase 2 (`:root` block, data attributes,
     anti-toolbox audit, impeccable hard rules) and updates the
     file's provenance.
2. **Direct impeccable invocation.** The user runs a command
   directly — `$impeccable bolder
   stardust/prototypes/home-proposed.html`. Stardust isn't in the
   loop; the browser tab reloads whatever's on disk. Supported
   escape hatch. (Includes `$impeccable live` against the proposed
   file for in-browser picker iteration — an external tool the user
   invokes; stardust does not drive its poll loop.)

The master skill's "open and reasoned" principle applies to path 1:
reason publicly about the phrase before running any command; never
silently map a refinement to a fixed command.

### Phase 5 — Approval (+ fold-back, Part III)

Approval is **explicit**. Stardust does not auto-approve. The user
signals approval with **"approve <slug>"** or **"approve"**; the
agent confirms the slug before writing state, then proceeds.

On approval:

1. Verify the proposed file's provenance block lists the *current
   active* `direction.md` (defensive check — if the direction
   changed during iteration, the user must re-prototype against the
   new direction first).
2. **Run approval fold-back** per `reference/approval-fold-back.md`
   (Part III of the merged spec). When the approved variant is
   non-A AND `ia-fidelity` is `reimagined`, read the approved
   file's `_provenance.differentiationFromA[andB]` block plus the
   brief's `compositionDelta`, diff against the active direction,
   and propose folding any structural moves. The user picks
   `fold site-wide` (default) / `fold page-local` / `don't fold`.
   Under `ia-fidelity: verbatim` the fold-back is a no-op by
   construction (A1/A2/A3 are surface forks; nothing structural to
   fold). Flags: `--auto-fold` skips the gate; `--no-fold` opts out
   entirely.
3. Mark the page `approved` in `state.json`; append a
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
pre-`prototyped` gate; the `mobile:` line reports the Phase 2.7
result for review continuity. If multiple pages are in flight,
approval is per-page; the user can approve some and keep iterating
on others.

### Phase 5.5 — Adapt for mobile (retired; see Phase 2.7)

Adapt and the mobile-adapt audit moved to **Phase 2.7**, gating
`prototyped` instead of approval (lovesac 2026-05-03 — see
`reference/lessons.md`); this anchor is retained for external
cross-references that still name Phase 5.5.

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

| Path | Purpose |
|---|---|
| `stardust/prototypes/<slug>-shape.md` | Per-page compositional brief (Phase 1 output, craft input). |
| `stardust/prototypes/<slug>-proposed.html` | Proposed redesign (iteration target, migration source, user-facing review surface). |
| `stardust/state.json` | Updated with page status and approval history. |
| `DESIGN.json` | Updated with `extensions.divergence.anti_toolbox_hits` and any audit amendments from this render. |

## Failure modes

- **No directed pages.** Recommend `$stardust direct` and stop.
- **Pending direction.** Refuse to run; the user must resolve the
  direction first.
- **Validation failure (`:root` block missing, data attributes
  missing, unjustified anti-toolbox hit, impeccable rule
  violation).** Do not write the file. Surface the specific failure
  and a suggested fix.
- **Impeccable not available.** Refuse to run — impeccable is a
  hard requirement (Delegation mechanic). Recommend installing the
  impeccable plugin and re-invoke.

## Concurrency

Per `state-machine.md`: stardust does not lock. Two concurrent
`prototype` runs on different slugs are safe. Two on the same slug
are last-write-wins; warn the user if they explicitly try.

## Prep mode (--prep)

Moved to `reference/prep-mode.md` — **READ that file when `--prep`
is passed** (page-type gap fill, canon write-back, prep summary).
This anchor is retained for external cross-references
(e.g. `skills/prepare-migration/SKILL.md`).

## References

- `reference/prep-mode.md` — `--prep` pass: gap fill, canon write-back, prep summary. **Read when `--prep` is passed.**
- `reference/lessons.md` — field history (wasatch, nvidia, knack, lovesac, moneyhub) behind the gates and disciplines.
- `reference/page-shape-brief.md` — per-page compositional brief format (Phase 1 output, craft input).
- `reference/canon-extraction.md` — five-step canon extraction on approval in `--prep` mode.
- `reference/proposed-file-shell.md` — proposed-file schema (`:root` block, data attributes, provenance, content sourcing hierarchy, mobile-adapt audit).
- `reference/publish-sample.md` — `--publish-sample` sub-flow (eligibility, staging, PR; publishes at `https://{owner}.github.io/stardust-2/`).
- `reference/mobile-nav-collapse.md` — stock hamburger pattern Phase 2.7 auto-applies; HTML+CSS+JS, smoke-test, alternative patterns.
- `reference/motion-validation.md` — Phase 2.8 procedure: 5 passes, motion-bug checks, Playwright probe patterns.
- `reference/motion-registers.md` — five motion registers, selection heuristic, § Extension rule. Consumed by Phase 2.4.
- `reference/motion-stack.md` — cinematic technology choice (Lenis + CSS keyframes + rAF + IO; why not GSAP; Lenis pinning).
- `reference/motion-attributes.md` — `data-*` vocabulary the cinematic runtime consumes, per register.
- `reference/motion-runtime.md` — canonical inline runtime script; embedded verbatim in Phase 2.4.
- `reference/fidelity-refined-pass.md` — CSS recipes for `--fidelity=refined` (Discipline 8).
- `reference/anti-template-bank.md` — worked non-template moves for Discipline 3, plus § Extension rule.
- `reference/approval-fold-back.md` — Phase 5 fold-back: diff algorithm, surfacing UX, write logic, stale flagging, flags, verbatim no-op.
- `fixtures/composition-delta-good.md` / `fixtures/composition-delta-trivial.md` — shape briefs that pass / fail Discipline 10.
- `skills/stardust/reference/reference-research.md` — real-world design reference sourcing; consumed by Discipline 2.
- `../stardust/reference/token-contract.md` — `:root` token block (prototype + migrate).
- `../stardust/reference/data-attributes.md` — structural data attribute vocabulary (prototype + migrate).
- `../stardust/reference/divergence-toolkit.md` — anti-mediocrity rules consumed during render and iteration.
- `../stardust/reference/intent-dimensions.md` — 7-axis vocabulary for chat-driven refinement phrases.
- `../stardust/reference/impeccable-command-map.md` — which impeccable command fits a refinement phrase.
- `../stardust/reference/state-machine.md` — page lifecycle and stale rules.
- `../stardust/reference/artifact-map.md` — provenance shape.
- impeccable's `reference/craft.md` / `reference/live.md` — the underlying delegated commands.
