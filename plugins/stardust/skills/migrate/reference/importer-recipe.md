# Importer rules (numbered, site-agnostic)

Ported from the `stardust/next` branch, `skills/migrate/reference/importer-recipe.md` (commits 1080f2b6, 7662fda2),
rewritten for the shipped encoder.

## When to read what

Read this before writing or widening a template's map — what `skills/migrate/scripts/encode.mjs` applies to
`stardust/current/pages/<slug>.html` to encode the template's siblings. Rules 1–7 shape what the map reads and emits;
8–10 are triage hints for its recurring defect classes; 11–13 point at the files that own the doc-source,
David's-Model and runtime contracts. `enforced by:` names the instrument that catches a violation today; `prose-only`
is judgment until an instrument lands. § Encoder contract is the encoder the plugin ships — write the map, not a
parser.

## Rules

1. **Import the rendered capture, never server HTML.** Client-injected elements (sub-navigation, scroll-loaded cards)
   are reconciled per template — replicate, policy-hide, or a `dynamics:<row>` marker — before a sibling ships.
   enforced by: the encoder's content count (`incomplete`); it reads only the committed capture, never the live page.
2. **Settle before you read.** A band empty in the capture but full live is a capture defect — fix extract's settle
   protocol, never paper over it in the map. enforced by: prose-only (capture vs live section count).
