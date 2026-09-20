# Fixture notes — replica-layout-clusters

`fixture/stardust/` starts as a copy of `evals/_shared/fixture-post-migrate/stardust/`
(see that README for the site, the six original pages and the three gate
cases). Deltas, all hand-authored — nothing in the shared tree is edited:

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
  type-level lint — outside this eval's task). No `modules[]` ledger, so the
  module-map precondition never fires here (that gate has its own eval,
  `migrate-sibling-module-map`).
- `migrated/insurance/{home,auto}/_meta.json` — `gatesPassed:
  ["archetype-gate"]` where the shared tree has `[]`: the `program` archetype
  is gated here, so the sidecar declaration follows `fidelity-tiers.md`
  § Declaration.
- `import/vocabulary.json` — maps the five program sections (`program-hero`
  → `block:product-hero`, `coverage-tiles`, `compare-columns`, `faq`,
  `cta-band` → `block:quote-cta`) so task step 4 is executable:
  `importer-skeleton.mjs --slug insurance__life --root <workspace>` reads the
  `.html` sidecar and writes `migrated/insurance/life/` with
  `fidelityTier: sibling`, `renderBranch: A'`, `unmapped: []`. Without this
  file the skeleton exits 1 (`vocabulary.json missing`) and step 4 could
  only be asserted, never run.

Expected clustering (`--min-cluster 3`): `c1` = A (exemplar the archetype
`insurance__home`, gated), `c2` = B (exemplar the median-weight B page,
ungated). With the default T (`max(5, 2 %)` = 5) B is tail.

## Known limitations

- Copied before the shared tree gained `usage.json` / `usage.md` (T13.4) and
  `current/pages/business.html` — absent here (the eight program captures are
  the only `current/pages/*.html`); the resume/usage criteria do not apply.
- No `prototypes/` and no `current/pages/*.json` capture records: the
  `currentStatePath` entries in `state.json` dangle by design (the skeleton
  reads the `.html` sidecar first). Nothing reaches a browser but step 1–2's
  `file://` extraction.
- The cluster block (step 3) is the agent's reading of the exit-2 report:
  `layout-cluster.mjs` prints the ungated cluster and the `$stardust replica
  <exemplar>` command; the `coverage gap: ungated cluster c2 (3 pages)` plan
  line and the `clusters gated 1 of 2 · ungated: c2 (3)` coverage line are
  written by the agent into the plan/report (`rollout/SKILL.md` Setup).

Deterministic coverage of the same facts without a browser:
`evals/lint/layout-cluster-fixtures.mjs` (in `lint:stardust`) — including
the step-4 precondition (skeleton exit 0 over a copy of this fixture); its
browser half runs over these sidecar pages when Playwright resolves from the
repo.
