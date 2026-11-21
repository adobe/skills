<!-- stardust provenance: skill=stardust:dynamics · phase=plan draft · 2026-11-21T18:34:32.365Z · input stardust/current/_dynamics.json (6 pages, 9 findings) -->
# Dynamic features — draft inventory (curate into `stardust/dynamic-features.md`)

One row per detected finding. Merge duplicates, drop noise, keep every axis honest. Columns: disposition = what we do · target = the delivery form (widget where no authored rows remain) · reproducibility = what it needs · status = where it stands (reference/triage.md).

| # | id | class | feature | pages | disposition | target | reproducibility | status | pattern | decision needed | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | cr-main-empty-at-load-filled-after-client-rendered-page | CR | main empty at load, filled after (client-rendered page) | 5/6 | static-snapshot | content | needs-human-capture | pending | client-rendered-page | human-browser capture; never migrate blank |  |
| 2 | f-form-fr-ftr-signup-no-action-js-wired-1-fields | F | form "fr-ftr__signup" → no action (JS-wired) (1 fields) | 5/6 | client-only | widget | self | pending | client-compute | none |  |
| 3 | f-form-signup-origin-frescopa-atelier-1-fields | F | form "signup" → origin /frescopa-atelier/ (1 fields) | 1/6 | rebuild-native | block | needs-backend | pending | forms | production endpoint; interim capture ships now |  |
| 4 | f-form-less-control-group-in-section-8-controls-submit-reque | F | form-less control group in section. (8 controls, submit "Request this tour→") | 1/6 | client-only | widget | self | pending | client-compute | none |  |
| 5 | x-commerce-signals-cart-true-prices-3 | X | commerce signals (cart: true, prices: 3) | 2/6 | decided-out | — | needs-backend | pending | decided-out | auth / commerce on the new host? |  |
| 6 | x-commerce-signals-cart-true-prices-9 | X | commerce signals (cart: true, prices: 9) | 1/6 | decided-out | — | needs-backend | pending | decided-out | auth / commerce on the new host? |  |
| 7 | x-commerce-signals-cart-true-prices-6 | X | commerce signals (cart: true, prices: 6) | 1/6 | decided-out | — | needs-backend | pending | decided-out | auth / commerce on the new host? |  |
| 8 | x-commerce-signals-cart-true-prices-0 | X | commerce signals (cart: true, prices: 0) | 1/6 | decided-out | — | needs-backend | pending | decided-out | auth / commerce on the new host? |  |
| 9 | x-commerce-signals-cart-true-prices-1 | X | commerce signals (cart: true, prices: 1) | 1/6 | decided-out | — | needs-backend | pending | decided-out | auth / commerce on the new host? |  |

## Triage

- **Ships autonomously (reproducibility `self`):** 2 row(s) — client-compute.
- **One owner decision batch:** 2 row(s) — human-browser capture; never migrate blank · production endpoint; interim capture ships now.
- **Already delivered by the capture pipeline:** 0 row(s) — no work.
- **Host-bound on the target:** 0 of 0 probed API paths — the off-origin data work.

## Phases

- **register** — 5
- **client tools** — 2
- **capture** — 1
- **forms** — 1
