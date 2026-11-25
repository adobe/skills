# stardust:extract: prep mode, locale-root capture gaps

The text of this part of `skills/extract/SKILL.md`, which points here. "Above" and "below" refer to the order of the sections in that file.

## Prep mode (--prep)

- **Locale-root capture gaps are settled before Phase 2 of any flow.**
  After the crawl, `crawl.mjs` takes every captured locale root (a one-
  or two-segment path of locale codes — `/en`, `/fr-ca`, `/ca/en`),
  lists the same-origin targets linked from that page under its own
  path, and marks the ones missing from the capture:
  `_crawl-log.json#captureGaps` (`roots[]` with `root`, `slug`,
  `linked`, `uncaptured[]`, plus `detail`, a ready ledger string) and
  one `[crawl] capture gaps:` stderr line. Copy `roots[]` to
  `state.json.site.captureGaps` (the `site` block is extract's; an
  uncaptured target never becomes a `pages[]` row) and carry `detail`
  verbatim in the ledger `end` line that closes the extraction —
  `ledger.mjs extract prep end --detail "… uncaptured first-level
  targets: ca/en 15, fr/fr 0"` (replica's `extract end` repeats it) — so
  the owner decides on the gap now (widen with `--pages`, or record it
  as scope debt), not in the rollout link audit: two recorded hands-off
  runs captured `/ca/en` as a locale root while 15 `/ca/en/*` pages
  existed on the source, and found out six hours later, when 15 links
  answered 404 and the gap exceeded the 12-page deliver threshold.
