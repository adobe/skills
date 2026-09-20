# Eval: layout clusters — one gated exemplar per cluster, not per CMS label

Pins the cluster-granularity form of the gated-archetype precondition: under
`flow: replica`, a page type is not one layout. `layout-cluster.mjs` groups a
type's pages by rendered layout signature (offline, over the crawler's
settled-DOM sidecar); a cluster of ≥ T pages whose exemplar has no gate result
at every configured breakpoint is a **coverage gap** — nothing in it renders
at sibling tier or fans out — while pages in gated clusters proceed and tail
clusters (< T) are reported and sampled, never blocked. The escape is work
(gate the exemplar) or a recorded operator `coveredBy`; hands-off never
merges clusters. Contract: `skills/migrate/reference/fidelity-tiers.md`
§ Sibling variance probe (Layout clusters); the rule it refines is
`migrate/SKILL.md` (before any sibling render) and `rollout/SKILL.md` Setup.

## Setup

`fixture/` is the shared post-migrate fixture (`evals/_shared/fixture-post-migrate/`,
see its README) with three changes: `stardust/current/pages/*.html` carries the
settled-DOM sidecar of eight `program` pages (five share the archetype's
section signature — hero, three coverage tiles, FAQ, CTA band; three carry an
extra two-column compare section); `stardust/state.json` lists all eight
(`insurance__home`, `insurance__auto` migrated; six more `extracted`); and
`stardust/replica/progress.json` records the `program` archetype
`insurance__home` as **gated** at 1440 and 360 with a motion inventory (the
type-level precondition passes — this eval is about the cluster level). A
fictional regional financial-services site on a `.example` origin: nothing is
live, no network is needed, no EDS target or token exists. Playwright must be
resolvable from the project for the `file://` extraction.

## Task (hands-off)

Run in this order and report each step's output:

1. `node stardust/scripts/replica/layout-cluster.mjs --type program --write-state`
   (or the plugin path `skills/replica/scripts/layout-cluster.mjs`): the
   default T is `max(5, 2 %)` = 5 for eight pages.
2. `node … layout-cluster.mjs --type program --min-cluster 3 --write-state`.
3. Migrate `insurance__landlord` at sibling tier under hands-off mode.
4. Migrate `insurance__life` at sibling tier under hands-off mode.

Do not invent a network. Do not edit `progress.json` gate numbers.

## Expected

- Step 1 prints `type program: 8 pages, 1 cluster(s) ≥ 5 (gated 1), tail 3 page(s)`,
  the tail line listing the three two-column pages, and exits 0 — a tail
  cluster is reported and falls under the seeded sample, it never blocks.
- Step 2 prints two clusters: `c1` (5 pages, exemplar `insurance__home`,
  archetype, gated at both breakpoints) and `c2` (3 pages, exemplar a
  two-column page, `ungated`, `→ $stardust replica <exemplar>`), the
  signature diff vs `c1` naming the `compare-columns` section, the
  `coverage gap: ungated cluster` line, exit 2. `stardust/current/layout-clusters.json`
  is written; `state.json.pages[].layoutCluster` is `c1` / `c2` per page.
- Step 3 is **blocked**: the page is listed with its cluster id `c2`, the
  exemplar slug and the command `$stardust replica <exemplar>`; nothing of
  `c2` renders; the plan/report carries `coverage gap: ungated cluster c2 (3 pages)`
  and the coverage line `clusters gated 1 of 2 · ungated: c2 (3)`. Hands-off
  resolves by gating the exemplar (Phase 3–4 on that page within the
  iteration cap), never by `--cover`; if it cannot gate within the cap the
  cluster stays blocked and heads the phase report and the journal `Next:`.
- Step 4 proceeds: `insurance__life` is in `c1`, whose exemplar is gated.
- No `coveredBy` is written anywhere; `progress.json` pass bars and numbers
  are byte-identical to the fixture's; no `--allow-ungated` or similar flag
  is invented.
