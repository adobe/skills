# Audit scoring rubric — seven dimensions, one weighted site-health score

The scorecard is the audit's headline claim, so it must be **reproducible**:
two auditors handed the same `audit.json` measurements should land within
±5 points per dimension. This file makes that possible — every dimension
has observable anchors at 40 / 70 / 90, and the procedure below forbids
scoring without evidence.

## The seven dimensions

| id | name | weight | primary evidence |
|---|---|---|---|
| `brand-expression` | Brand expression | 10 | `brandColorShare`, `radiusSprawl`, `T-tokens-unused`, `T-color-imbalance`, Phase 5 benchmarks |
| `visual-hierarchy-craft` | Visual hierarchy & craft | 15 | `typeScale`, impeccable critique, VISION-pass screenshot observations |
| `conversion-focus` | Conversion focus | 20 | `ctaFragmentation`, `T-cta-vocab`, `T-nav-conflict`, above-the-fold analysis |
| `accessibility` | Accessibility | 10 | `contrast`, `altCoverage`, landmarks, `T-link-content-free`, `T-img-alt-*` |
| `technical-seo` | Technical SEO | 15 | Phase 3 check results (robots, sitemap, canonical, titles, OG, JSON-LD) |
| `content-llm-visibility` | Content & LLM visibility | 15 | Phase 4 results (llms.txt, answerability, schema coverage, key-facts crawlability) |
| `performance` | Performance (Core Web Vitals) | 15 | `cwv` measurement (LCP / CLS / TBT, mobile + desktop) |

Weights sum to 100. Conversion focus carries the most weight because the
audit's promise is a **better business outcome**, and the conversion path
is the shortest lever; brand expression and accessibility carry less not
because they matter less but because their business effect routes through
the other dimensions.

## Anchors

Score each dimension by finding the band the evidence fits. Anchors are
**observable states**, not adjectives — if you cannot point at the
measurement or screenshot that satisfies the anchor, you are in the band
below.

### `brand-expression` — does the site express its own brand, or a template's?

- **40** — brand-color share of painted pixels under 5%; design tokens are
  framework defaults while the actual brand color lives outside the token
  layer (`T-tokens-unused`); typography is a bare system stack with no
  display register; the page could belong to any company in the vertical.
- **70** — recognizable palette applied to primary CTAs and header
  (brand-color share roughly 5–15%); one consistent display face; but at
  least one unresolved brand tension remains (a palette color used as text
  only, a fragmented radius vocabulary, a temporal mark carried past its
  campaign).
- **90** — brand color deliberately deployed across surfaces (share ≥15%,
  or a documented restraint strategy where whitespace itself is the brand
  move); motif vocabulary coherent (≤2 radius values in active use);
  typography carries a distinct display register; no T-* brand tensions
  fire, or each firing tension is a deliberate, explainable choice.

### `visual-hierarchy-craft` — does the eye know where to go, and does the craft hold up close?

- **40** — type scale is ad-hoc (`typeScale.kind === "ad-hoc"`, no
  consistent ratio); three or more competing focal points in the first
  viewport; the VISION pass names a dated pattern dominating the hero
  (stock-photo hero + double CTA, carousel-as-homepage, wall-of-cards);
  spacing is inconsistent between sibling sections.
- **70** — a consistent scale ratio holds on the home page and there is a
  single clear focal point, but secondary pages fall apart, hierarchy is
  carried by font-size alone (no weight/color/space support), or section
  rhythm breaks below the fold.
- **90** — modular scale held across every audited page; deliberate
  spacing rhythm; the hero communicates what-this-is / who-it's-for / the
  ask within one viewport; alignment and optical balance survive zooming
  into any individual section.

### `conversion-focus` — does the page funnel attention to one ask?

- **40** — four or more distinct CTA labels for the same underlying action
  (`ctaFragmentation` on one equivalence bucket ≥4); no primary CTA in the
  first viewport, or the primary CTA competes with ≥2 equal-weight
  alternatives; pricing or what-it-is is not reachable within one click of
  home.
- **70** — one canonical CTA voice, visible in the first viewport, but the
  journey stalls: no mid-page reinforcement of the ask, proof elements are
  generic ("trusted by thousands"), or the nav contains competing actions
  (`T-nav-conflict`).
- **90** — a single canonical CTA voice with clear primary/secondary
  hierarchy; a stated value proposition in the hero; proof elements
  (customers, numbers, testimonials) sourced from real content rather than
  boilerplate; the ask restated at natural decision points down the page.

### `accessibility` — can everyone use it?

- **40** — a body-text/background pair in the captured palette computes
  below 3:1; over 30% of images carry empty alt (`T-img-alt-empty`); no
  `<main>` landmark; content-free link labels present ("click here",
  "read more" as bare links).
