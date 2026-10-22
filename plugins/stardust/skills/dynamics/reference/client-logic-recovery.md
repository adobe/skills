# Client-logic recovery — calculators, filters, finders whose logic lives in the source's JavaScript

**The situation.** A row is `client-only` or `data-fed` in shape, but triage parked it as
`needs-human-capture` ("capture the calculator logic") or `needs-backend` (the source calls its own
API) because nobody read the code. The source page *is* the specification: the browser downloads
the logic, runs it on every input change, and usually ships it readable enough (or with source
maps). Recover it from the page before asking anyone. This turns a decision-batch item into a
`self` row when — and only when — the evidence below says the feature needs nothing the target
cannot have.

`scripts/client-logic.mjs` is the instrument (run `--help`). Public, first-party assets of the
source page only; third-party widgets (iframes, vendor SDKs) are out of scope — they stay
`embed-passthrough`.

## Procedure

1. **Capture** on the SOURCE page:
   `node skills/dynamics/scripts/client-logic.mjs capture --url <page> --feature <row id> --mount <css of the widget>`
   (`--channel chrome --headed` when the source is bot-walled; `--steps steps.json` when the
   widget needs a sequence — open a tab, choose a step — before its controls exist). It loads the
   page with precise JS coverage on, changes every control in the mount, and keeps only what ran
   **because of** the interaction. Read `logic.md` first: compute locus, the network calls the
   interaction made, the outputs that changed, the ranked candidate functions with excerpts.
2. **Decide the locus** — it decides the row:

   | locus (logic.md) | meaning | row |
   |---|---|---|
   | `client` | no request during the interaction; the numbers come from first-party JS | `client-only` · `self` — re-implement from the recovered code |
   | `client (with calls)` | requests fired, but none carries the displayed numbers (analytics, lazy assets, config fetched once) | as `client`; reproduce any config the code reads (coefficient table, defaults JSON) as a code-bus snapshot with `_provenance` |
   | `server` / `mixed` | a request's response carries the displayed numbers | the logic is behind an API. Run `cors --api <url> --from <target origin>`: callable → `data-fed` · `self` (the block calls the public API directly; record it in the plan as a dependency on the source host); not callable → stays `needs-backend` (owner: CORS or the formula) — recovered client code that only formats a server answer does **not** promote the row |

   **Live data never comes from code.** A widget that consumes values the source refreshes from a
   service keeps that data dependency even when its formula is recovered: freezing those values is
   `static-snapshot` with a dated note, not `self`. Data behind a first-party endpoint is off-origin
   data (`off-origin-data.md`), not client logic.
3. **Read the code.** Start with the top candidates in `logic.md`; open `sources/` when the page
   ships source maps with `sourcesContent` (originals, names intact), else `pretty/` (re-indented
   bundle, one statement per line). Follow the candidate to the constants it reads (`grep` the
   pretty bundle for the identifiers): coefficient tables, defaults, min/max/step, rounding,
   validation messages. Record each constant with its file:line in the plan row's evidence column.
   Never invent a coefficient: a value you cannot find in the code or derive from recorded vectors
   is a gap, not a guess.
4. **Re-implement** in the block (`client-only` pattern in `patterns.md`): a pure function
   `compute(inputs) → outputs` with the recovered constants, the controls and labels from
   `controls.json`, number formatting matching the source (locale, decimals, units). Keep the
   function separate from the DOM so it can be tested.
5. **Verify against the source, not against yourself.** Record a table on the source and the same
   rows on the target with `vectors` (≥ 20 rows: defaults, each option once, min/max edges, a few
   random, every error state the source shows), then `diff` them. Promote the row to `done` only on
   a clean diff (exact, or within a tolerance you justify from the source's own rounding). Put the
   vectors spec and both tables next to the feature (`stardust/dynamics/client-logic/<id>/`) and the
   result in the parity row.

## What not to do

- Do not lift the source bundle into the block. Re-implement the logic you read; the bundle carries
  the framework, tracking and dead code, and its licence is the source's.
- Do not call a first-party API from the target because it answered from a browser on the source
  origin — only `cors --from <target>` says whether the target can call it.
- Do not promote a row whose blocker is not the code because its front-end was readable: when the
  missing piece is a backend, a credential or a business decision, it still is.

## Evidence in the inventory row

`client-logic: locus client · compute() from <file>:<line> · constants <list> · vectors 24/24 exact`
— or, for a row that stays blocked, `client-logic: locus server (POST /api/…/annuity) · cors closed
from <target>` so the owner batch carries the concrete ask.
