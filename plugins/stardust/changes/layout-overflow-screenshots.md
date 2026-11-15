# a page whose CSS overflowed to Chrome's layout maximum is measured, not screenshotted (#602)

A source page with a column width of `calc(100% / 0)` lays out at 33,554,432 px (2^25, Chrome's layout
maximum) in both directions. Its full-page screenshot took gigabytes and killed the renderer or the
container; the crawler retried on the dead tab, still printed `OK`, and the agent recrawled it.
`stitch-shot.mjs` would have scrolled it in ~37,000 chunks into a ~193 GB buffer.

- **`stardust/scripts/live-session.mjs`** (through `browser.mjs`): `pageSizeInPage`, `layoutOverflow`,
  `shotPlan`, `LAYOUT_MAX_PX`, `SHOT_MAX_HEIGHT` — one size guard for every capture instrument.
- **`extract/scripts/crawl.mjs`** (`screenshotPage`): measures first — a layout overflow (or a page wider
  than 4 viewports) gets the viewport only, a page taller than 30,000 px is captured down to it (`capped`).
  A renderer crash is retried viewport-only on a fresh page, never the dead one. No screenshot or a layout
  overflow is a `[crawl] WARN` line with the reason and an entry in `_crawl-log.json#crawl.degraded`;
  `_signals` carries `pageSize`, `layoutOverflow` and `screenshotReason`.
- **`replica/scripts/stitch-shot.mjs`**: a layout overflow is refused before the settle pass (exit 1, no PNG,
  no capture record), naming the inconsistency register.
- Not yet guarded: the other `fullPage: true` captures (diff, deploy, qa, reskin, spec); they can take
  `shotPlan` the same way.