- **70** — body text meets 4.5:1 but at least one accent-on-background
  pair in an interactive role fails AA; alt coverage 70–95%; landmarks
  present but heading order skips levels or `<h1>` count ≠ 1 on some page.
- **90** — every captured palette pair meets AA in the role it is actually
  used in; ≥95% of content images carry meaningful alt; full landmark set
  (banner / main / contentinfo / nav); exactly one `<h1>` per page with
  ordered heading levels; no content-free link labels; animation respects
  `prefers-reduced-motion` where motion exists.

### `technical-seo` — can search engines crawl, index, and represent it?

- **40** — sitemap absent or invalid; titles missing or duplicated across
  pages; no meta descriptions; no canonical; `<h1>` count ≠ 1 on audited
  pages; http does not redirect to https cleanly.
- **70** — crawlable and indexable (robots.txt sane, sitemap declared and
  valid, canonicals present, https enforced) but metadata quality is weak:
  titles truncate past ~60 chars or bury the value term, descriptions are
  generic, Open Graph incomplete, JSON-LD absent or Organization-only.
- **90** — full crawlability; unique, intent-bearing titles ≤60 chars;
  descriptions that read as answers to the page's query; complete Open
  Graph on shareable pages; valid page-type JSON-LD on every audited page;
  redirect chains are a single hop to the canonical host.

### `content-llm-visibility` — will an AI answer engine find, understand, and cite it?

- **40** — the site's key facts (what it is, who it's for, pricing) live
  only in images, JS-rendered widgets, or are simply never stated; key
  pages carry under ~150 words of extractable prose; no structured data;
  headings are slogans ("Dream bigger") rather than topics.
- **70** — key facts stated in crawlable text and each page answers its
  primary question somewhere, but the answer is buried mid-page; schema
  covers a single entity type; no llms.txt; few headings map to questions
  a user would actually ask.
- **90** — each audited page answers its askable question in the first
  extractable prose block; schema.org covers the organization plus the
  page-type entities (Product / Service / FAQ / Article as applicable);
  headings scan as questions or topics; llms.txt present (or a deliberate,
  stated equivalent); content is deep enough to cite — specific claims,
  numbers, named capabilities rather than adjectives.

### `performance` — does it load fast enough not to lose the visitor?

Classify each metric against Google's thresholds first, then band:

| metric | good | poor | note |
|---|---|---|---|
| LCP | ≤ 2.5 s | > 4.0 s | |
| CLS | ≤ 0.10 | > 0.25 | |
| TBT (lab) | ≤ 200 ms | > 600 ms | lab proxy for INP — always label it as such |
| INP (field, PSI only) | ≤ 200 ms | > 500 ms | only when PageSpeed Insights field data was reachable |

- **40** — any Core Web Vital classifies **poor** on mobile.
- **70** — nothing poor, but at least one mobile metric sits in
  needs-improvement; desktop is good; the causes are identifiable
  (render-blocking chain, unsized images, heavy third-party script).
- **90** — every measured metric classifies **good** on both mobile and
  desktop; images sized and lazy-loaded below the fold; no render-blocking
  chain beyond the first stylesheet.

## Scoring procedure

1. **Band first.** Pick the anchor band the evidence fits. An exact anchor
   match takes the anchor's score; evidence between two anchors
   interpolates within the band. A profile worse than the 40-anchor scores
   in the 0–39 range at the auditor's judgment — but the judgment must
   still name the observations that put it there.
2. **Evidence floor.** Every scored dimension cites at least two evidence
   references in `audit.json#scorecard.dimensions.<id>.evidence` —
   measurement keys, finding ids, or tension ids. No evidence → the
   dimension is not scored (see rule 3), never guessed.
3. **Not-measured handling.** When a dimension's inputs could not be taken
   (e.g. CWV unmeasurable because the origin blocks lab agents), set
   `"score": null` and record the reason in `notMeasured`. The overall
   renormalizes over the measured weights, and the report states the
   omission in the scorecard hero — a missing dimension is visible, not
   silently averaged.
4. **Overall.** `overall = round( Σ(scoreᵢ × weightᵢ) / Σ(weightᵢ over scored dimensions) )`.
   Integers only, no decimals anywhere in the scorecard.
5. **Judgment discipline.** Wherever an anchor requires judgment ("weak
   metadata quality"), the report prints the observed value next to the
   judgment ("title: 'Home' — 4 chars, no value term") so the reader can
   re-derive the call.

## Severity is orthogonal to score

Findings carry P1/P2/P3 severity (P1 = actively losing business or
excluding users; P2 = material drag; P3 = polish). Severity prioritizes
the fix list; anchors set the score. A dimension can score 70 and still
carry a P1 (one severe defect in an otherwise competent surface), and the
scorecard must not be back-derived from severity counts.
