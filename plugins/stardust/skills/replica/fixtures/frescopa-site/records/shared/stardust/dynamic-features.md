# Dynamic features — Frescopa Atelier (https://markszulc.github.io/frescopa-atelier/)

Curated from stardust/dynamics/dynamic-features.generated-plan.md (dynamics-detect, 6 pages) plus the
home page's own behaviour scripts (shared/app.js, hero.js, flavor-dna.js). Hands-off: decisions below are
the run's named assumptions, never owner statements.

## Listings contract
none — the Journal and Machines lists are authored cards (no query index on the source; every card is in the
captured settled DOM). Filter pills act client-side over the authored cards.

## Features
| # | id | feature | class | reach | disposition | target | reproducibility | status | pattern | decision / owner | evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | cr-main-empty-at-load | 5 non-home pages are client-rendered (React DS bundle); settled DOM captured in full | CR | 5/6 | static-snapshot | content | self | planned | client-rendered-page | none — settled text 1.7–4.1k chars captured live, so no human capture needed; content ships as authored blocks | _dynamics.json, pages/*.html |
| 2 | f-footer-signup | footer newsletter form (no action, JS-wired) | F | 5/6 + home | client-only | block | self | planned | forms | assumption A1: no backend on source → rebuilt UI, submit handled client-side exactly as observed | fr-ftr__signup |
| 3 | f-signup-home | home "signup" form → origin GET | F | 1/6 | rebuild-native | block | needs-backend | interim | forms | assumption A1 (interim: UI rebuilt, no backend connected — same as source, a static GitHub Pages host) | form#signup |
| 4 | f-cafe-tour | café "Request this tour" control group (8 controls) | F | 1/6 | client-only | block | self | planned | client-compute | assumption A1 | cafe.html |
| 5 | x-commerce | cart / account / search icon buttons, price labels | X | 6/6 | static-snapshot | runtime | self | planned | chrome | assumption A2: the source buttons are inert UI (no commerce backend on a static demo host) → rebuilt as the same inert buttons; prices are authored text | header utils |
| 6 | b-header-scroll | header is-scrolled / is-hidden on scroll; transparent over dark heroes | R | 6/6 | rebuild-native | runtime | self | planned | chrome | none | app.js initHeader |
| 7 | b-mobile-nav | mobile menu toggle | R | 6/6 | rebuild-native | runtime | self | planned | chrome | none | app.js initNav |
| 8 | b-reveal | scroll reveal (.reveal → .is-in) | M | home+ | rebuild-native | runtime | self | planned | motion | only as observed by motion-observe | app.js initReveal |
| 9 | b-flavour-dna | flavour DNA SVG radar morphing between profiles | V | home, landing | client-only | block | self | planned | client-compute | none | flavor-dna.js |
| 10 | b-calendar | mood-aware calendar → brew suggestion | V | home | client-only | block | self | planned | client-compute | none | app.js initCalendar |
| 11 | b-hero-copy | hero copy positioned from image focal point; subtle parallax | M | home, landing | rebuild-native | block | self | planned | motion | only as observed | hero.js, app.js initParallax |
| 12 | b-hover-video | hover-to-play video reveal | V | landing | rebuild-native | block | self | planned | media | only as observed | app.js initHoverVideo |
| 13 | b-filter-pills | filter pills over cards (Journal, Machines, Café) | V | 3/6 | client-only | block | self | planned | client-compute | none | blog/machines/cafe |
| 14 | b-footer-year | footer year computed | D | 6/6 | rebuild-native | runtime | self | planned | clock | none | app.js initYear |

## Decision batch
- A1 (forms, rows 2–4): the source is a static GitHub Pages demo with no submission backend. Interim: same client-side
  behaviour as the source, no data leaves the page. Owner decision: connect a production endpoint (e.g. an EDS form
  sheet) when one exists.
- A2 (commerce chrome, row 5): cart/account/search are inert on the source; rebuilt inert. Owner decision: wire to a
  commerce backend if one is introduced.

## Register (decided-out)
| feature | reason | production statement |
|---|---|---|
| (none) | | |
