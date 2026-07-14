# stardust:qa — check catalogue

Every check, what it validates, its finding ids, and why each severity is what
it is. Layers: **delivery** = raw fetch of what the pipeline serves;
**rendered** = headless chromium after block decoration.

Severity philosophy: **error** = a visitor or crawler is harmed right now;
**warn** = probably wrong or needs human/LLM triage; **info** = evidence worth
recording, no action implied. Findings marked *triage* carry enough evidence
for a judgment pass without re-crawling.

## routing (A, delivery)

| id | sev | what |
|---|---|---|
| `page-not-200` | error | inventory path doesn't serve 200 |
| `plain-not-200` | error | `.plain.html` variant missing — content doc not delivered |
| `fragment-not-200` | error | chrome fragment (nav/footer) missing |
| `redirect-not-firing` | error | a /redirects.json rule doesn't redirect |
| `redirect-dest-broken` | error | redirect lands on a non-200 |
| `no-redirects-sheet` | info | no /redirects.json — verification skipped |
| `trailing-slash-broken` | warn | `/path/` variant of a sample path fails |
| `404-not-404` | error | unknown paths don't 404 (soft-404s poison crawlers) |
| `404-page-empty` | warn | 404 body is near-empty (unstyled error page) |
| `sitemap-missing` | error | no sitemap.xml |
| `sitemap-lists-fragment` | error | sitemap exposes nav/footer as pages |
| `sitemap-only-page` | warn | published page nobody tracks |
| `missing-from-sitemap` | warn | tracked page invisible to crawlers |

## content (B, delivery — `.plain.html`)

| id | sev | what |
|---|---|---|
| `h1-count` | error | ≠ 1 `<h1>` |
| `about-error-img` | error | image failed DA ingestion |
| `placeholder-copy` | error | `[Placeholder]`, `REPLACE_WITH_*`, lorem, TODO/TBD in copy (allowlist source-inherited ones) |
| `micro-paragraph-run` | warn | ≥4 consecutive ≤3-word paragraphs — flattened component |
| `bare-ordinals` | warn | `<p>1</p>` rows — numbered component flattened |
| `duplicate-text` | warn | 12-word shingle repeats within 400 words — pasted twice |
| `flattened-collection` | warn / error (≥6 repeats + >40% of page words unblocked) | a periodic tag cycle (e.g. `h4+p+p` ×24) or ≥5 same-level headings at a steady stride in DEFAULT content — a structured directory/card set rendered as plain prose instead of a block ("masthead + prose dump + CTA" pages). Fixture-tested: `scripts/test/flattened.test.mjs` |
| `source-images-lost` | error | capture has ≥4 images, delivered page renders <25% of them — pipeline strips imagery authored inside flat content |
| `unknown-block` | error | authored block class serves no code under /blocks/ |
| `verbatim-below-threshold` | warn *(triage)* | <95% of captured source text found verbatim; evidence lists missing nodes |
| `verbatim-missing-nodes` | info | coverage ok but some nodes absent |
| `scrape-dir-empty` | info | fidelity skipped |

## templates (C, delivery)

| id | sev | what |
|---|---|---|
| `missing-template-blocks` | error | page lacks blocks its template prescribes (explicit config, else >70% sibling consensus) |
| `unblocked-page` | error | zero blocks while template siblings have them — fell back to plain prose |
| `no-template-map` | info | no template assignments; check skipped |

## rendered (D, browser; desktop 1440 + mobile 390)

| id | sev | what |
|---|---|---|
| `load-failed` | error | navigation failed/timed out |
| `main-collapsed` | error | `<main>` < 50px tall — blank page (gate on rect height, not computed display) |
| `section-collapsed` | error | content-bearing section renders 0px |
| `broken-image` | error | `img.complete && naturalWidth === 0` |
| `upscaled-image` | warn | rendered >2× a <200px source — blurry logo class of bug |
| `horizontal-overflow` | error (mobile) / warn (desktop) | page scrolls sideways |
| `page-error` | error | uncaught JS exception |
| `console-error` | warn | console.error output (third-party noise → allowlist) |
| `request-failed` | error | same-origin request failed or ≥400 |
| `decoration-stalled` | warn | sections never reached `data-section-status="loaded"` (hanging tags stall EDS decoration) |

## visual (E, browser)

| id | sev | what |
|---|---|---|
| `baseline-created` | info | first run — screenshot saved as baseline (commit it) |
| `visual-diff` | warn >0.5% / error >5% *(triage)* | pixels changed vs baseline; evidence: both PNG paths + per-band ratios. Iframes are masked; judge warn-level diffs before calling them regressions |
| `page-height-changed` | warn | full-page height moved >2% |
| `screenshot-failed` | warn | capture failed |

## metadata (F, delivery — raw fetch = crawler view)

| id | sev | what |
|---|---|---|
| `missing-title` | error · `missing-description` warn · `missing-canonical` warn · `canonical-mismatch` warn | head basics |
| `missing-og-title` / `-og-type` / `-og-image` | warn · `missing-og-image-alt` info · `og-image-broken` error | social cards |
| `noindex-on-live` | error | live pages excluded from indexing |
| `jsonld-invalid` | error · `jsonld-no-type` warn | structured data must parse server-side |
| `jsonld-visible-as-text` | error | `"@context"` in visible copy — JSON-LD row landed outside the metadata block |
| `duplicate-title` / `duplicate-description` | warn | fleet-wide duplicates |
| `favicon-broken` | warn | |

## links (G, delivery)

| id | sev | what |
|---|---|---|
| `broken-internal-link` | error | internal href target ≥400 |
| `link-via-redirect` | info | href resolves only via redirect |
| `off-inventory-link` | info | live 200 but untracked |
| `broken-anchor` | warn | `#fragment` has no matching id — server HTML first, then re-verified in the rendered DOM (blocks assign ids client-side; without the rendered pass this false-flags) |
| `anchor-unverified` | info | id absent from server HTML and no browser available to check the rendered DOM |
| `empty-href` | warn · `malformed-mailto` / `malformed-tel` warn | dead affordances |
| `broken-external-link` | warn (never error — externals flap) | 404/410/DNS-fail, each unique URL probed once — **opt-in via `--probe-externals`** (on blog-scale fleets the unique-external set dominates sweep time) |
| `externals-skipped` | info | externals not probed this run (the default); count reported so the skip is never silent |

## a11y (H, browser, desktop, axe-core via CDN)

| id | sev | what |
|---|---|---|
| `axe-<rule>` | critical/serious → error, moderate → warn, minor → info | deduped fleet-wide by rule; evidence: affected pages + sample selectors. Contrast flags on alpha-tinted chips can false-positive — composite before trusting, triage don't auto-allowlist |
| `axe-unavailable` | info | CDN blocked / injection failed |

## perf (I, browser + CDP; representatives = one page per template + home)

| id | sev | what |
|---|---|---|
| `transfer-over-budget` | warn | encoded bytes > budget (default 800KB) |
| `js-over-budget` | warn | JS transfer > budget (default 250KB) |
| `lcp-poor` | warn | lab LCP > 2.5s · `cls-poor` warn | CLS > 0.1 |
| `network-degraded` | info | neutral-host TTFB control tripped — all perf findings this run downgraded to info (a slow network must not read as a site regression) |
| `measurement` | info | per-page numbers, always recorded |
| `load-timeout` | warn | no load event in 60s |

## Cross-cutting

- `<check>/check-crashed` (error) — a check module threw; the sweep continues
  but the failure is visible, never silently dropped.
- Allowlisted findings keep their severity but don't count toward the exit
  code or summary totals; they render greyed-out in report.html.
