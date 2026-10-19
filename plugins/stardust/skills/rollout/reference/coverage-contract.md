# The rollout's client contract (coverage/ and workspace/)

Clients (a migration tool that adopts a delivered project) read `stardust/rollout/coverage/` (`pages.json`,
`templates.json`, `blocks.json`) and `stardust/rollout/workspace/` (`manifest.json`, `judgement.json`, `mapping.json`);
they never re-crawl or re-judge. Unchanged inputs give byte-identical files. Statuses and lifecycle stay in
`skills/rollout/reference/coverage-model.md`. Schemas (strict: they describe what stardust writes):
`schemas/rollout-{pages,templates,blocks}.schema.json`, `schemas/rollout-workspace-manifest.schema.json`,
`schemas/rollout-workspace-mapping.schema.json`.

**Versioning.** Every coverage file, the manifest and the mapping carry `formatVersion`, now `0.1.0`. Pre-1.0
a release may still change the shape; from 1.0.0 (declared once a client has shipped against it) a minor only adds
fields, clients ignore fields they do not know, and removing or renaming a field is a major.

**One page-block shape.** `pages[].delivered.blocks` uses the spec skill's record shape (`page-blocks.jsonl` in
`skills/spec/reference/knowledge.md`: `pos`, `block`, `variant`, `kind`, `section`) with rollout's extras `sectionPos`,
`classes`, `variantId`, `rows`, `cells` added, so stardust publishes one "which page uses which block" format. Where
they differ: spec's source-side fields (`source[]`, `path`, `nested_in`, `crop`) and its section and global rows are
absent (sections live in `delivered.sections`, chrome in the blocks.json chrome rows); `kind` is `block` or `default`;
`section` keeps spec's meaning (the style of the enclosing section, or null) and `sectionPos` is that section's ordinal.

## pages.json: `delivered` (after `blocks`) and `excluded[]`; every other field unchanged

`excluded[]` (top level, only when there is one): planned pages the source no longer serves (`state.mjs exclude`), as
`{slug, path, sourceUrl, status: "excluded", reason, at}` — never rows of `pages[]`, so never counted.

| Field | Meaning |
|---|---|
| `delivered` | null when the page has no content file yet; else `{blocks[], sections[], lang, sourceSnapshot, contentHash}` |
| `blocks[]` | records in document order: `pos` (0-based over both kinds), `block`, `variant`, `kind`, `section`, `sectionPos`, `classes[]`, `variantId`, `rows`, `cells[]`; `metadata`, `section-metadata` and `header`/`footer`/`nav` are not records |
| `kind: block` | `block` = the block div's first class; `classes[]` = the rest, unique, sorted; `variant` = `classes` space-joined, or null; `rows` = row count; `cells[]` = cell count per row (never authored content) |
| `kind: default` | consecutive default content of one section as one record: `block` `default-content`, `variant` = its parts in order joined by `+` (`heading`, `text`, `image`, `video`, `button`, `link-list`, `separator`); `classes` `[]`; `variantId`, `rows`, `cells` null |
| `sections[]` | kept sections (one holding no record is dropped): `pos` (0-based), `style` (its section-metadata `style`, or null), `blocks[]` (the `pos` of its records) |
| `lang`, `sourceSnapshot` | the sidecar's `metadata.lang`; `stardust/current/pages/<slug>.html` when it exists (path style of `source.migratedHtml`); each else null |
| `contentHash` | `sha256:<hex>` of the content file: `index.html` for `/`, else `<path>.html` or `<path>/index.html` under `content/` |

`variantId` = `v_` + the first 12 hex of sha256 of `stardust-variant:<block>|<classes space-joined>`; prior ids stay.

## templates.json: new fields

| Field | Meaning |
|---|---|
| `type` | the representative page's sidecar `type`, else its `state.json` type, else null |
| `representativeUrl` | the representative's `source.sourceUrl`, or null |
| `urls[]` | the template's pages' source URLs: the representative's first, the rest sorted, unique, nulls skipped |
| `name`, `description` | only when judged, scrubbed; absent otherwise (clients fall back to `type`) |

## blocks.json: new fields (on `module` rows not mapped to `default-content`)

