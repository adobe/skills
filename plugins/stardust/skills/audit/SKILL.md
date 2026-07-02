---
name: audit
description: Full three-perspective audit of an existing website from one URL — design (tensions + concrete improvement opportunities), SEO/technical, and LLM/AI-search visibility — plus Core Web Vitals, synthesized into a scored, evidence-bound report. Use when the user asks to "audit this site", "site audit", "design audit", "SEO audit", "why is my site underperforming", "LLM visibility", "how does my site look to AI", or invokes /stardust:audit <url>.
license: Apache-2.0
---

# stardust:audit

One URL in. One scored, evidence-bound audit out.

`audit` looks at an existing website from three perspectives — design
(brand tensions + concrete improvement opportunities), SEO/technical,
and LLM/AI-search visibility — measures Core Web Vitals, and
synthesizes everything into a seven-dimension scorecard plus a
prioritized findings ledger that tells the owner what to improve to
generate a better business outcome. The report is also the natural
seed for a redesign: its findings feed `stardust:uplift`'s
improvements list and `stardust:direct`'s Phase 2.5, and it closes
with uplift-shaped redesign directions so "run `stardust:uplift`" is
the obvious next step.

## Opinionated defaults

- **Multi-page by default** — `stardust:extract <url> --cap 8`
  (home + seven IA pillars) unless `--single` or `--pages` overrides.
- **Non-interactive** — the audit never asks questions. Every
  assumption it makes instead is recorded in
  `audit.json#assumptions` and stated in the report's executive
  summary.
- **Evidence-bound** — every claim cites a measurement, a `T-*`
  tension id, a check result, or a screenshot observation. A claim
  with no citation does not ship.
- **No fabricated data** — a measurement that could not be taken is
  reported as `not measured (<reason>)`, never estimated silently.
  An estimate, where reasoned, is labeled as one with its basis.
- **Graceful degradation, not failure** — optional capabilities
  (refero, marketing-skills, modern-web-guidance, PageSpeed
  Insights) are probed once and their absence is recorded, never
  fatal. See § Degradation ladder.

## Inputs

