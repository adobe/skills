# Prototype lessons (field history)

Historical runs that motivated rules in `SKILL.md`. The **rules
live inline in SKILL.md**; this file preserves the evidence and the
full narratives behind them. Read when a gate's rationale is
questioned or a rule looks over-strict.

## wasatch.beer dry-run — 2026-05-13

- **Gate pair (Phases 2.5/2.6).** The dry-run caught two real bugs
  that the brief and craft phases missed — both caught by the
  **audit** half, not critique: (1) a WCAG contrast miscalculation
  off by 0.27–1.86 points on multiple text/substrate pairs of
  /beers variant C (hand-estimated `_provenance.wcagContrast`
  blocks vs the audit's computed ratios); (2) an LCP image
  lazy-loaded on the first catalog entry. The audit-driven fix
  darkened the Cutthroat substrate from `#1c8a7a` to `#177566` to
  clear AA body (4.5:1) and recolored the pour-link from yellow to
  white. Motivates: Phase 2.6's computed-contrast authority (the
  ≥ 0.25 discrepancy P1) and the LCP image audit.
- **JS-dependent-hidden-state mitigation.** /beers variant C passed
  the broken-by-default detector on all 4 files via the
  `html.js-anim` gate class set inline in `<head>` before the
  stylesheet loads, plus a CDN-failure fallback — confirming that
  mitigation pattern works (Phase 2.6 detector, mitigation #3).
- **Discipline 10.** The /beers A/B/C run declared 5 structural
  deltas per pair (`compositionDelta_vs_A` / `compositionDelta_vs_B`
  blocks in `_provenance`): substrate-strategy, section-presence,
  photo-treatment, section-order, section-completeness. The
  variant-convergence detector PASSED on all three pairs.

## nvidia.com home — 2026-05-04

The critique on the home prototype returned 1 P0 + 2 P1 + 3 P2; the
audit on the **same artifact** returned six additional findings: no
skip-link, theme carousels without keyboard arrow nav, hero ~3.5MB
without responsive `<picture>`, layout-property animation, JS-gated
reveal with no `<noscript>` fallback, and
`scroll-behavior: smooth` not respecting `prefers-reduced-motion`.
None were design issues; none would have been caught by critique
alone. Without an audit gate the page would have been marked
`prototyped` with quantifiable WCAG failures. Motivates: Phase 2.5's
critique + audit as a mandatory complementary pair.

## knack.com — 2026-06-26

Under a verbatim direction, impeccable's design hook flagged
em-dashes and "enterprise-grade" on Knack's own captured headings
("Built on Enterprise-Grade Components"). Rewriting captured copy to
satisfy a cadence rule would have been exactly the fabrication the
fidelity setting exists to prevent; the only correct response was to
leave the captured copy untouched and record the bypass. Motivates:
Discipline 9's copy-cadence detector bypass under verbatim fidelity.

## lovesac.com showcase — 2026-05-03

Stakeholders eyeballing showcase variants on a phone got the
unadjusted desktop layout, because adapt ran post-approval (the old
Phase 5.5). Motivates: promoting adapt + the mobile-adapt audit to
Phase 2.7, gating `prototyped` so a non-adapted prototype never
lands as `prototyped` in the first place.

## moneyhub.com migration

The agent read `surprise: low` / `verbatim` as license to strip the
page to a plain type-hero on a flat ground — faithful but
forgettable, under-selling the redesign. Motivates: Discipline 3's
"`low` ≠ generic" clause (brand-faithful + improvements + full
signature preservation, not "the most obvious faithful
interpretation").
