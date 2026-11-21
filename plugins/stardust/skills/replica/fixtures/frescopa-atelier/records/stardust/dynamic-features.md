# Dynamic features — markszulc.github.io/frescopa-atelier (index.html)

Detector: stardust/current/_dynamics.json (dynamics-detect, 2 findings) + extract --dynamics reach (0 endpoints, 0 hydration) + a read of the source scripts (shared/app.js, hero.js, flavor-dna.js).

## Listings contract
none — no listing blocks.

## Features
| # | id | feature | class | reach | disposition | target | reproducibility | status | pattern | decision / owner | evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | f-form-signup | footer newsletter "Sign up" (email; `action="#" onsubmit="return false"` — never submits on source) | F form | 1/1 | rebuild-native | block (footer fragment) — inert form as on source | full | planned | forms | self: source posts nowhere; replicate as non-submitting | index.html L305 |
| 2 | x-commerce | "Add to cart" buttons ×3, cart icon "Cart, 0 items" (no handler on source) | X commerce | 1/1 | decided-out | content — buttons render, no action (as source) | full | planned | — | self: no cart exists on source | dynamics-detect |
| 3 | dna-radar | flavour-DNA SVG radar: blooms on view, auto-cycles 3 profiles every 3 s, click to choose | client-only | 1/1 | client-only | block JS (flavour-dna) | full | planned | — | self | shared/flavor-dna.js |
| 4 | mood-calendar | calendar days → brew suggestion, auto-cycles every 3 s, click to choose | client-only | 1/1 | client-only | block JS (calendar) | full | planned | — | self | shared/app.js initCalendar |
| 5 | chrome-morph | header is-scrolled >12px, hides scrolling down past 480px; mobile nav toggle | runtime | 1/1 | rebuild-native | runtime (header block) | full | planned | — | self | shared/app.js initHeader/initNav |
| 6 | hero-art | hero copy column from image metadata (focal/product top/left) + parallax on hero & café images + scroll reveal | runtime | 1/1 | rebuild-native | block JS (hero, cafe) + scripts | full | planned | — | self | shared/hero.js, app.js |

## Decision batch
None — every row is self-decided (no owner input needed).

## Register (decided-out)
| feature | reason | production statement |
|---|---|---|
| cart / add to cart | no commerce backend on source; buttons are inert there | buttons kept visually, no action — same as source |
