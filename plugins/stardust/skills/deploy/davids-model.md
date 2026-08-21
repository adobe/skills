# David's Model — the authored-structure contract for stardust:deploy

Distilled from https://www.aem.live/docs/davidsmodel (David Nuescheler's content-modeling
rules, "second take") and https://www.aem.live/developer/component-model-definitions.
Cited throughout the deploy skill as `D#N`. The test behind every rule: **a good model is
easy to author intuitively — in Word, Google Docs, or DA — without training.** The content
this skill generates must read as if a thoughtful author wrote it, because after handoff a
thoughtful author WILL maintain it.

Enforcement: `scripts/davids-model-lint.mjs` (🔴 blocks the DA write; 🟡 is advisory —
review, then fix or justify in the conversion log). Column three names where each rule
lives in the skill.

| # | Rule | Where it's enforced in this skill |
|---|------|-----------------------------------|
| D1 | **Blocks aren't ideal for authoring.** Blocks are tables; default content is easier. A prose section (heading/text/image/CTAs, no repeating units, no bespoke structure) is DEFAULT CONTENT, never a block. Never wrap bare text/heading/image in a `text`/`heading`/`image` block. URL-based content (video/embeds) is auto-blocked from a plain link, not authored as a block. Section heads above repeating blocks are default content. | Step 2 triage question 1; "The one rule"; ENCODE contract; `buildAutoBlocks()` in Step 3; lint 🔴 (default-content wrapper blocks, authored embed-URL rows) + 🟡 (whole-section over-blocking) |
| D2 | **No nested blocks.** A table inside a table is unmaintainable. Use fragments or auto-blocked links. | ENCODE structural rules; lint 🔴 |
| D3 | **Limit row/column spans.** Only the block-name header spans. Merged-cell layouts don't survive doc editors. | ENCODE structural rules; lint 🟡 |
| D4 | **Fully-qualified URLs.** Authors copy/paste URLs as opaque tokens; code extracts pathnames. (Editorial images: `content.da.live` URLs — see ENCODE → Images; internal nav links may be root-relative by EDS convention.) | ENCODE structural rules; Step 9 image rules; lint 🔴 (relative/repo-relative src or href) |
| D5 | **Lists.** Complex list items → one block row per item (the `cards` pattern). Simple inferred lists (related links) → one cell of links; code pulls the links. FAQ/accordion → one row per Q/A. | ENCODE contract (grouped item sets, Lists/FAQ) |
| D6 | **Buttons inherit from context.** A formatted link is a button; size/color come from its block/section context. Bold = primary, italic = secondary, both = accent (high-impact, sparingly). Needing >3–4 author-facing variants means a design-system decision was wrongly delegated to authors. | Step 5 (decorateButtons mapping, #25 escape hatch keeps variant choice in block code); ENCODE contract |
| D7 | **Filenames matter.** No trailing-slash→`index` mapping games; strip trailing slashes / `.html` with 301s. | Path discipline in the deploy chain (lowercase segments, no trailing `-`/`_`); mostly a site-config concern outside this skill's scope |
| D8 | **Group content by team ownership.** Access control via the content source's own roles; keep it simple. | Out of scope for conversion; note in handoff when a site has distinct content-owner teams |
| D9 | **Few blocks, few variants.** Developers add blocks to avoid regressions → sprawl. Keep the core set small; collapse same-pattern sections into one block + variants; deprecate unused blocks. | "The one rule" (variant collapse); Step 2 naming; "Output you will produce" block-count expectations |
| D10 | **Limit columns.** Many columns = fragmented content that breaks default-content semantics. Blocks stay ≤4 columns. Exception: genuine data tables. | ENCODE structural rules; lint 🟡 |
| D11 | **Use Block Collection content models.** If a section matches a collection pattern (hero, cards, columns, accordion, quote, table, embed, carousel/tabs), mirror that block's name and authoring shape — even when the CSS is fully bespoke. | Step 2 triage question 2; conversion log records the match per block |
| D12 | **Fragments may be harmful.** Chrome (`/nav`, `/footer`) and genuinely reused bands (disclaimers, sign-up forms) are the legitimate uses. Fragments add indirection; SEO-relevant copy belongs directly on the page (duplicate-content caveat). | Step 6 (chrome documents); ENCODE contract #86/D12 (key facts in page content) |
| D13 | **Don't overload alt-text.** Alt-text is the image description, nothing else — never data a block parses (easily lost in copy/paste, invisible to authors). | ENCODE structural rules; Images (alt required, description only) |
| D14 | **Name/value pairs only for configuration.** They map to `data-`/`<meta>`; never model displayed content (Heading/Image/Text) as name/value. | ENCODE contract; page `metadata` + section-metadata usage; lint 🔴 (display copy in a key-value block) |
| D15 | **No HTML, CSS, or JSON in documents.** A visible `<tag>`, `{{ }}`, or style rule as author-facing text is a modeling mistake — code lives in the repo. | ENCODE structural rules; content-page checklist; lint 🔴 |

## Component-model shape compatibility (forward-looking)

From aem.live "component model definitions": form-based authoring (Universal Editor)
models blocks in three shapes. Content this skill generates must be expressible in one of
them, so a later UE adoption needs **no content migration**:

- **Simple block** — one property per row, in model order (a hero: image row, alt, rich
  text). Most stardust blocks after D1 triage are this shape.
- **Key-value block** — config rows (`section-metadata`, a feed block's
  `source`/`limit`). D14 content only.
- **Container block** — own properties as single-column rows, then one row per child
  with a column per child property (cards, logos, FAQ). The repeating-unit shape.

The semantic bridges UE uses — **type inference** (image refs → `<picture>`, URL-ish
values → `<a>`, block-level tags → rich text), **field collapse** (`image`+`imageAlt` →
one `<img alt>`; `link`+`linkText`/`linkType` → one styled anchor), **element grouping**
(several fields → one cell of flat siblings) — produce exactly the flattened cell shapes
the decode anti-patterns (#48–#76) already parse defensively. A block whose authored shape
fits none of the three models is a signal the MODEL is wrong (usually a D1/D2/D10
violation), not that a fourth shape is needed.

Two structural facts worth pinning (they shape D2's "why"):

- EDS deliberately permits **one nesting level** — default content or blocks inside a
  section. Complex nested visuals (tabs, accordions) are modeled as consecutive sections
  and combined client-side (auto-blocking), or as one block whose rows the block JS
  segments.
- On current sites (rendering version ≥ 2), **section metadata is applied by the
  delivery pipeline**: `style` values become classes on the section div, `id` becomes the
  HTML id, other keys become `data-*` — server-rendered, and the metadata block is
  removed from the served DOM. Foundation CSS can rely on those classes at first paint.
