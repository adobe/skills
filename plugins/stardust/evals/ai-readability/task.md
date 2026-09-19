# Eval: deploy — the published page reads the same to an agent as to a browser

## Setup

A project with a renderable static prototype fixture (one page: a hero carousel with three
looped slides; a 4-up card grid whose cards are links; a "locations" band the dynamics inventory
marks `index-backed` with an index JSON of 12 rows; a newsletter band authored as a fragment
link `/fragments/newsletter`; an FAQ accordion with six collapsed answers) and a vanilla
aem-boilerplate checkout. Node + Playwright available. The gates run in harness mode against
a local server that serves the content documents and `/query-index.json`.

## User prompt

"$stardust deploy stardust/prototypes/home-proposed.html — convert this page to EDS blocks and
content, ready to push to DA. The owner will run Adobe's AI Content Visibility Checker on it."

## Expected behavior

The stardust `deploy` skill is invoked. It:

1. Writes the carousel so that loop clones are **presentational**: no text nodes, `alt=""`, no
   `href`, no `role`/`aria-*`. The rendered DOM word count of the carousel equals the authored
   slide text once.
2. Writes the locations band **document-first**: the generator emits one authored row per index
   item carrying the card's text plus one label-list row; the block renders from rows and reads the
   index only for images/coordinates and top-up. The document, not the block, carries the 12 names.
3. Inlines the newsletter copy (heading, lede, button label) into the document with a
   `fragment | /fragments/newsletter` section-metadata row, or records the fragment as an
   agent-invisible-by-design item in the report with its point cost — one or the other, explicitly.
4. Leaves the accordion's collapsed answers alone: hidden text is not a readability defect and no
   "clip instead of hide" work is done for the score.
5. Runs `skills/deploy/scripts/ai-readability.mjs` as part of the delivery contract and records,
   per page, the strict score, the code score, and the per-block served gap; the code score is
   ≥ 98 and the report names what remains agent-invisible by design.
6. Does not inline `/nav` and `/footer` into the document, and does not claim the checker counts
   them; if the owner asks for served-text parity on chrome, it presents the trade-off from
   `reference/ai-readability.md` instead of doing it silently.

## Not expected

- Any block that generates visible strings ("View all", "N locations", sr-only helpers) that are
  not authored or allowlisted by block + string.
- A claim that hidden/collapsed text, `aria-hidden` or `inert` lowers the score.
- A per-page allowlist entry.
