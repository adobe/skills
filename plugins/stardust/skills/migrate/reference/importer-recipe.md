# Importer rules (numbered, site-agnostic)

## When to read what

Read this before writing or widening any project importer — the script that
turns `stardust/current/pages/<slug>.html` into migrated documents for a
template's siblings (Path A′, `template-and-module-rendering.md` § Render path
selection). Rules 1–7 shape what the importer reads and emits; 8–10 are triage
hints for its recurring defect classes; 11–13 point at the files that own the
doc-source, David's-Model and runtime-probe contracts. `enforced by:` names the
instrument that catches a violation today or the planned one; `prose-only` is
judgment until an instrument lands.

## Rules

1. **Import the rendered capture, never server HTML.** Client-injected elements
   (sub-navigation, scroll-loaded cards) are reconciled per template — replicate,
   policy-hide, or a `dynamic-dependency` row — before a sibling ships.
   enforced by: content-count acceptance (`fidelity-tiers.md`); capture sha in
   the importer report (planned, importer skeleton).
2. **Settle before you read.** A band empty in the capture but full live is a
   capture defect — fix extract's settle protocol, never paper over it here.
   enforced by: prose-only (capture vs live section count).
3. **Classify on the element itself, never a descendant.** `el.matches(sel)`
   first, wrappers only when nothing matches; the decode side is the inverse
   (`deploy` `reference/block-js-scaffold.md` § Decode rules, #53).
   enforced by: content-count acceptance; importer skeleton (planned).
4. **Never flatten a wrapper that carries meaning.** A hero, modal section, card
   grid or box wrapper collapsed into one paragraph loses the structure a block
   needs; widen the sibling walk only around scroll/lazy wrappers.
   enforced by: content-count acceptance; David's-Model lint D1/D3 (deploy).
5. **Walk content from the page root, not from a block pattern.** Consume only
   what the matched element owns, in document order; emit the rest as default
   content — patterns that swallow siblings drop everything between hits.
   enforced by: content-count acceptance; importer skeleton (planned).
6. **Exclusion list, applied at import, never at capture.** `<noscript>` bodies,
   `<template>`/binding markup, inline-script text, empty headings, third-party
   widget roots, tracking pixels.
   enforced by: David's-Model lint D15; empty-heading row (red) — planned.
7. **Strip `javascript:` hrefs and tracking params in the rich-text pass**, then
   rewrite per `content-preservation.md` § Internal link rewriting (which today
   only skips them). enforced by: `delivery-lint` P1 link rules (rollout); strip
   step planned (importer skeleton).
8. **Uniform 5–7 % bands whose Δh grows with the heading count = a source
   container margin, not a section fault.** Compare `anchor.mjs` y positions and
   emit one section per source container; band reading: `replica`
   `reference/source-fidelity-gate.md` § Reading the band breakdown.
   enforced by: band table + `anchor.mjs` (prose reading).
9. **A global importer change needs a CSS audit per template.** Remapping a
   heading level, wrapper class or list shape changes what every template's CSS
   and TOC/index selector sees; re-gate one page per template, re-run the
   builders. enforced by: prose-only; the sweep's template sample (`rollout`
   `reference/sweep-protocol.md`).
10. **Adjacent same-name blocks in one section are one block.** N consecutive
    same-name tables are one table with N rows; the decode side segments rows,
    the import side must not split them.
    enforced by: adjacent-blocks row (amber) — planned; `blocks.mjs` counts.
11. **Doc-source markup maps to sections and prose, not nested tables.** Unwrap
    inline wrappers; `div.p` → `p`; split a list around a block child with
    `<ol start>` + `in-list` variant; cells hold inline prose, lists, images only
    (lift nested blocks to a sibling paragraph); `<dl>` → list with bold terms;
    each source `<section>` → one EDS section. enforced by: David's-Model lint
    D2/D5; prose-only for the mapping (`content-preservation.md` § Transform
    with rules points here).
12. **The deviation ledger owns the smell list.** `<p>` > 400 chars carrying
    heading/table text, `<u>` small print, `Image W×H:` link text: `deploy`
    `davids-model.md` names the rule, `stardust/eds-conversion-log.md` records
    the fix or the deviation. enforced by: David's-Model lint; prose-only for
    unrowed smells.
13. **Every block the importer emits must exist in the runtime.** A name with no
    `blocks/<name>/` or `build*Block` counterpart renders as a bare table.
    enforced by: runtime-detection probe block enumeration (`deploy` § Runtime-
    detection probe, planned); until then `coverage/blocks.json` vs `blocks/`.