- `<url>` — required. The site to audit. A path narrows the crawl to
  that subtree (extract's semantics).
- `--pages <n>` — optional. Override the default 8-page extraction
  cap (passed through as `--cap <n>`).
- `--single` — optional. One-page audit of the given URL only. The
  cross-page checks (duplicate titles, sitemap coverage, CTA
  fragmentation across pages) then run on a single page and say so.
- `--deploy` — optional. After the report renders, publish
  `report.html` as a single self-contained page via the DA transport
  (`../deploy/da-deploy-protocol.md`: source PUT → preview → live)
  and print the delivered URL. Transport only — the report never
  goes through deploy's section→block conversion, which would
  decompose the self-contained file.
- `--benchmark` — optional. Force Phase 5 reference benchmarking:
  probe the refero MCP even when the earlier capability probe was
  slow or ambiguous. Without this flag Phase 5 fires only when the
  probe succeeds quickly.

There are no other flags. Everything else is derived from the
captured surface or governed by the underlying skills' contracts.

## Phase 0 — Setup

1. Run the master skill's setup (`../stardust/SKILL.md` § Setup) —
   with one audit-specific carve-out: **impeccable absence is a
   degradation here, not the master setup's hard stop.** When the
   dep check fails, record `impeccable: unavailable` in
   `audit.json#degradations` and continue — Phase 2 runs without the
   critique/audit arms (VISION pass + accessibility fold-in still
   fire) and Phase 6 skips the report render; the run ends at stop
   condition (b) *after* `audit.json` is written.
2. **Extraction freshness check.** If `stardust/current/` holds an
   extraction of the **same origin** less than **7 days** old —
   origin from `stardust/state.json` (the site record extract
   stamped), recency from the newest
   `pages/<slug>.json#_provenance.fetchedAt` — reuse it
   and record `site.extraction.reused: true`. Otherwise invoke
   `stardust:extract <url> --cap 8` (or `--single` / `--pages <n>`
   per the inputs). Extract owns the crawl, the screenshots,
   `_brand-extraction.json`, `pages/<slug>.json`, `PRODUCT.md` /
   `DESIGN.md`, and `brand-review.html` with its Tensions section.
3. **Probe optional capabilities once**, recording each outcome in
   the degradation record (`audit.json#degradations`):
   - `marketing-skills` plugin (`seo-audit`, `ai-seo` skills present?)
   - `modern-web-guidance` (`npx -y modern-web-guidance@latest search
     "<query>"` responds?)
   - refero MCP (attempt `mcp__refero__refero_search_styles`; treat a
     tool-not-found or timeout as unavailable)
   - PageSpeed Insights API (network-reachable without a key?)
   - rollout project (`stardust/rollout/rollout.json` present?)

If extract fails entirely (site unreachable, bot-management block
past the headed-Chrome fallback), stop and surface extract's error
verbatim — there is nothing to audit. This is the only hard stop
before synthesis; see § Stop conditions.

## Procedure

### Phase 1 — Brand surface & tension analysis

Read `stardust/current/_brand-extraction.json` and
`stardust/current/brand-review.html` § Tensions surfaced (rule
catalog in `../extract/reference/brand-review-template.md`
§ Tensions). Every fired `T-*` tension is candidate evidence for a
finding — carry the ids forward, do not re-derive the detections.

Compute the four brand-expression measurements the report needs.
Each lands in `audit.json#measurements` with `status` + `method` per
`reference/report-format.md`:

- **`brandColorShare`** — brand-color share of painted pixels on the
  captured home screenshot. Preferred method: Playwright pixel
  sampling (`method: "pixel-sample"`) — load the screenshot, sample a
  grid (e.g. every 8th pixel), classify each sample to the nearest
  palette entry within a tolerance, and divide brand-hue samples by
  painted (non-white/near-white) samples. When sampling is infeasible
  in the session, a reasoned estimate from the captured surfaces is
  allowed but must ship as `method: "surface-estimate"` with its
  basis — never presented as measured.
- **`ctaFragmentation`** — distinct CTA labels per equivalence bucket,
  aggregated from `pages/*.json#ctas[].label` (the same buckets that
  drive `T-cta-vocab`).
- **`typeScale`** — distinct heading sizes and scale kind/ratio from
  `_brand-extraction.json#type.scaleAudit`.
- **`radiusSprawl`** — distinct border-radius values with occurrence
  counts from `_brand-extraction.json#motifs.borderRadius`.

### Phase 2 — Design & experience critique

Three passes over the captured home page (screenshot + live URL),
folded into one set of design findings:

1. **impeccable critique + audit.** Invoke via the Skill tool using
   the delegation mechanic in `../prototype/SKILL.md` § Invoking
   impeccable (`Skill { skill: "impeccable:impeccable", args:
   "critique <target>" }`, then `"audit <target>"` for the
   accessibility / responsive / performance passes). Normalize its
   findings into the audit's finding shape.
2. **VISION pass.** Study the captured screenshots directly
   (`stardust/current/assets/screenshots/<slug>.png`) and name what a
   design director would: dated patterns the field has moved past,
   hierarchy failures, missed opportunities the captured surface
   doesn't capitalize on. The claim discipline is absolute — every
   observation cites a measurement, a tension id, or a screenshot
   region ("`home.png`, hero: three equal-weight CTAs compete").
   Adjectives without evidence do not become findings.
3. **Accessibility fold-in.** Contrast computed (WCAG ratios for the
   captured palette pairs in the roles they are actually used in),
   alt coverage from `pages/*.json#media.images`, landmark presence
   and heading order from `pages/*.json#landmarks`, content-free link
   labels (reuse `T-link-content-free` when fired).

### Phase 3 — SEO & technical

When the `marketing-skills` plugin is installed, follow
`marketing-skills:seo-audit`'s methodology and normalize its
issue/impact/evidence/fix items into findings. When absent, run the
checks directly — they are all curl/Playwright-derivable:

| area | checks | method |
|---|---|---|
| Crawlability | `robots.txt` present and sane; sitemap declared and valid XML | curl |
| Indexation | canonical present and self-referential; `meta robots` not accidentally `noindex`; http→https single-hop redirect; redirect chains | curl -I |
| Semantics | `main`/`nav`/`footer` landmarks; single `<h1>`; heading hierarchy without skips | pages/*.json + Playwright |
| Metadata | title/description presence + quality per page; duplicates across pages; Open Graph completeness | pages/*.json#metadata |
| Structured data | JSON-LD presence, parse validity, entity types vs page type | Playwright / curl |

Where a failure matches a `rollout:baseline` check id
(`../rollout/reference/checks.md`: `single-h1`, `title-missing`,
`meta-description`, `canonical`, `sitemap`, `jsonld`, `img-alt`,
`landmark-main`, `duplicate-title`), **reuse that id** as the
finding's `evidence.ref` (`check:<id>`) — findings recorded into a
rollout ledger under a known id get picked up by the AEM autofix
registry automatically.

**Core Web Vitals.** Measure LCP / CLS / TBT via Playwright
performance APIs (`PerformanceObserver` for
`largest-contentful-paint` and `layout-shift`, `longtask` entries for
TBT) on two viewports: mobile (375×667, CPU throttled where the
session supports it) and desktop (1440×900). When the PageSpeed
Insights API is network-reachable without a key, prefer it and record
`method: "psi-api"` (it adds field INP); otherwise record
`method: "playwright-lab"` and say in the measurement note that lab
TBT is a proxy for INP. Classify every metric against the Google
thresholds tabled in `reference/scoring.md` § performance.

**Remediation guidance.** When `modern-web-guidance` is installed,
run `npx -y modern-web-guidance@latest search "<specific failure>"`
for each distinct failure class and cite the returned guide ids in
the finding's `guides[]`. When absent, write the generic remediation
and leave `guides: []`.

### Phase 4 — LLM visibility

When `marketing-skills:ai-seo` is installed, follow its methodology.
When absent, assess directly:

- **`llms.txt`** — present at the origin root?
- **Answerability** — does each audited page answer the question a
  user would ask of it ("what does this cost", "what is this") in
  extractable, well-structured prose — and how early on the page?
- **schema.org coverage** — do the JSON-LD entities cover the
  organization plus the page-type entities an answer engine needs
  for entity understanding?
- **Heading-as-question coverage** — what share of `h2`/`h3` map to
  askable questions or scannable topics rather than slogans?
- **Content depth** — extractable prose word counts on key pages;
  specific, citable claims vs thin marketing copy.
- **Key facts in crawlable text** — are pricing, what-it-is, and
  who-it's-for stated in crawlable text, or locked in images and
  JS-rendered widgets?

Every Phase 4 finding names the concrete fix ("state the three price
points in the pricing table as text; they currently render only
inside the plan-card images"), not a category ("improve content").

### Phase 5 — Reference benchmarking (optional)

Fires when the refero MCP tools are reachable — the Phase 0 probe
attempted `mcp__refero__refero_search_styles`; `--benchmark` forces a
re-probe. Skip gracefully when unavailable
(`benchmarks: { status: "skipped", reason: … }`).

When available: retrieve 2–3 same-vertical reference styles, compare
the audited site's brand expression (Phase 1 measurements) against
what best-in-class in the category does, and cite each reference —
title, URL, one line on what they do better — in the relevant design
findings and in `audit.json#benchmarks.references`.

### Phase 6 — Synthesis & report

1. **Scorecard.** Score the seven dimensions per
   `reference/scoring.md` — anchors first, evidence floor enforced,
   not-measured dimensions nulled and renormalized. Compute the
   weighted overall.
2. **Findings.** Consolidate Phases 1–5 into the prioritized ledger:
   P1 (actively losing business or excluding users) / P2 (material
   drag) / P3 (polish). Per finding: `dimension`, `evidence`
   (measurement / tension / screenshot / check / benchmark citation),
   `businessImpact` one-liner, concrete `fix`, `guides[]`.
3. **Uplift directions.** Close with 2–3 redesign directions framed
   exactly like uplift's variant role contract
   (`../uplift/SKILL.md` § The three-variant role contract):
   **A** faithful + fixes (names the findings it resolves), **B** one
   captured-but-underused trait amplified, **C** cinematic (motion as
   identity, register suggested per
   `../prototype/reference/motion-registers.md` § Selection
   heuristic). Drop B when the captured surface can't support a
   differentiated middle — two strong directions beat three weak
   ones.
4. **Write `stardust/audit/<domain-slug>/audit.json`** — schema,
   slug convention, and measurement rules in
   `reference/report-format.md` Part 1. Provenance `_provenance`
   first key.
5. **Render `stardust/audit/<domain-slug>/report.html`** by
   delegating to `$impeccable craft` with the brief in
   `reference/report-format.md` Part 2 — the same Skill-tool
   mechanic as prototype, and the same rule: **never hand-template
   the report**. Run the post-render validation checklist; on
   failure re-invoke craft with the specific violation. Open the
   result with `open stardust/audit/<domain-slug>/report.html`.
6. **Ledger recording (rollout projects only).** When
   `stardust/rollout/rollout.json` exists, record each finding into
   the delivery ledger via
   `node skills/rollout/scripts/findings.mjs record` with source
   namespace `audit:` — `--source audit:<dimension>`, `--layer` from
   the mapping below, severity carried through, `--fixability`
   normalized per `../rollout/reference/audit-sources.md`
   § Recording an external finding. Write each returned id into the
   finding's `ledgerId`.

   | audit dimension | ledger layer |
   |---|---|
   | `brand-expression` | `brand-tensions` |
   | `visual-hierarchy-craft` | `design-ux` |
   | `conversion-focus` | `content-conversion` |
   | `accessibility` | `accessibility` |
   | `technical-seo` | `seo` (site-wide: `cross-page`) |
   | `content-llm-visibility` | `ai-search` |
   | `performance` | `seo` |

7. **`--deploy`.** When passed, publish `report.html` via the DA
   transport per `../deploy/da-deploy-protocol.md` — PUT the file as
   a single source, POST preview, POST live, verify the delivered
   URL returns 200 — and print the delivered URL. Transport only;
   never run deploy's section→block conversion on the report.
8. **Chat summary.** Short — the work is on disk and openable:

   ```
   audit complete — <url>

   Site health: <overall>/100
     <dimension>: <score>   × 7 (not-measured dimensions listed with reasons)

   Findings: <n> P1 · <n> P2 · <n> P3
   Top lever: <the single highest-impact P1, one line>

   Report: stardust/audit/<domain-slug>/report.html
   Data:   stardust/audit/<domain-slug>/audit.json

   Next: run stardust:uplift <url> — the report's closing directions
   are its variant briefs.
   ```

## Degradation ladder

Probed once in Phase 0; every degradation is recorded in
`audit.json#degradations` and rendered in the report's methodology
appendix. None of these stops the audit.

| capability absent | behavior |
|---|---|
| refero MCP | skip Phase 5; `benchmarks.status: "skipped"` with reason |
| marketing-skills | run the Phase 3 / Phase 4 checks directly (tabled above) |
| modern-web-guidance | generic remediation text; `guides: []` |
| PageSpeed Insights | Playwright-only lab metrics; measurement note says lab TBT proxies INP |
| Playwright pixel sampling infeasible | `brandColorShare` ships as `method: "surface-estimate"` with basis |
| rollout project | no ledger recording; `ledgerId: null` on every finding |

## Hard constraints

- **No fabricated data.** A measurement that could not be taken is
  `not measured (<reason>)` in both artifacts. Estimates are labeled
  with method + basis. This is the same discipline extract enforces
  against synthesis (`../extract/SKILL.md` § Failure modes) —
  fabricated audit numbers are worse than missing ones because they
  are actionable-looking and wrong.
- **Evidence discipline.** Every finding cites observable evidence:
  a measurement key, a `T-*` tension id, a screenshot region, a
  check id, or a benchmark URL. Uncited claims are cut in synthesis.
- **Report is craft-rendered.** `report.html` is authored by
  `$impeccable craft` against the brief in
  `reference/report-format.md`, validated afterward — never
  hand-templated, never hand-patched.
- **Provenance is mandatory** on both artifacts, per
  `../stardust/reference/artifact-map.md` § Provenance shapes.
- **Non-interactive.** No questions in normal flow; assumptions are
  stated in the report. The only stops are the two below.
- **Audit does not fix.** Fixes belong to `uplift` (page redesign),
  `direct` Phase 2.5 (improvements list), and rollout's optimize
  loop (platform autofix). Audit names the fix; it never edits the
  site.

## Stop conditions

Stop and surface only if:

(a) **Extract fails entirely** — site unreachable, structure
    unparseable, bot-management block past the headed-Chrome
    fallback. Surface extract's error verbatim; nothing to audit.
(b) **impeccable unavailable** — Phase 2's critique/audit arms and
    Phase 6's report render require it. Per the Phase 0 carve-out,
    the run continues in degraded mode (VISION pass, SEO/technical,
    LLM visibility, benchmarks all still fire) and writes
    `audit.json`; then stop and tell the user the designed report
    needs the impeccable plugin — deliver the data, not a
    hand-templated substitute.

Everything else degrades per the ladder; the audit never stops for
confirmation in normal flow.

## Outputs

```
stardust/
├── current/                             ← from extract (reused when <7 days old)
│   ├── _brand-extraction.json
│   ├── brand-review.html                ← Tensions section = Phase 1 input
│   ├── pages/<slug>.json
│   └── assets/screenshots/<slug>.png    ← VISION-pass + report evidence figures
└── audit/
    └── <domain-slug>/                   ← hostname, www-stripped, dots → dashes
        ├── audit.json                   ← scorecard, measurements, findings[], provenance
        └── report.html                  ← craft-rendered, self-contained

stardust/rollout/optimize/findings.json  ← appended via findings.mjs (rollout projects only)
```

Audit writes no `state.json` entries — extraction state belongs to
`extract`; audit's own artifacts are self-describing via provenance.
Re-running audit against a fresh extraction overwrites
`stardust/audit/<domain-slug>/`; ledger recordings dedupe by the
ledger's own id hash.

## Scope

- Audits and prescribes; never modifies the site or its redesign
  artifacts.
- One origin per run. Auditing a competitor set is N runs.
- The natural continuations: `stardust:uplift <url>` (the closing
  directions are its variant briefs), `stardust:direct` (findings
  feed the Phase 2.5 improvements list), rollout's optimize loop
  (ledger findings with known check ids autofix on AEM).

## References

- `reference/scoring.md` — the seven dimensions, weights, observable
  anchors at 40/70/90, scoring procedure.
- `reference/report-format.md` — `audit.json` schema (Part 1) and
  the `report.html` craft brief + post-render validation (Part 2).
- `../extract/SKILL.md` — crawl, capture, brand-surface extraction;
  § Failure modes for the anti-synthesis discipline.
- `../extract/reference/brand-review-template.md` § Tensions — the
  `T-*` detector catalog Phase 1 carries forward.
- `../prototype/SKILL.md` § Invoking impeccable — the Skill-tool
  delegation mechanic reused for critique (Phase 2) and the report
  render (Phase 6).
- `../rollout/reference/audit-sources.md` — the findings-ledger
  normalization rules (severity, fixability) Phase 6 applies.
- `../rollout/reference/checks.md` — baseline check ids to reuse so
  AEM autofix picks the findings up.
- `../rollout/scripts/findings.mjs` — the ledger writer (`record`).
- `../uplift/SKILL.md` § The three-variant role contract — the frame
  for the closing uplift directions.
- `../prototype/reference/motion-registers.md` § Selection heuristic
  — register suggestion for direction C.
- `../direct/SKILL.md` § Phase 2.5 — the improvements list audit
  findings feed on a subsequent redesign.
- `../deploy/da-deploy-protocol.md` — the DA transport behind
  `--deploy` (source PUT → preview → live; no block conversion).
- `../stardust/SKILL.md` § Setup — master-skill setup run in Phase 0.
- `../stardust/reference/artifact-map.md` — provenance shapes.
