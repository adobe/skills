# Importer rules (numbered, site-agnostic)

## When to read what

Read this before writing or widening any project importer — the script that
turns `stardust/current/pages/<slug>.html` into migrated documents for a
template's siblings (Path A′ in `template-and-module-rendering.md` § Render
path selection). Rules 1–7 shape what the importer reads and emits; 8–10 are
the triage hints for its recurring defect classes; 11–13 point at the files
that own the doc-source, David's-Model and runtime-probe contracts. Each rule
ends with `enforced by:` — the instrument that catches a violation today, or
the planned one; `prose-only` means judgment until an instrument lands. The
same rule class has been re-learned on every project that hand-built an
importer; each entry below cost a site-wide re-import or a red lint class.

## Rules

1. **Import the rendered capture, never server HTML.** Structure comes from the
   settled DOM the crawler saved (`migration-procedure.md` § Inputs per page);
   elements the page injects client-side (sub-navigation, cards loaded on
   scroll) are reconciled per template — replicate, policy-hide, or a
   `dynamic-dependency` deviation row — before the importer ships a sibling.
   enforced by: content-count acceptance (`fidelity-tiers.md`); provenance
   sha of the capture file in the importer report — planned (importer
   skeleton).
2. **Settle before you read.** Lazily rendered bands and scroll-revealed
   sections must be present in the capture; a band that is empty in the
   capture but full on the live page is a capture defect, fixed in extract's
   settle protocol, not papered over in the importer. enforced by: prose-only
   (compare the capture's section count with the live page's).
3. **Classify on the element itself, never a descendant.** A rule matches
   `el.matches(sel)` first and recurses into wrappers only when nothing
   matches; `:scope >` shortcuts and `querySelector` on the module drop every
   element that carries the marker itself. The decode direction is the
   inverse — element OR descendant in the flattened shape (`deploy`
   `reference/block-js-scaffold.md` § Classifiers, #53). enforced by:
   content-count acceptance; planned (importer skeleton).
4. **Never flatten a wrapper that carries meaning.** A hero, a modal-bearing
   section, a card grid or a "box" wrapper collapsed into one paragraph loses
   the structure a block needs; keep the wrapper as a block row and let the
   sibling walk widen only around scroll/lazy wrappers. enforced by:
   content-count acceptance; David's-Model lint D1/D3 (deploy).
5. **Walk content from the page root, not from a block pattern.** Block
   patterns that "swallow" following siblings and matchers that start inside
   the first hit drop everything between hits; consume only what the matched
   element owns, in document order, and emit the rest as default content.
   enforced by: content-count acceptance; planned (importer skeleton).
6. **Exclusion list, applied after capture.** Drop at import time (never at
   capture): `<noscript>` bodies, `<template>`/binding markup (`{{ }}`),
   inline-script text, empty headings (the CMS emits one before the real
   heading), third-party widget roots (reviews, chat, consent), tracking
   pixels. enforced by: David's-Model lint D15 (bindings, inline-script,
   tracking tokens); planned lint rows: empty heading (red), adjacent
   same-name blocks (amber).
7. **Links: strip `javascript:` hrefs and tracking params in the rich-text
   pass**, then rewrite per `content-preservation.md` § Internal link
   rewriting (which today only skips such links). enforced by: link
   rewriting skip; `delivery-lint` P1 link rules (rollout); strip step
   planned (importer skeleton).
8. **Uniform warm bands = a container margin, not a section fault.** Triage
   hint owned by `replica` `reference/source-fidelity-gate.md` § Reading the
   band breakdown. enforced by: the band table + `anchor.mjs` (prose
   reading).
9. **A global importer change needs a CSS audit per template.** Remapping a
   heading level, a wrapper class or a list shape site-wide changes what
   every template's CSS and every TOC/index selector sees; re-gate one page
   per template before the re-import, and re-run the listing/TOC builders.
   enforced by: prose-only; the site-scale sweep's template sample
   (`rollout` `reference/sweep-protocol.md`).
10. **Adjacent same-name blocks in one section are one block.** N consecutive
    tables of the same block name are one table with N rows (or one block
    with a repeat unit), never N blocks; the decode side segments rows, the
    import side must not split them. enforced by: planned lint row (amber,
    David's-Model lint); `plan.mjs`/`blocks.mjs` instance counts (rollout).
11. **Doc-source markup maps to sections and prose, not to nested tables.**
    Unwrap inline wrappers; `div.p` → `p`; a list interrupted by a block
    child splits around it with `<ol start>` and an `in-list` variant on the
    child; cells hold inline prose, lists and images only — lift any nested
    block to a sibling paragraph; `<dl>` → a list with bold terms; each
    source `<section>` becomes an EDS section (its margin is the section
    gap). enforced by: David's-Model lint D2/D5 (deploy); prose-only for the
    mapping itself. `content-preservation.md` § Transform with rules points
    here.
12. **The deviation ledger owns the smell list.** A `<p>` over 400 characters
    that carries heading or table text, `<u>` small print, `Image W×H:`
    link text and their kin are David's-Model smells: `deploy`
    `davids-model.md` names the rule, `stardust/eds-conversion-log.md`
    records the fix or the justified deviation. enforced by: David's-Model
    lint (deploy); prose-only for the smells the lint does not yet row.
13. **Every block the importer emits must exist in the runtime.** A block
    name with no `blocks/<name>/` or `build*Block` counterpart renders as a
    bare table. enforced by: planned — the runtime-detection probe's block
    enumeration (`deploy` § Runtime-detection probe); until then
    `coverage/blocks.json` vs `blocks/` by hand.
