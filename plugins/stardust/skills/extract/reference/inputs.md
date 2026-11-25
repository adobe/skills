# stardust:extract: inputs

The text of this part of `skills/extract/SKILL.md`, which points here. "Above" and "below" refer to the order of the sections in that file.

## Inputs

- `<url>` — required. The origin to crawl. Examples: `https://example.com`,
  `https://example.com/shop`. A path narrows the same-origin crawl to
  that subtree.
- `--cap <N>` — optional. Override the default 5-page cap. The cap
  is intentionally small — a 5-page sample (home + four IA
  pillars/templates) is enough for cross-page brand aggregation,
  system-component detection, and the brand-review HTML; lift it
  (e.g. `--cap 25`) when a deeper crawl is genuinely needed.
- `--all` — optional. Lift the cap entirely; extract every
  discovered page after junk filtering. Equivalent to `--cap 0`.
  Use when the user spontaneously asks for a full crawl.
- `--pages <slug,slug,...>` — optional. Restrict the crawl to specific
  paths (slugs derived per `reference/ia-extraction.md`). Bypasses
  the cap.
- `--refresh <slug>` — optional. Re-extract one page that already exists
  in `state.json`.
- `--single` — optional. Equivalent to `--cap 1`. Useful for testing.
- `--wait <fast|medium|spec|auto>` — optional. Wait strategy per page.
  Default `medium`. See `reference/playwright-recipe.md` § Wait modes.
- `--no-junk-filter` — optional. Disable the default junk-page filter
  in discovery (see `reference/ia-extraction.md` § Filtering).
- `--no-consent-dismiss` — optional. Skip the pre-flight consent /
  cookie banner dismissal (see `reference/playwright-recipe.md`
  § Pre-flight: consent dismissal). Use when the redesign scope
  includes the consent surface or the dismissal's side-effects
  (script activation that wouldn't otherwise run) must be
  avoided. Default is to dismiss, keeping screenshots, voice
  aggregation, and per-section style unpolluted by the banner.
- `--dynamics` — optional, **migration-bound**. Record per-page reach
  signals of the dynamic surface (data endpoints, forms, modal
  triggers, player ids) in each page JSON `dynamic` section and roll
  them up in `_crawl-log.json#dynamicSurface`. Set by
  `prepare-migration`, `replica` and `migrate`'s safety net; never by a
  bare extract, `uplift` or `audit` — dynamics is a migration concern.
  Depth and classification belong to the stardust `dynamics` skill.
- `--concurrency <n>` — optional. Parallel browser contexts for the
  per-page capture loop. Default 4; sane range 4–8. See
  § Concurrency.
- `--brand-source <url>` — optional, repeatable. An additional
  **same-brand** origin whose brand surface enriches the primary
  extraction (shallow capture: home + up to 2 nav-linked pages).
  See § Cross-site brand sources.
- `--design-source <url>` — optional. Design-donor origin: its
  design system is captured to `stardust/canon-source/` and becomes
  the fixed redesign target while the primary origin supplies
  content. See § Cross-site brand sources.
- `--prep` — optional. Run in **migrate-prep mode**: lift the cap,
  type each page, detect module candidates, capture typed content
  slots, emit the prep summary. See § Prep mode below. Typically
  invoked via the `prepare-migration` orchestrator skill rather
  than directly.
