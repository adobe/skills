# stardust:direct: phase 2.5, improvements list

The text of this part of `skills/direct/SKILL.md`, which points here. "Above" and "below" refer to the order of the sections in that file.

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

The agent should not rationalise — *"the hero is dated"* is not an
item, *"the typography could be more modern"* is not an item.
Genuine empty-list cases occur when the captured site is already at
a high execution level on observable dimensions. In that case the
honest answer is to surface the empty list and propose reduced
scope (density-and-contrast adjustments only, or pivot to a single
exploratory variant rather than three).
