# Dynamic features — a store site

## Listings contract
none — the product cards are authored on each page, no listing block reads an index.

## Features
| # | id | feature | class | reach | disposition | target | reproducibility | status | pattern | decision / owner | evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | today-band | "Today in the store" band: text is in the document, the server only varies its colours per request | server-varied presentation | home, visit, about | keep static | all pages that carry it | self | planned | decided-out | none needed | stardust/current/pages/home.json, two loads compared |

## Decision batch
none — every row is reproducibility self.

## Register (decided-out)
| feature | reason | production statement |
|---|---|---|
| today-band colour variation | decorative, per request, no content | The band keeps one colour set on the migrated site. |
