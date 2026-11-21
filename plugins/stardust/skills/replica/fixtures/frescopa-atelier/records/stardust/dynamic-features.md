<!-- stardust provenance: skill=stardust:dynamics · phase=triage (curated, hands-off) · 2026-11-21 · input stardust/current/_dynamics.json, stardust/dynamics/dynamic-features.generated-plan.md, stardust/replica/motion/ -->
# Dynamic features — Fréscopa Atelier home (curated)

Source: https://markszulc.github.io/frescopa-atelier/index.html (static GitHub Pages site; 0 first-party API endpoints,
0 third-party scripts beyond Google Fonts; all behaviour is three local scripts: shared/app.js, hero.js, flavor-dna.js).

## Listings contract

None — no client-rendered or index-fed listing on the page. The three "New favourites" cards are authored content.

## Features

| # | id | class | feature | disposition | target | reproducibility | status | notes |
|---|---|---|---|---|---|---|---|---|
| 1 | f-form-signup | F | footer newsletter form (1 email field) | rebuild-native (UI) | footer block | self (as captured) | implemented in prototype | Source form is inert: `action="#"`, `onsubmit="return false"`. Rebuilt with the same no-op submit (prevented). **Decision named: production newsletter endpoint** (owner) — interim = source behaviour (no submission). Not regulated-PII beyond an email address; nothing is captured. |
| 2 | x-commerce-signals | X | cart icon "Cart, 0 items", 3 × "Add to cart" buttons, prices | rebuild-native (UI) | header block, cards block | self (as captured) | implemented in prototype | Source buttons have no handlers (static UI). Replicated inert. **Decision named: commerce backend** (owner). Not decided-out. |
| 3 | w-flavor-radar | — | flavour DNA radar: SVG build, bloom on first view (threshold 0.35, 1100 ms expo), 3 profile buttons (820 ms morph), autocycle 3 s until a click | rebuild-native | flavor-dna block | self | implemented, motion parity | motion-compare: is-active ×9 parity |
| 4 | w-mood-calendar | — | mood calendar: day buttons set the brew card (tag/title/note), autocycle 3 s once on screen until a click | rebuild-native | calendar block | self | implemented, motion parity | |
| 5 | w-reveal | — | reveal-on-scroll (.reveal → .is-in, threshold 0.14, rootMargin -8 %), 900 ms expo | rebuild-native | scripts.js (site-wide) | self | implemented, motion parity | is-in ×20 parity |
| 6 | w-header-morph | — | header: `is-scrolled` > 12 px, `is-hidden` scrolling down past 480 px; mobile drawer | rebuild-native | header block | self | implemented, motion parity | header scroll-morph parity, 600 ms |
| 7 | w-hero-art | — | art-directed hero: copy top/width from product position in the cover-cropped image (≥ 760 px) | rebuild-native | hero block | self | implemented | live inline style 166 px / 378 px at 1440 reproduced (gate Δh 0) |
| 8 | w-parallax | — | parallax translate on hero + café images (12 / 14 px), pointer devices only | rebuild-native | hero, cafe blocks | self | implemented | |

## Decision batch (owner, hands-off: interim tier ships, decision named)

1. Newsletter production endpoint (row 1) — interim: inert form, as on the source.
2. Commerce backend for cart / add-to-cart (row 2) — interim: inert UI, as on the source.

## Register

No register entries: every row replicates captured behaviour; martech out of scope (operator).
