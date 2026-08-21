# Audit output contract — `audit.json` schema + the `report.html` craft brief

Two artifacts per audit, both under `stardust/audit/<domain-slug>/`:

- **`audit.json`** — the machine-readable truth. Every number, finding,
  and classification lives here first.
- **`report.html`** — the designed, human-facing rendering of that truth.
  Rendered by `$impeccable craft` (never hand-templated); every number it
  shows traces back to a field in `audit.json`.

`<domain-slug>` = hostname of the audited URL, lowercased, leading `www.`
stripped, dots replaced with dashes: `https://www.example.com/` →
`example-com`.

---

## Part 1 — `audit.json` schema

`_provenance` is the first top-level key, per
`../../stardust/reference/artifact-map.md` § Provenance shapes (JSON).

```jsonc
{
  "_provenance": {
    "writtenBy": "stardust:audit",
    "writtenAt": "<ISO-8601>",
    "againstInput": "<audited URL>",
    "readArtifacts": [
      "stardust/current/_brand-extraction.json",
      "stardust/current/brand-review.html",
      "stardust/current/pages/<slug>.json"
    ],
    "synthesizedInputs": [],
    "stardustVersion": "<plugin version>"
  },

  "site": {
    "url": "https://example.com",
    "domainSlug": "example-com",
    "pagesAudited": ["home", "pricing", "about"],   // slugs from extract
    "extraction": {
      "reused": false,            // true when a <7-day extraction was reused
      "extractedAt": "<ISO-8601>",
      "pageCount": 8
    }
  },

  // Non-interactive contract: every assumption the audit made instead of
  // asking a question. Rendered verbatim in the report's executive summary.
  "assumptions": [
    "Primary conversion action assumed to be 'Request a demo' (most prominent repeated CTA)."
  ],

  "scorecard": {
    "overall": 62,                // integer; formula in scoring.md
    "scoredWeight": 100,          // < 100 when a dimension was not measured
    "dimensions": {
      "brand-expression": {
        "score": 55,              // integer 0–100, or null when not measured
        "weight": 10,
        "evidence": ["measurements.brandColorShare", "F-004", "T-tokens-unused"],
        "notMeasured": []         // reasons; non-empty only when score is null
      }
      // … one entry per dimension id in scoring.md
    }
  },

  // Every quantitative claim in the audit. A measurement is one of:
  //   status "measured"      — taken with the stated method
  //   status "estimated"     — reasoned estimate; method + basis mandatory
  //   status "not-measured"  — could not be taken; reason mandatory
  // A bare number with no method is a schema violation.
  "measurements": {
    "brandColorShare": {
      "value": 0.06, "unit": "share-of-painted-pixels",
      "status": "measured", "method": "pixel-sample",
      "detail": { "screenshot": "assets/screenshots/home.png", "grid": "every 8th px", "paintedPixels": 41230, "brandPixels": 2478 }
    },
    "ctaFragmentation": {
      "value": 4, "unit": "distinct-labels-per-bucket",
      "status": "measured", "method": "pages-json-aggregation",
      "detail": { "bucket": "get-started", "labels": { "Get started": 6, "Start now": 2, "Try free": 2, "Begin": 1 } }
    },
    "typeScale": {
      "value": "ad-hoc", "unit": "scale-kind",
      "status": "measured", "method": "brand-extraction",
      "detail": { "headingSizes": [48, 40, 34, 28, 22, 18], "ratio": null }
    },
    "radiusSprawl": {
      "value": 4, "unit": "distinct-radii",
      "status": "measured", "method": "brand-extraction",
      "detail": { "occurrences": { "4px": 31, "6px": 12, "8px": 22, "12px": 5 } }
    },
    "contrast": {
      "status": "measured", "method": "wcag-computed",
      "detail": { "pairs": [ { "fg": "#6b7280", "bg": "#ffffff", "ratio": 4.39, "role": "body-secondary", "passesAA": false } ] }
    },
    "altCoverage": {
      "value": 0.71, "unit": "share-of-images-with-meaningful-alt",
      "status": "measured", "method": "pages-json-aggregation",
      "detail": { "images": 62, "emptyAlt": 14, "genericAlt": 4 }
    },
    "cwv": {
      "status": "measured", "method": "playwright-lab",   // or "psi-api"
      "detail": {
        "mobile":  { "lcp": { "value": 4.8, "unit": "s", "class": "poor" },
                     "cls": { "value": 0.02, "unit": "score", "class": "good" },
                     "tbt": { "value": 340, "unit": "ms", "class": "needs-improvement" } },
        "desktop": { "lcp": { "value": 1.9, "unit": "s", "class": "good" },
                     "cls": { "value": 0.01, "unit": "score", "class": "good" },
                     "tbt": { "value": 90,  "unit": "ms", "class": "good" } },
        "note": "Lab TBT is a proxy for INP; field data unavailable (PSI unreachable)."
      }
    }
    // … plus any check-derived measurement Phases 3–4 record
    //   (sitemapValid, jsonldTypes, llmsTxt, headingQuestionCoverage,
    //    extractableProseWords, ogCompleteness, redirectChain, …)
  },

  "findings": [
    {
      "id": "F-001",                    // stable within this audit: F-###
      "severity": "P1",                 // P1 | P2 | P3
      "dimension": "technical-seo",     // a dimension id from scoring.md
      "title": "Three pages share the same <title>",
      "evidence": {
        "type": "check",                // measurement | tension | screenshot | check | benchmark
        "ref": "check:duplicate-title", // measurement key, T-* id, screenshot path + region, check id, or benchmark URL
        "observed": "\"Example — Home\" on /, /pricing, /about"
      },
      "businessImpact": "Search results cannot differentiate the pages; the pricing page competes with the home page for its own query.",
      "fix": "Unique intent-bearing titles per page: lead with the page's value term, append the brand.",
      "guides": ["mwg:seo-titles-04"],  // modern-web-guidance ids when retrieved; [] otherwise
      "ledgerId": "f-3ba9c01d2e"        // rollout findings-ledger id, or null when no rollout project exists
    }
  ],

  "benchmarks": {
    "status": "run",                    // run | skipped
    "reason": null,                     // when skipped: "refero MCP unreachable"
    "references": [
      { "title": "Linear — pricing", "url": "https://linear.app/pricing",
        "note": "Single CTA voice held across every section; brand color reserved to the one ask." }
    ]
  },

  "upliftDirections": [
    { "id": "A", "pitch": "Tomorrow's version of the site you have today.",
      "summary": "Same IA, the P1/P2 findings fixed: one CTA voice, modular scale, AA contrast.",
      "addressesFindings": ["F-001", "F-003", "F-005"] },
    { "id": "B", "pitch": "What if we amplified <captured trait>?",
      "summary": "The captured photography foregrounded as the compositional spine.",
      "addressesFindings": ["F-004"] },
    { "id": "C", "pitch": "What if motion was part of the identity?",
      "register": "arrival",
      "summary": "Same IA as A; the brand's third dimension rendered kinetic.",
      "addressesFindings": [] }
  ],

  // The graceful-degradation record: every optional capability probed in
  // Phase 0 and what happened. Rendered in the report's methodology appendix.
  "degradations": [
    { "capability": "refero-mcp", "status": "available", "effect": null },
    { "capability": "marketing-skills", "status": "absent", "effect": "SEO/LLM checks run directly" },
    { "capability": "modern-web-guidance", "status": "absent", "effect": "generic remediation text" },
    { "capability": "pagespeed-insights", "status": "unreachable", "effect": "Playwright-only lab metrics" },
    { "capability": "rollout-ledger", "status": "absent", "effect": "no findings.mjs recording" }
  ]
}
```

