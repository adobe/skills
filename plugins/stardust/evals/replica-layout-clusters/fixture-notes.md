# Fixture notes — replica-layout-clusters

`fixture/stardust/` starts as a copy of `evals/_shared/fixture-post-migrate/stardust/`
(see that README for the site, the six original pages and the three gate
cases). Deltas, all hand-authored:

- `current/pages/*.html` — eight `program` pages as the crawler's settled-DOM
  sidecar would write them (`extract` writes `pages/<slug>.html` by default).
  Signature A (5 pages): `insurance__home`, `insurance__auto`,
  `insurance__life`, `insurance__renters`, `insurance__boat` — `main` holds
  `section.program-hero`, `section.coverage-tiles` (3 × `div.tile`),
  `section.faq` (2 × `details`), `section.cta-band`. Signature B (3 pages):
  `insurance__business-owners`, `insurance__landlord`, `insurance__umbrella` —
  the same plus `section.compare-columns` (2 × `div.column`) before the FAQ.
  Every stylesheet/asset reference points at the `.example` origin and is
  never fetched: `layout-cluster.mjs` aborts every request but the `file://`
  document.
- `state.json` — the six new program pages appended as `extracted`
  (`insurance__home`, `insurance__auto` stay `migrated`); `site.totalDiscovered`
  and `site.crawled` follow. No `layoutCluster` key is present before the run.
- `replica/progress.json` — the `program` entry is **gated**: `gated: true`,
  `breakpoints.1440` (3.4 %, Δh 2) and `.360` (4.1 %, Δh −3) both `pass: true`
  with `structuralRed: 0`, a `motion` inventory, the `note` removed. The
  landing and article entries are unchanged (article still blocks the
  type-level lint — outside this eval's task).

Expected clustering (`--min-cluster 3`): `c1` = A (exemplar the archetype
`insurance__home`, gated), `c2` = B (exemplar the median-weight B page,
ungated). With the default T (`max(5, 2 %)` = 5) B is tail.

Deterministic coverage of the same facts without a browser:
`evals/lint/layout-cluster-fixtures.mjs` (in `lint:stardust`); its
browser half runs over these sidecar pages when Playwright resolves from the
repo.
