<!-- stardust provenance: skill=stardust:dynamics · phase=plan draft · 2026-11-21T07:20:18.755Z · input stardust/current/_dynamics.json (1 pages, 2 findings) -->
# Dynamic features — draft inventory (curate into `stardust/dynamic-features.md`)

One row per detected finding. Merge duplicates, drop noise, keep every axis honest. Columns: disposition = what we do · target = the delivery form (widget where no authored rows remain) · reproducibility = what it needs · status = where it stands (reference/triage.md).

| # | id | class | feature | pages | disposition | target | reproducibility | status | pattern | decision needed | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | f-form-signup-origin-frescopa-atelier-index-html-1-fields | F | form "signup" → origin /frescopa-atelier/index.html (1 fields) | 1/1 | rebuild-native | block | needs-backend | pending | forms | production endpoint; interim capture ships now |  |
| 2 | x-commerce-signals-cart-true-prices-3 | X | commerce signals (cart: true, prices: 3) | 1/1 | decided-out | — | needs-backend | pending | decided-out | auth / commerce on the new host? |  |

## Triage

- **Ships autonomously (reproducibility `self`):** 0 row(s) — none.
- **One owner decision batch:** 1 row(s) — production endpoint; interim capture ships now.
- **Already delivered by the capture pipeline:** 0 row(s) — no work.
- **Host-bound on the target:** 0 of 0 probed API paths — the off-origin data work.

## Phases

- **forms** — 1
- **register** — 1
