# Operational learnings (scaled rollouts, ~1k pages)

Lessons from large, real full-site rollouts. SKILL.md points here from the phases
they apply to; none change the per-phase contract, they just save a debugging cycle.

## Extending a delivered site: a "new template" is usually a new COMPOSITION (Phase B)

When you add page types *after* the first rollout, a "new template" is almost
always a new composition of the existing block library, not new block code. Audit
`blocks/` and `widgets/` BEFORE writing any — most "new templates" resolve to existing
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
  Enumerate the hrefs in the `/nav` + `/footer` documents (and each section's
  index/landing page) and confirm each target is in the deploy+publish+verify set,
  not just the detail pages. The chrome documents themselves are PUBLISHED CONTENT
  (`content/nav.html`, `content/footer.html`) — they belong on the roster, and a
  chrome fix is a DA write + republish of that document (the header/footer BLOCK
  code is the only part that ships via git push).
- **Absolute source-site "bounce" links.** Beyond root-relative `href="/…"` that
  404, flag `href="https://<source-host>/…"` links whose path HAS a delivered local
  equivalent — those silently bounce the visitor back to the OLD site (not a 404, so
  plain link-resolution misses them). Rewrite to the local path. Keep an absolute
  source link only when no local page exists (e.g. an un-migrated language tree).
  Re-run the localizer over the whole tree after every wave: an earlier wave's
  pages gain valid targets only when a later wave ships them.
- **Link every internal page at its served URL** (`deploy/scripts/eds-path.mjs`):
  no `.html`, a slash only on a folder index (`/x/`). `.html` and a leaf's slash
  404 while `.plain.html` passes. Repoint `.html` links with no local page at the
  working source URL. The audit GETs each href against the LIVE tree: the ledger
  alone misses slash and case defects.
- **Targets missing from the capture.** Two cases, both recorded in
  `direction.md` as a named decision with the list: a target the direction's
  caps meant to include is a CAPTURE GAP — crawl it first (capture → migrate →
  gate, never authored from a live read) and deliver when the gap is ≤ 12
  pages, else repoint to the source site and list it as scope debt; a target
  outside the declared caps is SCOPE EXTENSION — repoint regardless of count.
  External targets: repoint to the source site; other-locale targets: repoint
  ONLY when that locale root was never captured. The ≤ 12 rule is for UNcaptured
  pages: a recorded run dropped ten captured locale roots by citing it, and a
  recorded audit found 10 uncaptured in-scope pages — delivering them was the
  right call.

## Site-assembly learnings (Phase D)

- **The served sitemap is not the assembled one.** `stardust/rollout/` is in
  `.hlxignore`, so `site/sitemap.xml` is a local artifact — the EXPECTED url set.
  The platform serves its own `/sitemap.xml`, built from its index of every
  published document, chrome documents included unless each carries `Robots |
  noindex` (SKILL.md Phase C has the row). A recorded hands-off run read the local
  file, reported "sitemap 36 urls" and shipped a served sitemap of 58 (36 pages +
  22 `nav` / `footer` documents). Two remedies, the first required:
  - **Authoring:** every chrome/fragment document — `/nav`, `/footer`, per-locale
    `nav-*` / `footer-*`, locale shells that are not pages — carries the row; a
    document already published without it is re-authored and re-published
    (preview → live) before the check.
  - **Configuration (alternative, additive):** when the code branch is writable, a
    `helix-sitemap.yaml` at the project root (`sitemaps.default.include: ['/**']`,
    `exclude: ['/nav', '/footer', '/**/nav*', '/**/footer*', '/fragments/**']`,
    `properties.lastmod: lastModified`) keeps chrome out of the served sitemap even
    when a document lacks the row; the same `exclude` globs go into
    `helix-query.yaml` (Phase D2) so the index never carries them either.

  `assemble.mjs --verify-origin <live-origin>` compares the served `<loc>` paths
  with the coverage rows and exits 1 on any difference. An extra path is a chrome
  document without `noindex` or a page built outside the migrated tree with no
  coverage row (`update-coverage.mjs --new`, Phase D2); a missing path is a page
  not published live. The `D-site` ledger `end` line names the SERVED count, never
  the assembled one — e.g. `--detail "sitemap served 36 = assembled 36; redirects
  wired; / 200"`.
- **The redirects sheet, and the root.** `stardust/redirects.tsv` (Phase C's
  path-safety gate) is wired into the redirects sheet at the content root: on a
  DA-backed site `/redirects.json`, columns Source / Destination; PUT through the
  admin API, then preview + publish it like a page. When the source root serves a
  page, deliver it as the root `index` document (the pipeline serves `/` from it —
  `/index` ≡ `/`; never also a `/` Source row, which would shadow it); only when
  the source root itself redirects (`curl -sI <source-url>`, follow the Location
  chain) does the sheet carry `/` and `/index.html` → the landing page. A 404 on
  `/` fails the whole delivery after every phase has passed (recorded — a sheet
  with a row for every `.html` path and none for `/`).
- **The DA library (#160).** Without a `library` tab in its site config, a
  migrated site shows authors an inherited or empty block library, never the
  blocks it shipped. `da-library.mjs` writes one document per block variant and
  per template, the sheets, and only the Blocks / Templates config rows.

## Dynamic-features learnings (Phase D2)

- **A 404 on `/query-index.json` means "no `helix-query.yaml`", not "no index can be
  configured".** Commit the yaml in the code branch (a spec's
  `knowledge/helix-query.yaml` is the draft), push, publish the pages live and
  poll (no more often than every 5 s, bounded) — no configuration-service write is
  involved; a 403 there with the migration token is expected. The sheet-backed
  interim index is the fallback only when the code branch is not writable
  (`skills/dynamics/reference/listings.md` § Getting an index at all).
- **A page built in D2 needs a coverage row** — `update-coverage.mjs --new` — or it
  stays outside verify, optimize and the sitemap.

## Optimize-gate learnings (Phase F)

- **Findings that mirror the source are informational, not work.** With the extract
  capture present, `optimize.mjs` tags a finding whose condition the source shares
  (`source parity:` evidence prefix, `fixability: out-of-scope`) and keeps it out of
  the score, the open counts and the gate — a recorded hands-off run accepted 63 by
  hand (`checks.md` § Source parity).

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