| Field | Meaning |
|---|---|
| `optionClasses[]` | the variants' classes plus classes chained to `.<name>` in `blocks/<name>/<name>.css`, sorted |
| `variants[]` | from every page's `delivered.blocks`: `{id (variantId), classes[], pages (distinct pages), instances}`, by classes |
| `description` | first sentence of the first doc comment in `blocks/<name>/<name>.js`, scrubbed, or null |
| `contract` | the block's bullet under a "Content contract" heading of `stardust/eds-conversion-log.md`, scrubbed, or null |
| `baseType` | always present: judged, else the name when standard (`accordion`, `breadcrumbs` (alias `breadcrumb`), `cards`, `carousel`, `columns`, `embed`, `form`, `fragment`, `hero`, `modal`, `quote`, `search`, `table`, `tabs`, `video`), else `unknown` |
| `purpose`, `reuseGuidance {suitableFor[], notSuitableFor[]}`, `colorScheme` | only when judged, scrubbed |

## workspace/manifest.json and judgement.json

| Field | Meaning |
|---|---|
| `_provenance` | `writtenBy` `stardust:rollout/workspace-manifest`, `writtenAt` = pages.json `generatedAt`, `readArtifacts[]`, `stardustVersion` (null in a project copy) |
| `inputs` | `sha256:` hashes of what coverage was built from: `content {files, sha256, tracked}` and the files `blocks.mjs` read (`judgement.json`, `stardust/eds-conversion-log.md`, each `blocks/<n>/<n>.{js,css}`, when present) |
| `outputs` | hashes of what a client reads: the three coverage files and `workspace/mapping.json` when present; a client trusts one only when its hash matches |
| `placeholders[]` | "(not judged)" summary lines (template names, template descriptions, blocks with base type `unknown`, blocks without purpose or reuse guidance); pages with `delivered: null`; module blocks delivered without a conversion record (`update-coverage.mjs --block`) |
| `selectorQuality` | present when `mapping.json` exists, derived from it (block-origin `countsOf`, not a rewrite): `instances`, `sources {encoderMap, textAlignment, position}`, `encoderCoverage` (encoder-map/instances, 3 dp), `zeroConfidence` (confidence-0 selectors — image-only repeating blocks with no text to anchor), the top `zeroConfidenceBlocks[]` and `byTemplate[]` (`{template, instances, encoderMap, textAlignment, position, encoderCoverage}` per mapping template, most instances first, so a reviewer sees which templates are encoder-backed and which fell back); a re-hash recomputes it and `--check` never counts it as drift |
| `sectionGaps` | present when `mapping.json` exists, derived from it the same way (`[]` when none apply): the sections an adopter projecting per selector drops — `{page, template, section, reason, blocks[]}`, `reason` `no-selector` (no source selector, so not emitted) or `blocks-unprojected` (selector kept but its blocks merge into an earlier section and are lost), `blocks[]` the dropped block names. `no-selector` is exact; `blocks-unprojected` models the adopter's current per-selector merge (each variant homes to its first emitted section), so it can under- or over-count a given adopter's real losses. `done-check.mjs` surfaces the no-selector count; a re-hash recomputes it and `--check` never counts it as drift |
| `judgement` | present when `workspace/judgement.json` exists, derived from it (not a rewrite): `{toFill, byKind}` — `toFill` counts the fields the judgement lists in its own `toFill[]` that are still empty, `byKind` splits that by field (name, description, purpose, reuseGuidance, baseType). Distinct from `placeholders` (unjudged COVERAGE values): a client can carry filled coverage while the judgement has open fields. `done-check.mjs` surfaces `toFill` as the `export_quality:judgement_to_fill` info line; a re-hash recomputes it and `--check` never counts it as drift |
| `handover` | null, or `{at, detectedFrom}` (`marker` / `manifest` / `untracked-content`) from the first `--force` run; later forced runs keep it; absent while captures exist without `mapping.json` (exit 2): not ready to hand over |
| `degraded` | only once a `--force` run found inputs differing from the manifest's: `{reason, inputs[]}`, accumulated across forced runs |

**Freshness:** the manifest refuses coverage older than its inputs (exit 1, naming what to re-run): a page with a
content file whose `delivered` is null or whose `contentHash` differs (`inventory.mjs`), or a file in blocks.json
`_provenance.inputs` changed on disk (`blocks.mjs`). **Judgement:** `templates.<id>.{name, description}` and
`blocks.<name>.{baseType, purpose, reuseGuidance, colorScheme}`; empty = unjudged, non-empty = judged (`reuseGuidance`:
one non-empty array; the draft's `defaults`, `toFill` and `colorScheme`: `workspace-manifest.mjs --help`). An unjudged
template has no `name`/`description` in coverage; an empty base type keeps the coverage default. Clients read judged
values only from coverage.

## mapping — the source side (`workspace/mapping.json`)

Every delivered block instance → the CSS selector of its origin element in the page's captured source DOM
(`sourceSnapshot`), derived and verified as stardust's own HTML parser reads the capture (no browser: no inserted
`tbody`). A selector resolves to exactly one element there, or is null; `confidence` (0–1) is the share of the block's
text the element holds (image `alt` is never block text). Shape (template `pages[]`: every mapped slug):
`{formatVersion, generatedAt, skipped[], templates[{templateId, pages[], sections[], blocks[]}]}`.

