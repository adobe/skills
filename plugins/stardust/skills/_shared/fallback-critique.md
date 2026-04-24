# Fallback: Critique

Inline substitute for `/impeccable critique` from the `impeccable` plugin. Produces a lighter heuristic review — enough to catch common issues before showing output to the user.

## When to use

When a skill (`wireframes`, `prototype`) would normally run `/impeccable critique` between iterations but impeccable is not available.

## Rubric (10 heuristics, 0–2 each)

For each heuristic, assign a score:
- **0** = clearly fails (call out and suggest fix)
- **1** = acceptable (move on)
- **2** = strong (no action)

Total: 0–20. Below 12 → iterate before showing to user; 12+ → show and collect feedback.

1. **Hierarchy** — does the eye land where it should first? Primary heading wins, secondary elements support.
2. **Contrast** — is text legible against its background? WCAG AA at minimum (4.5:1 body, 3:1 large).
3. **Proximity** — are related elements grouped, unrelated ones separated, via whitespace?
4. **Alignment** — does every element align to at least one other? Ragged alignment looks accidental.
5. **Scale rhythm** — does the type scale progress cleanly? No adjacent sizes that look like mistakes.
6. **Color discipline** — does the palette stay within the brand tokens? No one-off hex values.
7. **Spacing rhythm** — does vertical rhythm feel intentional? No adjacent sections with near-identical padding (creates confusion).
8. **Button weight** — do primary CTAs read as primary? Are secondary/tertiary visually subordinate?
9. **Image integration** — do images feel designed in, not dropped on top? Cropping, aspect, and placement considered.
10. **Copy-to-design coherence** — does the copy match the design's tone? Quiet copy with loud design (or vice versa) feels off.

## Automated checks

Before scoring, run these (optional but recommended):

```bash
# Broken <img> references
grep -oE 'src="[^"]+"' <file> | cut -d'"' -f2 | while read src; do
  [ -f "$src" ] || [[ "$src" =~ ^https?:// ]] || echo "missing: $src"
done

# Unclosed tags (basic)
grep -c '<section' <file>
grep -c '</section' <file>
# counts should match
```

## Report format

```
Critique of stardust/prototypes/home.html:

Strengths (scored 2):
- Hierarchy: hero establishes clear primary→secondary→body order
- Color discipline: stays within brand-profile palette

Issues (scored 0):
- Spacing rhythm: sections 2, 3, 4 all use --section-padding with no variation → monotone
  → try varying padding on section 3 for contrast

Acceptable (scored 1): rest

Total: 15/20 → show to user
```

## Anti-patterns to flag explicitly

- **Two hero sections** (only one per page).
- **CTA lost in a sea of CTAs** (primary action unclear).
- **Orphaned headings** (H2 followed immediately by H4 with no H3).
- **Placeholder text that made it through** ("Lorem ipsum", "TODO", "[placeholder]").
- **Image alt text empty or generic** ("image", "photo").

## Rules

- **Silent announcement policy** per `soft-deps.md` — don't tell the user the fallback is running.
- **Fix before showing.** If score is below 12, iterate silently before presenting to the user.
- **Never claim to be `/impeccable critique`.** The output is a lighter heuristic pass; don't oversell it.
