# Brand Board Template

The brand board is a self-contained HTML file rendered from `brand-profile.json`. The designer reviews this visual artifact — never the raw JSON.

## Structure

The brand board is a single HTML file with embedded CSS. No external dependencies. It must render correctly when opened directly in a browser or served via the AEM dev server.

### Required Sections (render if data present, skip if absent)

1. **Sticky Navigation** — fixed top bar with brand name + section jump links
2. **Brand Philosophy** — hero section with mission statement and positioning (dark background, serif typography)
3. **Logo** — variant grid (primary, white-on-dark, black, alternative), clear space diagram, do/don't grid
4. **Color Palette** — primary swatches (large, with Pantone + hex + role), secondary swatches, web-specific functional colors
5. **Typography** — live type specimens per hierarchy level (heading, subheading, body, eyebrow, button), typographic rules
6. **Photography & Video** — style direction cards (studio, video, social) with do/don't grid
7. **Voice** — character statement, trait tags (this/not-this split), paired do/don't copy examples, hard rules
8. **Tone Adaptation** — writing goal cards (educate/engage/inspire), clever vs. clear guidance
9. **Content Pillars** — pillar cards with icons and descriptions
10. **Personas** — profile card with values, motto, behavioral stats
11. **Spacing & Shape** — visual spacing scale blocks, border radius samples

### Design Guidelines

- Use the brand's own colors and fonts in the board wherever possible
- **Page body background is derived from the brand's palette**, specifically the color whose `use` field names it as the page ground. There is NO default substrate — picking "warm neutral" / "cream" / `#faf9f6` without a brand-derived reason is a divergence hit. See [`../../_shared/divergence-toolkit.md`](../../_shared/divergence-toolkit.md) § 1 *Palette-family moves* ("Cream/paper as default page ground") and § 2.5 *Ground color by seed* for what substrate each seed implies. Example seeds that genuinely want cream: 1920s–1960s × letterpress / riso / folded-paper / field-guide / travel-brochure / museum-didactic. Example seeds that should NOT default to cream: 1990s × legal-contract (pale gray or stark white); 1970s × enamel-sign (saturated ground); 2010s+ × broadcast / sports-scorecard (true black / true white / saturated monotone).
- Dark sections for hero/philosophy and voice character statement only when the brand's palette supports an ink-or-deeper-than-ground surface — do not invert arbitrarily
- All color swatches rendered at 80x80px minimum with hex, Pantone, and role labels
- Type specimens use the actual extracted fonts (or closest web-safe fallback, flagged if substituted)
- Do/Don't pairs color-coded: green (#7B997C) for do, red (#C8102E or brand red) for don't
- Responsive — must look good on desktop (primary) and tablet
- Sticky nav enables quick section jumping on long boards

### Template Generation

When rendering the brand board, read `aem-design/brand-profile.json` and:
1. Build the sticky nav from present sections (skip links for absent sections)
2. Render each section using the data fields. Omit entire sections if the corresponding brand-profile field is null/missing.
3. Write the complete HTML to `aem-design/brand-board.html`
4. Tell the designer to open the URL to review
5. Render the logo section using an `<img src="assets/logo.svg">` (or matching extension). Read the path from `brand-profile.json`'s `logo.path` and make it relative to the board file (both live under `aem-design/`, so `assets/logo.*` is the correct relative reference). **Never inline the SVG** — the brand profile points at the real asset; the board consumes it.

### Reference

See the Vitamix example at `.superpowers/brainstorm/*/content/brand-board-full.html` in the project for the full-depth visual reference.