| Field | Meaning |
|---|---|
| `sections[]` | `{id, selector, pages[], style, blocks[], defaultContent[], confidence}`, aligned across pages by style and block names; `selector` generalises the per-page ones (the lowest common ancestor of the section's encoder-map and text-alignment anchors; null, `pages[]` empty, when no page has one: clients skip the section — the manifest's `sectionGaps` records these, and the sections that keep a selector but lose their blocks to a per-selector projection), `pages[]` = the slugs where its one hit is that page's own section element (`--verify` may drop one, never adds one); `defaultContent[]` = eds-schema roles, else delivered parts; `confidence` = the lowest over its pages |
| `blocks[]` | `{block, variant, variantId, section, positions[], instances[]}` per block, `variantId` and section; an instance is `{slug, pos, selector, confidence, source, verified}`, `pos` = its record's `pos` in that page's `delivered.blocks[]` (clients match instances to page blocks by it); `positions[]` = its instances' `pos`, unique, ascending |
| `source` | precedence `encoder-map` > `text-alignment` > `position`: the template's encoder map (`--encode`, default `stardust/import` when present, else `stardust/migrate/encode`; under its `root`, page-wide without one) selecting the instance's element, confidence 1 — a block it selects no element for falls through; else the element covering most of the text; else, when its text is not found (e.g. image-only), its position, confidence 0: a child of the section's element if any, else next to the nearest anchored neighbour, never another record's element, null when none is free |
| `verified` | `--verify`: `true` = exactly one capture element matches (not proof it is the right one), else `false`; `null` = not verified (skipped) |
| `skipped[]` | `{slug, reason}`: a page without a delivered structure, a content file or an indexable capture, or one that failed (`page could not be mapped (<error>)`); `{slug, block, pos, reason}`: a coverage block the delivered document no longer has |

**Rule:** clients read selectors only from mapping.json and only when its sha256 is listed in manifest.json outputs.
They also require its `generatedAt` to equal pages.json's (`block-origin.mjs` copies it), else the mapping is stale.

## Identity and what is absent

Clients MUST ignore identity fields (`delivery.deployedUrl`, anything under `rollout.json` `site`) and resolve identity
from the repository they open. New free-text fields are scrubbed: the project's identity tokens become `<site>`, a
GitHub repo URL `<repo-url>`, a `<ref>--<repo>--<owner>` EDS host `<host>`, a DA content or admin path `<da-path>`.
Deliberately absent: screenshots (none are committed). Source selectors live only in `workspace/mapping.json` (above).

## How it is produced

Structural fields are always written, by `skills/rollout/scripts/inventory.mjs` (`delivered`, template fields) and
`skills/rollout/scripts/blocks.mjs` (block fields, judged template values). The export — the manifest, the judgement and
`mapping.json`, all three — is written when `rollout.json` `exports` lists `migration-workspace` (set by a person, a
supervising process, or `inventory.mjs --export migration-workspace`): Phase I, after `dashboard.mjs`, before the
`I-dashboard` end line, by three commands in order, each required (procedure and `export_stale`: rollout
`SKILL.md § Phase I`):

```bash
node skills/rollout/scripts/workspace-manifest.mjs --draft-judgement   # once; then fill judgement.json
node skills/rollout/scripts/inventory.mjs … && node skills/rollout/scripts/blocks.mjs   # 1. Phase A flags; judged values → coverage
node skills/rollout/scripts/block-origin.mjs --verify                  # 2. required → workspace/mapping.json
node skills/rollout/scripts/workspace-manifest.mjs                     # 3. → workspace/manifest.json
```

**Handover:** `workspace/handover.json` (`{at, by}`, written by the adopting client, never by stardust), a manifest
recording a handover, or content once tracked that git no longer tracks → the manifest writes nothing and exits 3;
`--force` writes anyway, with `handover` and `degraded` as above. Other exit codes: each script's `--help`.
