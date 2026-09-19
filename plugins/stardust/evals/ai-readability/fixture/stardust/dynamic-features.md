<!-- stardust:provenance writtenBy=stardust:dynamics writtenAt=2026-09-10T11:30:44Z stardustVersion=0.22.0 -->
# Dynamic features — Meridian Coast Credit Union

## Listings contract
- **Branch locations** (`/locations/<slug>` pages, 12 published): each page emits `address`, `city`, `hours`, `lat`, `lng` through its metadata block; `og:title` / `og:image` / `description` are page-intrinsic. Index: `helix-query.yaml` → `/query-index.json` (target scoped to `/locations/**`). The home page's locations band reads this index. Per `deploy/reference/ai-readability.md` § 4 rule 3 the band is document-first: the generator writes one authored row per branch plus a label-list row; the block uses the index only for images and coordinates and to top up branches published later.

## Features
| # | id | feature | class | reach | disposition | reproducibility | status | pattern | decision / owner | evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | home-hero-carousel | Home hero carousel, 3 slides, autoplay loop | M | home | rebuild-native | self | pending | carousel (scroll-snap track, loop clones presentational) | — | source: Swiper 9 with `loop: true`, 2×perView clones carrying full slide text |
| 2 | locations-band | "Find a branch" band, 12 branch cards | L | home | index-backed | self | pending | document-first listing over `/query-index.json` | — | source: `GET /api/branches.json` rendered client-side into 12 cards |
| 3 | newsletter-signup | Newsletter e-mail capture (heading, lede, e-mail field, button) | F | home, accounts (footer band) | rebuild-native | needs-backend | scaffolded-awaiting-owner | fragment `/fragments/newsletter`; endpoint via `scripts/site-config.js`, disabled until the owner names the list provider | owner: marketing — which e-mail provider receives the form | source: POST to a marketing-automation vendor host |
| 4 | faq-accordion | FAQ accordion, collapsed answers | M | home, accounts | rebuild-native | self | pending | accordion (`details`/`summary` → block) | — | source: jQuery toggle on `.faq__q` |
| 5 | online-banking-login | "Log in" → online banking | X | chrome | decided-out | needs-business-decision | decided-out | link kept to the existing off-origin login | owner: digital banking | source: sign-in link to the core-banking vendor host |

## Decision batch
- **needs-backend** — #3 newsletter-signup: which provider receives submissions; until answered the form renders with a "no backend connected" message and the endpoint stays empty in `scripts/site-config.js`.
- **needs-business-decision** — #5 online-banking-login: kept as an off-origin link; nothing to rebuild.

## Register (decided-out)
| feature | reason | production statement |
|---|---|---|
| online-banking-login | session-bound, lives on the core-banking vendor host | "Log in" links to the existing online-banking sign-in page; no account UI on this site |
