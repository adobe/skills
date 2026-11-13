# Eval: spec judgement — component kinds (block / widget / default / metadata)

## Setup

A `spec` run for a regional airport operator's site, stages S1–S6 and the
S9 judgement files complete and saved; only the S7 mapping/catalog judgement
and S10 are left:

- `stardust/spec/spec.config.json` — origin `https://www.example.com`, scope
  `/en/`, parser profile `aem-core`.
- `stardust/.work/spec/` — `inventory/urls.txt` (3 sitemap pages),
  `fetch/fetch.jsonl`, `links/pages.jsonl` (empty), `parse/components.jsonl`,
  `parse/signals.jsonl`, `parse/links.jsonl`, `map/variants.json`,
  `chrome/header.json`.
- `parse/components.jsonl` — per page a `comps` tree of site components
  (custom resource types, NOT in the aem-core starter mapping):
  `banner` (h1, image, CTA links — the page hero), `richtext` / `title` /
  `image` (authored prose and media), `quicksearch` (a search box:
  `chars: 0`, `forms: 1`, no copy — results come from the search page /
  query index) and `langnav` (the language switcher: three locale links).
- `stardust/spec/judgement/` — `implementation.json` (one feature
  `site-search`, two open questions, a default query index), `findings.json`
  (three rule-driven headlines, one referencing `block:site-search`),
  `search-probes.json`, `answers.json` (`[]`). NO `mapping.json`, NO
  `catalog.json`, NO `knowledge/` yet.
- No network, no browser; the origin is not reachable. Impeccable installed.

## User prompt

"Resume the stardust spec skill at S7 on the saved run in `stardust/spec/` and `stardust/.work/spec/`: S1–S6 and the S9 judgement files are done and must stay as they are, and this machine has no network or browser, so do not re-fetch, crawl, capture or probe anything. Write `judgement/mapping.json` and `judgement/catalog.json` for the components in `parse/components.jsonl` (decide each component's kind from the component data and the skill's judgement reference, with a rationale per catalog entry), run the mapping script until nothing is unmapped, then run S10 so `stardust/spec/knowledge/` is written — in particular `blocks.json` and `page-blocks.jsonl`. Do not ask me questions; decide and record."

## Expected behavior

The stardust `spec` skill is invoked at S7. It:

1. Reads `parse/components.jsonl` (and `reference/judgement.md`) and writes
   `judgement/mapping.json` with one `direct` rule per site component:
   - `banner` → `kind: block`, block `hero` (authored h1, image, links),
   - `richtext`, `title`, `image` → `kind: default` (authored prose and
     media are default content, merged into one row),
   - `quicksearch` → `kind: widget` with a semantic block name such as
     `site-search` / `search` (code only, no authored content — "widget when
     the section carries no authored content"),
   - `langnav` → `kind: metadata` (a language switcher is page metadata, not
     a block).
2. Writes `judgement/catalog.json` with `header` / `footer` (`kind: global`),
   `hero` (`kind: block`, family `hero`) and the search entry (`kind: widget`,
   family `search`, `reference: null`, `verdict: new` — a widget's verdict is
   `new`), each with a rationale.
3. Runs `spec-map.mjs` (from the plugin tree or a `stardust/scripts/spec/`
   copy) until it reports `unmapped components: none`, producing
   `.work/spec/map/page-blocks.jsonl` with `kind` values `block`, `default`,
   `widget`, `metadata`.
4. Runs `spec-knowledge.mjs`; it exits 0 (every finding rule computes, no
   "missing from judgement/catalog.json" warning) and writes the full
   `knowledge/` set, where `blocks.json` lists `hero` (`kind: block`) and the
   search block (`kind: widget`, `verdict: new`) alongside the two globals,
   and `page-blocks.jsonl` carries the per-page kinds with chrome globals
   first and last.
5. Never names a block `widget` (the word appears only as a `kind` value),
   never re-fetches, and asks no questions.
