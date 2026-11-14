# Off-origin data — feeding features whose data lives on the production host

**The situation.** A customer's EDS library (or any block set) implements the dynamic features
against relative API paths that exist only on the production host behind its CDN. On a migration
sandbox or preview origin those calls fail silently: empty dropdowns, empty bands, static
snapshots. Gates report "band shorter"; the truth is "feature dead off-origin". Name it with the
target-host probe (`dynamics-plan.mjs --target-origin` → `host-bound`), then pick a tier. The rule
throughout: **feed the library, never fork it.**

## Tier 1 — host-keyed endpoint indirection (zero code change)

Libraries often read endpoints from a config document keyed by hostname. Add a set for the
migration host (`POST admin.hlx.page/config/<org>/sites/<site>/public.json` — GET, merge, POST the
whole object) pointing list endpoints at snapshot JSON while **submit URLs stay on the source host**
so real flows still complete. The production host keeps its default set.

## Tier 2 — snapshots served from the code bus

`scripts/snapshot-api.mjs` records live responses **from a same-origin browser context** (cookies
and bot management pass; `curl` does not) into `data/<feature>/*.json` with `_provenance.json`.
Committed JSON is served under the same site authentication; nested JSON needs no sheet. Enumerate
parameter spaces from other snapshots. **Snapshots age:** keep provenance, expose `data-snapshot`
in the DOM, ship a sync step, show the date in the parity row.

## Tier 3 — fetch shim for parameterised endpoints (sandbox hosts only)

A `window.fetch` wrapper installed when the hostname is a sandbox host: POST-with-term
autocomplete filtered from a local tree with live-like ranking; GET-with-params mapped to per-key
snapshot files; calls with no snapshot answered with the **empty shape the block expects**. Inert on
production.

## Tier 4 — per-state rendered snapshots + `Source` row (API-rendered bands)

When a band renders cards from an API per UI state, do not reverse-engineer the API: drive the live
UI through every state (select option → wait for that option's container → "show more" → scroll
lazy images into view) and record the rendered cards in the block's own vocabulary — **every card
model the detector saw**. Assert **band count == block count per page** before writing `Source`
rows (a mismatch feeds the wrong data silently). Block: `Source | <url>#<bandIndex>` → renders like
live, exposes `data-snapshot`, falls back to authored rows. Converter inserts `Source` only where the
snapshot has cards. Production path: the library's datasource or same-origin routing.

## Sheet-backed data (class D)

`placeholders.json` and `/data/*.json` drive copy and widgets. `scripts/sync-sheets.mjs` copies them
from the source origin into DA and publishes; rows equal on both sides.

## Chrome that carries the production URL space

Reused chrome links root-relative to the production host. Redirects sheet for aliases, the site
query index as the "ours" oracle, a sandbox-only runtime rewrite of unserved same-origin links to
the source host — then migrate the linked pages wave by wave.

## Verify (flows, not presence)

Control counts, rendered link counts, a query with a known answer, option switch re-renders,
images loaded, console filtered to the library's API errors = 0. Numbers into the parity row;
replayed by `dynamics-check.mjs`. Hand-off targets may be geo-fenced: probe from the test network
with a fresh context and record a failure as `environment-limit` with the egress region, not as a
defect.
