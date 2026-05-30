# Wheeler reference implementation

The patterns in this skill come from a working implementation at
`github.com/paolomoz/uplift-wheelercat-eds`. Two authored DA pages
exercise the full pattern catalogue. Use as a worked example when
scaffolding a new project.

## Live URLs

- **CVA blocks test (program archetype)**:
  `https://main--uplift-wheelercat-eds--paolomoz.aem.page/customer-value-agreements-blocks-test`
  Authored DA page using `template: wheelercat-cva-blocks`. Composes:
  hero · text.centered · cards.tiers (4-up with elevated flagship) ·
  text · cards.rail (5-up on dark) · columns.alternate (image-text
  alternation, image-left + image-right) · columns (TMR with numbered
  commitment list) · cta-bar (dark with yellow side rule).

- **Service blocks test (canon-propagation test)**:
  `https://main--uplift-wheelercat-eds--paolomoz.aem.page/service-blocks-test`
  Same theme, different page. Composes: hero.service (yellow-text-on-
  black pill CTA variant) · text.centered · cards.photos.seven ·
  cards.photos.three · cards.photos.two (photo-card grids with N-up
  variants, PLACEHOLDER image cards for missing photos) ·
  columns.alternate · columns · cta-bar.stacked (with body
  paragraph + single CTA).

- **Home (overlay-mode example)**:
  `https://main--uplift-wheelercat-eds--paolomoz.aem.page/`
  Authored as overlay-mode page (`template: wheelercat-home` with
  HTML template at `templates/wheelercat-home.html`).

## Key files to study

| Purpose | File |
|---|---|
| The block-flavor theme CSS (all patterns + workarounds) | `styles/wheelercat-cva-blocks.css` |
| The overlay-mode template | `templates/wheelercat-home.html` |
| The overlay-mode CSS | `styles/wheelercat-home.css` |
| Chrome fragments (header + footer) | `fragments/wheelercat-cva-blocks/{header,footer}.html` |
| Engine patch | `scripts/scripts.js` (function `applyTemplateOverlay`) |
| Header/footer block patches | `blocks/header/header.js`, `blocks/footer/footer.js` |
| Phone icon SVG (example of icon stub) | `icons/phone.svg` |
| Empty block stubs | `blocks/text/`, `blocks/cta-bar/` |

## DA content samples

The authored DA content for the two block-mode test pages lives in DA
at:

- `https://admin.da.live/source/paolomoz/uplift-wheelercat-eds/customer-value-agreements-blocks-test.html`
- `https://admin.da.live/source/paolomoz/uplift-wheelercat-eds/service-blocks-test.html`

To fetch:
```bash
curl -H "Authorization: Bearer $DA_TOKEN" \
  "https://admin.da.live/source/paolomoz/uplift-wheelercat-eds/customer-value-agreements-blocks-test.html"
```

The content shows the exact DA-block-table shape for each pattern in
`conventions.md` — useful as copy-paste templates when authoring new
pages.

## Companion stardust project

The prototypes that fed this implementation live at
`github.com/paolomoz/uplift-wheelercat`. Of particular interest:

- `stardust/prototypes/customer-value-agreements-proposed.html` — the
  source for the CVA blocks test
- `stardust/prototypes/service-proposed.html` — the source for the
  service blocks test
- `stardust/prototypes/customer-value-agreements-shape.md` and
  `service-shape.md` — the shape briefs that drove the block-mapping
  decisions
- `stardust/notes/skill-improvements.md` — the original 11-item
  ledger that became this skill's `conventions.md` + this reference

## Iteration history

The CVA test took 6 iterations (each a git commit) to reach pixel
parity. The diffs caught at each stage and their fixes are in the EDS
project's git log between commits `bd4fa7d` and `260da38`:

- Iteration 1: initial DA push + theme CSS
- Iteration 2: reverse odd rows in columns.alternate
- Iteration 3: CTA bar h2 margin-right auto, TMR buttons inline
- Iteration 4: breadcrumb block + CSS
- Iteration 5: yellow `›` separators via `<em>`
- Iteration 6.0–6.4: hero width, card icons, placeholder signatures,
  Fleet Call Now, CTA bar phone icon, em > a direct styling

The service test then took ~5 iterations (commits `b2e4667` through
`260da38`). Most fixes were generalizations of CVA patterns, not net-
new. By the third or fourth prototype in a brand, the iteration count
should approach 1 — most patterns will already be in the theme.

## Recommended onboarding for new wheelercat pages

To add a new page to this same wheelercat project:

1. Stardust-prototype the page (`stardust:prototype <slug>`)
2. Run `stardust:aem-import <slug> --eds-project /Users/paolo/stardust/uplift-wheelercat-eds`
3. The skill detects the existing wheelercat-cva-blocks theme, adds
   only the per-page DA content (no theme CSS regeneration needed if
   no new components are introduced)
4. Push, verify
5. Done — page is live at `aem.page/<slug>` and authorable in DA

For a new brand, the skill bootstraps a new theme:

1. New EDS project (`aem-edge-delivery-services:create-site`)
2. Stardust-prototype the first page
3. `stardust:aem-import <slug>` — generates the first theme CSS from
   the prototype + applies the engine patch (one-time per project)
4. Subsequent pages inherit the theme
