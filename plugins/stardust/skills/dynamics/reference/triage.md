# Triage — the four axes and the inventory

One row per feature in `stardust/dynamic-features.md`. Four axes per row; each answers a different
question and none can be inferred from another.

| axis | question | values |
|---|---|---|
| **class** | what is it? | `L S F M V T A R X I18N CR D` (classes-and-signals.md) |
| **disposition** | what do we do? | `rebuild-native` · `index-backed` · `data-fed` · `embed-passthrough` · `client-only` · `static-snapshot` · `decided-out` |
| **reproducibility** | what does it need to ship? | `self` · `needs-credential` · `needs-human-capture` · `needs-backend` · `needs-business-decision` |
| **status** | where does it stand? | `pending` · `in-progress` · `interim` · `done` · `scaffolded-awaiting-owner` · `delivered-by-capture` · `decided-out` · `skipped-source-broken` |

Flags, when they apply: `regulated-pii` (forms), `host-bound` (APIs dead on the target),
`source-nonfunctional` (the source itself fails for a real user), `environment-limit` (the test
network cannot reach a hand-off target).

## Dispositions

- **rebuild-native** — behaviour rebuilt in block or runtime JavaScript with no external data:
  modal loaders, chrome interactions, search results blocks, forms, clock-dependent strings. The
  largest class of work on a greenfield rebuild.
- **index-backed** — fed by the site's own query index: listings, related rails, search.
- **data-fed** — fed by data that lives outside the page: an API kept same-origin, a snapshot
  served from the code bus or a sheet, endpoint indirection for an existing library
  (off-origin-data.md).
- **embed-passthrough** — a third-party surface kept as-is: players, iframes, form services, tags
  and CMPs. Re-authored from live-DOM ids where needed, never re-implemented.
- **client-only** — pure client compute (calculators, filters, comparisons): inline JS, controls,
  no network. Cheapest, highest-fidelity migration; never flatten it into prose.
- **static-snapshot** — the settled DOM ships as content, with the reason and the unfreeze
  condition recorded.
- **decided-out** — cannot or must not exist off-origin (session-bound, regulated capture, no
  consumer on the migrated pages). A register row with the production statement, never a silent gap.

## Reproducibility — the axis that bounds the phase

Only `self` ships autonomously. Everything else is emitted as **one decision batch** — one message
listing every credential, capture, backend and business decision — never one question at a time.
Under hands-off mode the batch is recorded, each decision becomes a named assumption, and the
interim path ships (`interim` or `scaffolded-awaiting-owner`). An assumption is the run's, never the
owner's: it cannot set `decided-out` (a recorded run put a live-indexed site search out of scope by
assumption and cited it as the owner's). On the finance-site case one of five
gaps was `self`; the other four each gated on something external. Naming that up front is what turns
dynamics from an open-ended stall into a bounded phase.

## Rules

1. **Reconcile against the migrated output first.** Scan `stardust/migrated/` for the feature's
   evidence before scheduling work (`dynamics-plan.mjs --migrated`). The capture pipeline had
   already baked review text on 48 of 64 detail pages that a source-only scan flagged as a gap.
2. **Never fabricate** legal or financial copy for a page captured empty. `CR` with an empty main
   is a hard content gap → `needs-human-capture`; headless re-capture fails on bot-walled SPAs too,
   so the escalation is a human browser, batched with every other such page.
3. **Never auto-wire a regulated form.** `regulated-pii` (SSN, date of birth, account numbers,
   minors, document upload) → rebuild the UI with submission blocked until a human configures the
   secured endpoint; surface as a mandatory decision. Most intake help pages deep-link to an
   authenticated app — migrate the link, do not manufacture a form.
4. **A search box implies a results page.** Class S over the site's own pages is `self` once the
   index exists: it ships over the migrated corpus (a smaller corpus than the source's is a parity
   note, not a reason to exclude). Emit the paired deliverable or mark the form non-functional;
   the header form never keeps the source origin's results URL.
5. **Source-live-check.** If the source surface fails for a real logged-in user, mark
   `skipped-source-broken`; there is nothing to reproduce.
