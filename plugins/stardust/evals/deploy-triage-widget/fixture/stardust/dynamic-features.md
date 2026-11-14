<!-- stardust provenance: skill=stardust:dynamics · phase=triage (curated) · 2026-10-12T11:40:00Z · input stardust/current/_dynamics.json (1 page, 2 findings) -->
# Dynamic features — a regional public-library network

## Listings contract
none — the home page has no listing block; the three programme cards are authored copy.

## Features
| # | id | feature | class | reach | disposition | reproducibility | status | pattern | decision / owner | evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | s-site-search-form-search | site search form → /search (input `q`, button, empty results list; no authored copy) | S search | 1/1 | client-only | self | pending | search-index-backed | none — ships over the migrated corpus once `helix-query.yaml` exists | `form[role=search] input[name=q]`, `ul.results` empty at capture |
| 2 | x-sign-in-account-links | sign-in / account links (chrome) | X session-bound | 1/1 | decided-out | needs-business-decision | decided-out | — | owner: the account area stays on the current host | header `a[href^="/account"]` |

## Decision batch
Nothing blocks the static path. One owner decision is recorded in the register below.

## Register (decided-out)
| feature | reason | production statement |
|---|---|---|
| sign-in / account links | session-bound; the account area is not migrated in this phase | "Sign in" keeps linking to the current host's account area until the owner decides otherwise. |