Schema rules:

- **No bare numbers.** Every quantitative value lives in `measurements`
  with a `status` and `method`. Findings and the scorecard reference
  measurements; they do not carry independent numbers.
- **`estimated` is loud.** An estimated measurement states its basis in
  `detail` and the report renders it with an "estimated" qualifier. A
  measurement that could not be taken is `not-measured` with a reason —
  never a silent guess.
- **Finding ids are per-audit** (`F-001`…); `ledgerId` links to the
  cross-audit rollout ledger when one exists.
- **Dimension ids** are exactly the seven in `scoring.md`; `severity` is
  exactly `P1|P2|P3`.

---

## Part 2 — the `report.html` craft brief

`report.html` is a **designed artifact**. The audit skill does not
hand-template it; it delegates rendering to `$impeccable craft` via the
Skill tool (the same delegation mechanic as
`../../prototype/SKILL.md` § Invoking impeccable), passing:

1. the finished `audit.json` (the single source of every number),
2. the captured screenshots under `stardust/current/assets/screenshots/`,
3. the subject's palette and type from
   `stardust/current/_brand-extraction.json`,
4. this brief, verbatim.

### Register

An editorial **consulting report** — confident, data-forward,
print-quality. The typographic ambition of a well-set annual report or a
serious agency teardown, not a SaaS dashboard. Long-form reading rhythm:
generous measure, real hierarchy, numbers set large only where they are
the point.