3. **Classify on the element itself, never a descendant.** A marker matches the element, the first in array order
   wins, wrappers only when nothing matches; the decode side is the inverse (deploy `SKILL.md` § 8, #53).
   enforced by: `--lint` C3 (one marker per module); the encoder (`unmapped` for a visible module with no emitter).
4. **Never flatten a wrapper that carries meaning.** A hero, modal section, card grid or box wrapper collapsed into one
   paragraph loses the structure a block needs; declare `wrappers[]` only for layout and scroll/lazy containers.
   enforced by: David's-Model lint D1/D3; the encoder's `flattened` stop (exit 2, never a logged warning).
5. **Walk content from the page root, not from a block pattern.** Consume only what the matched element owns, in
   document order; the rest is default content — patterns that swallow siblings drop everything between hits.
   enforced by: the encoder (walk from `root`, recursion only through `wrappers[]`); its content count.
6. **Exclusion list, applied at import, never at capture.** `<noscript>` bodies, `<template>`/binding markup,
   inline-script text, empty headings, third-party widget roots, tracking pixels. enforced by: David's-Model lint
   D15; the encoder strips the first four; widget roots and pixels are `drop:<reason>` markers.
7. **Strip `javascript:` hrefs and tracking params**, then rewrite per
   `skills/migrate/reference/content-preservation.md` § Internal link rewriting. enforced by: `delivery-lint` P1 link
   rules; the encoder drops `javascript:` hrefs and localises links as `localize-links.mjs` does (it keeps a query
   string: tracking params are prose-only).
8. **Uniform 5–7 % bands whose Δh grows with the heading count = a source container margin, not a section fault.**
   Compare `skills/replica/scripts/anchor.mjs` y positions and emit one section per source container; band reading:
   `skills/replica/reference/source-fidelity-gate.md` § Reading the band breakdown. enforced by: band table +
   `anchor.mjs` (prose reading).
9. **A map change that remaps shared structure needs a CSS audit per template.** Remapping a heading level, wrapper
   class or list shape changes what the template's CSS and TOC/index selectors see; re-gate one page per affected
   template. enforced by: `--roundtrip` (a remap fails it); prose-only for the gate rows.
10. **Adjacent same-name blocks in one section are one block.** N consecutive same-name tables are one table with N
    rows; the decode side segments rows, the import side must not split them. enforced by: `blocks.mjs` counts; the
    encoder merges adjacent runs of one marker (`merge`, default true).
11. **Doc-source markup maps to sections and prose, not nested tables.** Unwrap inline wrappers; `div.p` → `p`; split
    a list around a block child with `<ol start>` + `in-list` variant; cells hold inline prose, lists, images only
    (lift nested blocks to a sibling paragraph); `<dl>` → list with bold terms; each source `<section>` → one EDS
    section. enforced by: David's-Model lint D2/D5; prose-only for the mapping.
12. **The deviation ledger owns the smell list.** `<p>` > 400 chars carrying heading/table text, `<u>` small print,
    `Image W×H:` link text: deploy `davids-model.md` names the rule, `stardust/eds-conversion-log.md` records the fix
    or the deviation. enforced by: David's-Model lint; prose-only for unrowed smells.
13. **Every block the encoder emits must exist in the runtime.** A name with no `blocks/<name>/` counterpart renders
    as a bare table. enforced by: `--roundtrip` for the archetype's blocks; a block only siblings carry is
    prose-only (`coverage/blocks.json` vs `blocks/`) until its gate row.

## Where selectors come from

The committed archetype capture is the authority for every selector (root, wrappers, chrome, markers, rows, cells,
variant `when`). `stardust/replica/units.json` origin selectors anchor rows only when they select the same nodes (C4).
Sibling captures only widen the map; a widened marker names them in `evidence[]` (C2). The eds-schema gives roles and
cell order, aligned by block, never by section index (C6). The gated archetype document gives token and section-style
names; their condition comes from the source DOM (C5). A variance JSON says which siblings need a token, never selector
text. Never used (C1): generated ids or class tokens, position pseudo-classes, prototype classes (the eds-schema
`unitSelector` included), chains through a layout container.

## The map

One per template, keyed by the archetype slug: `stardust/import/<archetype-slug>/vocabulary.json` and an optional
`transform.json` (rich-text rules). `markers[]` is an array — order is the only precedence — of declarative `rows` ×
`cells`; `moduleSelectors` is a site-level component pattern, so an unknown component is `unmapped`, never default
content. Keys: `skills/migrate/reference/encode-map.schema.json`; semantics: the header of
`skills/migrate/scripts/encode/engine.mjs`, whose validators are the contract. Author it at C-archetype from the gated
archetype's convert — its delivered `content/<path>.html` and its capture: no delivered text in the map, no condition
on slug or URL, `literal` cells counted.

## Encoder contract

```bash
node skills/migrate/scripts/encode.mjs --template <archetype-slug> [--slug <s>[,…]] [--dry-run] [--json] [--force] [--overwrite-hand-edit <slug>[,…]]
node skills/migrate/scripts/encode.mjs --lint|--sweep|--roundtrip --template <archetype-slug> [--level text|strict]
```

- **Opt-in per template, gated at plan time.** Siblings encode only once the archetype is gated (unit `C-archetype`
  done, gate row passing), `--lint` exits 0 and `--roundtrip` exits 0. A template with no map, or one that does not
  round-trip, stays on the A′ clone path (`skills/migrate/reference/template-and-module-rendering.md` § Path A′).
- **Inputs.** The map, the roster (`stardust/rollout/coverage/templates.json`), each page's committed capture + page
  JSON and patches, and the site inputs: `stardust/deploy/media-ledger.json`, `stardust/deploy/asset-ledger.json`,
  `stardust/rollout/chrome-map.json`, `stardust/redirects.tsv`. Never the row-2 clone, never a sibling's `content/`
  document (`--roundtrip` and `--lint` C5 read the archetype's). No browser, network, clock or locale: the same inputs
  give the same bytes.
- **Hidden-live** content is honoured when the capture marks it (`data-hidden-live-stamp` on `<html>`/`<body>`, or any
  `[data-hidden-live]` node): skipped and listed in `hidden[]`; an unmarked capture skips nothing and records
  `hiddenLive: "unstamped"`.
- **Outputs**, each written only when its bytes change: `stardust/encoded/<da-path>.html` in deploy's delivered form
  (the metadata block alone in the first section — `Title`, `Description`, `nav`, `footer`, no `lang` row —, media from
  the ledger, links localised, sanitise's `encode()` last, so deploy's finalisers leave it unchanged); in migrate's
  sidecar only `encode` (the document's provenance) and `audit.encode` (this run's status and report);
  `stardust/import/<archetype-slug>/manifest.json`; `state.json` `migrate.generators[<archetype-slug>]`.
- **Statuses and exits.** Per page `clean | unmapped | flattened | variance | incomplete | hand-edit | error`; a stopped
  page's document is not written. Exit 0 every page encoded or unchanged · 1 usage, invalid map, missing input · 2 a
  page stopped; last line `encoded N · unchanged N · stopped N`. **Exit 0 means encoded, never done:** rows 4–7 of
  `skills/replica/reference/handoff-contract.md` § 1 still decide.

**Hard stops are the model's exceptions** — no numeric tolerance, no per-template code; only stopped pages reach the
model, and each remedy is on record (`dropped[]`, an accept's `reason`, `patchesApplied[]`):

| status | when | remedy |
|---|---|---|
| `error` | root missing or a landmark, 0 sections, no `<h1>` | map edit, else an exception page |
| `unmapped` | a visible module with no emitter | map edit (a marker), `drop:<reason>` or `dynamics:<row>` |
| `flattened` | a required row or cell resolves to nothing; a module inside rich content | map edit (`rows`/`cells`, a marker) |
| `variance` | the page's set of shape prints differs from the archetype's | review the class once: widen the map, or accept it — `variance.ignoreAncestors` (a chain-level class), `variance.accept[{print, on, reason}]` (one print) |
| `incomplete` | the content count finds a MISSING item | map edit (a cell, a rich-text rule) or `drop:` |
| `hand-edit` | the encoded document is not the encoder's last write | move the edit into a patch (one page) or the map; `--overwrite-hand-edit <slug>` replaces it (never in hands-off; `--force` does not) |

A patch (`stardust/patches/<slug>.json`, `[{selector, op: replace|attr|remove, name?, value?}]`) edits the rendered
document before the `<h1>` check and the content count, never the fingerprint. What the grammar cannot express is an
**exception page**: the model authors it as on a template without a map; the other pages stay encoded.

- **Round-trip.** `--roundtrip` encodes the archetype in memory against its gated `content/<path>.html`: exit 0 equal,
  2 not. Real templates pass at `text` (the default: code points equal after sanitise, NBSP kept, only ASCII whitespace
  runs collapse; `pre`/`code`/`textarea` and attribute values exact); the plugin's fixture passes at `strict`.
- **Lint and sweep** write nothing (checks: the header of `skills/migrate/scripts/encode/lint.mjs`). `--lint` after
  every map edit — map, `inputs` shas, a clean archetype, C1–C6; exit 1 on a finding. `--sweep` before siblings
  encode — a dry run over every sibling capture; exit 2 when it lists a new kind, unknown modifier or zero-hit marker.
- **Deploy staging.** `skills/deploy/scripts/stage-content.mjs` copies only a current, clean encode into
  `content/<path>.html` behind its own hand-edit guard and prints the paths to deliver; then deploy's chain,
  `--record`, `deploy-batch --force --paths`. Neither the archetype nor a stopped page is staged.
- **After a map edit**: `--lint`, `--roundtrip`, `--template` — only pages whose bytes change are rewritten; stage and
  re-gate those, never the whole tree. `skills/deploy/scripts/content-count.mjs` runs the count standalone (an
  approximation; `incomplete` decides).