6. **Decided-out is explicit**, with reason and production statement, so "not migrated" and
   "cannot exist here" are never confused.
7. **Static first, then wire.** Every feature degrades to a working static page before any phase
   replaces one degradation with the live behaviour. The inventory never blocks the static path.
8. **A missing query index is a yaml file, not a service.** `/query-index.json` → 404 on the
   target means no `helix-query.yaml` in the code branch (listings and search, class L / S):
   author it, push, publish live, poll (no more often than every 5 s, bounded) —
   listings.md § Getting an index at all. The sheet-backed interim index ships only when the
   code branch is not writable; a 403 from the configuration service is never the reason (a
   recorded hands-off run read one missing yaml file as "cannot be configured").
9. **Search parity is count and titles.** Record `expectCount` / `expectTitles` per probe term at
   detect time on the `search-query` check in `parity.json`; ranking, dedupe and the dropdown cap
   follow patterns.md § search-index-backed.

## `stardust/dynamic-features.md`

```markdown
# Dynamic features — <site>

## Listings contract
<per content type: the `<meta name>` fields each page must emit; index each listing reads —
listings.md. "none" when there are no listing blocks.>

## Features
| # | id | feature | class | reach | disposition | reproducibility | status | pattern | decision / owner | evidence |
|---|---|---|---|---|---|---|---|---|---|---|

## Decision batch
<every non-self row, grouped by what it needs, one message to the owner>

## Register (decided-out)
| feature | reason | production statement |
```

`dynamics-plan.mjs` drafts the table; the run curates it (merge duplicates, drop noise, keep every
axis honest) and writes `stardust/dynamic-features-plan.md`: phases with deliverables, authoring
contract, verification, owner decision, effort. The gate (prepare-migration 4.5, replica Phase 2,
rollout B2) fails on a row without a disposition — "I don't know yet" is spelled `static-snapshot`
with reason "undecided — revisit at rollout".

## Martech

Consent, tag-manager and analytics vendors are one feature routed by the source's own stack, not
triaged per vendor. `dynamics-detect.mjs` records the evidence (`report.martech`: static script
srcs, inline-snippet hosts, account ids, hosts fired before consent — the CMP banner is accepted
after that list is taken); `dynamics-plan.mjs` writes `stardust/martech-contract.json` (`--contract`
to relocate) and `stardust/martech-handoff.md`, and marks martech rows `martechStatus`. The
contract is the only input to deploy Step 3b (`martech-scaffold.mjs`) and to the `martech`
parity checks (parity-report.md).

| source stack | route (`loader`) | fallback / upgrade |
|---|---|---|
| self-hosted Web SDK (alloy + datastream + org id) | `aem-martech` | source Launch URL as `url` |
| Adobe Launch | `url` (the property URL) | upgrade `aem-martech` |
| AppMeasurement / Target without Web SDK | `aem-martech`, off, `missing: datastreamId` | — |
| direct GA4 (`gtag/js?id=G-…`) | `aem-gtm-martech` | source GTM container as `gtm` |
| GTM container | `gtm` (container URL + dataLayer name) | upgrade `aem-gtm-martech` when GA4 rides it |
| Tealium / other direct vendor script | `url`, category from vendors.json | — |

- **Consent.** OneTrust and Cookiebot with a captured account id → policy `cmp`, categories mapped
  to the CMP's groups. No CMP on the source, an unknown CMP or a missing id → `owner-decision`:
  every route stays off until the owner sets `consent.policy` (`none-required` grants on load).
  Tags the source fires before consent are flagged — the EDS site waits.
- **Ids are captured, never invented.** A route missing its id is `scaffolded-awaiting-owner`,
  `enabled: false`; the hand-off lists it with the field to fill.
- **Production hosts gate everything.** Tags load only on `productionHosts` (the source's hosts);
  preview and branch hosts need `?martech=on`, so a migration never double-counts traffic.
- **Vendors behind the tag manager** (`via: tag-manager`) are not re-wired: they come with the
  container once it loads.