### The subject/chrome split (load-bearing)

The report **visualizes the audited site's brand; it does not adopt it.**
The subject's palette appears as swatches, its type as specimens, its
pages as screenshot figures — all clearly framed as *exhibits*. The
report's own chrome stays neutral: near-black ink on paper-white, one
restrained accent for severity/classification chips, a disciplined
type system of the report's own. A reader must never wonder whether a
color belongs to the report or to the subject.

### Structure (section order)

1. **Masthead** — "Site audit", the audited URL, audit date, pages
   audited, a one-line provenance note.
2. **Scorecard hero** — the overall score set very large, with the seven
   dimension bars beside it (name, weight, score). Not-measured
   dimensions render as an explicit gap ("not measured — <reason>"),
   never as a zero-height bar.
3. **Executive summary** — 3–5 sentences: the site's biggest lever, the
   headline P1s, and the stated assumptions from `audit.json#assumptions`.
4. **Brand surface** — the subject's palette as swatches (hex + role +
   usage share), type specimens, radius/motif inventory. This is where
   the brand-expression measurements become visible.
5. **Findings ledger** — the prioritized list, P1 → P3. Per finding: a
   text severity chip, dimension tag, title, evidence line (the observed
   value or a screenshot figure with a callout), business-impact
   one-liner, and the concrete fix. Screenshots embed as evidence
   figures with captions citing slug + region.
6. **Technical & performance exhibit** — the SEO check results and CWV
   values set against their thresholds, each with a
   good / needs-improvement / poor classification chip and the
   measurement method stated (lab vs field).
7. **LLM visibility exhibit** — llms.txt, answerability, schema
   coverage, heading-as-question coverage, key-facts crawlability.
8. **Benchmarks** (only when `benchmarks.status === "run"`) — 2–3
   reference cards: title, URL, one line on what best-in-class does
   better.
9. **Uplift directions** — three pitch cards (A / B / C per
   `audit.json#upliftDirections`), each naming the findings it resolves,
   closing with the next step: *run `stardust:uplift <url>`*.
10. **Methodology appendix** — the full measurement table (value, unit,
    method, status), the degradation record, and the scoring-rubric
    pointer.

### Hard rules

- **Self-contained single file.** Embedded CSS, screenshots inlined as
  base64 `data:` URIs, no external JavaScript, no runtime font fetches
  (system stack or embedded). The file must open correctly offline.
- **Every number traces.** Any number rendered in the report exists in
  `audit.json` (`measurements`, `scorecard`, or a finding's `observed`).
  No derived statistics invented at render time.
- **Honest gaps.** `not-measured` and `estimated` statuses render
  visibly with their reasons. Never fill a gap with a plausible value.
- **No emoji.** Severity and classification chips are typographic
  (text + color), not icons or emoji.
- **Provenance block** as the first child of `<head>`, HTML-comment
  shape per `../../stardust/reference/artifact-map.md`.
- **Print-friendly.** A print stylesheet that keeps the scorecard,
  findings, and exhibits legible on A4/Letter.

### Forbidden

Generic dashboard slop — gradient stat cards, drop-shadowed KPI tiles,
donut charts for three values, icon-font decoration, skeleton-loader
aesthetics. Emoji anywhere. Invented data, placeholder lorem, or
"representative" numbers. Adopting the subject's brand as the report's
chrome.

### The bar

The bar to beat is
<https://paolomoz.github.io/semrush-stardust/audit/knack-analysis.html> —
match its content ambition, and beat it substantially on typography,
hierarchy, and evidence presentation (figures captioned and cited, not
pasted; numbers set in context, not floated in cards).

### Post-render validation (the audit skill runs this, not craft)

- Every scorecard number in the HTML equals its `audit.json` counterpart.
- Finding count and severity counts match `audit.json#findings`.
- Provenance comment present as first child of `<head>`.
- No external resource references (`src=`/`href=` to http(s) other than
  cited links in copy).
- Zero emoji code points.
- File opens with screenshots visible from a `file://` URL.

If validation fails, re-invoke craft with the specific violation; never
hand-patch numbers into the rendered file.
