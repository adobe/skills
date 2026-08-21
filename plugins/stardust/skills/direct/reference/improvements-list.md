# Improvements list — worked examples

Consumed by `stardust:direct` Phase 2.5 (Mode A only). The contract,
specificity bar, and stopping condition live in `SKILL.md` § Phase
2.5; this file carries the worked examples that calibrate item
specificity.

## The five categories, with examples

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

## Format example

Markdown, with a `_provenance` frontmatter block per the artifact-map
convention. Each item is a numbered list entry with a category tag, a
weakness statement, and a one-line fix:

```markdown
<!--
_provenance:
  writtenBy: stardust:direct
  writtenAt: 2026-04-29T11:00:00Z
  readArtifacts:
    - stardust/current/_brand-extraction.json
    - stardust/current/brand-review.html
    - stardust/current/pages/<slug>.json
  stardustVersion: 0.10.x
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
