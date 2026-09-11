# Classes and detection signals

The class axis says **what a feature is**. It is read from evidence, never guessed from
screenshots: a site's dynamic surface is invisible to a block-scoped, pixel-verified
pipeline, and invisible in a way every existing gate certifies as correct (three
migrations, three site shapes, the same finding).

## Classes

| class | meaning | signals the detector reads | usual disposition |
|---|---|---|---|
| **L** listing | a block that lists other pages | repeated same-site card groups in the content area, dates in cards | `index-backed` or `static-snapshot` (curated) — the choice stays human |
| **S** search | site search, autocomplete, results | `form[role=search]`, `q`/`s`/`query` inputs, first-party XHR with `search|autocomplete|typeahead|suggest`, hosted search vendors | `index-backed` (+ a results page — a search box without one is a 404) |
| **F** form | any submission | `<form>` with or without `action`, **form-less control groups** (modern CMS front ends render forms without a form tag), token-like hidden names, form-vendor hosts | `rebuild-native` with a configurable endpoint; `client-only` when the form is pure compute |
| **M** modal / interactive | overlays, dialogs, tabs, accordions, chrome interactions | `*modal*|dialog|lightbox|popup` markers, `aria-haspopup=dialog`, `aria-controls`/`data-*trigger` → `[role=dialog]`, titles carried on the trigger; chrome-only triggers are interactions, not modals | `rebuild-native` |
| **V** media | players, embeds, maps | `video-js`, `data-video-id`/`data-account`, player hosts, `iframe` (an iframe **without src** is a runtime-injected embed) | `embed-passthrough` (the player URL is the content) |
| **T** tag / consent | analytics, tag managers, consent, RUM, pixels, review/chat widgets | vendor table by host; **first-party collector subdomains** are tags that need a CNAME; **mount divs with vendor `data-*` attributes and zero script tags** = tag-manager-injected | `embed-passthrough`, scaffolded disabled, owner-enabled |
| **A** API / personalisation / settings | first-party XHR that renders content, experimentation, CMS settings objects | `/api|/graphql|/ajax|/json|/client/|/webservices|_next/data` on the source host, POST bodies, `drupalSettings|dataLayer|digitalData|__NEXT_DATA__` **keys** (they name endpoints, ids and vendors) | `data-fed` when a consumer exists on migrated pages, else `decided-out`; **host-bound** when the target cannot serve the path |
| **R** relationship | many-to-many listings | card groups keyed by taxonomy | `static-snapshot` until modelled (listings.md Tier 3) |
| **X** auth / commerce | sign-in, account, cart, prices, session-bound features | `login|sign-in|account|register|oauth|sso` links, identity-provider hosts, cart/price tokens | `decided-out` off-origin, links kept |
| **I18N** locale | language trees | `link[rel=alternate][hreflang]` (primary — sitemaps are not), language path prefixes | a **tree**, not a feature: every other class recurs inside it (locale-trees.md) |
| **CR** client-rendered | slots or whole pages filled after load | placeholder/skeleton/`js-`/`data-endpoint` nodes with content, DOM added after `load`, **main empty at load** | `static-snapshot` from the settled DOM; a blank capture is a **hard content gap**, never migrated silently |
| **D** sheet / data file | copy and settings from spreadsheets or JSON files | `.json` GETs that are not APIs, `placeholders.json`, `fetchPlaceholders` in a library | `data-fed` by syncing the files from the source origin |

## Detection procedure

1. **Depth on archetypes.** `scripts/dynamics-detect.mjs --from-state stardust/state.json` probes one page per type plus the home page (or `--urls`). Per page it accepts consent, settles, scrolls, settles again — tags and lazy players fire late — and records the network log by host, first-party API paths with status, POST bodies, third-party XHR, scripts, forms and control groups, the trigger → dialog → content graph, media ids, iframes, mount divs, globals and settings keys, framework, auth/commerce/locale signals, client-rendered slots and listing candidates. Findings are deduped across pages and keyed `class|feature`.
2. **Reach on every page.** `extract --dynamics` records cheap per-page signals in the crawl (endpoints, forms, triggers, players); `--reach stardust/current` folds them into each finding as `reach: pages/of`. Features come from archetypes; reach comes from the roster — the two are never the same pass.
3. **Chrome once.** Header and footer interactions (dropdowns, search overlay, sticky banner, switcher) are M findings marked `chrome only`; their evidence is motion observation, not the detector.

## Vendor table

`scripts/vendors.json` maps host/URL patterns to a class and a role and is the classification
engine. Grow it by adding rows, never by editing detector code. Unknown third-party hosts are never
dropped: they stay visible as `unknown third-party host — inspect` (class A when the host answered
XHR, T otherwise) until a row classifies them. Product names only — a customer's own hosts and
account ids never enter the table.

## Origin-bound probe

`scripts/dynamics-plan.mjs --target-origin <host>` requests every recorded first-party API path on
the target. A 4xx or network error marks the finding **host-bound**: the feature exists in code but
is dead off-origin. A pixel gate reports this as "band shorter"; the probe is what names it. Run it
whenever a target host exists, with the site auth header scoped to that origin.

## Known noise

`aria-controls` on nav dropdowns counts as a dialog trigger only when the target has `role=dialog`;
media-CDN edge hosts and geo lookups appear as unknown hosts until the table knows them; four
archetypes give features but not reach.
