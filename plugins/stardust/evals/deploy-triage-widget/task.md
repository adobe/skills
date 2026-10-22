# Eval: deploy triage — a search section becomes a widget link, not a block

## Setup

A stardust redesign project for a regional public-library network, one page
approved and ready for the `deploy` skill, in a fresh EDS code tree with no
blocks written yet:

- `stardust/state.json` — `flow: redesign`, one page `home` with status
  `approved`, `prototypePath: stardust/prototypes/home-proposed.html`.
- `stardust/prototypes/home-proposed.html` — a self-contained prototype whose
  `<main>` has three sections: `section.hero` (eyebrow, h1, lede, two CTAs,
  image), `section.cards` (h2 + three programme cards: image, h3, text, link)
  and `section.site-search` (a search `<form>` with one input and one button
  plus an EMPTY `ul.results` — no authored copy at all).
- `stardust/dynamic-features.md` — the dynamics triage: the search row is
  class `S`, disposition `client-only`, pattern `search-index-backed`,
  reproducibility `self`; the inventory predates the `target` axis, so it
  names no delivery form.
- `scripts/scripts.js` — the stock aem-boilerplate file (144 lines, sha256
  starting `e43cddca`): `buildAutoBlocks()` already calls the stock
  `buildWidgetAutoBlocks()`; `decorateMain`/`loadEager` are stock.
- No `blocks/`, no `widgets/`, no `content/` directory yet.
- No DA credentials, no network, no browser. Impeccable installed.

## User prompt

"Use the stardust deploy skill on `stardust/prototypes/home-proposed.html`, but stop after the triage: run Step 1 (audit the `<main>` sections) and Step 2 (per section decide default content / block / widget and the Block Collection match, lock the names), record both triage answers per section in `stardust/eds-conversion-log.md` quoting the rule you applied, and author the content page `content/home.html` as the Step 9 body fragment (metadata block first). Do NOT write block or widget code, do NOT run the Playwright or runtime probes, do NOT touch `scripts/`, and do NOT deploy — this machine has no DA token, no network and no browser. Decide everything yourself from the prototype and `stardust/dynamic-features.md`; do not ask me questions."

## Expected behavior

The stardust `deploy` skill is invoked. It:

1. Reads the prototype `<main>` and lists its sections: hero, cards, site-search.
2. Applies the Step 2 triage per section and records both questions in
   `stardust/eds-conversion-log.md`:
   - **hero** → block (authored eyebrow, headline, lede, CTAs, image), Block
     Collection match `hero`.
   - **cards** → block (three authored repeat units), Block Collection match
     `cards`, one row per card.
   - **site-search** → **widget**: the section carries no authored content —
     an input, a button and an empty results list, everything arrives from
     user input and the search index — so per the skill's decision rule
     ("widget when the section carries no authored content … block when
     authors fill rows") it is authored as ONE paragraph holding only a link
     whose href contains `/widgets/` and ends in `.html`
     (e.g. `/widgets/search/site-search.html`), rendered by the stock
     `buildWidgetAutoBlocks()` / `blocks/widget/` loader. No block table named
     `search`, `site-search` or `widget`.
3. Names the widget file stem semantically (not a reserved EDS class:
   `widget`, `section`, `block`, `wrap`, `button`, `*-wrapper`, `*-container`).
4. Writes `content/home.html` as a DA body fragment: `<body><header></header>
   <main>…</main><footer></footer></body>`, first section a `metadata` block
   with Title + Description derived from the h1, then the hero block table,
   the cards block table (3 rows), and the lone widget link paragraph.
5. Writes NO code: no `blocks/`, no `widgets/`, no `blocks/widget/`;
   `scripts/scripts.js` is byte-identical to the fixture.
6. Names no real site, brand or hostname beyond the fixture's role names and
   `example.com` placeholders.
