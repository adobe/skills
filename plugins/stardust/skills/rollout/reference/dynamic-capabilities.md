# Dynamic capabilities: the strategy vocabulary (Phases B2, D2)

> **Provisional by design.** This file is the scaffold that real migrations fill
> in. Each strategy section below is one paragraph of intent plus the minimum
> `deploy` and probe contract. When a `dynamic-gap` or `api-dependency` learning
> (`skills/stardust/reference/learnings.md`) folds, it lands here — in the
> section it names. Do not add a strategy to the vocabulary without a ledger
> entry that needed it; do not build tooling for a strategy fewer than two
> ledgers have hit.

A site is dynamic wherever a page's content did not come from that page's own
authored source: a list of other pages, a table of numbers, an API response, a
third-party surface, a client-side render. `extract` records the evidence
(`dynamic` per page, `_crawl-log.json#dynamicSurface` sitewide — schema in
`skills/extract/reference/current-state-schema.md § Dynamic`). This file defines
the **closed vocabulary** those rows are classified into, and
`stardust/dynamic-blocks-map.md` is where the classification lives.

## The vocabulary

| strategy | one line | owner |
|---|---|---|
| `query-index` | the data is pages of this site → an EDS query-index feeds the block | `dynamic-listings.md` (full spec) |
| `sheet-json` | tabular data with no page identity → authored as a sheet, served as `.json` | § below |
| `client-fetch` | an external or retained API the block calls at runtime, with authored fallback rows | § below |
| `embed-preserved` | a third-party surface that stays as-is | § below |
| `static-until-modeled` | dynamic today, frozen at capture state, with the reason and the unfreeze condition | § below |
| `out-of-scope` | not migrating, with the reason | § below |

The vocabulary is fixed because learnings are keyed on it. Renaming a strategy
after three migrations orphans their ledgers.

## The map — `stardust/dynamic-blocks-map.md § Dynamic capabilities`

One row per capability the evidence surfaced. Listings live in § Listings of the
same file (per `dynamic-listings.md`); every other row lives here. Columns:

```markdown
| id | evidence | pages | strategy | reason | owner |
|---|---|---|---|---|---|
| reviews-rail | GET api.vendor.com/v1/reviews (roll-up row 3) | 41 | client-fetch | ratings change daily; vendor API is public, CORS `*` | deploy: reviews block |
| branch-hours | GET www.site.com/api/locations/{n} | 88 | sheet-json | 88 rows × 6 cols, edited monthly by ops; no page identity | deploy: hours block + `/data/hours` sheet |
| site-search | form GET /search?q (1 page + header) | all | static-until-modeled | source search is server-side over a DB the site is leaving behind; unfreeze: EDS search block over query-index | rollout D2 |
| booking | iframe widget.booking-vendor.com | 12 | embed-preserved | vendor-hosted, works under EDS CSP (probe B2-7) | migrate: verbatim |
| consent-tag | script js.consent-vendor.com | all | out-of-scope | re-wired at deploy as a separate concern (metadata-and-jsonld.md § drop list) | — |
```

- `evidence` names a roll-up row or endpoint pattern a maintainer can re-check.
- `pages` is the roll-up count — it is what decides whether a strategy is worth
  building (one page → usually `static-until-modeled`).
- `reason` is one line; `static-until-modeled` rows also carry the unfreeze
  condition.
- **An unclassified row fails the gate** (prepare-migration Phase 4.5, rollout
  B2). "I don't know yet" is spelled `static-until-modeled` with the reason
  "undecided — revisit at D2".

## `sheet-json`

**Use when** the data is a table — rows with the same columns, no page of its
own per row, edited by people who think in spreadsheets (rates, specs, opening
hours, FAQs at scale, glossaries). The source usually served it from a CMS
endpoint (`/api/locations/{n}` on 88 pages is the tell); the EDS shape is a sheet
at a content path, delivered as `<path>.json` with `{ total, offset, limit,
data: [...] }`.

