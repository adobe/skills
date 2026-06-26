# Operational learnings (scaled rollouts, ~1k pages)

Lessons from large, real full-site rollouts. SKILL.md points here from the phases
they apply to; none change the per-phase contract, they just save a debugging cycle.

## Extending a delivered site: a "new template" is usually a new COMPOSITION (Phase B)

When you add page types *after* the first rollout, a "new template" is almost
always a new composition of the existing block library, not new block code. Audit
`blocks/` BEFORE writing any block — most "new templates" resolve to existing
blocks recomposed, e.g.:
- blog = `article-header` + `article-body` (the news blocks)
- legal = `page-header` + `body-text`
- specialty landing = `page-header` + `lead-text` + `centers`
- center = `page-header` + `lead-text` + `body-text` + `contact-cta`

These ship with **zero new block JS/CSS** — only new archetype content files
composing existing blocks. Reach for a new block only when no composition of the
library reproduces the section. This keeps the library small and makes extension an
authoring task, not an engineering one.

## Two verify checks a roster-driven batch misses (Phase E)

A roster built from detail-page sitemaps omits these, so they get committed but
never deployed/published — and every link to them 404s while the dashboard still
reads 100%:
- **Nav/footer targets + section landing pages are NOT archetype siblings.**
  Enumerate the header/footer/nav fragment hrefs (and each section's index/landing
  page) and confirm each target is in the deploy+publish+verify set, not just the
  detail pages. (Static header/footer fragments are served from the CODE branch — a
  fix there is a git push, not a DA write.)
- **Absolute source-site "bounce" links.** Beyond root-relative `href="/…"` that
  404, flag `href="https://<source-host>/…"` links whose path HAS a delivered local
  equivalent — those silently bounce the visitor back to the OLD site (not a 404, so
  plain link-resolution misses them). Rewrite to the local path. Keep an absolute
  source link only when no local page exists (e.g. an un-migrated language tree).

## Optimize-gate learnings (Phase F)

- **A `head.html`-level fix needs a SITE-WIDE REPUBLISH to land, and to flip the
  findings.** The dominant baseline finding at scale is `ai-search/jsonld` ("no
  JSON-LD structured data") — one P2 *per page*. The cheap, legitimate fix is
  sitewide structured data in `head.html` (e.g. an `Organization` + `WebSite`
  `@graph`); the detector only checks for `application/ld+json` in the served
  `<head>`. But editing `head.html` updates the file immediately while
  **already-rendered pages stay CDN-cached with the old head** — `/head.html` shows
  the new JSON-LD yet `/some/page` does not. You must **`POST /live/` every page** to
  re-render it (verify on one page first: republish → GET → grep `ld+json`). On the
  optimize re-run those findings flip `open → fixed` (e.g. 715/716 in one pass).
  Per-page granular schema is a later enhancement, not needed to clear the gate.
- **A full republish also re-triggers query-index builds.** New indexes in
  `helix-query.yaml` sit at `total: building`/404 until in-scope pages are
  re-published under the synced config — the same republish that propagates a
  `head.html` change populates them. (Same root cause as the D2 publish gotcha.)
- **optimize only audits what's in `coverage/pages.json`.** When EXTENDING a
  delivered site (new templates, sub-trees, language trees), those pages aren't in
  the coverage ledger, so Phase F silently skips them. Re-run `inventory.mjs` (add
  the new pages to `state.json` first) before the gate, or audit them with explicit
  `--slug`/a second `--base` pass — otherwise "gate passes" covers only the old set.
- **Faithfully migrating PARALLEL source trees yields legitimate
  `duplicate-title`/`duplicate-description` findings, not bugs.** When a source
  serves the same content at two paths (e.g. a `/corporate/…` and an
  `/international/…` tree), reproducing both faithfully trips the cross-page
  uniqueness detector. The resolution is a **content-model / canonical decision**
  (canonicalize one tree to the other, or differentiate titles), not a re-author —
  surface it as such; don't silently rewrite source-faithful titles to dodge the
  check.
