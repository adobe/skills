<!-- stardust provenance: skill=stardust:dynamics · phase=plan draft · 2026-01-01T00:00:00.000Z · input findings.json (3 pages, 8 findings) -->
# Dynamic features — draft inventory (curate into `stardust/dynamic-features.md`)

One row per detected finding. Merge duplicates, drop noise, keep every axis honest. Columns: disposition = what we do · target = the delivery form (widget where no authored rows remain) · reproducibility = what it needs · status = where it stands (reference/triage.md).

| # | id | class | feature | pages | disposition | target | reproducibility | status | pattern | decision needed | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | T1 | T | tag manager: Adobe Launch | 1/3 | embed-passthrough | embed | needs-business-decision | pending | consent-gated-tags | which tags run on the new host; property ids |  |
| 2 | S1 | S | site search form → /search | 2/3 | index-backed | widget | self | pending | search-index-backed | none (corpus = the migrated pages; second corpora stay out) |  |
| 3 | F2 | F | form-less control group in main (4 controls, submit "Send") | 1/3 | rebuild-native | widget | needs-backend | pending | forms | production endpoint; interim capture ships now |  |
| 4 | A1 | A | first-party API GET /api/store-locator | 1/3 | data-fed | widget | needs-business-decision | pending | off-origin-data | which tier for the target host; consumer on the migrated pages? |  |
| 5 | F3 | F | form "contact" → /thanks (5 fields) | 1/3 | rebuild-native | block | needs-backend | pending | forms | production endpoint; interim capture ships now |  |
| 6 | L1 | L | listing candidate .news (8 cards) | 1/3 | index-backed | block | needs-business-decision | pending | listing-index-backed | index-driven or editorially curated? |  |
| 7 | M1 | M | modal trigger .js-modal → /contact | 1/3 | rebuild-native | runtime | self | pending | modal-loader | none |  |
| 8 | X1 | X | sign-in / account links | 3/3 | decided-out | — | needs-backend | pending | decided-out | auth / commerce on the new host? |  |

## Triage

- **Ships autonomously (reproducibility `self`):** 2 row(s) — search-index-backed, modal-loader.
- **One owner decision batch:** 5 row(s) — which tags run on the new host; property ids · production endpoint; interim capture ships now · which tier for the target host; consumer on the migrated pages? · index-driven or editorially curated?.
- **Already delivered by the capture pipeline:** 0 row(s) — no work.
- **Host-bound on the target:** 0 of 0 probed API paths — the off-origin data work.

## Phases

- **forms** — 2
- **tags** — 1
- **search** — 1
- **off-origin data** — 1
- **listings** — 1
- **interactive** — 1
- **register** — 1
