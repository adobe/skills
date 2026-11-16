# Eval: deploy — desktop-first prototype CSS is delivered mobile-first (#162)

## Setup

A stardust redesign project for a neighbourhood bakery cooperative, one page
approved and ready for the `deploy` skill, in a fresh EDS code tree with no
blocks written yet:

- `stardust/state.json` — `flow: redesign`, one page `home` with status
  `approved`, `prototypePath: stardust/prototypes/home-proposed.html`.
- `stardust/prototypes/home-proposed.html` — a self-contained prototype whose
  `<main>` has two sections: `section.hero` (eyebrow, h1, lede, two CTAs,
  image; two columns on desktop) and `section.cards` (h2 + three cards:
  image, h3, text, link; three columns on desktop). Its `<style>` is
  **desktop-first**: the desktop layout is the base and two queries override
  it for phones, `@media (max-width: 599px)` (hero and card grid to one
  column, smaller h1, stacked CTAs, 4 / 3 hero image) and
  `@media (width < 600px)` (section padding `40px 20px`, smaller h2). Both
  switch at 600px.
- `styles/styles.css` — the stock aem-boilerplate file (mobile-first, two
  `(width >= 900px)` queries).
- `package.json` — the stock aem-boilerplate scripts: `lint:js`, `lint:css`,
  `lint` = `npm run lint:js && npm run lint:css`, `lint:fix`. No
  `lint:breakpoints`.
- No `blocks/`, no `stardust/scripts/`, no `node_modules`, no DA
  credentials, no network. Impeccable installed.

## User prompt

"Use the stardust deploy skill on `stardust/prototypes/home-proposed.html`, up to and including the code: run Steps 1 and 2 (audit, names), do the Step 3 foundation in `styles/styles.css`, and write the `hero` and `cards` blocks (CSS and JS). Skip fonts, the header/footer chrome and the content page. Do NOT run the Playwright or runtime probes and do NOT deploy — this machine has no DA token, no network and no `node_modules`, so only lint scripts that need no installed package can run. Record what you did in `stardust/eds-conversion-log.md`. Decide everything yourself; do not ask me questions."

## Expected behavior

The stardust `deploy` skill is invoked. It:

1. Lifts the prototype's tokens and layout into `styles/` and `blocks/` and,
   as it lifts them, **converts the two desktop-first queries to
   mobile-first** (Step 3, #162): the phone declarations become the base
   rules and the desktop declarations move into `(width >= 600px)` (or
   `(min-width: 600px)`). No `max-width`, `width <`, `width <=` or
   upper-bounded range query is left in `styles/` or `blocks/`.
2. Keeps the switch point: the converted queries switch at 600px, not at
   599px or 601px, so the delivered page shows the prototype's phone layout
   at 360px and its desktop layout at 1280px.
3. Wires the check once: copies `skills/replica/scripts/breakpoint-lint.mjs`
   from the plugin to `stardust/scripts/replica/breakpoint-lint.mjs`, adds
   `"lint:breakpoints": "node stardust/scripts/replica/breakpoint-lint.mjs"`
   to `package.json` and appends `&& npm run lint:breakpoints` to `lint`,
   keeping `lint:js` and `lint:css` in the chain.
4. Runs `npm run lint:breakpoints` (the part of `npm run lint` that runs
   without `node_modules`) before declaring the code done, and it prints
   `breakpoint-lint: clean — … all mobile-first`.
5. Records the conversion and the lint result in
   `stardust/eds-conversion-log.md`.

## Failure modes this eval pins against

- Copying the prototype's `@media (max-width: 599px)` / `(width < 600px)`
  blocks into `styles/` or `blocks/` verbatim.
- Converting the direction but moving the switch point (`min-width: 599px`
  or `min-width: 601px`), or dropping a phone override in the conversion.
- Writing the lint into a one-off command instead of `npm run lint`, so the
  next block or page fix reintroduces a desktop-first query unnoticed.
- Replacing the stock lint chain instead of appending to it.
- Removing the stock `(width >= 900px)` rules or the structural layer of
  `styles/styles.css` to make the lint pass.
