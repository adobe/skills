# stardust:prototype: phases 2.5 to 2.8, the quality gates

The text of this part of `skills/prototype/SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

### Phases 2.5 – 2.8 — Quality gates: Critique → Audit → Adapt → Motion (Discipline 9)

Four mandatory gate phases run by default before any prototype
can advance to `prototyped`. They implement Discipline 9: critique
covers *design*, audit covers *technical correctness*, adapt
covers *viewport behaviour*, motion covers *scroll-driven and
time-driven choreography correctness*. P0/P1 findings from **any**
of the four block `prototyped` until acknowledged. None have an
opt-out flag (per § No opt-outs).

| Sub-phase | Focus | Catches |
|---|---|---|
| **2.5 Critique** | Design judgment | AI-slop reflexes, hierarchy regressions, contrast / cognitive issues, register drift |
| **2.6 Audit** | Technical correctness | a11y (alt, focus, contrast ratios computed), responsive overflow at 4–6 viewports, performance (LCP, image weights), JS-dependent-hidden-state |
| **2.7 Adapt** | Viewport behaviour | doc-width · overflow · sticky · grid columns · font scaling at 1920 / 1440 / 1280 / 800 / 414 / 375, mobile-nav-collapse audit |
| **2.8 Motion** | Scroll / time-driven correctness | clipped-container reveal timing, animation-range vs reading position, anim-enter trigger reachability, reduced-motion override completeness, no-JS fallback, multi-viewport scroll-driven check |

Phase 2.8 fires only when the rendered file declares ≥ 1 named
choreography (per the page-shape brief's motion stack) OR uses
`animation-timeline:`, `@scroll-timeline`, IntersectionObserver-driven
entry triggers, or rAF loops reading `getBoundingClientRect()`,
**OR** when Phase 2.4 (motion application under `--cinematic`)
emitted a `<slug>-cinematic.html` file with motion attributes per
`reference/motion-attributes.md`. Cinematic prototypes additionally
trigger the cinematic-mode gates in `reference/motion-validation.md`
§ Pass 6 (Lenis bootstrap, reduced-motion fallback completeness,
scroll-jack check, three-position screenshots, register-match
audit, motion C-cliff detector). Static prototypes skip the
discipline entirely.

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

A 2026-05-04 hardware-vendor home prototype critique returned
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

1. **Run both validators in parallel.** Invoke impeccable twice in one
   batch of skill invocations (Claude Code form shown; see § Invoking
   impeccable):

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

3. **Vision gate.** Render a screenshot of the proposed file and
   study it NEXT TO the captured source screenshot
   (`stardust/current/assets/screenshots/<slug>.png` when present).
   Judge visually, not from the DOM: **brand-fit** (would the
   brand owner say "that's us"?), **signature preservation** (hero
   medium / motif carried, per Discipline 3's signature clause),
   and **hierarchy at a glance** (does the eye land where the
   brief says it should?). Record
   `_provenance.visionCheck = { verdict: pass|fail, observations[] }`;
   a `fail` is a P1 finding through the same gate mechanics as
   critique/audit findings. The vision gate complements — never
   replaces — the deterministic critique/audit pair.

4. **Surface findings in the user-facing report**, grouped by
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

5. **Gate `prototyped` status on P0/P1 findings from EITHER
   validator.** If the merged-and-deduped findings list (after
   the brand-faithful auto-dismiss, plus a vision-gate `fail`
   from step 3, which counts as P1 here) contains any P0 or P1,
   do **not** mark the page `prototyped` in `state.json` yet. The
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

6. **Optionally spawn an LLM design-review subagent** for an
   independent take when the user wants more than the
   deterministic detector (where the harness offers a subagent
   primitive; otherwise run a separate review pass in the same
   session). Trigger only when the user explicitly
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

**JS-dependent-hidden-state detector.** The audit catches initial-state CSS that hides content via `clip-path:
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

Invoke impeccable adapt against the rendered file (Claude Code form;
see § Invoking impeccable):

```
Skill {
  skill: "impeccable:impeccable",
  args: "adapt stardust/prototypes/<slug>-proposed.html"
}
```

Pass the captured viewport breakpoints from
`DESIGN.json#extensions.breakpoints` if present; otherwise adapt
picks defaults (640 / 768 / 1024 / 1280 are the stardust spec
defaults), written mobile-first per § Mobile-adapt audit below. The full target list is
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
- The file declares no `@media (width >= N)` rule (one layout at
  every width), or any `@media` with an upper bound (`max-width`,
  `width <`/`<=`). Queries are mobile-first: the base styles are
  the phone layout, because deploy lifts this CSS into blocks as
  written (deploy `#162`). Check: `breakpoint-lint.mjs --root
  stardust/prototypes --dirs <slug>-proposed.html` exits 0.
  Refusal code: `audit/responsive: desktop-first-query`.
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

After injecting, run the source-order check in
`reference/mobile-nav-collapse.md` § Source order.

The stock pattern is the default; `reference/mobile-nav-collapse.md`
§ Alternative patterns documents priority+overflow, bottom nav,
and side-drawer as valid alternatives the user can request, but
the agent does not pick between them autonomously.

### Phase 2.8 — Motion validation (mandatory when motion declared)

Static-DOM gates (2.5 critique, 2.6 audit, 2.7 adapt) all read the
proposed file at `scrollY=0` with no time elapsed. They cannot
catch motion-specific failure modes:

- Content stuck `opacity: 0` because an anim-enter trigger fires
  past the user's reading position.
- Content rendered outside its parent's `overflow: clip` boundary
  because a translateY animation magnitude exceeds the parent's
  slack room.
- Scroll-driven animations whose `animation-range` completes only
  after the section has fully scrolled past, leaving the reveal
  state invisible during the readable window.
- rAF loops with stale baseline measurements drifting on resize /
  font-load / lazy-image-load.
- Section overlaps caused by transforms that don't appear in
  static DOM.
- `prefers-reduced-motion` regressions where the choreography is
  disabled but the element is left at the hidden "from" state.
- No-JS regressions where the choreography's hidden initial state
  has no `<noscript>` fallback.

The full procedure (5 passes — scroll-position probe, finding
classification, motion-bug checks, no-JS state, multi-viewport
scroll-driven check) lives in `reference/motion-validation.md`.

Phase 2.8 fires when the rendered file declares ≥ 1 named
choreography (per `_provenance.motion.choreographies[]`) OR contains
any of: `animation-timeline:`, `@scroll-timeline`, IntersectionObserver
with `target.classList.add('anim-enter-visible')` patterns, or rAF
loops driven by `getBoundingClientRect()`. Static prototypes skip.

Findings are classified as **by-design** (the choreography is
supposed to produce this state at this position; explained by a
named choreography in the brief) or **bug** (the choreography
produces an unintended state). Bugs block `prototyped` until
acknowledged or fixed.

When a bug cannot be auto-fixed within 3 iterations of the recursive
loop, surface to the user with the finding, the classification
reasoning, the 3 fix attempts that were tried, and a proposed
remediation that requires user input. Do not silently lower the
gate.

Append an entry to the proposed file's `_provenance.motionValidation`
recording: ISO timestamp, probe positions run, viewports tested,
findings (hiddenInViewport, sectionOverlaps, clippedReveals,
rangeMismatches) with per-finding classification, and `fixesApplied[]`.
Save clean-pass screenshots to `stardust/validation/<slug>/motion-<viewport>.png`.

#### Variant-convergence detector (Discipline 10)

When N > 1 variants render, each `<slug>-<id>-shape.md` declares:

- A distinct `dominantDimension` value (no two variants share it).
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
