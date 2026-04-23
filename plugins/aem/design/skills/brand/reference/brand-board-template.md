# Brand Board Template

The brand board is a self-contained HTML file rendered from `brand-profile.json`. The designer reviews this visual artifact — never the raw JSON.

The template has two halves: a **data contract** (what information must be rendered) and a **chassis** (how it's presented). The data contract is fixed; the chassis is picked per run from a library.

## Data contract · what must be rendered

Every brand board MUST render, where data exists in `brand-profile.json`, the following information. These are information obligations — presentation is a chassis concern, handled separately.

- **Masthead** — brand name, tagline, short philosophy / positioning statement
- **Logo variants** — primary mark, alternates (white-on-dark, black, stacked), clear-space guidance, do/don't
- **Color palette** — every color entry with `name`, `hex`, brand-native `role`, optional `use`, optional `pantone`
- **Typography** — every face in `typography` with family, weights, role, and a live specimen in the actual face (or closest web-safe fallback, flagged if substituted)
- **Voice** — character statement, trait tags (this/not-this), paired do/don't copy examples, hard rules
- **Tone adaptation** — writing-goal cards (educate / engage / inspire) if present, clever-vs-clear guidance if present
- **Motifs** — every motif with name, description, usage, and a visual demo
- **Components** — primary/secondary/alert button patterns, plus any brand-specific component (stamp, tag, badge, etc.)
- **Photography direction** — style rules, do/don't grid, subject guidance
- **Content pillars** — if present, one card per pillar with name + description
- **Personas** — profile card per persona with values, motto, behavioral stats
- **Spacing & shape** — spacing scale blocks, border-radius samples (if present)

Render only what has data. Omit sections where the brand-profile field is null or missing. Do NOT invent data to fill a section — an empty section is a valid signal that the brand hasn't captured that dimension yet.

## Chassis · how it's presented

The chassis determines navigation pattern, section order, hero shape, eyebrow conventions, spacing rhythm, typography emphasis, and motif placement. Available chassis live under `brand/reference/chassis/`:

- **`classic-archive`** — numbered sections, sticky top nav, masthead with metadata stamp, editorial-archival feel
- **`dashboard`** — fixed left sidebar, cards-as-widgets, meters and status chips, operations-console feel
- **`magazine`** — masthead with volume/issue/date, column text, pull quotes, magazine department heads
- **`pinboard`** — no sticky nav, spatial cluster arrangement, handwritten labels, scrapbook overlap

Read the chosen chassis's `.md` file in full before rendering. Each chassis specifies its nav, section order, hero shape, eyebrow conventions, spacing, typography register, and motif placement in detail.

### Chassis selection

The `brand` skill picks the chassis in Phase 3 of `brand/SKILL.md`. Selection is:

1. **Designer override.** If `_divergence.chassis` is already set (designer picked explicitly, or a previous run's profile is being refactored), use that value.

2. **Hash-based default.** Compute `byte[3]` of the seed hash (already calculated for § 2 of `_shared/divergence-toolkit.md`), modulo the number of chassis files available. Maps to alphabetical order of chassis files: 0 → classic-archive, 1 → dashboard, 2 → magazine, 3 → pinboard.

3. **Seed-informed preference.** The hash-based pick is overridden when it lands on a chassis that flatly contradicts the seed's register. Preference table:

   | Seed register | Preferred chassis |
   |---|---|
   | legal contract · repair manual · museum didactic · hospital discharge · pharmacy insert | classic-archive OR dashboard |
   | railway timetable · broadcast captioning · sports scorecard · liturgical program | dashboard |
   | tabloid · memoir · auction catalogue · travel agency brochure · real-estate listing · supermarket flyer | magazine |
   | zine · (or brands with `collective`, `community`, `youth` in their content pillars) | pinboard |
   | field guide | classic-archive OR magazine |

   When a register has multiple preferred chassis, re-run the hash within that subset.

4. **Fallback.** If no preference fits, default to `classic-archive`.

Record the chosen chassis in `_divergence.chassis` on the emitted profile.

## Design guidelines · cross-chassis

Rules that apply regardless of chassis:

- Use the brand's own colors and fonts in the board wherever possible.
- **Page body background is derived from the brand's palette**, specifically the color whose `use` field names it as the page ground. There is NO default substrate — picking "warm neutral" / "cream" / `#faf9f6` without a brand-derived reason is a divergence hit. See [`../../_shared/divergence-toolkit.md`](../../_shared/divergence-toolkit.md) § 1 *Palette-family moves* ("Cream/paper as default page ground") and § 2.5 *Ground color by seed* for what substrate each seed implies. Example seeds that genuinely want cream: 1920s–1960s × letterpress / riso / folded-paper / field-guide / travel-brochure / museum-didactic. Example seeds that should NOT default to cream: 1990s × legal-contract (pale gray or stark white); 1970s × enamel-sign (saturated ground); 2010s+ × broadcast / sports-scorecard (true black / true white / saturated monotone).
- Dark sections / inverted blocks only when the brand's palette supports an ink-or-deeper-than-ground surface — do not invert arbitrarily.
- All color swatches rendered at 80×80px minimum with hex, role, and `use` (if present).
- Type specimens use the actual extracted fonts (or closest web-safe fallback, flagged in `_provenance.synthesized_inputs` if substituted).
- Do/Don't pairs color-coded using the brand's own palette — green only if the brand has green; red only if the brand has red. Do NOT inject `#7B997C` or `#C8102E` as brand-external tokens.
- Responsive — must look good on desktop (primary) and tablet. Mobile is not a Phase-3 concern.

## Template Generation

When rendering the brand board:

1. Read `aem-design/brand-profile.json`.
2. Pick the chassis per the "Chassis selection" rules above. Record in `_divergence.chassis`.
3. Read the selected chassis's full specification in `brand/reference/chassis/<chassis-name>.md`.
4. Render the board following the chassis's rules for navigation, section order, hero shape, eyebrows, spacing, typography register, and motif placement.
5. Render only data-contract sections that have data. Omit empty sections.
6. Render the logo using `<img src="assets/logo.svg">` (or matching extension). Read the path from `brand-profile.json`'s `logo.path` and make it relative to the board file (both live under `aem-design/`, so `assets/logo.*` is correct). **Never inline the SVG** — the brand profile points at the real asset; the board consumes it.
7. Write the complete HTML to `aem-design/brand-board.html`.
8. Tell the designer which chassis was picked and why (which branch of the selection rules fired).

## Reference

For chassis-specific reference artifacts and examples:
- `tmp/e2e-3/aem-design/brand-board.html` — classic-archive (baseline)
- `tmp/e2e-3/aem-design/brand-board-v1-console.html` — dashboard
- `tmp/e2e-3/aem-design/brand-board-v2-avanguardia.html` — magazine
- `tmp/e2e-3/aem-design/brand-board-v3-pinboard.html` — pinboard

For broader brand-board depth, see the Vitamix example at `.superpowers/brainstorm/*/content/brand-board-full.html` in the source project (not bundled with this skill).
