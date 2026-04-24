# Brand Board Template

The brand board is a self-contained HTML file rendered from `brand-profile.json`. The designer reviews this visual artifact — never the raw JSON.

## Data contract · what must be rendered

Every brand board MUST render, where data exists in `brand-profile.json`, the following information. Render only what has data. Omit sections where the brand-profile field is null or missing. Do NOT invent data to fill a section — an empty section is a valid signal that the brand hasn't captured that dimension yet.

Canonical top-to-bottom section order:

1. **Masthead** — brand name, tagline, short philosophy / positioning statement
2. **Color palette** — every color entry with `name`, `hex`, brand-native `role`, optional `use`, optional `pantone`
3. **Typography** — every face in `typography` with family, weights, role, and a live specimen in the actual face (or closest web-safe fallback, flagged if substituted)
4. **Voice** — character statement, trait tags (this/not-this), paired do/don't copy examples, hard rules
5. **Tone adaptation** — writing-goal cards (educate / engage / inspire) if present, clever-vs-clear guidance if present
6. **Motifs** — every motif with name, description, usage, and a visual demo
7. **Components** — primary/secondary/alert button patterns, plus any brand-specific component (stamp, tag, badge, etc.)
8. **Photography direction** — style rules, do/don't grid, subject guidance
9. **Content pillars** — if present, one card per pillar with name + description
10. **Personas** — profile card per persona with values, motto, behavioral stats
11. **Logo variants** — primary mark, alternates (white-on-dark, black, stacked), clear-space guidance, do/don't
12. **Spacing & shape** — spacing scale blocks, border-radius samples (if present)

## Design guidelines

- Use the brand's own colors and fonts in the board.
- **Page body background is derived from the brand's palette**, specifically the color whose `use` field names it as the page ground. There is NO default substrate — picking "warm neutral" / "cream" / `#faf9f6` (or any rebrand thereof — vellum, kami, bone, ivory, eggshell) without a brand-derived reason is a divergence hit. See [`../../_shared/divergence-toolkit.md`](../../_shared/divergence-toolkit.md) § 1 *Palette-family moves* and § 2.5 *Ground-color seed* for what substrate should be picked.
- Dark sections / inverted blocks only when the brand's palette supports an ink-or-deeper-than-ground surface — do not invert arbitrarily.
- Sticky top navigation with section links is recommended for long boards.
- All color swatches rendered at 80×80px minimum with hex, role, and `use` (if present).
- Type specimens use the actual extracted fonts (or closest web-safe fallback, flagged in `_provenance.synthesized_inputs` if substituted).
- Do/Don't pairs color-coded using the brand's own palette — green only if the brand has green; red only if the brand has red. Do NOT inject `#7B997C` or `#C8102E` as brand-external tokens.
- Responsive — must look good on desktop (primary) and tablet. Mobile is not a Phase-3 concern.

## Template Generation

When rendering the brand board:

1. Read `stardust/brand-profile.json`.
2. Generate `stardust/brand-board.html` rendering the data contract sections in the canonical order above.
3. Render only data-contract sections that have data. Omit empty sections.
4. Use the brand's own extracted colors and fonts. The page ground is brand-derived (see Design guidelines).
5. Self-contained HTML with embedded CSS. External font + image URLs fine. No external JS.
6. Render the logo using `<img src="assets/logo.svg">` (or matching extension). Read the path from `brand-profile.json`'s `logo.path` and make it relative to the board file (both live under `stardust/`, so `assets/logo.*` is correct). **Never inline the SVG** — the brand profile points at the real asset; the board consumes it.
7. Write the complete HTML to `stardust/brand-board.html`.
8. Tell the designer the file path.

## Reference

For brand-board reference artifacts in this repo:
- `tmp/e2e-3/stardust/brand-board.html` (Nonna's Arsenal — the original baseline)
- `tmp/e2e-5/stardust/brand-board.html` · `tmp/e2e-6/stardust/brand-board.html` · `tmp/e2e-7/stardust/brand-board.html` (first-pass test runs)

For broader brand-board depth, see the Vitamix example at `.superpowers/brainstorm/*/content/brand-board-full.html` in the source project (not bundled with this skill).