**Deploy contract.** The block's authored rows carry the shape and act as the
fallback; `decorate()` fetches the sheet's `.json` (same origin, no CORS), maps
`data[]` onto the row template, and replaces the fallback. Column names are the
contract — write them in the brief; sheet columns that the source endpoint did
not expose need a source for their values (say so in the map, don't invent).

**Live probe (D2).** `GET <path>.json` on the live origin returns `total > 0`;
the block renders the fetched rows; the fallback renders with the fetch blocked.

**Open questions this scaffold does not answer** (fill from learnings): sheet size
limits and chunking; multi-sheet workbooks; who authors the sheet during
migration (script from the captured endpoint responses? — the crawl records
patterns, not bodies).

## `client-fetch`

**Use when** the data lives outside the content tree and stays there: a vendor
API (reviews, stock, weather, events), or a source backend the client is
keeping after the move. The block calls it at runtime. **This is the strategy
that fails in the field** — CORS, auth tokens in page source, rate limits,
endpoints that move — so it needs the strongest fallback story.

**Deploy contract.** Authored rows are the fallback and the first paint;
`decorate()` fetches with a timeout, re-renders on success, leaves the fallback
on failure, never throws. The brief names: endpoint pattern (from the roll-up),
method, the fields the cards need, auth model (public / key-in-config / none
possible → not this strategy), and the failure behaviour. Keys never go in
content or block code; a `client-fetch` that needs a secret is
`static-until-modeled` with reason "needs a proxy".

**Live probe (D2).** From the live origin the request succeeds (status, CORS
headers, CSP `connect-src` if the project sets one); the rendered block shows
fetched data; with the endpoint blocked the fallback renders and the console is
clean.

**Open questions:** whether a same-origin proxy pattern belongs in the plugin at
all; per-vendor recipes (reviews platforms, maps, job boards) — add one only
after two ledgers hit the same vendor class.

## `embed-preserved`

**Use when** the capability IS a third-party surface and the client keeps the
vendor: iframes (booking, maps, video, payment), hosted form services
(`content-preservation.md § Forms` already preserves those actions), chat and
scheduling widgets mounted by script. Migrate keeps the markup verbatim; nothing
is re-implemented.

**Deploy contract.** iframes and form actions: verbatim in content (an `embed`
block per the Block Collection when the composition needs one). Script-mounted
widgets: the loader lives in block JS or `delayed.js`, never in authored content
(D15), and must run under the EDS CSP (`script-src 'nonce-…' 'strict-dynamic'`,
no `wasm-unsafe-eval` — see `deploy/SKILL.md` "What still can't run").

**Live probe (D2).** The embed paints on the live page; no CSP violation in the
console; the widget's own network calls succeed from the live origin.

**Open questions:** consent gating of embeds (the consent tag itself is
`out-of-scope`, but embeds that must wait for consent are not yet covered).

## `static-until-modeled`

**Use when** the capability is dynamic on the source but there is no strategy
for it yet — Tier-3 relationships (`dynamic-listings.md`), server-side search
over a database the site is leaving, personalisation, anything authenticated,
a `client-fetch` that would need a secret. The captured state ships as static
content. This is an honest decision, not a failure — but it is a decision, with
a **reason** and an **unfreeze condition** in the map, and `migrate` logs a
`dynamic-dependency` deviation per affected page so the report shows the frozen
surface.

**Live probe (D2).** None. The row is re-read at every rollout B2 against the
current roll-up: if the unfreeze condition is now met, it moves.

## `out-of-scope`

**Use when** it is not content and not migrating: analytics, consent, A/B and
chat tags (`metadata-and-jsonld.md § drop list` already drops these), internal
tooling endpoints, preview/admin calls the crawl saw. Reason is one line; the row
exists so the roll-up has no orphans.

## Site search — a note, not a strategy

Search shows up in the evidence as a form (`search: true`) and often as an
endpoint. It is not a strategy because the answer differs per site: a
query-index-backed search block (when the corpus is this site's pages →
`query-index`, with the `?q=` hand-off `dynamic-listings.md` mentions), a vendor
search (`client-fetch` or `embed-preserved`), or `static-until-modeled` when the
source searched a database that is not coming along. Classify the search row like
any other; record which of those it is in the reason. A dedicated search block
recipe belongs here once two ledgers ask for it.

## What this file deliberately does not contain

- A search block, a sheet authoring tool, an API proxy, per-vendor adapters.
- Any eval fixture. Add one when a strategy has a stable contract.
- Detection heuristics — those are `extract`'s (`crawl.mjs`), and they record
  evidence, not strategies.
