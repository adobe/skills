# The rollout's client contract (coverage/ and workspace/)

Clients (a migration tool that adopts a delivered project) read `stardust/rollout/coverage/` (`pages.json`,
`templates.json`, `blocks.json`) and `stardust/rollout/workspace/` (`manifest.json`, `judgement.json`); they never
re-crawl or re-judge. Unchanged inputs give byte-identical coverage. Statuses and lifecycle stay in
`skills/rollout/reference/coverage-model.md`. Schemas (strict: they describe what stardust writes):
`schemas/rollout-{pages,templates,blocks}.schema.json`, `schemas/rollout-workspace-manifest.schema.json`.

**Versioning.** Every coverage file and the manifest carry `formatVersion` (after `_provenance`), now `0.1.0`. Pre-1.0
a release may still change the shape; from 1.0.0 (declared once a client has shipped against it) a minor only adds
fields, clients ignore fields they do not know, and removing or renaming a field is a major.

**One page-block shape.** `pages[].delivered.blocks` uses the spec skill's record shape (`page-blocks.jsonl` in
`skills/spec/reference/knowledge.md`: `pos`, `block`, `variant`, `kind`, `section`) with rollout's extras `sectionPos`,
`classes`, `variantId`, `rows`, `cells` added, so stardust publishes one "which page uses which block" format. Where
they differ: spec's source-side fields (`source[]`, `path`, `nested_in`, `crop`) and its section and global rows are
absent (sections live in `delivered.sections`, chrome in the blocks.json chrome rows); `kind` is `block` or `default`;
`section` keeps spec's meaning (the style of the enclosing section, or null) and `sectionPos` is that section's ordinal.

## pages.json: `delivered` (after `blocks`; every other field unchanged)

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
| `outputs` | hashes of what a client reads: the three coverage files; a client trusts one only when its hash matches |
| `placeholders[]` | "(not judged)" summary lines (template names, template descriptions, blocks with base type `unknown`, blocks without purpose or reuse guidance); pages with `delivered: null` |
| `handover` | null, or `{at, detectedFrom}` (`marker` / `manifest` / `untracked-content`) from the first `--force` run; later forced runs keep it |
| `degraded` | only once a `--force` run found inputs differing from the manifest's: `{reason, inputs[]}`, accumulated across forced runs |

**Freshness:** the manifest refuses coverage older than its inputs (exit 1, naming what to re-run): a page with a
content file whose `delivered` is null or whose `contentHash` differs (`inventory.mjs`), or a file in blocks.json
`_provenance.inputs` (the judgement, conversion log and block JS/CSS `blocks.mjs` read) changed on disk (`blocks.mjs`).
`--draft-judgement` needs only `formatVersion`. **Judgement:** `templates.<id>.{name, description}` and
`blocks.<name>.{baseType, purpose, reuseGuidance, colorScheme}`; empty = unjudged, non-empty = judged (`reuseGuidance`:
one non-empty array). `defaults` are suggestions, `toFill` is informational, `colorScheme` is accepted but not prompted
(not in `toFill`, no placeholder). An unjudged template has no `name`/`description` in coverage; an empty base type
keeps the coverage default. Clients read judged values only from coverage.

## Identity and what is absent

Clients MUST ignore identity fields (`delivery.deployedUrl`, anything under `rollout.json` `site`) and resolve identity
from the repository they open. New free-text fields are scrubbed: the project's identity tokens become `<site>`, a
GitHub repo URL `<repo-url>`, a `<ref>--<repo>--<owner>` EDS host `<host>`, a DA content or admin path `<da-path>`.
Deliberately absent: screenshots (none are committed) and source selectors (`sourceSnapshot` names the source DOM).

## How it is produced

Structural fields are always written, by `skills/rollout/scripts/inventory.mjs` (`delivered`, template fields) and
`skills/rollout/scripts/blocks.mjs` (block fields, judged template values). Only the manifest and the judgement draft
are opt-in (`rollout.json` `exports: ["migration-workspace"]`, set by a person, a supervising process, or
`inventory.mjs --export migration-workspace`): Phase I, after `dashboard.mjs`, before the `I-dashboard` end line,
non-gating (a failure goes into that line's `--detail`, never `blocked`):

```bash
node skills/rollout/scripts/inventory.mjs …                            # the Phase A flags
node skills/rollout/scripts/blocks.mjs
node skills/rollout/scripts/workspace-manifest.mjs --draft-judgement   # once; then fill judgement.json
node skills/rollout/scripts/blocks.mjs                                 # judged values → coverage, template names too
node skills/rollout/scripts/workspace-manifest.mjs                     # → workspace/manifest.json
```

Exit codes: 0 written or unchanged, 1 coverage missing, without `formatVersion` or stale, 2 usage, 3 handed over (1
and 3 write nothing). **Handover:** `workspace/handover.json` (`{at, by}`, written by the adopting client, never by
stardust), a manifest recording a handover, or content once tracked that git no longer tracks → exit 3; `--force`
writes anyway, with `handover` and `degraded` as above.
