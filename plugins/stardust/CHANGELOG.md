# Changelog

This file starts at 0.14.0. Prior versions (0.3.0 – 0.13.1) are documented in
git history only (plus the branch-scoped notes in
`CHANGELOG-redesign-adobecom.md` and `CHANGELOG-delivery-media-fidelity.md`).

## 0.36.x (stardust/s55-export-rows) — the export reads the delivered rows as they are: a case-folded content file is found, a used block is converted, a synthesized row is named (#178)

In a recorded hands-off run the migration-workspace export was fresh and schema-valid and still misread three
things that were right on the delivered site. A verified, gated, live page shipped `delivered: null` ("1 page(s)
without a content file"), no mapping entry ("no delivered structure") and an empty template: its coverage row
keeps the source path's case while the deploy writes the document under the lower-cased delivered path, and
`contentFileFor` matched the row's path exactly on a case-sensitive file system. Thirteen module blocks, every one
live, gated and used by the delivered pages, read `pending` (rollout.json `blocks.pending 13`, the placeholder
"12 block(s) delivered without a conversion record", `blocks_pending:12`) because no unit had run
`update-coverage.mjs --block`. And three per-locale search pages added with `--new` (no source URL) left
done-check at `sidecars_missing:3: schema 3, gate widths 3` for ever — nothing to gate against, no schema
sidecar — until the lead removed them from pages.json by hand after json-edit's guard had refused.

- **A content file is found by the row path exactly, then by its delivered-path fold** (`lib.mjs`
  `foldDeliveredPath`, `contentFileMatch` → `{ file, rule, alternate }`; `contentFileFor` keeps its signature):
  the deploy's fold (`deploy/scripts/eds-path.mjs` `deliveredUrl` — segments lower-cased, runs outside
  `[a-z0-9]` → `-`), never a looser match; both cases present as two files: the exact one is read and the
  other named as `alternate`, not guessed. `inventory.mjs` reads the content tree by real names (a walk, not
  `existsSync`: on a case-insensitive file system the old lookup matched in inventory and the manifest then
  refused "coverage is stale" for the same page — one defect, two symptoms) and prints `Folded <n> row(s) …`
  and `Ambiguous <n> row(s) …`; block-origin and workspace-manifest resolve through the same function. On the
  recorded export: `Delivered 9/9` (was 8/9), the page's template maps 5 blocks / 14 sections (was skipped),
  the page placeholder is gone.
- **A block the delivered documents use, with its code under `blocks/`, reads `converted`** (`blocks.mjs`): a
  planned module row with `instanceCount` > 0 (counted from pages.json `delivered.blocks`) and
  `<blocks>/<name>/<name>.{js,css}` present is `converted` with `convertedAt: null` (derived, not recorded); a
  block no document shows, one whose code is missing, or any recorded status stays as recorded. `pending` now
  means: planned and shown by no delivered document yet, or shown while its code is missing. Stdout names the
  derived rows (`Converted <n> …`); `done-check.mjs`'s `blocks_pending` text, coverage-model.md, the coverage
  contract (a `delivery.status` row) and the handoff contract follow. On the recorded export: `blocks.pending
  13 → 0`, placeholders 2 → 0, no `blocks_pending` line.
- **A coverage row without `source.sourceUrl` is synthesized — no sidecar or gate asked of it**
  (`done-check.mjs`): `sidecarGap` leaves such rows unjudged (schema, widths, redirects; one skipped line counts
  them — gate-all's roster filter `delivered(r) && r.source && r.source.sourceUrl` draws the same line) and
  `doneGaps` names them under a new info line `synthesized_pages:N: <paths>` (after `pages_excluded`, before
  `blocks_pending`; a coverage fact, shown after handover too). Their status still counts — `pages_unfinished`
  until `verify.mjs --all` proves them live — and `unit_unproven` is unchanged. The coverage contract's row
  semantics, rollout SKILL.md (Phase D2 and the info lines), `update-coverage.mjs --new` and the handoff
  contract say so: such a row is never removed from pages.json by hand. On the recorded export with its three
  rows restored: `sidecars_missing:3` → complete, `info: synthesized_pages:3`.
- Tests: `inventory.test.mjs` — the pure rule (exact, folded, folder index, both cases, a missing file stays
  null, predicate and object inputs), a mixed-case row delivered from its lower-cased file and keeping its path,
  a file missing in both cases still null; `blocks.test.mjs` — derived vs recorded vs missing-code vs unused vs
  default-content rows, the counts, the summary line, idempotence; `done-check.test.mjs` — synthesized rows
  unjudged beside sourced rows still judged, the skipped and info lines and their place, a deployed synthesized
  row still unfinished, the CLI text and `--json`. The scripts index is untouched (20551 bytes). No version bump.

## 0.36.x (stardust/s54-export-truth) — the export states its own facts: the encode decision is the record's, section gaps stop predicting the adopter, low-confidence selectors are counted (#177)

In a recorded hands-off run the migration-workspace export was complete and self-consistent (outputs 4/4,
124/124 selectors verified, 7/7 files schema-valid) and still misstated three things the reviewing client
reads first. The ten-page template's `encode.decision` read `encoded` with `reason` and `recordedAt` null
while migrate's record said `no-roundtrip` (round trip exit 2, nine differences; nine siblings forked from
the archetype) — #173 let one encoder-map selector in the mapping decide before the record, and a
vocabulary that matched the captures is not an archetype that round-tripped. `sectionGaps` declared seven
`blocks-unprojected` sections and the handover note said they "lose their blocks", yet the adopter that
read the export names a block in every section that places one and reconciled all seven to zero with a
note — #164's reason modelled one client's per-selector merge, not a property of the export. And 45 of the
124 verified selectors (33 of them under 0.25) were text alignments whose element holds less than half of
the block's text, shipped as ordinary selectors with no quality line: `selectorQuality` counted confidence
0 only.

- **The encode decision is the record's verdict, never the mapping's inference** (`workspace-manifest.mjs`
  `encodeDecisionOf`): `encoded` / `no-roundtrip` / `not-attempted` / `hand-authored` as
  `migrate/encode-attempt.mjs` wrote it — the four verdicts it writes, and the one source that knows
  whether the encoder ran and what its round trip said — else `not-applicable` (a template of at most one
  page, no record) or `unrecorded` (a multi-page template with no record at all; `done-check.mjs`'s
  `export_quality:encode_unrecorded` keeps that meaning). `reason` and `recordedAt` always travel with the
  record. The mapping's encoder-map count stays on the row (`encoderMap`, `encoderCoverage`) as what it
  is: evidence that a vocabulary matched. On the recorded export the ten-page row now reads
  `no-roundtrip` with the round-trip line as its reason and the record's stamp; the counters move from
  `encoded 1 · notAttempted 11` to `noRoundtrip 1 · notAttempted 11`. Schema: the enum is unchanged (an
  older manifest still validates), the descriptions state the rule; the coverage contract, rollout
  SKILL.md, the handoff contract's done-check row and done-check's header follow.
- **`sectionGaps` lists only `no-selector` sections; `blocks-unprojected` is retired** (`sectionGapsOf`,
  `sectionGapNotes`). A section with no source selector is a property of the export — a client projecting
  per selector cannot emit it. The retired reason predicted one adopter's per-selector merge (each variant
  homed to its first emitted section) and was wrong for the next: the recorded export's seven declared
  gaps are now zero and the "lose their blocks" handover note is gone. The adopter's reader passes any
  reason through and reconciles against what it sees, so an export without the value changes nothing on
  its side; what the reason tried to express is the adopter's to report, and the one-off variants behind it
  are already counted in `variantsSummary.singleUse`. Schema: the value stays in the enum as deprecated
  (never written; an older manifest still validates), the descriptions say so; `done-check.mjs`'s
  `export_quality:null_selector_sections` is unchanged; the coverage contract and rollout SKILL.md follow.
- **`selectorQuality.lowConfidence`, per template too, and `export_quality:low_confidence:<n>`**
  (`workspace-manifest.mjs` `LOW_CONFIDENCE = 0.5`, `done-check.mjs`). A verified instance at 0 < confidence
  < 0.5 is counted: block-origin's confidence is `coveredShare` — the share of the block's text the selected
  element holds (images never text) — so below 0.5 the element holds a minority of that text and a fragment
  (a heading, a 16-character span) anchors the selector, evidence against it as the block's origin, while
  it resolves to one element and a per-selector client reads it as any other (the adopter places verified
  instances only and carries the confidence-0 position fallbacks as gaps, so those stay in
  `zeroConfidence`). The bar is block-origin's own `>0–<0.5` status bucket, so all three agree on the bar (the manifest counts verified
  instances only; block-origin's status line counts them all). The figure rides `--json` (`counts.lowConfidence`, null without a
  mapping) and a `Selectors` line in the printed status; done-check prints it right after
  `zero_confidence` — informational, never a gap, hidden after handover with the other seven. On the
  recorded export: 45 of 124 (33 under 0.25), where the manifest had said `zeroConfidence 0` and nothing
  else. Schema: both fields optional (an older manifest validates); the adopter reads `zeroConfidence` and
  `zeroConfidenceBlocks` by name and ignores keys it does not know. The coverage contract, rollout
  SKILL.md, delivery-gates and the handoff contract's done-check row follow.
- Tests: `workspace-manifest.test.mjs` — the mapping-decides cases flip to `unrecorded` / the record's
  verdict, a `no-roundtrip` + forked record beside encoder-map selectors, no gap for a section that keeps
  its selector, the retired value still validates and adds no note, the low-confidence buckets (0.009 …
  0.499 in; 0, 0.5, unverified and unchecked out), `--json` and the printed line; `done-check.test.mjs` —
  the new line's place, silence at 0 / null, hidden after handover. The scripts index is untouched (20551
  bytes). No version bump.

## 0.36.x (stardust/s53-slot-grammar) — the slot value grammar where the slots are written; a provenance `src` is no image; a never-directed sibling is told its status (#176)

In a recorded hands-off run the prep session (`extract --prep`) wrote the typed slots of
`stardust/current/pages/<slug>.json#slots` with a generator of its own and invented nested value shapes —
`headline: {text, level: "h1", src: "headings[0]"}`, `items: [{question: {…}, answer: null}, …]`, `help: {heading,
text: {…}, links: […]}` — because the slot VALUE grammar lived only in the header of `migrate.mjs` while
`extract/reference/prep-mode.md` § 4 named slot NAMES and pointed to a `current-state-schema.md` § Typed slots
that did not exist. `render --from-archetype` then refused every sibling: `headline (image value on <div> without
an <img>)` — misleading, `slotKind` tested `src` before `text`, so the provenance pointer read as an image — and
`items (unsupported value)` seven times over. A sibling the lane had never advanced to `directed` was refused
`strict source — no source HTML at stardust/prototypes/<slug>-proposed.html`, which the lane read as "no sibling
prototype". It then hand-copied the archetype's content document into `content/` for the sibling: no migrated
page, no sidecar or provenance, no `forked` record, no `encode-attempt.mjs record --hand-authored`. The one
recorded run whose lane re-derived flat values from the captured HTML forked six siblings on the same path.

- **The grammar at the source of the slots.** `prep-mode.md` § 4 carries the seven value shapes verbatim with one
  example each — `string | {text} | {html} | {src, alt?, srcset?} | {href, text?} | an array of those | null` — and
  the rule: a value is one of these or `null`, no nested objects, no provenance key inside a value; provenance goes
  beside the value in the array form (`{name, value, from}` — keys other than `name` and `value` are not read),
  page-level evidence in `_provenance`. A listing's card fields are one slot name per field (`card-title[]`,
  `card-image[]`, `card-link[]`), never an object per card. `current-state-schema.md` gains the § Typed slots the
  pointer named (both forms, the grammar, the rules the fork enforces; `slots` listed as the one key that may be
  absent). migrate/SKILL.md cross-links it where it describes `render --from-archetype` and strict slots and
  states the order after a strict slots refusal — fix the value → fork → `state.mjs advance … --to directed` →
  render; never a hand copy of the archetype's content document; `template-and-module-rendering.md` § Path A′
  Step 2 and extract/SKILL.md point at it. No stardust doc told an agent to copy the archetype when render
  refuses — the run's own brief did; nothing to replace.
- **`slotKind`: a `src` is an image reference only when it reads as one** — a path or URL (holds `/` or `:`) or a
  file name with an image extension (`.avif .bmp .gif .heic .heif .ico .jpg .jpeg .jxl .png .svg .tif .tiff
  .webp`; a query or fragment after it allowed): `isImageRef`, exported. Anything else inside a value is refused
  by name rather than read as text or as an image (a silently accepted stray `src` could hide a real image
  reference): `slotValueProblem` (exported) takes the leading key — `html`, else `src`, else `href`, else `text`,
  the fork's precedence — as the shape and checks that key's type, a `src` that is no image reference, `alt` /
  `srcset` / `text` types, then any key the shape does not have. Reasons: `headline (src "headings[0]" is not an
  image reference: no / : ? or #, no image extension)`, `items (an object with key(s) question, answer and none of
  text, html, src, href)`, `help (text is an object, not a string)`, `note (key(s) level outside the text value
  shape)`, `flag (a boolean is no slot value)`. An identical problem is listed once; the refusal's fix states the
  grammar — `fix the value in <capture>#slots (a value is a string | {text} | {html} | {src, alt?, srcset?} |
  {href, text?} | an array of those | null, with no other key inside it — extract/reference/prep-mode.md § 4) or
  the archetype's markup, or pass --source <slug>=<file>` (`SLOT_VALUE_GRAMMAR`, exported). The seven shapes, the
  array form's unread keys beside `value` and every existing fixture pass unchanged.
- **`chooseBranch`: a page whose status is not `directed` and has no source HTML is told so.** `strict source — no
  source HTML at <path> (status extracted: branch A renders the page's own prototype — only a directed page forks
  its archetype) — a sibling of an archetype: node stardust/scripts/stardust/state.mjs advance <slug> --to
  directed, then render <slug> again (it forks the archetype's prototype; render --from-archetype
  <proto-dir>/<archetype>-proposed.html --capture <current>/pages/<slug>.json first writes the sibling's own
  source HTML); an archetype: build the page's prototype or pass --source <slug>=<file>`; a prototyped / approved /
  migrated page gets the archetype fix alone. An explicit `--source` that does not exist and a `--branch-b` page
  keep the old line (the named file is the mistake, not the status). `plan` prints the same.
- `--help` (the header) states both rules; the scripts index is untouched (20551 bytes). Tests: `migrate.test.mjs`
  92 → 96 checks — the pinned refusal pins the fix text; `isImageRef` over 18 image references and 11 pointers;
  `slotValueProblem` over every shape and each reason; a fork with the run's six shapes refused in one line,
  identical items once, `{name, value, from}` accepted and `{name, text, from}` refused; the extracted and the
  approved page without a prototype pin both strict source lines, exit 2, nothing written. No version bump.
- Not done, deliberately: no bypass flag (`--unfillable empty` or any `--allow-*`) — an owner decision; the
  proposal is in the wave report.

## 0.36.x (stardust/s52-image-alignment) — a block with no text to anchor is located by its images (#175)

With #174 applied to the recorded hands-off runs, 69 position fallbacks remained across twelve runs and 66
of them were blocks carrying images (an image-only hero, repeating carousel and article-grid tiles) — each a
confidence-0 guess among its neighbours although the capture carries the very image: the delivered `img`
is named by the media harvester from the source file (`<stem>-<8 hex>.<ext>`, the stem lower-cased, folded,
cut to 60 characters) and its alt is the source's. Of those 66, 62 match every image by stem exactly once;
the other 4 are ambiguous (a logo repeated on the page) or missing from the capture.

- **`block-origin.mjs` image alignment** (`imagesOf`, `captureImages`, `alignImages`, `deliveredStem`,
  `captureStem`, exported) sits between text alignment and position: a block whose text found no anchor
  takes its images' element when each delivered `img` is found exactly once in the capture by file stem
  (the harvester's `-<8 hex>` dropped on the delivered side, the capture's `img` / `picture > source` URLs —
  src, data-src, srcset, data-srcset — folded the same way), else by a non-empty alt. One image climbs its
  wrapper-only ancestors (no text, no other leaf media — the block is the picture, not the band around it)
  and stops below the first that holds anything else; several images take their lowest common ancestor. A
  picture with its source and img is one unit; an image under noscript or template (a lazy-load fallback)
  none. `source: "image-alignment"`, confidence 1 when every image matched by stem, 0.8 when any by alt; an
  ambiguous stem or alt, a missing image, a partly matched block, or an element another record already has
  (the position fallback's discipline — text alignment has none, two records may cover one element) falls
  through to position as before. On the 112-instance export of #174 the hero moved from the position
  fallback (confidence 0) to `image-alignment` 1 at the grid column holding exactly the hero component;
  sections without a selector 1 → 0; nothing else moved and no confidence fell. Against the #174 baseline, a
  206-instance export goes position 48 → 1 (zero-confidence 48 → 1), a 90-instance one 9 → 2, the 112-instance
  one 3 → 2; a 188-instance encoder-backed export is unchanged; 62 of the 69 fallbacks are located, 7 remain
  (4 whose images are ambiguous or missing, 3 with neither text nor image). Two runs give the same bytes.
- Format: the mapping schema's `source` enum gains `image-alignment` (formatVersion unchanged — an enum
  value, no key); the status line and `--json counts.sources` carry `image-alignment N`; the manifest's
  `selectorQuality.sources` and `byTemplate[]` gain `imageAlignment` (optional in the manifest schema, so an
  older manifest still validates); `zeroConfidence`, `encode`, `export_quality:zero_confidence` and
  `encode_unrecorded` keep their meaning (confidence 0 is still the position fallback). --help, the exit-3
  message, the coverage contract, the manifest schema, rollout/SKILL.md and the done-check's info-line note say
  what a remaining zero-confidence instance now is: a position fallback — no encoder-map marker, no text
  match, no uniquely matched image. The position-fallback fixtures name images the capture
  does not carry, so each fallback rule is still exercised.
- Not covered, deliberately: CSS `background-image` (hundreds per page in one run; the delivered document
  has no counterpart to match it to) and images the deploy pipeline renamed beyond the harvester's rule.

## 0.36.x (stardust/s51-position-fallback) — delivered text decodes before it is aligned; the position fallback never lands on a blank element (#174)

In a recorded hands-off run the migration export's `mapping.json` carried 7 position fallbacks (confidence
0, `verified: true`) among 112 instances, and 4 of their selectors resolved to elements with no text and no
media — an empty grid component (`<div class="<title-slot>"> </div>`), a spacer, a rule, an empty
container. Reproduced on the run's own inputs (this version re-creates the shipped file byte for byte):
five of the seven fell back because their text was "not in the capture", and four of those five carried a
curly apostrophe, a dash or a ® that the deploy skill writes as a named character reference (`&rsquo;`
76×, `&reg;` 70×, `&mdash;` 17× in the run's `content/`) while a capture holds the character itself.
`lib.mjs parseHtml` decoded six names (`amp lt gt quot apos nbsp`), so `squash("We&rsquo;ve …")` could
never be found. Across twelve recorded runs, 11 of the 15 text-not-found fallbacks anchor at confidence 1
once the names decode; the other 4 are genuinely absent text (a video title living in attributes and
JSON-LD, form labels, share-link labels). The run's two remaining fallbacks were an image-only hero (its
heading delivered as default content in the next section, so nothing to align) and that video — and the
hero's fallback had landed on the empty component between the breadcrumbs and the hero.

- **`lib.mjs parseHtml` decodes every named reference the deploy skill's `sanitise.js encode()` emits**
  (the table `deploy/content-inventory.mjs` already reads), case-sensitively (`&Auml;` is not `&auml;`),
  names with digits included (`&frac12;`); numeric references as before, an unknown name stays as written,
  `&amp;lt;` is decoded once. `block-origin.mjs` text alignment now sees the text a browser shows;
  no coverage file changes (`inventory.mjs` keeps only the parsed document's records and sections). An unknown
  name never reaches an inherited object member (`&constructor;` stays as written; the deploy skill's
  `content-inventory.mjs` table is guarded the same way). On the run above:
  position 7 → 3, confidence ≥0.9 53 → 106 (50 text-aligned instances rose, 49 of them to 1, none fell),
  zero-confidence 7 → 3, sections without a selector 2 → 1; on a 188-instance export 12 confidences rose
  and nothing else moved. The test keeps the table a superset of `sanitise.js`'s.
- **`block-origin.mjs`'s position fallback never chooses a blank element** — no text and no media (img,
  picture, video, audio, svg, iframe, canvas, object, embed; `isBlank`, exported): a blank free child of
  the section's element or a blank sibling is passed over for the next one in that direction, and when
  only blanks (or other records' elements) remain the selector is null (verified false under `--verify`) — an honest
  unlocated instance, counted at confidence 0 as before. On the run above the hero moved from the empty
  component to the content grid that holds it; on another run a rate calculator moved from a spacer to its
  app container. Said in --help, the mapping schema's `source` description and the coverage contract;
  formatVersion unchanged (no key or value added).
- Not done, and why: reusing a sibling page's verified selector for the same variant (a `sibling-selector`
  source). Across the recorded runs 17 of 80 fallbacks had such a candidate resolving to one non-empty
  element on their page, but the candidates were page-wide structural paths or mis-targets (an image
  caption for an article grid), the blocks repeat 2–4× per page (one one-hit selector cannot serve them),
  and the hero's only verified twin sat on a page of another template. Image-only blocks are 65 of the 80
  fallbacks: matching a delivered image's alt/src against the capture's `img` attributes (not its text
  nodes) is the follow-up that would locate them.

## 0.36.x (stardust/r17-block-usage) — blocks.json usage counted from the delivered documents; the variant explosion surfaced (#171)

In a recorded hands-off run the export's `coverage/blocks.json` disagreed with the delivered content
on 14 of its 22 rows: `instanceCount` / `usedByPages` were aggregated from the sidecars' planned
`modules[]` (3 modules declared on a page that delivers 25) and hard-coded to 0 / `[]` on every row
registered from `blocks/`, so 83 of the 112 delivered instances sat on rows reading 0 and a client
could not rank blocks by real use. The same run delivered 90 block variants over 17 blocks, 75 of
them used by exactly one instance — each a Tier-2 catalog block for the adopter — and nothing in the
export said so.

- **`blocks.mjs`** counts `usedByTemplates`, `usedByPages` and `instanceCount` for every module row
  with an EDS block from the delivered documents — pages.json `delivered.blocks` records of kind
  `block`, the same records `block-origin.mjs` maps, so on a fresh export (the manifest refuses a
  stale one) the ledger and the mapping agree instance for instance and `instanceCount` is the sum
  of `variants[].instances`. A block no document shows reads 0, truthfully, whatever the sidecars
  planned; `blocks-dir` rows are counted like any other. A chrome row counts every page with a
  delivered document — chrome is site-wide, as this skill defines it, and in the recorded runs no
  sidecar declared header or footer, so the sidecar rule read 0 for fragments shipping on every
  page; a default-content row keeps the pages whose sidecars declare it (default content leaves no
  block record). The stdout `Reuse leverage` line now says `planned listings`, not instances. The
  blocks-directory discovery stays the row source.
- **Variant explosion in blocks.json.** Each enriched row gains `variantsSummary {total, singleUse}`
  beside `variants[]`, and the file a top-level `variantsSummary {total, singleUse, blocks}` (one
  row per EDS name); the summary line reads `N variant(s) of M block(s), S single-use`. Both
  optional in `rollout-blocks.schema.json`, whose `usedByPages` / `instanceCount` / `source`
  descriptions now say what is counted.
- **`workspace-manifest.mjs`** writes the same `variantsSummary` beside `templateGroups`, recomputed
  from blocks.json's module rows through the shared `lib.variantsSummaryOf` (so the two never
  disagree, and an older blocks.json without the field still yields it); the Coverage line names the
  single-use count and `--json` carries `counts.singleUseVariants`. Derived at manifest time,
  recomputed by `--rehash-only`, never a drift input — a fresh export stays `fresh`. Optional in the
  manifest schema.
- **`done-check.mjs`** prints `export_quality:single_use_variants:<n>` when n>0 — the same family
  and rules as the other export_quality info lines (informational, hidden after handover).
- Docs: the coverage contract's blocks.json and manifest tables and rollout/SKILL.md carry the
  fields and what a high single-use count means for an adopter.
- **`replica/gate-triage.mjs`** — its `scopeOf`, the one other reader of `usedByPages` /
  `usedByTemplates`, gains a `planned` scope source: the pages whose coverage `blocks[]` (the
  sidecar plan) list the block by id or EDS name. The share map is now delivered usage, 0 / `[]` on
  every module row until the content files exist, so without it a block group's advisory scope mid-
  run collapsed to its rows plus the observed DOM.

## 0.36.x (stardust/r17-encode-decision) — each template's encode decision in the export (#173)

In a recorded hands-off run the migration-workspace export shipped 0 encoder-map selectors (105 by
text alignment, 7 by position) because no vocabulary was ever drafted — and the decision lived only
OUTSIDE the export: both multi-page templates carried `stardust/migrate/encode/<template>.json`
records reading `hand-authored`, with the owner's reasons. A reviewer of the export saw
`encoderCoverage 0` per template and could not tell "tried and refused" from "never applicable" from
"never decided"; across four recorded runs the same figure meant all three (none drafted; 18/18
encoded; a mixed site with two vocabularies drafted mid-run).

- **`selectorQuality.byTemplate[].encode` `{decision, reason, vocabulary, recordedAt}`**
  (`workspace-manifest.mjs`, manifest schema, optional). `decision` is `encoded` when the mapping
  holds ≥ 1 encoder-map selector for the template (the export's own evidence, record or not), else
  the verdict migrate recorded (`hand-authored`, `not-attempted`, `no-roundtrip`, `encoded`), else
  `not-applicable` for a template of at most one page (no sibling to encode), else `unrecorded` —
  the multi-page case a reviewer cannot interpret. `reason` quotes the owner's why from the record
  (trimmed, at most 300 characters) and `recordedAt` its stamp — both only when the decision is the
  record's verdict, null otherwise — so `hand-authored` and `not-attempted` read with their reason
  inside the export; `vocabulary` names the map where block-origin reads it by default. A new
  `selectorQuality.encode` `{encoded, noRoundtrip, notAttempted, handAuthored, notApplicable,
  unrecorded}` counts the decisions. The records are read tolerantly (`verdict`, `template`,
  `reason`, `at` / `writtenAt`; every other key ignored) and never written; the reader is in the
  coverage contract. Derived at manifest time, recomputed by `--rehash-only`, never a drift input
  (`--check` hashes inputs and outputs only; a record is neither).
- **`done-check.mjs` prints `export_quality:encode_unrecorded:<n>`** when multi-page templates carry
  no encode decision — the same family and rules as the other export_quality lines (informational,
  never a gap, hidden after handover; counted from the byTemplate rows when a manifest has the rows
  but not the counts).
- The coverage contract documents the fields and the record shape read; rollout SKILL.md and the
  handoff contract's done-check row name the pair a reviewer reads together: `encoderCoverage` with
  `encode.decision` and `encode.reason`.

## 0.36.x (stardust/r17-schema-parity) — every export file validates against its schema; `excluded[]` accounts for a dropped planned URL (#172)

In every recorded hands-off run the migration export failed its own published schemas:
`coverage/pages.json` on the six `delivery.gate` keys `update-coverage.mjs --gate` writes per page
(`inconclusive`, `width`, `atByWidth`, `passByWidth`, `rounds`, `host` — 54 to 342 errors per
export), on `source.encodedHtml` (encoded pages) and `source.variance`, and `rollout.json` on
`lastRun.pages.contentPending`. The adopter's tolerant reader did not mind; a client validating the
export rejected a correct one. And a planned URL whose source answered 404 left the roster with its
decision in `report.md` prose only — nothing machine-readable said a planned page was excluded, or
why.

- **Schema/writer parity.** Each key a writer emits on purpose is declared with its type: the gate's
  six per-width keys, `override` as gate-all's `{verdict, reason, valid}` object (a string stays the
  older form), `at` nullable; `source.encodedHtml` and `source.variance`; the config's
  `contentPending`. No writer key was found to be accidental; nothing was dropped. All four recorded
  exports now validate (Ajv, strict clients included).
- **In-tool validation.** `lib.mjs` carries the structural JSON Schema check the tests used
  (declared properties, required keys, `additionalProperties`, types, enums, patterns — no
  dependency); `done-check.mjs` validates every export file present against
  `skills/rollout/schemas/` and prints `export_quality:schema:<file>:<n>: <first errors>` for one
  that fails (informational, hidden after handover; a `skipped:` line when no schemas dir is beside
  the scripts — the handoff contract's Phase 5 copy step now copies `rollout/schemas/` beside the
  rollout scripts, so a project copy runs the check too; `format` and `if`/`then` are not checked).
  The writers' tests assert that a
  written pages.json (gate rows, `--new` rows, encoded and variance rows), rollout.json,
  blocks.json, manifest, mapping and judgement validate.
- **`excluded[]` in the manifest** (beside `templateGroups`; optional in the schema, derived —
  recomputed by `--rehash-only`, never a drift input, a fresh export stays `fresh` under `--check`):
  the planned URLs that never became a page as `[{url, reason}]`, read from what the coverage and
  the plan already record — the coverage's `excluded[]` rows (`state.mjs exclude`, the roster-freeze
  record, reason as recorded), the crawl's failed URLs (`stardust/current/_crawl-log.json`
  `crawl.failures[]`: `crawl: HTTP 404`), and `state.json` pages or `plan.json` steps with no row
  (`unrecorded`). `done-check.mjs` prints `export_quality:excluded:<n>`. In the recorded run the
  dropped tenth URL now reads `crawl: HTTP 404`; the other three exports read `[]`.
- Docs: `reference/coverage-contract.md` (manifest table, the validity sentence) and `SKILL.md` §
  Phase I.

## 0.36.x (stardust/r17-stop-aware-wait) — the wait instruments stop on the runner's stop file (#169)

In a recorded hands-off run three sessions were killed at the end of the runner's stop grace: the lead
was inside a five-minute `progress.mjs wait` / `run-bg.mjs wait` step when the runner's boundary reply
said `stop`. The instruments already polled the pause file (`STARDUST_PAUSE_FILE`) and returned exit 76
on it, but the runner wrote that file only for its own pushed stop — a reply `stop` left nothing on disk
for the wait to see, so the lead kept waiting on its units until the grace killed the session (work in
flight lost, a re-orientation next session). The runner now writes the pause file on every `stop` reply,
so its presence is a stop signal the wait can watch.

- **`run-bg.mjs wait` and `progress.mjs wait`** check the pause file on every poll (a cheap `existsSync`):
  present → they stop waiting at once with a new distinct **exit 78**, printing
  `wait: the runner asked to stop (<stopAt or "now">; <reason or "no reason given">) — end the session now`
  to stderr and to stdout (as the wake exit prints its line). The file's presence is the signal; the JSON
  `{stopRequested, stopAt, reason}` is optional detail and an unparseable file still counts. Exit 78 is
  distinct from 0/75/76/77 and wins over the wake file (77) when both are present. `STARDUST_PAUSE_FILE`
  unset → nothing changes. 76 is no longer emitted; `run-bg.mjs status` keeps printing the pause line at
  exit 0.
- **The lead's response to exit 78:** stop launching, let running units finish on their own (they survive
  the session), ask `/boundary` once so the runner checkpoints, write the two-line note and end — documented
  in replica/SKILL.md, rollout/SKILL.md and the handoff contract's wait exit-code bullet.

## 0.36.x (stardust/r17-version-env) — version stamps honour STARDUST_VERSION (#170)

Every place a skill stamps `_provenance.stardustVersion` from the plugin manifest — rollout's
`inventory.mjs` (rollout.json and the coverage files; the export manifest copies it), qa's `lib.mjs`
(the QA report) and `state.mjs` (state.json) — now falls back to the `STARDUST_VERSION` env before
its last resort (`0.0.0`; state.json keeps the stamp it already carries). In the runner's image the
skills run from a copied scripts tree with no manifest above it, so a recorded hands-off run stamped
`0.0.0` everywhere — consistent but meaningless; the runner now exports the version and all agree.

## 0.36.x (stardust/r17-export-polish) — export manifest: real version, per-template encoder coverage, judgement debt, sibling-group count (#168)

Four small fixes an evaluation of three recorded hands-off runs surfaced in the migration-workspace
export, each the adopter reads once and none a hard gate:

- **`_provenance.stardustVersion` resolved export-local.** The manifest stamped `null` in-run while a
  recompute by the released tool read the real version, so a re-hash reported `written`, not
  `unchanged`, over that one field. The writer resolved the version from a `.<name>-plugin` dir found
  by walking up from the script — absent in the image, where the skills run from a `stardust/scripts/…`
  copy. It now reads rollout.json's `_provenance.stardustVersion` (what inventory.mjs recorded for this
  export) first — export-local, so any build's recompute reads the same stamp — then the
  `STARDUST_VERSION` env, then the plugin-manifest walk. `--check` compares inputs/outputs only, so
  `_provenance` never counts as drift.

- **Per-template encoder coverage.** `selectorQuality` gains `byTemplate[]` — one row per mapping template
  (`{template, instances, encoderMap, textAlignment, position, encoderCoverage}`, most instances first) — so a
  reviewer sees which templates are encoder-backed and which fell back to text-alignment or position, not just the
  export-wide totals. Derived from mapping.json at manifest time, recomputed by `--rehash-only`, never a drift input.

- **Judgement debt in the manifest.** A new `judgement` `{toFill, byKind}` counts the fields the judgement lists
  in its own `toFill[]` that are still empty, split by field (block purpose / reuseGuidance / a default-fallback
  baseType) — distinct from `placeholders`, which counts unjudged COVERAGE values, so an adopter sees open
  documentation fields even when the coverage reads filled. `done-check.mjs` prints
  `export_quality:judgement_to_fill:<n>` when n>0 — the same family and rules as the other export_quality info
  lines (informational, hidden after handover).

- **Cloned-sibling template count split.** The manifest gains `templateGroups` `{total, archetypes, siblings}`
  and the writer's printed line reads `N templates (M archetypes + K sibling groups)` when siblings exist, so the
  cloned siblings the export emits as their own group no longer silently inflate the template count against the
  archetype count. The split is by page type (archetypes = distinct types; siblings = the rest): block-origin groups
  the mapping by templateId (the page slug) and no coverage field — nor the migrated `_meta.json` sidecars, which
  record siblings as `fidelityTier: archetype` — carries a sibling's parent archetype, so a `sameTemplateAs` link was
  not added; the count split is what the export can know cheaply and truthfully.

## 0.36.x (stardust/r17-unit-proof) — unit done proves its delivered pages before it flips (#165)

A recorded hands-off run delivered all 21 pages about 2.7 h sooner than the day before, but the 18
sibling pages shipped as clones of their archetypes were never gated at unit level — done-check later
read `unit_unproven` for 2 units, and the C-final roster gate found 7 of them failing on pixel at 360
(collapsing margins summed, a section style hiding utility-text variants, one mis-resolved link), a
two-hour gap-closure tail the previous run never had. The docs already required a sibling to carry a
passing gate before `done`; nothing enforced it, so a fast parallel clone-and-deploy outran the gates.
This wave makes `unit done` prove it, with the SAME predicate the final done-check uses:

- **`progress.mjs unit done <unit>`** (a rollout delivery unit — kind not `foundation`/`final`) now
  refuses (exit 2, nothing written) when any DELIVERED page the unit's `.paths` lists (a
  `deployed`/`verified` coverage row) has no passing published-origin gate at BOTH widths. The proof
  predicate is the new shared `lib.gateProof`, the one done-check's `unit_unproven` reads — the two
  never disagree. The refusal names each page, the widths it owes and, per width, BOTH remedy commands:
  `gate-all.mjs --only … --skip-existing` AND the `update-coverage.mjs --gate stardust/replica/gates/all-<w>/`
  that ingests its table — gate-all writes no coverage, so gating without ingesting proves nothing.
- **Escape hatch, no silent bypass:** `unit done --unproven "<reason>"` records the reason on the unit
  entry and skips the gate; done-check then carries it as `unit_unproven: … declared unproven:
  <reason>`.
- **`done-check.mjs`** `unit_unproven` now reads the shared `lib.gateProof` predicate and surfaces a
  unit's recorded `--unproven` reason on its gap line.
- **`rollout/SKILL.md`** cluster flow and the handoff contract's unit row now state the sibling gate
  runs at both widths with `--skip-existing` before `done`, a failing sibling fixes inside the unit
  (cap 3 rounds), and `unit done` refuses without that evidence.

## 0.36.x (stardust/r17-extract-pipeline) — extract pipelined; census concurrency restored (#167)

On the same site, a recorded hands-off run's extract phase took 32 min against 15 min on the
previous image. Three causes, all in the read-side tail: the style census ran serially (the
recorded command carried no `--concurrency`, where the earlier run measured both breakpoints at
`--concurrency 2` — 261 s grew to 501 s); the assets, media and dynamics probes were pulled into
the extract window; and after the probes the lead launched a classify / design-record subagent and
waited for it serially, a ~10-minute idle gap the earlier run did not have (it had interleaved that
work with the probes). Docs-only, no script change:

- **`extract/SKILL.md`** (Phase 3 census) — the census recipe now covers both breakpoints in one
  pass (`--width 1440,360`) and names its concurrency: its slice of the run's browser budget, the
  gate's live-origin pool share (2 at the default `STARDUST_BROWSER_BUDGET`), passed as
  `--concurrency 2` and raised above 1 only on an origin with no bot management.
- **`replica/SKILL.md`** (Phase 1) — orders the extract read-side for wall time: start the crawl,
  run the census and live probes as background jobs, and classify / detect archetypes / write
  design records in parallel rather than waiting for the probes; the `--dynamics` detector stays in
  Phase 2 and `media-harvest` stays a background job; poll with `run-bg.mjs wait --max 300` and the
  wake file in steps of at most five minutes, a wait only for a job whose result the next step
  needs.

## 0.36.x (stardust/r17-regate-discipline) — gap-closure re-gates at the width of the fix (#166)

In a recorded hands-off run the lead re-gated the full 21-page roster about five times during
gap-closure (18–23 min each, `gate-all.mjs --skip-existing`, never `--changed-only`) while only 7,
then 2, pages were failing — and sat idle for most of those minutes. This documents the re-gate
ladder so each fix re-gates the narrowest scope that proves it:

- **`skills/rollout/SKILL.md`** gains the gap-closure re-gate ladder: (a) a page fix → `gate-all.mjs
  --only <failing slugs>` at both widths; (b) a shared block/style fix → `--changed-only`, which
  re-gates exactly the pages whose delivered fingerprint moved; (c) ONE full-roster gate
  (`--skip-existing`) to confirm at the END — about N minutes for N pages across both widths,
  never a per-fix step. Launch every gate in the background and do the next fix while it runs;
  never idle the lead on a full roster with nothing else to do.
- **`skills/replica/reference/source-fidelity-gate.md`** § Iteration discipline cross-references the
  ladder; **`skills/rollout/reference/delivery-gates.md`** names the confirming full-roster gate.

Docs only; no script, contract or version-manifest change.

## 0.36.x (stardust/r17-null-sections) — null-selector sections surfaced in the migration export (#164)

A recorded hands-off run ended READY with a fresh, Tier-2-adoptable export, yet when the adopter
projected its page templates per selector it silently dropped 9 sections that carried no source
selector and lost the blocks of 13 more — nothing in the manifest, the done-check or the handover
said so (a green READY hid it). `mapping.json` already described every section and block instance
with its source selector; the drop was only ever visible to the downstream adopter. This wave
derives those gaps from `mapping.json` at export time, the same way `selectorQuality` is derived
(never rewriting it). `no-selector` is exact — it matches the adopter's "not emitted" entries on
that run (9). `blocks-unprojected` is a PREDICTION of the adopter's current per-selector merge (each
variant homes to its first emitted section), so the shipped manifest reports 10 for that run — close
to, but not, the adopter's own 13 lost; it can under- or over-count a given adopter's real losses:

- **`workspace-manifest.mjs`** now adds a `sectionGaps` list to the manifest, derived from
  `mapping.json` (present when a readable mapping exists, `[]` when none apply): one entry per
  section an adopter projecting per selector would drop — `{page, template, section, reason,
  blocks[]}`, `reason` `no-selector` (the section has no source selector, so it is not emitted) or
  `blocks-unprojected` (the section keeps its selector but its declared blocks merge by variant into
  an earlier section and are lost), `blocks[]` the dropped block names. The section-gap counts ride
  the `handoverNotes`. It is derived, so a `--rehash-only` recomputes it and `--check` keeps it out
  of the drift classification. Schema + contract updated.
- **`done-check.mjs`** surfaces the manifest's `sectionGaps` no-selector count as an
  `export_quality:null_selector_sections:N` info line (migration-workspace export only, when
  `N > 0`) — informational, it never flips completeness, and it is hidden once the export is handed
  over, matching the `export_quality:zero_confidence` line.
- **`block-origin.mjs`** status lines now also print `sections-without-selector N` beside the
  selector-quality figures (no gate flag).

## 0.36.x (stardust/r17-encoder-figures) — selector-quality figures in the migration export, and a zero-confidence gate (#163)

Across four recorded hands-off runs `block-origin.mjs` assigned its selector sources
(encoder-map / text-alignment / position) as 0/69/3, 0/89/4, 75/51/0 and 0/158/48 — and in the last
one the 48 position selectors (confidence 0: image-only repeating blocks, article-grid and carousel,
that cannot anchor by text because an encoder map was never drafted) shipped into a client-facing
export with nothing in the manifest saying so. `countsOf` computed the sources and confidence
buckets and the status lines printed them, but the manifest stored only a hash of `mapping.json`.
This wave makes the figures visible and gateable (the hand-drafted encoder vocabulary itself is a
separate, next-wave problem):

- **`workspace-manifest.mjs`** now adds a `selectorQuality` block to the manifest, derived from
  `mapping.json` at manifest time (block-origin's `countsOf`; `mapping.json` is never rewritten):
  `instances`, `sources {encoderMap, textAlignment, position}`, `encoderCoverage`
  (encoder-map/instances, three decimals), `zeroConfidence` (the confidence-0 count) and the top
  `zeroConfidenceBlocks[]`. It is derived, so a `--rehash-only` recomputes it and `--check` keeps it
  out of the drift classification (only `inputs`/`outputs` are hashed). Schema + contract updated.
- **`block-origin.mjs`** gains `--max-zero-confidence <n>` (default unlimited — no existing caller
  changes): the run still writes the mapping but exits 3 when more than `n` instances land at
  confidence 0, the message listing them by block. The status lines now also print
  `encoder-coverage F · zero-confidence N`.
- **`done-check.mjs`** surfaces the manifest's `selectorQuality.zeroConfidence` as an
  `export_quality:zero_confidence:N` info line (migration-workspace export only, above a documented
  threshold, default 0) — informational, it never flips completeness; the hard gate stays
  `block-origin.mjs --max-zero-confidence`.

## 0.36.x (stardust/r17-origin-baseline) — a frozen, provenance-stamped origin baseline for the source-fidelity pixel gate (#161)

The replica source-fidelity pixel gate compares the build against a FRESH capture of the live origin every round. In a
recorded hands-off run of a multilingual site the origin moved underneath the run — server-side personalisation made the
home render 189 px shorter desktop / 432 px shorter mobile than the morning capture, live font loads intermittently
failed, one live capture came back blank at the top — so three pages ended the run failing on pixel only (content,
height and clip all passed), and each moving-origin event burned a fix round on a false FAIL. This adds the first,
opt-in slice of a frozen origin baseline: capture one provenance-stamped origin per page/width, then gate against it
instead of a fresh shot so the origin cannot move under the run. Default OFF — a run that does not ask for it is
byte-for-byte unchanged. (First slice; the drift verdict that LABELS origin movement "origin drift (external)" and the
category request-routing data file are a later wave.)

- **`stitch-shot.mjs --freeze-baseline [--force]`.** Reuses the existing capture (consent dismissed, `document.fonts.ready`
  awaited with `fontsFailed` recorded, animations settled via `--settle`, a content hash over the `--inventory`) and
  writes `baseline.png` (atomic) + `baseline.json` { capturedAt, url, width, height, conditions, fontsFailed,
  contentHash } atomically (temp + rename) into the gate dir. It refuses to re-freeze over an existing baseline without
  `--force`, and refuses to freeze a capture whose fonts failed (a baseline in fallback type would bake the wrong wraps
  into every future round). `--check-baseline` captures a fresh shot and prints its contentHash / Δheight vs the
  baseline — no verdict yet.
- **`gate.sh --gate-against-baseline`.** When a frozen baseline exists for the page/width it becomes the origin side of
  the SAME downstream pixel-compare (`live.png` is the baseline; `live.json` records `originBaseline { capturedAt,
  contentHash, height }`) instead of a fresh live shot, and one line names the baseline's capture time. With the flag
  set but no baseline present it says so and takes a fresh shot as usual. Default OFF: nothing changes for a run that
  does not pass the flag.
- **Docs.** `source-fidelity-gate.md` § Iteration discipline gains an "Origin baseline (opt-in)" note;
  `rollout/reference/delivery-gates.md` and `replica/SKILL.md` point at the flags. No new script file (the flags live on
  the existing capture and gate instruments); the scripts index is unchanged.

## 0.36.x (stardust/r17-rehash-only) — a stale migration export gets a cheap, safe re-hash and an adopter gate (#160)

In a recorded hands-off run the migration export went stale after gap-closure edited block CSS and
the inventory rewrote coverage, and two things were missing. `done-check.mjs` flagged `export_stale`
but never said the downstream adopter does not degrade: it hard-rejects an export whose
`coverage/pages.json` sha mismatches its manifest and produces nothing. And the remedy was always
the full 10–20 minute re-run, even when the drift could not have moved the source selectors.
`workspace-manifest.mjs --check` now classifies the drift `fresh` / `rehash-safe` / `rebuild` from
the manifest's recorded inputs and outputs, and `done-check.mjs` puts the class, its command and —
when `coverage/pages.json` drifted — the adopter-refusal note on the `export_stale` line. On an
export this release's toolchain builds, CSS- or regenerated-coverage-only drift is `rehash-safe`:
`--rehash-only` refreshes the manifest hashes and reconciles the mapping's generatedAt in seconds,
no re-run (proven by the test fixture). Any content, capture, sidecar, encoder-map, block-JS,
judgement or mapping change — and a manifest predating this release's capture/sidecar input hashing
— is `rebuild`, the full sequence.

In a recorded hands-off run of a multilingual site the three longest cluster units (146, 132 and 58 minutes) were all
siblings that tripped the majority-variance guard: `migrate.mjs render` correctly refuses a mechanical clone when more
than half an archetype's current clones differ, but the cluster subagent could then do nothing — it could not even
record the deviation, because `decision --kind re-type` needs a rendered `_meta.json` sidecar the refusal prevents, so
it wrote a prose note and bounced to the lead to re-plan the re-type by hand. This adds the machine hand-off; the
guard, its condition and its strings are unchanged.

- **`migrate.mjs retype-plan <archetype> [--write] [--json]`.** It reads the on-disk variance ledger
  (`stardust/rollout/variance/<archetype>.json`), groups the differing siblings by a delta fingerprint — the sorted
  `missing` probe set plus the cluster/count signature (the probes carrying a COUNT or CLUSTERS delta; magnitudes
  dropped, so same-shape siblings group even when exact counts differ) — and proposes one sub-archetype per
  fingerprint, each with a representative (the member with the fewest findings; ties by slug) and its members;
  same-verdict siblings stay with the archetype. `--json` emits the machine plan; `--write` persists it to
  `stardust/migrate/retype-plan/<archetype>.json` and records the re-type deviation there the way
  `decision --kind re-type` does — one deduped row, no rendered sidecar required, idempotent on re-run. Exit 0 plan
  produced, 2 no ledger / archetype unknown (naming the command that writes the ledger).
- **The refusal points at it.** After the majority-variance refusal (its text unchanged), `render` prints one extra
  stderr line: `next: … migrate.mjs retype-plan <archetype> --write`.
- **The cluster flow records the re-type instead of bouncing.** On a majority refusal the cluster subagent runs
  `retype-plan --write`, returns the plan in its hand-back, and the main agent starts one unit per proposed group —
  `unit start`/spawn stays with the lead (migrate and rollout SKILLs, handoff contract § Fan-out discipline).

## 0.36.x (stardust/r17-sleep-lint) — the lint that catches a blind sleep in a skill doc (#162)

In a recorded hands-off run the lead spent about 73% of wall time inside blind `sleep` calls while
waiting on background units — it wrote `sleep 595`, `sleep 1200`, `sleep 1380`, and the tool cap
truncated the long ones to 600 s, so neither the intended wait nor an early wake happened. The wait
instruments already exist (`run-bg.mjs wait`, `progress.mjs wait`, both returning early via a wake
file) and the docs already say a sleep is never a wait; nothing scanned the docs for the habit.
inline-writes' sibling now does.

- **`evals/lint/inline-sleeps.mjs`** (chained in `lint:stardust`; test in `evals/lint/test/`; a CI
  step in the validate workflow beside inline-writes): fails when a SKILL.md or a reference doc shows
  a shell snippet — a shell-language fenced block or an inline backtick span, the same file set and
  snippet detection inline-writes uses — holding a bare `sleep <n>` over the threshold (default 60 s,
  `--max-seconds <n>`) or a `while`/`until` poll loop with a sleep in it. Prose that merely names
  sleep, a non-shell block and a bounded `for` poll stay clean; `<!-- lint: allow-sleep -->` on the
  line above the sleep (or above the opening fence) allows a genuinely short, legitimate wait. It
  reports `file:line` and the snippet, exits 1 on findings, and the advice names the instruments. The
  tree is clean as it stands — the one bounded asset-liveness poll in the deploy protocol is a capped
  `for` loop at `sleep 3`, not a blind wait.

## 0.36.x (stardust/r17-retype-plan) — a majority-variance refusal hands off a re-type plan, no prose-note bounce (#159)

In a recorded hands-off run of a multilingual site the three longest cluster units (146, 132 and 58 minutes) were all
siblings that tripped the majority-variance guard: `migrate.mjs render` correctly refuses a mechanical clone when more
than half an archetype's current clones differ, but the cluster subagent could then do nothing — it could not even
record the deviation, because `decision --kind re-type` needs a rendered `_meta.json` sidecar the refusal prevents, so
it wrote a prose note and bounced to the lead to re-plan the re-type by hand. This adds the machine hand-off; the
guard, its condition and its strings are unchanged.

- **`migrate.mjs retype-plan <archetype> [--write] [--json]`.** It reads the on-disk variance ledger
  (`stardust/rollout/variance/<archetype>.json`), groups the differing siblings by a delta fingerprint — the sorted
  `missing` probe set plus the cluster/count signature (the probes carrying a COUNT or CLUSTERS delta; magnitudes
  dropped, so same-shape siblings group even when exact counts differ) — and proposes one sub-archetype per
  fingerprint, each with a representative (the member with the fewest findings; ties by slug) and its members;
  same-verdict siblings stay with the archetype. `--json` emits the machine plan; `--write` persists it to
  `stardust/migrate/retype-plan/<archetype>.json` and records the re-type deviation there the way
  `decision --kind re-type` does — one deduped row, no rendered sidecar required, idempotent on re-run. Exit 0 plan
  produced, 2 no ledger / archetype unknown (naming the command that writes the ledger).
- **The refusal points at it.** After the majority-variance refusal (its text unchanged), `render` prints one extra
  stderr line: `next: … migrate.mjs retype-plan <archetype> --write`.
- **The cluster flow records the re-type instead of bouncing.** On a majority refusal the cluster subagent runs
  `retype-plan --write`, returns the plan in its hand-back, and the main agent starts one unit per proposed group —
  `unit start`/spawn stays with the lead (migrate and rollout SKILLs, handoff contract § Fan-out discipline).

## 0.36.x (stardust/r17-export-order) — the migration export is built on a frozen roster, and refreshed before the done-check (#158)

In a recorded hands-off run the migration export (workspace manifest, mapping and judgement) was built at the
dashboard step while the roster was still open; gap-closure then kept editing pages, so the export shipped stale —
`done-check.mjs` correctly raised `export_stale`, but the run reached its deadline without re-running it. The
freshness check already existed; the order did not. The rollout and migration-export docs now state it: the export
is built once the roster is frozen — no unit running, no fix round open, gap-closure finished — and any later change
under `content/`, `blocks/`, `styles/` or a judgement re-runs the export sequence (`inventory` → `blocks` →
`block-origin --verify` → `workspace-manifest`) before `done-check.mjs`, with a same-session refresh only when it
takes under five minutes.

## 0.36.x (stardust/r16-tail-and-defaults) — the unit ends with its sidecar, deploy-batch knows its site, and the tail re-gates only what changed (#157)

A recorded hands-off run that finished `ready` in 8 h 58 min spent its last minutes on work the tail should have
avoided: `deploy-batch` was invoked without its coordinates and token four times across two sessions, eight
subagent-run units left their pages' eds-schema sidecars unwritten until done-check found them at the very end,
verify failed and re-deployed pages over out-of-plan links the link-audit phase was about to repoint, and two
`fix-later` header requests queued early were applied only at the final gate, 40 min on the critical path.

- **deploy-batch reads its coordinates and token from the config.** `deploy-batch.mjs` defaults `--org`/`--repo`/
  `--branch` from `stardust/rollout/rollout.json` `site.da` (org / site / ref, ref's schema default `main`) and,
  with no token flag, reads the token from the file named by `$ADOBE_IMS_TOKEN_FILE`, else `DA_TOKEN`. An explicit
  flag wins; the usage error names the config file and the `site.da` fields, or the file and the variable, it read;
  a first stderr line records the resolved sources (never the token value).
- **The unit ends with its sidecar.** `unit-commit.mjs <unit>` pre-checks, before staging, that every delivered
  page has its `stardust/eds-schema/<slug>.json`, refusing a missing one (exit 2, nothing staged) with the exact
  `section-schema.mjs … --out …` command per page. `--no-sidecar-check` overrides and records the override in the
  commit message. The fix-round brief and the handoff contract's unit briefs say "sidecar before commit".
- **The tail re-gates only what changed, and reports source traits.** `verify.mjs` judges the `<h1>` count against
  the source capture — 0 or more than one is a `trait` (verified) when the capture shares it, a failure otherwise —
  and reports an out-of-plan internal href as `e2_pending` (the link-audit phase repoints it), never a page failure.
  The rollout `§ D/E/E2` order runs the link audit + repoints BEFORE verify, and re-gates with
  `gate-all --changed-only` (content/CSS fingerprint) after href-only edits, never the full roster.
- **A `fix-later` header request is applied in-wave.** The foundation-chrome owner applies it as soon as the first
  wave is running (parallel to the archetype units, with a home re-gate), not at the final gate, which only verifies
  header parity.

## 0.36.x (stardust/r16-export-fresh) — the migration export tells the truth about what it was built from, who encoded, and what the owner must still name (#156)

Two recorded hands-off runs wrote their migration export in-run and shipped it stale or misleading. A gap-closure
rewrote 43 schema sidecars five minutes after the mapping was committed, yet the manifest said fresh and done-check
raised nothing — it hashed neither the sidecars, the captures nor the encoder maps the mapping was built from. The
encoder was never invoked: every sibling was hand-built behind `not-attempted` records that named the agent's own
generator scripts, or a bare "sub-archetype (re-typed …)", as if those were owner decisions (0 of 38 siblings
encoded). Fifteen re-type decisions turned 9 planned templates into 14, every two-page article becoming its own
template. Seven blocks judged base type `unknown` reached the adopter as judged metadata. Header parity was measured
on the preview host while the gates ran on the live host, and the rule never fired because the offline run never named
the live host. The usage ledger stopped one session short of the run's meter.

- **Export freshness is measured on block-origin's inputs.** `workspace-manifest.mjs` hashes the captures, the
  eds-schema sidecars and the encoder maps the mapping was built from into `inputs`; `done-check.mjs` re-hashes the
  same tree and raises `export_stale` naming the changed file. The handoff-end order is gap closure writes →
  block-origin → manifest → done-check, never reversed (`replica/SKILL.md`, `rollout/reference/delivery-gates.md`
  § Export freshness).
- **The encoder is not bypassed with a fake reason.** `encode-attempt.mjs`'s record CLI refuses a
  `--reason`/`--not-attempted` that names a generator script (a script is not a decision; the owner's decision is a
  sentence), refuses an automatic `not-attempted` for a template with ≥ 1 sibling and no map (draft the map:
  `migrate.mjs plan <t>`), and takes an owner `not-attempted` only with a recorded refusal reason (`re-typed:`,
  `no-repeatable-structure:`). The record carries `siblings`/`encoded` counts and the roster line reads
  `<t>: <n> siblings · <m> encoded · <k> A′ · <reason>`.
- **Re-type is the exception, differs is a variant.** `sibling-variance.mjs` records `variant: <name>` on a differing
  sibling — the same template with variant CSS/JS. `state.mjs set --type` refuses re-typing a sibling into a new
  template when the current template would be left with ≤ 2 pages or the new one would have ≤ 2 pages, unless
  `--owner-decision "<sentence>"` is given (recorded on the page). The rollout cluster-brief says the same.
- **Unknown is not a judged base type.** The judgement draft keeps an unjudged delivered block in `toFill` and offers
  the candidate base types; the manifest lists it under `handoverNotes` ("N delivered blocks have no judged base type;
  the owner names them"); `done-check` raises `blocks_unjudged:N` for the migration-workspace export — a gap, not a
  hard stop, until judged.
- **The live host is inferred; the ledger records what it saw.** `done-check` infers the live host from the coverage
  (the delivered rows' deployed URLs) and applies the live-host header-parity rule by default, offline too (the gap
  says where parity was measured and where the gates ran). `token-ledger.mjs`'s `harnessCost` records `costLinesSeen`
  and `lastCostAt`, so a reader can tell a ledger run made before the final session's last cost line is one session
  short; it runs last, after that line.

## 0.36.x (stardust/r16-gates-and-jobs) — servers are not jobs, the unit commits its report, the source contract is cached, and gates stop at PASS (#155)

The recorded hands-off runs: a 26-second measure queued 615 s behind a static file server because `run-bg.mjs`
counted every running job toward its slots, and a bare `wait` blocked the full tool cap on a unit's own prototype and
dev servers (deadline 3600 s) while its gates had ended seven minutes earlier; six unit subagents left their reports,
the foundation requests, the variance verdicts, `state.json` and migrate's `progress.json` uncommitted because
`unit-commit.mjs` committed a fixed pathspec, and the lead patched four extra commits; the header-contract loop
re-explored the unchanged source four times after the one-hour cache lapsed (one run: eight explores, 57 minutes of
browser); every archetype burned all three gate iterations at both widths even at 0.05 % pixel, and all seven
archetypes were re-gated after each shared-CSS change; and the foundation-first rule made the delivery head single-file
for 70 minutes with eight units waiting, though an earlier run overlapped the foundation with the first archetype and
lost nothing.

- **Servers are not jobs (`run-bg.mjs`).** `start --kind server` (implied by `--no-lock`) holds no slot, stays out of a
  bare or `--all` wait, is listed under a `servers:` heading in `status`, and is ended by `stop`. `stop` now ends the
  whole process group — SIGKILL pass after pass to every member a fresh census still finds, so a child that ignores
  SIGTERM no longer outlives it — and records the deadline's no-verdict marker (exit 124) rather than a verdict; every
  signal first takes a fresh look so a recycled pid is never signalled. The kind is stored as `runKind` to avoid a
  collision with gate-evidence's own `kind`.
- **The unit commits what it writes (`unit-commit.mjs`).** The default pathspec now carries the unit's report
  (`stardust/rollout/units/<unit>.md`), `foundation-requests.md`, `variance/*.json`, `state.json`,
  `migrate/progress.json`, `migrate/encode/*.json` and `eds-conversion-log.md` alongside the pages and coverage;
  `--also <path>` commits anything else the unit wrote. The brief sentences that told agents to `git add` by hand are
  gone.
- **The source contract is cached (`chrome-explore.mjs`).** Each source URL + width is cached for the run at
  `stardust/.work/chrome/source-<hash>.json`, reused unless `--fresh` (the hit printed, no page opened); both widths of
  a page are explored in parallel inside the slot's browsers; `--build-only` re-explores the build alone.
- **Gates stop at PASS (`delivery-gates.md`, `gate-all.mjs`).** A unit stops iterating at PASS on both widths with
  Δh 0 — no confirmation round unless a shared file changed after the pass — and a killed roster is resumed with
  `--skip-existing`, never restarted. `gate-all --changed-only` re-gates only the pages whose delivered CSS/JS
  fingerprint changed since their last PASS (the fingerprint recorded beside each verdict).
- **Foundation first, overlapped (`rollout/SKILL.md`, `handoff-contract.md`).** `foundation-chrome` and
  `foundation-styles` may run in parallel (disjoint files); the shell template's archetype may convert its blocks and
  write its document during C0 and deploys and gates only after styles ship; the freeze still happens before any
  sibling page of that template.

## 0.36.x (stardust/r16-census-and-clock) — the style census survives a stuck page, presence suggests on a miss, and a unit brief carries a clock (#154)

Recorded hands-off runs: on a site with a consent manager the style census (`--concurrency 2`) hung after its first
page and ran to its whole deadline (exit 124); a second census was killed after 14 minutes with its results lost,
because the instrument wrote nothing until the end; a third at concurrency 1 did eight pages in 4.6 minutes — 51 minutes
of census against 5.6 in an earlier run of the same site, and the extract phase took 67 minutes against 41. On the same
site a `presence.mjs add --dismiss <sel> --verify` refused with "matched nothing" and the agent then walked the DOM by
hand for 14 minutes to find the control, although `presence.mjs suggest` already existed. And a unit told to "return
within 45 minutes" either stopped eight minutes in or was cut by the session end, because nobody had computed the
absolute time left.

- **The census survives a stuck page (`extract/scripts/style-census.mjs`).** A per-measurement deadline
  (`--page-timeout`, default 120 s, raised to the navigation timeout + 60 s when that is longer) records a page that
  never settles as `timed_out` and the census continues. `<out>` is rewritten after every measurement in roster order,
  so the file is valid after each page and `--resume` continues a killed pass, re-measuring only its timed-out and
  failed records. A timeout above `--concurrency 1` finishes the rest of the roster at concurrency 1 and says so on one
  WARNING line. Exit 0 when at least one page was measured (the timed-out ones listed under `_provenance.timedOut[]`),
  exit 2 only when none was.
- **Presence suggests on a miss (`replica/scripts/presence.mjs`).** An `add … --verify` whose selector matches nothing
  now runs `suggest` on the same URL and width and prints the top three candidates of that kind (selector, text, role),
  each with the exact `add` command to try, before exiting 2 — no hand-walking of the DOM. `suggest --kind
  hide|dismiss|pin` lists the same candidates standalone. A suggested selector is always a single light-DOM match and
  never holds a comma (which `add` splits on) or rests on a transient state class.
- **A unit brief carries an absolute clock (`replica/reference/handoff-contract.md`, § Unit briefs).** The subagent
  brief template now states `deadline: <UTC HH:MM>` — the earlier of the unit's own budget and the session end minus
  five minutes — with the rule to stop at the next clean point, flip the unit to `paused` with what remains, and return
  if it cannot be met. The main agent does not launch a unit whose expected duration does not fit before the session end
  unless the unit is resumable (`gate-all --skip-existing`, encoder batches). One worked example of the arithmetic is
  included.

## 0.36.x (stardust/r16-proto-to-doc) — from prototype to document, and from archetype to sibling, without a hand-written generator (#153)

The recorded hands-off runs wrote the same generators again and again: a gated prototype's `<main>` into the
delivered document, a prototype grouped into `<section>`s because the schema reader found none, and each sibling's
proposed HTML from the archetype prototype plus the sibling's capture. The encoder path never engaged — every
`encode-attempt` record read `not-attempted` ("no map", "single sibling", "bodies identical"), `slot-map.mjs` was
never invoked, and the strict fork refused for want of a `-proposed.html`, so every cluster rendered from a
hand-built `--source` file. Those generators also carried the bugs behind two extra fix rounds.

- **A gated prototype's `<main>` → the delivered document (`deploy/proto-to-doc.mjs`).** New, offline: the
  prototype's top-level groups become sections, its block markers become block tables, the page record becomes the
  metadata block, in the migrate encoder's document form. Refuses a prototype with no `<main>`; deterministic.
- **A markerless prototype auto-sections (`deploy/section-schema.mjs --split`).** When the content root holds no
  `section, [data-section]`, the groups of `main > *` (or a given selector) are the inferred sections, reported as
  such; the old behaviour stays the default when real `<section>`s exist.
- **The encoder engages without a hand-written map (`migrate/migrate.mjs`, `slot-map.mjs`, `encode-attempt.mjs`).**
  `plan` derives the slot map from the archetype prototype when the capture has no `#slots` (`source: derived`) and
  refuses only when nothing derives, naming the one command that makes it derivable; `render --from-archetype
  <proto> --capture <page.json>` forks an identical or minor sibling's own `-proposed.html` from the archetype; the
  attempt record distinguishes `derived` / `forked` / `not-attempted` with the reason.
- **Docs.** The migrate encode section and the handoff contract § Encoded siblings name the order — `plan`
  (derived) → `render --from-archetype` for identical/minor siblings → hand-authored only for `major` variance,
  with the one-line commands — and the rule that a generator script the agent writes for these steps is a defect.

## 0.36.x (stardust/r16-wait-and-waves) — the lead waits five minutes, not twenty-five, and starts every disjoint unit at once (#152)

The recorded hands-off runs: the lead handed each delivery unit to a subagent and then polled with foreground `sleep`
calls of 9–23 minutes — one 93-minute session held 15 such sleeps totalling 99 minutes, another 83 of 97, a third 76
of 93 — and a finished unit waited until the current sleep ended before the lead saw it. The previous rule let a lead
whose cache holds an hour wait with `run-bg.mjs wait --max 1500`; with a one-hour cache a five-minute poll costs about
three cents, so the long wait bought nothing and cost up to twenty minutes per unit. One run delivered its archetype
units one after another (the first alone for 70 minutes, then its cluster, then the next archetype alone) while another
started four units in one turn and finished ten units in the time the first finished five; code propagation after a
push (median 5–6 minutes, p90 10) is paid serially by serial units and overlapped by parallel ones.

- **`progress.mjs wait` (stardust).** Watches the progress ledger — every unit `running` when the wait starts, `--unit`
  narrows — and returns 0 the moment one is `done` or `failed`, printing its line; 75 at `--max` (default 300) with the
  units still running; 76 at once while `$STARDUST_PAUSE_FILE` exists; 2 when nothing is running. Polls every 5 s,
  reads without the lock, `--json`.
- **`run-bg.mjs wait` defaults to 300 s for everyone (replica).** The 1500 s ceiling and `--until <ISO>` stay; a `--max`
  above 600 prints one notice line that a one-hour cache does not need it.
- **One wait rule, three places.** The master skill's wait discipline, the handoff contract's § Fan-out discipline and
  replica's gate-round example say the same sentence: wait in steps of at most five minutes, lead and subagents
  alike — `run-bg.mjs wait` for jobs, `progress.mjs wait` for units; a `sleep` is never a wait.
- **Each unit flips its own end.** A unit's subagent runs `progress.mjs unit done|failed <unit> …` as its last act,
  after its commit, so the lead's wait sees the end within five seconds; the lead records an end only for a unit that
  died without flipping it (`failed`, with the reason — at a wake, or at a 75 past its launch deadline), and still
  commits each ended unit (`unit-commit.mjs`) before its boundary ask.
- **Wake (exit 77, both waits).** `progress.mjs wait` and `run-bg.mjs wait` also return 77, first line
  `wake: <last line>`, when `stardust/.labs/wake` has grown since the wait started — the runner appends a line there
  when a background agent finishes; an absent file means nothing. An exit 0 that arrives with a wake prints it too.
- **Every disjoint unit starts at once (rollout Phase C, delivery-gates).** After C0 is committed and frozen, every
  archetype unit starts in the same turn, each cluster the moment its archetype is `done`; disjoint units are never
  serialized to spare browsers — the browser slot queue paces captures. The lead's loop is `progress.mjs wait` →
  record what ended (the wait's lines and any end `show --waves` lists that the last wait did not print) → start what
  is now unblocked → wait again; the one exception is a unit that edits a shared file, which waits for that file's
  lock. The worked example shows no `sleep`, each exit code (0 / 75 / 76 / 77) with what the lead does, and one
  launch line's `deadline: <UTC HH:MM>` — the earlier of the unit budget and the session end minus five minutes (the
  brief carries the clock, contract § Unit briefs).
- **A re-recorded end keeps its time (`progress.mjs unit done|failed`).** On an entry that already has that status the
  fields still apply and `endedAt` stays the first recorded end, so a re-record never moves it.
- **`progress.mjs show --waves`.** The dependency view foundation → archetypes → clusters → final, each unit with its
  state (recorded, or `planned` from `coverage/templates.json`), and a last line `can start now: <names>`.
- **The slots follow the browser budget (`run-bg.mjs`).** With `STARDUST_BROWSER_SLOTS` unset, run-bg derives it from
  `STARDUST_BROWSER_BUDGET` — 3 slots when the budget is 3 or 6, otherwise 2 (a budget under 2: one slot per browser) —
  so budget 4 runs 2 slots × 2 browsers instead of 3 × 1 with one idle (budgets 3, 4 and 6 are used whole, 5 runs 4);
  an explicit `STARDUST_BROWSER_SLOTS` still wins, and the job log names a derived count.
- **A job that just ended is never called lost (`run-bg.mjs`).** `status` and `wait` read a job's state again before
  calling it `lost`: a state read just before the wrapper wrote its exit, with the wrapper gone by the liveness check,
  printed `lost — re-run` for a job that had ended (seen under load). The run-bg tests match a job's own output line,
  never the command the wrapper echoes.

## 0.36.x (stardust/r16-edit-instruments) — the file edits the agents make, as instruments (#151)

Four recorded hands-off runs made 4177 shell calls: 598 heredocs and 345 inline interpreter calls. 238 heredocs were
python programs; ~150 of them read a tracked HTML or CSS file, replaced a string or a regex and wrote it back — one
page's HTML 17 times, the shared CSS 11 times. 18 python programs edited JSON ledgers in place, and a node script was
written 32 times just to update a notes JSON. The earlier rule "the edit tool, not an interpreter" changed nothing: the
edit tool ran 1–18 times per run against ~150 inline rewrites in the four runs — the inline rewrite handles several
occurrences and regexes in one call without a prior read. replace.mjs now offers that, counted and atomic.

- **Counted, atomic text replacement (`stardust/scripts/replace.mjs`).** `<file>… --from <text> --to <text>`, literal
  by default; `--regex` (flag g always, `--flags <imsu>` adds more) with `$1`, `$<name>`, `$&`. The expectation is per
  file: exactly 1 match by default, `--all` at least 1, `--count <n>` exactly n. Every file is read and counted before
  the first write; a missed expectation prints each file's count with up to 5 matches in two lines of context and
  writes nothing to any file. `--files-from <glob>` adds files, `--dry-run` prints what would be replaced, `--json`
  prints one object. A write is a sibling temp file renamed over the path (mode, line endings and a BOM kept). Refused
  (exit 2): a path outside the project or a symlink leaving it, a binary or non-UTF-8 file, and a file with a dedicated
  writer under any casing — state, the progress ledgers, presence, the foundation freeze, the rollout coverage files,
  `rollout.json` and `templates.json`, encode attempts, `status.jsonl` — with the writer named.
- **One locked JSON edit (`stardust/scripts/json-edit.mjs`).** `<file> set|merge|append|delete <path> [<value>]` at a
  dotted path — a key in double quotes may hold dots, `[n]` is an index; the value is JSON when it parses, else the
  text as given; `merge` deep-merges an object. `__proto__`, `constructor` and `prototype` are refused in the path and
  at any depth of the value. The edit takes deploy's file lock, re-reads the file inside it and writes atomically,
  keeping the file's indentation, line endings and trailing newline; `--create` starts an absent file. The same path
  and dedicated-writer refusals as replace.mjs (exit 2).
- **Reading discipline** (`replica/reference/reading-discipline.md`): rewritten around one "I want to … → use …" table
  (text in a tracked file: the edit tool or replace.mjs; a JSON value: json-edit.mjs; a progress ledger: progress.mjs)
  and one rule — an inline interpreter may read and print; it never writes a tracked file.
- **The skills say it where they edit.** The rollout, migrate and extract SKILL.md each gain one sentence that points at
  reading-discipline.md; replica's sits in the paragraph that opens with its pointer to it. Each says text in a tracked
  file goes through the edit tool or replace.mjs and a JSON value through json-edit.mjs (replica's adds a ledger
  through progress.mjs) — an inline interpreter may read and print, never write a tracked file.
- **`evals/lint/inline-writes.mjs`** (chained in `lint:stardust`; test in `evals/lint/test/`): fails when a SKILL.md
  or a reference doc shows an inline interpreter (python `-c` / stdin / heredoc, `node -e` / `-p` / heredoc) and a
  file-write call (`open(…)` with a write mode, `write_text`, `json.dump`, `writeFileSync`, …) in one fenced block or
  paragraph; a read-only probe, or a prohibition naming `node -e`, stays clean. The validate workflow lists the lints
  one by one and does not run it yet — the integrator adds the step.
- **The extract summary, one script (`extract/scripts/extract-report.mjs`).** The four runs wrote 95 distinct helper
  scripts; one run alone wrote seven extract-analysis helpers (outline, brand tokens, slots, modules, design, review,
  aggregate). Per page of `stardust/current/pages/*.json` it prints the heading outline, the modules (the main
  landmark's sections with purpose and headline, component counts), the brand tokens (custom properties as colours,
  fonts and other; font families; theme colour) and the slot candidates (headline, lede, title, description, up to 8
  CTAs, image alt counts, one line per main section), then one aggregate line. It reads both the crawler's record and
  the documented schema (`extract/reference/current-state-schema.md`), a missing field left out; `--pages <glob>`
  keeps the matching pages, `--json` prints one object, uncapped. Read-only: it writes nothing.

## 0.36.x (stardust/r16-capture-settings) — capture settings are recorded where every gate reads them; a gate row tells the truth about its capture (#150)

The recorded hands-off runs: an independent roster re-gate of one run reproduced 8/10 instead of its 10/10 — the run
pinned a rotating hero with a `--dismiss` flag and accepted two clip findings in prose, and neither was where the roster
gate reads. In another run four origin captures kept a consent dialog open and still passed, because the dialog's
container was on a per-slug hide list. Build-side "hide matched nothing" lines read as warnings although nothing
matching on the build is expected; a duplicate always-404 `@font-face` failed rows as a font-load failure; a header
contract recorded a body-hydration state as a panel and cost two sessions and eight re-explores.

- **Capture settings live in presence.json (`replica/scripts/presence.mjs`).** `add` takes `--dismiss <sel,…>`,
  `--pin <sel> --state <label>` and `--allow <kind>=<selector>` (kinds `clip`, `per-visitor-dialog`) beside `--hide`,
  per key (`"*"` or `--slug`), with the same `--verify <url>` poll (every selector of the call) and `--reason R-<nn>`
  rule; an allowance needs a reason, a per-visitor-dialog allowance needs its container hidden for the page. The pure
  readers `captureSettings` and `clipAllowed` are what the gates share. The register's Kind line names the new kinds.
- **The gates read them.** gate-all and gate.sh add presence.json's `dismiss` after `--dismiss` (one list per page),
  pass `pin` (stitch-shot `--pin`: a rotator control clicked on the frozen page) and a hidden per-visitor-dialog
  container (`--allow-dialog`) to both captures, and record dismiss / pin / allow in the records, live.json and the gate
  key; a capture taken with another pin list is not reused. A `clip` allowance adds the counted clip findings under its
  selector (its clipper or whole path segments of the recorded findings) to the allowance (gate-all row `clipAllowed`;
  gate.sh `--full`). A roster run with the settings in
  presence.json takes the captures a run with the same flags took. stitch-shot `--slug` / `--presence` reads them too.
- **A dialog left open is INCONCLUSIVE.** stitch-shot prints `dialog-left: <name>` and records `dialogLeft` for every
  dialog the last sweep left open — hidden or not; only a hidden container allowed as a per-visitor dialog clears it
  (`dialogsAllowed`), and only while that allowance stands. gate-all: `<side> capture polluted: dialog left open
  (<name>)`, never kept by a fix round; a capture recorded before the check is never kept, re-shot under
  `--skip-existing` and INCONCLUSIVE when measured. gate.sh: `INCONCLUSIVE: dialog left open (<name>)`, no verdict
  (exit 1); a live.png from before the check, or taken with other dialog allowances, is retaken.
- **A build-side hide miss is information.** gate-all and gate.sh print `info: hide matched nothing on the build
  (expected — …)`; the live side's warning is unchanged.
- **Dead font declarations do not count.** An `@font-face` whose every requested src answered 404, beside a face of the
  same family, weight and style that loaded, is `fontsDead` with one stdout line, not a `FONT LOAD FAILED` warning or a
  `font-not-loaded` row reason; a 404 face with no loaded twin (another weight, or none) renders fallback type and still
  counts.
- **C-final re-captures only what changed.** Under `--skip-existing`, gate-all keeps a page's EDS capture from its
  unit gate on the preview host when the final roster gate measures the live host and both gate keys are known and
  equal but for the build host (the delivered document, the chrome documents and every code hash unchanged since that
  gate): `reused build capture (unchanged since <ts>)`, the row's `buildReused`, its `host` the one the pixels came from,
  and one summary.md line naming those rows. In the local integration this is an experiment behind
  `--reuse-across-hosts`, off by default: a C-final row is measured on the live host, and the preview-vs-live
  difference in published inputs the key does not hash is what C-final exists to catch.
- **chrome-explore's pollution guard.** Every top-level open state is sampled again on a fresh page; a repeat that
  differs by more than `--bar` (default 0.02) marks the state `unstable` and is re-sampled once. The contract's header
  records `stability`; `unstableAsWarn` turns chrome-compare's errors on an unstable source state into warnings
  (`--no-repeat` skips the guard, recorded as skipped).

## 0.36.x (stardust/r16-instruments) — the instruments behind the inline scripts; asset harvest through the browser (#149)

The recorded hands-off runs wrote 99–287 inline interpreter scripts each: 56–120 whole-file rewrites of CSS and JS,
16–40 screenshot inspections (one run: 40 pixel measures in an image library), element-box probes and DOM-skeleton
dumps. One run hand-wrote a browser-side CSS/font harvester because a CDN wall answered every direct fetch of a
stylesheet with a denial page while the browser was never blocked. A lead polled `run-bg wait` twenty times over 35
minutes; another waited 57 minutes in one tool call. token-ledger wrote `usage.md` before the run's last two sessions,
and an optimize scorecard read 100 beside 22 `open` findings it did not score.

- **Stylesheets, fonts and SVG through the browser (`extract/scripts/media-harvest.mjs --assets sheets,fonts,svg`).**
  Each crawled page opens in one live-session context (launchStealthHeaded, newLiveContext, gotoLive, dismissOverlays)
  and the asset responses the browser receives are kept; every `@font-face` and every `.svg` `url()` of a loaded sheet
  is loaded in the page, so unused fonts and icons come too. Files: `assets/<kind>/<base>-<hash8>.<ext>`;
  `assets/harvest-map.json` in the media map's format plus `kind`; 5 MiB per file and 100 MiB per run unless
  `--max-bytes` / `--max-total-bytes`; a failure never replaces an `ok` entry whose file is on disk. `--assets media`
  (the default) is the Node path, unchanged; exit 3 when every page was refused by a bot challenge.
- **`diff/scripts/dom-probe.mjs <url|file>`** — the one probe for geometry and structure: per `--selector` root the
  page-absolute box with computed display/position, the DOM skeleton to `--depth` (×N sibling runs), the heading and
  landmark outline; `--compare <url|file>` diffs two documents; `--json`. Never gate evidence.
- **Reading discipline** (`replica/reference/reading-discipline.md`): a question → instrument table (dom-probe, measure,
  inspect-image, the gate's pixel lines, page-probe) — measure with these, never with an image library or a
  hand-written evaluate; an inline interpreter may read and print, never rewrite a tracked file (the edit/write tool's
  job). `inspect-image.mjs --help` says the same.
- **`run-bg.mjs wait`** returns exit 76 at once while `$STARDUST_PAUSE_FILE` exists (jobs keep running; `status`
  prints the pause line first), so a runner's push-stop ends a long wait; `--max` defaults to 1500 s, also the ceiling;
  `--until <ISO>` is the alternative bound; declare the shell call's timeout above the wait.
- **`token-ledger.mjs`** runs LAST (handoff end) and idempotently: `usage.json` carries `writtenAt` and
  `sessionsCovered { count, first, last }` (one line in `usage.md`); unchanged inputs write nothing; the harness cost
  sums each session's last cost line and per-model costs across sessions.
- **An `informational` finding status** (`rollout/scripts/optimize.mjs`, `findings.mjs`, `lib.mjs`): a source-parity
  finding is `informational`, never `open` (older ledgers migrate; `resolve --status informational` for a parity
  finding); the scorecard gains an `informational` count and its open counts equal the ledger's; both schemas accept
  it. Every other finding, out-of-scope ones included, is scored and gated as before.
- **`rollout/scripts/media-manifest.mjs`** lists the delivered media per page — each reference of every delivered
  document with its source URL(s) → `media/<scope>/<file>` from the deploy media ledger, or `unmapped` / `external` /
  `code` / `broken` — the helper three recorded runs wrote by hand. It reads only; `--json` for machines.

## 0.36.x (stardust/r16-encoder-first) — the encoder path is the default: maps at C-archetype, derived slots, a variant never a re-type (#148)

A recorded full-site hands-off run left every template `not-attempted` at C-archetype; strict variance refused all 21
siblings of one before the lead drafted import maps, after which 30 of 30 siblings encoded in seven minutes.
Prototypes without `data-slot` marks were refused (`strict slots`) and patched by `sed` seven times; a single
differing sibling was moved to an archetype of its own (`state.mjs set --representative` to itself) and recorded again
later; in two runs sibling pages were generated by per-template scripts because no map existed, with no record.

- **Encoder first (`migrate/encode-attempt.mjs`, `migrate.mjs plan`).** `record` refuses the automatic
  `not-attempted` outcomes (no map, no encoder) for a template with two or more siblings unless `--reason "<why>"`
  names why — exit 2, nothing written, an earlier automatic record removed; with a reason the record keeps
  `<why> (<cause>)`. Siblings come from the state (`--state`; representative links, else the template's type) and
  the migrate sidecars that name the template (delivered siblings still count).
  `plan` records an automatic not-attempted again (a map drafted since is picked up), prints `maps due: …` for every
  template still without one and exits 2; with `--force` a recorded decision (a reason, hand-authored) is kept when
  nothing new can run.
- **Hand-authored is recorded.** `record --hand-authored --reason "<why>" [--pages <slug,…>]` writes verdict
  `hand-authored` (nothing run, an earlier attempt's roundtrip and lint kept, `pages` = the hand-authored siblings);
  the summary line — `plan`'s last — counts it: `encode: <e> encoded · <a> A′ (<n> no-roundtrip, <m> not-attempted,
  <h> hand-authored)`. Records gain a `pages` key (null except hand-authored).
- **Per-template summary (`encode-attempt.mjs summary`).** Before the totals line, one line per template — the line
  the roster report quotes: `encode-attempt <t>: <s> sibling(s) · <e> encoded · <r> slot-rendered · <h> hand-authored
  · <n> not-attempted (<verdict>)`, each sibling counted once from its migrate sidecar and the template's record; an
  A′ sibling rendered from its own file without a hand-authored record is named. `--json` adds `perTemplate`.
- **Derived slots (`migrate.mjs render`).** An archetype with no `data-slot` inside `<main>` — the strict-slots check's
  own test — is no longer refused: its content units are marked in-process from its section structure (per section,
  each heading, phrasing-only text element, text link and image, named `<section>-<tag>`; repeats of one structure
  share the name), both slot sources read them, the run prints `slots derived (no data-slot markers): archetype <a> —
  <n> slot(s): …` and the sidecar records a `slots-derived` decision. The prototype file is never written. A derived
  slot repeated across containers (one per card) needs one value per container — else strict slots asks to mark the
  repeated container (the fork would splice a card into its neighbour).
- **A variant, never a re-type (`replica/sibling-variance.mjs`, `migrate.mjs` variance gate).** For a single
  differing sibling, or fewer than 20 % of them, the probe's advice and the strict-variance refusal name a variant
  class on the template with the exact `migrate.mjs render <slug> --accept-variance "…"` and `migrate.mjs variant
  <slug> <class>` commands — the template's only sibling included; re-typing stays the advice, and the refusal that
  `--accept-variance` cannot unlock, for a majority of two or more.
- **Docs.** migrate SKILL.md § Encoder first and § When the encoder cannot (A′ fork, variant, hand-authoring last);
  replica `recreation-procedure.md` § Slot markers (required on every region that carries sibling content); the
  rollout C-archetype paragraph; T&M § Path A′ Step 2; fidelity-tiers; the encoder contract. Folded: three migrate
  Phase 2 bullets that restated their reference docs.

## 0.36.x (stardust/r16-export-required) — the migration export is required, fresh, and counted once (#147)

In every recorded hands-off run the agent drafted the judgement and wrote the manifest but never ran
`block-origin.mjs --verify`: the export step called both scripts opt-in and read as optional, so no `mapping.json`
reached the migration tool. In one run gap-closure fixes landed after the export was written; the manifest's own
freshness check caught it, and nothing re-ran it. done-check counted the same header findings twice.

- **The export is required once listed.** When `rollout.json` `exports` lists `migration-workspace`, rollout's
  Phase I runs the judgement draft once, then three commands in order, each required: `inventory.mjs` +
  `blocks.mjs`, `block-origin.mjs --verify`, `workspace-manifest.mjs`. `mapping.json` is part of the export
  (`reference/coverage-contract.md`); the "opt-in" wording is gone for both scripts.
- **workspace-manifest.mjs refuses to call an export without its mapping ready.** When the capture dir
  (`--captures`, default `stardust/current/pages`) holds a capture and `workspace/mapping.json` is absent, the
  manifest is written without `handover`, `missing: stardust/rollout/workspace/mapping.json — run block-origin.mjs
  --verify first` goes to stderr and the exit is 2; `--json` carries `missing[]`. `--allow-no-mapping` keeps the
  manifest as before; a project without captures needs no mapping. The manifest schema makes `handover` optional
  (absent = not ready to hand over).
- **done-check gains `export_stale:<why>`** (export listed, not handed over): no manifest; manifest input or output
  hashes that differ from the tree; `mapping.json` missing while captures exist, unreadable, or with another
  `generatedAt` than `pages.json`. One line, the three commands as the remedy; a handed-over export is a `skipped:`
  line. The handoff contract's gap-closure exit re-runs the export before `handoff end` when an input changed.
- **Header gaps counted once.** `header_parity_errors` is left out when `header_parity` already names the same
  undecided errors; for another `header_parity` cause it stays. Without `findings[]` it reads `counts.error` alone
  (chrome-compare already leaves the decided out), and the header decisions a hands-off agent took are
  `info: header_decided_by_agent:N` for the owner's review, never a gap.
- **A planned page the source no longer serves leaves with a record.** `state.mjs exclude <slug…> --reason "<why>"`
  writes `excluded { reason, at }` on the page (`--url <url>` lists one `init` never had in a top-level
  `excluded[]`); `inventory.mjs` moves it out of `pages[]` into a `pages.json` `excluded[]` row (`status:
  excluded`, the key only when there is one), never counted in a denominator, a pass or a fail; done-check prints
  `info: pages_excluded:N` (JSON `info[]`), never a gap. In a recorded run such a page vanished with no record.
- **A block is pending only when delivered without a conversion record** (`workspace-manifest.mjs`
  `pendingBlocks`): one manifest placeholders line and `info: blocks_pending:N` in done-check; the C-deliver unit
  checklist records each converted block (`update-coverage.mjs --block`) first. The runner's count still reads
  `rollout.json` `lastRun.blocks.pending`.

## 0.36.x (stardust/r16-header-decisions) — hands-off header decisions: the agent decides, with a reason (#146)

A recorded hands-off run ended `needs_human` with every page passing, because three documents disagreed on who clears
a header-parity finding: diff/SKILL.md and chrome-compare's `--help` ignored every agent-signed decision, while the
handoff contract ("fix the header or record a decision") and the run's instructions ("fix or decide every error")
asked the agent to decide. The agent wrote its proposals, with rationale, into a candidates file and never a decision;
a sibling run fixed its findings in code instead. Touches #132 (the header contract).

- **One rule, word for word,** in diff/SKILL.md § The header contract, chrome-compare's `--help`, the handoff contract
  (**Header findings**, its `header_parity` / `header_parity_errors` remedy) and replica/SKILL.md, a test keeping the
  four identical: fix or decide every error (hands-off: you decide, with a reason). In a hands-off run
  (`state.json` `handsOff: true`) the agent is the deciding party — `{ finding, decision: accept|fix-later|artefact,
  reason, by: "agent", at }`, one exact key per entry, a reason of at least 40 characters naming the evidence;
  chrome-compare counts it as decided and lists it for the owner's review. In an attended run the owner rule stays.
- **chrome-compare:** `--state <file>` (default `stardust/state.json`); an agent entry that is attended, a prefix*
  key, another decision or a reason under 40 characters is ignored and reported (`decision-invalid`, naming why); an
  agent word anywhere in `by` ("subagent", "the agent", a bot) signs as the agent, never as the owner; a bare `*` key
  clears nothing for anyone; a site owner's entry wins over the agent's for the same key. The verdict gains `handsOff`, `counts.decidedByAgent`
  and `decidedByAgent[]` (`{ key, decision, reason, at }`); the printed report a `🔵 decided by the agent:` line per
  entry and `(n by the agent, hands-off — for the owner's review)` on the counts line (attended: the counts line is
  unchanged; the warning for an ignored agent entry now names the attended rule).
- **`chrome-compare.mjs decide <key> --decision <d> --reason "<r>"`** turns a proposal into a decision: the
  agent-signed entry, written atomically; the same entry again changes nothing, a changed decision or reason
  replaces it, a site owner's entry is kept; refused in an attended run (exit 3, the owner sentence), usage exit 1.
- **qa's `chrome` check** applies the same rule; its message names an agent's decision for the owner's review.
- **A hide-list offset is a measurement artefact, not an error:** when the panels' top edges differ by the height of a
  region hidden at that width (±2 px, from the records' `hide.perWidth`), the panels are as wide, the lower panel is
  at most that much shorter (the shift only lets the viewport clip its bottom) and the shared, top-aligned crop area
  is within the bar, the `panel-visual` finding is `info` with `evidence: { kind: "hide-offset",
  region, h, dy, shared }`; a shared area over the bar stays an error and names the offset. chrome-compare prints
  `info` findings (⚪) and counts them (an `info` count beside `error` and `warn`).
- **The owner report** lists "decisions the agent took" — every `decidedByAgent` entry (diff/SKILL.md).
- done-check is unchanged: it reads `findings[].decided`, which an accepted agent decision sets.

## 0.36.0 — local integration for the next recorded run (not a release)

A local integration of the stardust branches for the next recorded hands-off run's image: never pushed,
never released. Each merged branch keeps its own entry below in version order, under its provisional
version; numbers marked "local" are integration-only and renumbered by the maintainer at merge.

- Base `stardust/gate-economics` — 0.35.6 (#141, #142 local), carrying `stardust/gate-trust` 0.35.5,
  `stardust/gate-all-coverage-roster` 0.35.1, `stardust/replica-fidelity-run14` 0.34.5 (#138 local),
  `stardust/replica-retro-pack` 0.34.4, `stardust/replica-gate-triage` 0.34.3,
  `stardust/replica-source-oracle` 0.34.2, `stardust/replica-speed-instruments` 0.34.1 and
  `stardust/replica-consent-and-progress-shape` 0.33.1.
- `stardust/replica-cluster-subunits` — 0.35.0 (#134).
- `stardust/replica-instrument-deadlines` — 0.35.2 (#135).
- `stardust/rollout-bookkeeping-proof` — 0.35.3 (#140 local).
- `stardust/handover-tools` — 0.35.4 (#137).
- `stardust/migrate-shipped-encoder` — 0.35.0 (#139 local).
- `stardust/rollout-workspace-export` — 0.34.0 (#133, PR #443).
- `stardust/rollout-block-origin` — 0.34.1 (#136 local).
- `stardust/rollout-run-followups` — 0.35.7 (#143 local); it tracks the gate's JSON sidecars under
  `replica/gates/`, which replaced the local stand-in.
- `stardust/handover-followups` — 0.35.9 (#144 local).
- `stardust/capture-dialogs-and-denials` — 0.35.8 (#145 local).
- Local-only commits: the scripts-index lint cap at 16 KiB, then 20 KiB; an encoded page's sidecar feeds
  its delivered `lang` in the rollout inventory; an INCONCLUSIVE gate row keeps a width's earlier failing
  verdict; the master card's Versioning line names the tracked gate sidecars; a crawl loader comment; the
  renumbering above.

**+r16** — the run-16 image (`stardust/local-integration-run16`, on the run-15 image above at 32b4220c; the version
stays 0.36.0). Merged, in this order, each under its own `0.36.x (<branch>)` heading above this one:

- `stardust/r16-header-decisions` — 0.36.x (#146 local).
- `stardust/r16-export-required` — 0.36.x (#147 local).
- `stardust/r16-encoder-first` — 0.36.x (#148 local).
- `stardust/r16-instruments` — 0.36.x (#149 local).
- `stardust/r16-capture-settings` — 0.36.x (#150 local).
- Local-only commits: the qa `chrome` check's wording for decided findings; the self-representative refusal names
  the variant path; the handoff contract's derived slots and plan line; the artifact map's `hand-authored` verdict;
  run-bg's wait bound and pause exit in the handoff contract, rollout, the gate doc and the replica card, and
  source-parity findings recorded `informational`; chrome-compare and qa's `chrome` check turn errors on unstable
  source states into warnings (`unstableAsWarn`); gate-all's cross-host capture reuse behind `--reuse-across-hosts`, an experiment,
  off by default; the replica card names `presence.mjs add`'s capture settings; this renumbering.

Not in this image: none — every run-16 branch is merged.

**+r17** — the run-17 image (`stardust/local-integration-run17`, on the run-16 image above at 2fe5cbbf; the version
stays 0.36.0). Batch 1, merged in this order, each under its own `0.36.x (<branch>)` heading above this one:

- `stardust/r16-edit-instruments` — 0.36.x (#151 local).
- `stardust/r16-wait-and-waves` — 0.36.x (#152 local).
- `stardust/r16-proto-to-doc` — 0.36.x (#153 local).
- `stardust/r16-census-and-clock` — 0.36.x (#154 local).
- `stardust/r16-gates-and-jobs` — 0.36.x (#155 local).
- `stardust/r16-export-fresh` — 0.36.x (#156 local).
- `stardust/r16-tail-and-defaults` — 0.36.x (#157 local, taken as a fast-forward).
- Local-only commits: the new scripts-index rows trimmed and the lint cap raised to 20 KiB + 96 bytes for the
  four-branch union (a maintainer question); the extract SKILL and scripts-index name style-census's `--page-timeout`
  and `--resume`; the validate workflow runs the inline-writes lint beside the other stardust lints; a pre-existing
  "skipped skipped." typo in the migrate SKILL; proto-to-doc removes its temp file when the write fails; the run-bg server/stall/stop machinery merged beside the wake/exit-77 machinery, and rollout restores four sentences the gates-and-jobs condensing dropped while delivery-gates names exit 77; migrate plan engages the encoder for a one-sibling template and the roster line quotes the source, encode-attempt's script guard flags a generator path/existing file (not a sentence that names one), and done-check infers the live host from the gates (not the preview deployedUrl); this
  renumbering.

Not in this image: none — all seven batch-1 branches are in the image.

## 0.35.9 — handover follow-ups: the encoder attempted before A′, fork slots from the block mapping (#144)

A recorded hands-off run never invoked the encoder: it hand-built every A′ sibling, wrote each sibling's slot data by
hand, and its plan ledger could not say how many templates were encoded. Review of the 0.35.4 handover tools left open
items: `site.totalDiscovered` stayed null whenever the `--max` cap bit; the entry-locale scope of an entry redirected
to another origin did not say it read the landed URL, and any two-letter second path segment narrowed the entry locale;
a re-render refused a variance the owner had already accepted, and representatives could link in a cycle; page-probe
always hid through its local fallback, counted an element matched by two selectors twice and let `--sbs` overwrite
`--shot`; chrome-docs labelled a mega-menu item with its first column heading and decoded `&constructor;` from the
object prototype; media-harvest fetched video of any size and wrote its map only at the end; a `$&` in a captured
title was expanded; and every probe screenshot was written at full resolution, to be read at full cost.

- **The encoder is attempted before any A′ sibling is built.** `migrate/scripts/encode-attempt.mjs` (`record` /
  `check` / `summary`) runs the encoder's `--roundtrip` and `--lint` once per template and writes
  `stardust/migrate/encode/<template>.json`: `encoded`, `no-roundtrip` (its reason recorded) or `not-attempted` (no
  encoder beside it, no `stardust/import/<t>/vocabulary.json` map, or an owner's `--not-attempted "<reason>"`); a
  `--encoder <file>` that does not exist is a usage error (exit 2, nothing written), never `not-attempted`. A new,
  minimal `migrate.mjs plan <slug…|--all>` prints render's branch partition (A, A′ per template, B, passthrough,
  refused; nothing rendered, state untouched), records the attempt of every template with A′ siblings in the set (an
  existing record kept, `--force` re-records, `--encoder <file>`) and ends with the count line for the plan unit's
  ledger detail: `encode: <e> encoded · <a> A′ (<n> no-roundtrip, <m> not-attempted)`. `render` refuses an A′ page,
  own file or fork, whose template has no record (strict `encode-attempt`, naming
  `node stardust/scripts/migrate/encode-attempt.mjs record --template <t>`); A and B pages are never checked.
- **Crawl totals and scope:** `_crawl-log.json#discovery.total` is the count before the `--max` cap, beside `count`;
  `captureGaps.scope.totalDiscovered` carries it and `state.mjs init` takes it for `site.totalDiscovered`. After an
  origin redirect the entry-locale scope still reads the landed URL, and now says so: the detail adds `(from the
  landed URL <landed>, redirected from <entry>)` and `scope.landedFrom` keeps the asked URL. A two-letter second path
  segment is part of the locale only when it is a known language or region code: `extract/scripts/locale-codes.json`
  (ISO 639-1 languages, ISO 3166-1 alpha-2 regions), copied beside `crawl.mjs`; without it no second segment narrows,
  said once on stderr.
- **A′ forks fill their slots without hand-written data, and their decisions hold:**
  - `render --from-archetype` fills slots through the block mapping (`--slots mapping|page-json`,
    `migrate/scripts/slot-map.mjs`): each `data-slot` of the archetype's prototype is located under a verified
    mapping selector in the archetype's capture and read at the same path in the sibling's; a value in the sibling's
    page JSON wins. The mapping is read only while `stardust/rollout/workspace/manifest.json` lists its sha256 and
    its `generatedAt` matches coverage `pages.json`. By default the mapping is used when it is usable, covers the
    archetype and both captures exist; else the page JSON slots — silently with no `mapping.json`; when one is present
    but not used, the run line `slots: archetype <a> — mapping not used (<reason>); page JSON slots` and the sidecar's
    `slotMapSkipped` give the reason. Strict slots refusals: an explicit `--slots mapping` with an unusable mapping, an
    uncovered archetype or a missing capture; a slot without a recipe (an ambiguous one included: its text in separate
    places of the archetype's capture, or its image file name on more than one image — never the first place for every
    such slot), or a mapped slot that does not resolve (an anchor not matching exactly one element, a path that leads
    nowhere, a link without text, a list longer than the archetype's or whose items cannot be counted), with no page
    JSON value. The sidecar gains `slotSource`, `slotMap` and `slotMapSkipped`.
  - An accepted variance holds while the archetype and the deltas are unchanged: the earlier record (the page's
    sidecar, else coverage `source.variance`) must match on `archetype`, verdict, `missing`, `extra`, the delta
    count and `deltaKinds` (each delta's kind, its probe and its message — `COUNT(card): 3 → 4 matches`, so a grown
    COUNT, CLUSTERS or SECTIONS delta is a change; SECTION HEIGHTS and PROBE keep the kind only, their pixel values
    move between probes; lists in any order). The page then renders without `--accept-variance`, keeps `accepted`
    (and `acceptedAt`) and is named on `variance: <n> A′ page(s) rendered on an earlier acceptance of an unchanged
    variance (…)`. A changed row is refused, naming each changed field and quoting the earlier reason; a record
    written before `archetype` and `deltaKinds` existed, or whose `deltaKinds` lack the messages, is refused once that
    way. The majority refusal stays, accepted or not.
  - `state.mjs set --representative` refuses a cycle (exit 2, nothing written, the chain named, e.g.
    `a → c → b → a`); `set <slug…> --clear-representative` unlinks pages (with `--representative`: a usage error).
- **The handover tools' open items:**
  - page-probe `--hide` runs through live-session's `hideEntries` / `hideRegions` when they are exported (stderr
    names the path, else the local fallback), `hidden <n>` counts an element once, and an `--sbs` output that is the
    `--shot` file is written beside it as `<name>-sbs`.
  - chrome-docs nests a list item made only of nav columns under the item's own label, never its first column
    heading (without a label, the columns' entries stand at that level); the item's own link or toggle button also
    heads every column after the list it heads (a dropdown's own link over two columns keeps both), while a heading
    inside a mega menu under the item's label heads only its own list, bare or wrapped, and the columns after it stay
    siblings; a Back or Close control at the top of a panel is skipped, a dropdown wrapper's own trigger keeps its
    label. Its entity and implied-tag maps have no prototype, so `&constructor;` stays literal.
  - media-harvest caps video at 50 MiB without `--max-bytes` (which caps every file); an over-cap file is recorded
    `too-large`, never written. `media-map.json` is saved after every finished download, so a killed run keeps every
    finished entry; an unchanged re-run leaves it byte-identical.
  - migrate's `composeHead` keeps `$&`, `$1` and `$$` in a captured title literal, as do the canonical, `og:url` and
    link rewrites.
  - `reading-discipline.md` names `page-probe.mjs` as the one ad-hoc browser tool.
- **page-probe writes capped images:** `--shot` and `--sbs` write a JPEG fitted within 1400 × 1000 (aspect kept,
  never upscaled) at quality 80, as `<name>.jpg` beside the given `.png` path; `--full-res` also keeps the
  full-resolution PNG at that path; the output lines name every file written. `--sbs` composes PNG or JPEG inputs.

Rulings: the default slot source falls back to the page JSON (when a `mapping.json` is present but not used, with the
reason on a run line and in `slotMapSkipped`), and only an explicit `--slots mapping` refuses; any encode-attempt
verdict (`encoded`, `no-roundtrip`, `not-attempted`) opens render's gate, which asks that the attempt was made, not
that it encoded; `--clear-representative` writes `representative: null`, the key kept.

`migrate.mjs` now imports `slot-map.mjs` and `encode-attempt.mjs` beside it, so a project copies migrate's whole
scripts dir. The extract, migrate and replica docs, the handoff contract, `state-machine.md`, `artifact-map.md` and
`scripts-index.md` name the changes; touches #137, #126. The scripts-index lint cap is now 14016 bytes (was 13312),
raised for the new rows with none trimmed — a maintainer question.

Patch: no verdict, threshold, criterion or gate row moved; the new refusals (an A′ page without an attempt record, an
unresolved or ambiguous mapped slot, a changed accepted variance, a representative cycle, a mistyped `--encoder`) only
add caution, and page-probe's images are for looking, never gate evidence. Upgrade: the sidecar's shape changed
(`slotSource`, `slotMap`, `slotMapSkipped`; the variance record's `archetype` and `deltaKinds`), so every A′ fork
re-renders once; each earlier variance acceptance is refused once, quoting its reason, and takes one
`--accept-variance`; an A′ page whose template has no attempt record is refused until `migrate.mjs plan` (or
`encode-attempt.mjs record`) writes one; `page-probe.mjs --shot x.png` now writes `x.jpg` (`--full-res` keeps the PNG).

Provisional version, renumbered at merge; stacks on 0.35.4 (the handover-tools branch); 0.35.7 and 0.35.8 are other
branches.

## 0.35.8 — the capture sweep closes dialogs; a 2xx denial page is a bot challenge; client hints stay consistent (#145)

Pre-run probes: a large logistics site served the headless browser a 900 px denial page with status 200, and
`stitch-shot.mjs` wrote it as a capture with exit 0. In headed stealth Chrome the page rendered fully, but an open modal
dialog locked scrolling and the stitch died on the lock. A controlled test: the vendor wall answered 200 "System Down"
when the client-hint headers were inconsistent.

- **The overlay sweep closes dialogs (`diff/scripts/live-session.mjs` `dismissOverlays`).** A third pass, after
  consent and the timed marketing interstitials: every visible `dialog[open]` gets `close()`, then its first visible
  close control (`[aria-label*=close i]`, `[aria-label*=schließen i]`, `[data-dismiss]`, `button.close`,
  `.modal__close`, `[class*="close"]`), then `Escape`; a visible, overlay-like non-native modal
  (`[role=dialog][aria-modal=true]`, `.modal.show`, `[class*="modal"][class*="open"]`) its close control, then
  `Escape`. The scroll lock a closed dialog leaves on html/body is released for the capture (overflow-y visible, a
  hidden overflow-x clipped), only when the pass closed one and none survives (re-read after the pass, so a dialog a
  close opened or remounted counts). `dismissOverlays` returns `dialogs`, `dialogsLeft` (the survivors) and
  `scrollLockReleased`; stitch-shot logs each (`dialog closed: …`, `dialog still open: …`, `scroll lock released …`).
- **A 2xx denial page is a bot challenge.** A vendor wall answering 200 leaves no header to classify, so the page is
  read after the settle: a vendor signature — "can't process your request" + "Incident Number" or "Access Denied" +
  "Reference #" anywhere in the title and text; "Just a moment…", "Press & Hold", "Incapsula", "DataDome", "Request
  unsuccessful" or "System Down" in the title, or in the text or an iframe src on a page under 2 KB of text — or a
  page under 2 KB of text under one error heading. `gotoLive` throws `BotChallengeError` (marker
  `HTTP <status> denial page — …`; the message says "origin blocked" and names the `--headed` escalation). stitch-shot
  reads the page once more after its dismissal sweeps (a denial page a script renders late) and exits 3 with no PNG
  and no capture.json; measure, cap-probe and every other instrument that navigates through `gotoLive`/`visit()` (the
  diff probes, chrome-explore, chrome-parity, anchor, sibling-variance, motion-observe, style-census, the reskin
  probes) exit 3 instead of measuring; the crawl treats it as a bot challenge — at the entry it escalates to headed
  real Chrome + stealth (`discovery.botBlock: 'denial'`; still denied → fatal), and every other page is read at
  domcontentloaded and again before the record: a denied one is listed in `crawl.failures` and never captured (no page
  record, no screenshot). Each probe read races a 10 s deadline (a wedged renderer never answers), so the navigation
  stays bounded; a check that cannot read the page is one stderr line (`denial-page check skipped`), never a pass.
- **Client hints back the UA.** live-session sets the browser's UA metadata from the UA string (CDP
  `Emulation.setUserAgentOverride` with `userAgentMetadata`: the UA's brands and version, the host's platform) on
  every page of every live context — measure and cap-probe on their local contexts too — so every request, documents
  and subresources, same- and cross-origin, carries `sec-ch-ua*` with the UA's brands and version and the host's
  platform, with no CORS preflight (browser-set hints are not author headers). Why not the route: Playwright drops
  route overrides of `sec-*` headers as forbidden, so the document route's hints never arrived. Out-of-process iframes
  and service workers keep the browser's own. stitch-shot prefers the full Chromium build (`launchChromium`; the
  headless shell, with one stderr line, when it is not installed) and prints
  `browser: <build>, client hints: <hints>`. The escape hatch is `native`: `--hints native` in stitch-shot,
  `STARDUST_LIVE_HINTS=native` in every instrument and gate round. `<stem>.capture.json` gains `browserBuild`,
  `hints`, `denialCheck` (`ok`, or `skipped: <reason>` when the post-sweep denial-page read could not run — on the
  record, not only stderr) and `dismissed` (the sweeps merged; null under `--no-dismiss`).
- **`STARDUST_NAV_TIMEOUT_MS` is a floor.** The navigation timeout is max(env, 2 × `crawl.navMs.p95`) clamped to
  20–180 s — the env is clamped too — else the instrument's default; an explicit flag always wins, and the recorded
  `source` names the input that set the max (`env` on a tie). A runner sets the env from its discovery sample while
  the crawl measured the real pages, so a smaller env no longer cuts a slow origin short. This supersedes 0.35.2's
  "used as given"; that entry, unreleased in the same stack, now says floor too.
- **Older copies, the remaining probes, the reopen sweep.** A project copy of `live-session.mjs` older than
  `navTimeout` no longer throws: measure, cap-probe, stitch-shot and style-census keep their old default (20 / 30 /
  60 / 20 s) with one stderr line; measure and cap-probe refuse a copy older than `withDeadline` before any browser
  launch (exit 2 / 125). motion-observe, content-diff, visual-diff and the reskin probes (capture-content,
  dom-equality, slot-coverage, donor-probe) take the shared timeout instead of a hard-coded 60 s (60 s still, with
  neither input). cap-probe's fresh-page retry bounds its reopen sweep: the new page and the overlay sweep each race
  `FRESH_PAGE_STEP_MS` (30 s), as measure's do; a deadline there is that read's failure, never retried.
- **Docs:** the scripts index rows; source-fidelity gate hardening rules 1 (client hints), 2 (the floor and its
  instruments), 6 (dialogs), 12 (2xx denial pages, `--headed`) and 13 (a released lock is no stall); replica
  SKILL.md's hardening paragraph and capture recipe (exit 3 → `--headed`); extract SKILL.md's nav-timeout sentence
  and the crawl's denial page; the `--help`s of stitch-shot, measure, cap-probe, style-census, motion-observe and
  crawl.

Patch: no verdict, threshold, criterion, gate-row or pairing change; the new states only add caution. The scroll lock
is released only after the dialog pass closed a dialog and none survives — a lock with no closed dialog is the page's
own layout and a lock over a survivor stays, so the scroll stall still fails loud on both. A denial page gives no
verdict, never a false pass: every live instrument exits 3, and the crawl captures none. gate-all is untouched: a
stitch exit 3 takes its existing blocked path, and the INCONCLUSIVE `origin blocked` row arrives with the gate-trust
merge; provisional: version and #145 renumbered at merge.

## 0.35.7 — bookkeeping follow-ups from a recorded local run: scripts record the units, gap closure is bounded, the foundation is three units (#143)

A recorded ten-page local hands-off run recorded its units by 16 hand-written `node -e` edits of the progress ledgers,
missed headings it passed to `section.mjs` verbatim, read 65 full-page PNGs (about 17 MB) into context and held the
foundation in one subagent for 78 minutes while that context grew to about 481k tokens (48 % of the session's cost).
Its verifier read 7 of 10 pages as 404s — a slash appended for an `index.html` source — and trailing-slash redirect
rows papered over it; one unit's `localize-links` pass rewrote documents another unit owned; `dynamics-check.mjs`
exited 0 with a FAIL row; the gate's JSON was gitignored, so a lost container takes the row of record with it; four
delivered blocks had no ledger row and a deliberately undelivered one no status; the usage ledger never ran, and
header parity ended with four undecided errors. On a site with a consent manager in a shadow root the main agent
patched the crawler's own selector list in place, though the gate instruments' table already held the button. A
recorded 99-page hands-off run spent about half its cost in an unbounded gap-closure loop after the procedure ended:
no ledger line, coverage never updated, done-check stuck at `pages_failed:89`. Follow-up items K1–K8, K10, K11 and K15
ship here.

- **The gate's JSON is tracked; its images stay ignored (K1).** `stardust/reference/stardust.gitignore` replaces the
  bare `replica/gates/` line with `replica/gates/**`, `!replica/gates/**/`, `!replica/gates/**/*.json` (git cannot
  re-include a file below an excluded directory), so the checkpoint commit carries summary, overrides, presence,
  rounds, triage and probes, and a lost container keeps the row of record. The artifact map and the handoff contract's
  checkpoint sentence say so; a project set up earlier swaps its bare line for the template's three.
- **done-check names what blocks completion; gap closure is one bounded ledger phase (K2).** `done-check.mjs` adds
  `gates_inconclusive:N` (a gate with no verdict leaves `pages_failed` unless the row failed for another reason),
  lists an object override without `valid: true` as not validated by gate-all (it no longer counts as earned or toward
  the 10 % cap; the string form keeps its register logic) and adds `header_parity_errors:N` for
  `chrome/header-parity.json` in any project. `ledger.mjs` knows the rollout `gap-closure` phase, the one unlettered
  phase. The handoff contract (row C) enters it only when done-check lists `pages_failed` after C-final: at most one
  pass per template, each within the three-round fix cap, `update-coverage.mjs --gate` after every pass, an `end` line
  with the residuals; the remaining phases run and replica's `handoff end` records the residuals — never withheld,
  never a second loop. Its remedies name the new gaps.
- **Verifier truth (K3).** `rollout/scripts/lib.mjs` `publicUrl()` reads `delivery.deployedUrl` by the delivered-path
  contract (`.html` stripped, `/index` → `/`, a recorded trailing slash kept), else the row's path — no slash appended
  from the migrated file name; done-check's redirect check asks for a line when a slash-ended source URL is served
  without the slash. `verify.mjs` reads media and text-track links (`.vtt`, `.srt`, audio, video, stream manifests) as
  assets. `inventory.mjs --state` needs `pages[]` of objects with a `url` and an archetypes-only tree, else exit 2
  with one line and nothing written. Identical bytes never mark a row stale; a roster row's hash (its capture or URL)
  is another basis than a migrated file's, so once the page is migrated it keeps its status, takes the file's hash and
  is named on one `Kept … not compared` line.
- **Blocks the export can see (K4).** `rollout/scripts/blocks.mjs` registers every `blocks/<name>/` holding
  `<name>.js` or `<name>.css` that no planned row covers (by id, EDS name or `edsBlockName`; header and nav are one
  chrome) as a `source: blocks-dir` row (`--blocks <dir>`; a missing dir is a note; a re-run writes the same bytes).
  `update-coverage.mjs --block <name> --status not-delivered --reason "<text>"` records a block deliberately left
  undelivered (reason required, exit 2 otherwise; found by id, then `edsBlockName`). `blockCounts` returns `{total,
  converted, notDelivered, pending}`, inventory seeds `lastRun.blocks` in that shape, the rollout schemas declare the
  status, its reason, the row source and the count, and the report's Blocks line reads `<B> total · <c> converted ·
  <n> not delivered · <p> pending`; the coverage model documents both.
- **Unit records and section reads go through scripts (K5).** New `stardust/scripts/progress.mjs unit
  start|done|failed <name>` (`--ledger rollout|migrate|replica`, `--kind`, `--pages`, `--blocks`, `--templates`,
  `--verdict`, `--set key=value`, `--again`; `show`) edits one entry of `stardust/rollout/progress.json`,
  `stardust/migrate/progress.json` or `stardust/replica/progress.json` (`types.<archetype>`) under deploy's
  `file-lock.mjs`, re-read inside the lock and written atomically; it refuses a malformed shape with nothing written,
  keeps the replica ledger's other top-level keys and prints the row. The handoff contract and the skill docs name it
  instead of `node -e` edits; replica Setup copies `progress.mjs` and, early, the deploy file it needs,
  `file-lock.mjs`. `replica/scripts/section.mjs` retries a pattern that does not compile or hits no heading by its
  words (case, accents and punctuation ignored, in order, a word may start a longer one; one stderr line says so); a
  total miss prints the outline on stdout, exit 2 (a bad regex was exit 125).
- **A unit's localize-links pass stays in its unit; dynamics-check fails loudly (K6).**
  `deploy/scripts/localize-links.mjs --unit <name>` (`--units-dir`, default `stardust/rollout/units`) rewrites, counts
  and checks only the documents of `units/<name>.paths` while the URL map still spans the whole content tree, so the
  unit's links to other units' pages still localize; a missing `.paths` or a unit with no document is exit 1, a path
  without a document a note; without `--unit` nothing changes. The per-page chain, row C and the deploy skill pass
  `--unit` inside a unit; the whole-tree pass runs where no unit runs (C-final). `dynamics/scripts/dynamics-check.mjs`
  sets its exit code before the backstop timer — 0 every check passed, 2 any FAIL (was 1, or 0 when the event loop
  drained first), 1 usage (was 2) — and rollout D2 says a parity fix changes block code, never the delivered content's
  meaning.
- **The usage ledger always writes its table (K7).** `stardust/scripts/token-ledger.mjs` with unreachable transcripts
  still writes `stardust/usage.md` and `usage.json` from the phase windows (`status.jsonl`) and the unit rows (the two
  unit ledgers): from / to, wall minutes and pages kept, every token and request cell `unknown` (JSON `null`,
  top-level `"usage": "unknown"` and `unknownReason`); with nothing to window, one `usage: unknown (<why>)` row; exit
  stays 0. It is a step at rollout `H-report` and before replica `handoff end`, and both files are committed (master
  step 5, the artifact map, the contract's row H).
- **The foundation runs as three recorded sub-units; the freeze runs once after them (K8).** Row C of the handoff
  contract and rollout Phase C split C0 into `foundation-chrome` (header and footer blocks, the chrome documents,
  per-locale nav and footer), `foundation-styles` (styles, fonts, favicon, scripts, `stardust/runtime-contract.json`),
  then `archetype-<template>` of the shell template, run one after another — each its own `progress.json` entry (kind
  `foundation`, `foundation`, `archetype`), a subagent that returns one verdict line, a checkpoint commit and a
  boundary ask. The two foundation sub-units commit with C0's `git add -A` checkpoint (no fan-out yet;
  `unit-commit.mjs` refuses the frozen header and footer blocks), the archetype through `unit-commit.mjs <unit> --code
  blocks/<name>`. The two foundation sub-units close on their own lint and `.plain.html` checks and run the whole-tree
  `localize-links.mjs` pass (no fan-out yet, no `.paths` file). The foundation-first gate — chrome checks and the pixel
  row at both widths — runs once, when the shell template's archetype page flips to `deployed` (the first page with
  header, footer, styles and fonts), and closes `archetype-<template>`; a failing check goes back to a subagent for the
  sub-unit whose files it points at, re-recorded with `progress.mjs unit start <sub-unit> --again`; a reopened
  sub-unit (its fix, `git add -A` checkpoint and whole-tree `localize-links.mjs`) runs only after the archetype
  subagent has returned, never beside it. Once it passes, `foundation-freeze.mjs freeze` runs once, after the three,
  and the freeze check runs from that freeze on. The single-subagent C0 text is folded, in replica's SKILL.md too.
- **Images meant to be looked at are small (K10).** New `replica/scripts/inspect-image.mjs <in.png> [--y <px> --height
  <px>] [--out <file.jpg>] [--max 1400x1000] [--quality 80]` writes a capped JPEG copy (default `<in>.inspect.jpg`; at
  most 1400 × 1000 px, quality 80) with a dependency-free area-average downscale and baseline JPEG encoder (4:4:4, alpha
  on white, deterministic); `pngjs` loads only after `--help`. A whole page fitted into the box is a sliver (1440 × 6000
  → 240 × 1000), so `--y` / `--height` crop the gate's failing band at full resolution before the cap (default
  `<in>.y<y>-h<h>.inspect.jpg`; a band not wholly inside the image exits 2 with one line, checked on the PNG header
  before `pngjs` loads), and the gate doc, the reading discipline and the contract's brief read-set send that band (the
  first hot band; gate-all's `hotBands`), never a whole page. `crop-compare.mjs` writes its diff and strip as capped
  JPEGs at the `.jpg` sibling of `--out` / `--strip`; `--full-res` also writes the full-resolution PNG at the given path
  (the old output); verdict, numbers and exit codes are unchanged. In its `--json`, `diffImage` now names the capped
  JPEG (was the `--out` PNG), `strip` → `stripImage` (the strip's JPEG, null without `--strip`), and new `fullRes` lists
  the PNGs written. The gate's own PNGs stay full-resolution measurement inputs: the gate doc and the reading discipline
  say agents look only at capped images, and the breakpoint strip for approval keeps `--full-res`. page-probe's `--shot`
  / `--sbs` part lands on the stacked 0.35.9 branch with page-probe itself.
- **One consent table (K11).** `extract/scripts/crawl.mjs` dismisses consent from live-session's `CONSENT_CANDIDATES`
  (`consentTable()`, resolved lazily in the plugin tree and the project-copy layouts — `scripts/extract/` ↔
  `scripts/diff/`, flat, and a `crawl.mjs` in `stardust/scripts/` beside replica's `stardust/scripts/diff/`; a drift
  test asserts the very same array) instead of its own list; its shadow-root pass, text-match fallback and prune pass
  stay. Without `live-session.mjs` beside the crawler a consent-dismissing crawl stops with exit 2 naming the looked-in
  paths (`--no-consent-dismiss` never loads it); extract Setup copies it.
- **`unit-commit.mjs --push` returns under 240 s (K15a).** Its network deadline is 170 s after the script started (the
  lock wait included), and every network step and backoff gets min(its own limit, the time left); with none left it is
  not started (exit 2, `push deadline reached`, the local commit kept and named). The last network step ends by 175 s
  (5 s kill grace), leaving 65 s for the local steps; `--help` states the bound. This supersedes 0.35.3's "no network
  step starts later than 180 s" (about 245 s in the worst case).
- **The one-h1 checklist line names the source trait (K15b).** The deploy skill's "Exactly one `<h1>` per page" line
  says what delivery-lint, verify and qa-gate already apply: a page whose source capture has no h1 keeps none — a
  recorded source trait, never a content edit.
- **The gate verdict per width (K15c).** `update-coverage.mjs --gate` records `delivery.gate.passByWidth["<width>"]`
  beside `pass` (keys as `atByWidth`; other widths kept; a skipped older row touches none); `pass` keeps its meaning.
  done-check's `unit_unproven` proves a page only when `passByWidth[w] === true` and a gate time is recorded at every
  `--widths` width; a legacy row without `passByWidth` falls back to `pass` + `atByWidth` and is counted in a
  `skipped:` line (`unit_unproven: <n> row(s) without per-width verdicts — proven on the last width's pass`). A page
  failing at 1440 no longer reads deployed because 360 was ingested last: any recorded width's `false` counts the row
  in done-check's `pages_failed`, `update-coverage` flips a gate-failed row back to `deployed` only when no recorded
  width is `false`, and `verify.mjs` never marks a row `verified` while one is (`gate: FAIL at <width>`). A width
  without a verdict is `null`, never `false`, so an inconclusive gate stays `gates_inconclusive`; gate-all rows on
  this base carry no inconclusive flag, so nothing writes `null` yet (a merge note for the base that adds one).
- **The scripts-index lint cap is 14208 bytes** (was 13312): raised for the new rows, none trimmed — a maintainer
  question.

K9, K12, K13 and K14 (and K10's page-probe part) live on the stacked branch and ship in its 0.35.9 entry.

Rulings: `header_parity_errors` counts the undecided error findings of `findings[]`, and `counts.error −
counts.decided` only when the file has none — chrome-compare's `counts.error` already leaves decided findings out, so
the literal difference would under-count. Stale (K3): a changed hash re-flags stale whenever the prior hash is of a
compared basis (a migrated file, or an `update-coverage --new` origin digest), the cautious side; only a roster row is
kept uncompared, and named. Consent (K11): this base's shared table is smaller than the crawler's old list — one
vendor's button class and three broad accept-attribute selectors are not in it (the prune pass still removes that
banner's container) — until the branch that extends the table lands first in the merge order. `update-coverage --gate`
refusing a per-page `--only` summary and the provenance `state.mjs advance` stamps (run item R14-8) are left to their
own session.

Patch/contract: no verdict, pixel threshold, capture, criterion or freeze-set change. The new refusals (inventory
`--state`, a crawl without live-session, progress.mjs shapes, `--push` with no time left, an inspect-image band outside
the image), `gates_inconclusive`, unvalidated overrides, `header_parity_errors` and the per-width proof and failure only
add caution; every skipped check is a named line. Output changes: crop-compare writes JPEGs unless `--full-res`; in its
JSON `diffImage` now names the capped JPEG (was the `--out` PNG), `strip` is now `stripImage` and `fullRes` is new.
dynamics-check: any FAIL exits 2 (was 1, or 0 when the event loop drained first), usage errors exit 1 (was 2). Touches
#125, #126, #134, #140. Provisional version, renumbered at merge: handoff contract row C (C0's sub-units, the
gap-closure phase) and § 5 change, and by plugin `AGENTS.md` a changed contract is a minor release.

## 0.35.6 — the instrument counts fix rounds; one height bar per regime; one browser budget across jobs; the hide list is derived, not remembered

Retrospectives of recorded hands-off runs found the gate's economics kept in prose: the 3-round fix cap was a
sentence a new brief could reset, while gate-triage counted the tables on disk; the same page could PASS at
gate-all's 5 % height bar and FAIL at gate-evidence's 8 px; a browser slot bounded jobs, not browsers, so one
gate-all job opened up to six Chromiums inside it; and after an `--only` run, which never writes the roster
`summary.json`, an agent pointed `update-coverage --gate` at that file and was told
`not a gate-all summary (no rows[])` — a missing file reported as an empty one. Another recorded run knew its in-flow
location bar's selector from the preserve-direction step on and never wrote a hide list, because nothing linked the
register to the file; probed later, the recorded selector matched nothing on either side (the bar was the first
in-flow block above the header), and chrome-parity had printed `hidden live: … ×0` and carried on. Numbered 0.35.6
provisionally, stacked on 0.35.5.

- **Fix rounds are counted by the instrument (#141, extends #126).** gate-all counts 3 fix rounds per page in
  `<out>/<slug>/rounds.json` — a fix round is a measured `--only` verdict of a page that already has one; the first
  gating and a row reused whole are not rounds (nor is an INCONCLUSIVE row); a fourth round is refused before any
  capture — `gate-all: refused to start, no verdict — cap reached — re-prototype decision: <slug> 3/3 @<w> …`, exit
  2, nothing written. Only the re-prototype decision starts a new count: `--round-reset "<reason>"`, recorded in
  rounds.json `resets` and the row's `roundReset`; `--max-rounds` (1..3) may only lower the cap. Concurrent rounds
  of one page are refused through `<slug>/rounds.lock`; a project without rounds.json is seeded from its tables (the
  measured verdict rows less one). Rows carry `round`; gate-triage reads the same count (`rounds n/max` per row in
  triage.md, `cap reached (<slug>@<w> n/max): re-prototype decision now`) instead of counting tables, and
  `update-coverage --gate` records it per width in `delivery.gate.rounds`.
- **One height bar per regime.** Without a pixel table, gate-evidence judges a `gate.sh` round at |Δh| ≤ 8 px in
  the prototype regime and ≤ 5 % of the origin height in the published regime — gate-all's bar; a table row, either
  stage, still decides at 5 %. The origin height comes from pixel-compare's `A <w>x<h>`; a round whose log has none
  reads `OPEN: no origin height in the round's log — re-run`, never a pass. `--height-tolerance <v>`: v ≤ 1 a
  fraction of the origin height, v > 1 pixels, for both regimes. Evidence lines name their bar, e.g.
  `[published regime: |Δh| ≤ 5 % of origin 3000px = 150px]`.
- **One browser budget across jobs.** run-bg gives a slot-holding job `STARDUST_BROWSERS_PER_SLOT = max(1,
  floor(STARDUST_BROWSER_BUDGET (default 3) / STARDUST_BROWSER_SLOTS))`: the contract's 3 browsers = budget 3 across
  all jobs; a larger machine raises `STARDUST_BROWSER_BUDGET`, and the slots with it; a budget below the slots says
  so in one `run-bg:` line. Inside a slot gate-all clamps its origin / EDS / probe pools to that share (1 → 1/1/1,
  the origin captures before the EDS ones; 3 → 2/1/2), and its roster estimate — run-bg's deadline for a gate-all job
  without `--timeout` — follows the pools (×4 at one browser per slot). gate.sh runs its `--full` probes that many at
  a time, so a bounded round takes the sum of their times; one stderr line names the bound and, when it holds probes
  back, the remedy (start the round through run-bg with `--timeout 1800`, or raise `STARDUST_BROWSER_BUDGET`). Run
  without a slot, nothing changes.
- **update-coverage ingests every gate-all table.** New: `--gate` takes the gate dir `all-<w>/` (its summary.json,
  then runs/*.json in name order; the newest row per page and width wins), beside the roster `summary.json` and an
  `--only` run's `runs/<ts>-<slug>.json` it already took. A `summary.json` absent beside `runs/` tables ingests those
  with one stdout note,
  `summary.json absent — an --only run writes runs/<ts>-<slug>.json; ingested <n> table(s) from <dir>/runs/`.
  The refusals are distinct (exit 1, nothing written): `<path> not found`, `<path> cannot be read (<code>)`,
  `<path> does not parse as JSON (<error>)`, `<path> is not a gate-all summary (no rows[])` — now only a parsed
  file without rows — and `<dir> holds no gate-all table (no summary.json, no runs/*.json)`.
- **An override must be a deviation's size.** gate-all lets an `overrides.json` entry lift a row only within 2 × the
  bars on the row's own measured numbers — pixel % ≤ 2 × `--threshold` and |Δh| ≤ 2 × `--height-tol` × origin
  height, inclusive; a reused row is re-checked. Beyond that the row stays FAIL with
  `override exceeds magnitude: use --hide / presence.json` — a capture or hide-list problem, not a deviation —
  counted in `totals.overrideMagnitude` and named on one summary.md line,
  `Override exceeds magnitude (fix the capture / hide list, not a deviation): <path>, …`.
- **The host measured is named.** The published gate still measures the preview host by default (coverage
  `deployedUrl`); the C-final roster gate and the gate before done-check run with
  `--eds-host <rollout.json site.liveHost>`. gate-all's first status line ends `; build host <origin> (<from>)`
  (`--eds-host`, `coverage deployedUrl`, `state liveUrl` or `--proto-base`); every row records `host`, the origin of
  its EDS capture, so `--compare-only` names the host the pixels came from; `update-coverage --gate` records it as
  `delivery.gate.host` (the row's `host`, else the table's `_provenance.eds`, else null).
- **A fix round triages itself.** A published `--only` run of a page that already had a row in the out dir runs
  gate-triage's triage on that dir in-process (offline: no parity, nothing routed) — `<out>/triage.{json,md}`, its
  head printed under the table as the next round's input. A triage failure is one `triage: skipped — <why>` line and
  never changes the verdict or the exit code; a page's first gating, full runs and the prototype stage do not triage.
- **gate-all takes `--dismiss <sel,…>`** like gate.sh and anchor.mjs: both stitches dismiss the site's own overlays
  before the hide list; its probes keep their built-in dismissal. The list is recorded in origin.json / eds.json,
  probes.json inputs and the gate key; a capture taken with another list is not reused (`dismiss list differs`), and
  a kept origin taken with another dismiss / hide list makes the row INCONCLUSIVE —
  `origin capture polluted: kept origin taken with another dismiss/hide list`.
- **One hide list per site (#142, extends #125).** `stardust/replica/presence.json` — a gate dir's presence.json
  shape, `"*"` and per slug — lists the in-flow per-visitor regions once; live-session's `mergePresence` puts it under
  a gate dir's file (the gate dir's value wins per key and field). gate-all, gate.sh, chrome-parity, chrome-explore
  and chrome-compare read it with no flag (`--slug` no longer needs `--presence`); gate-triage passes it to
  chrome-parity when the gate dir has none, and an edited site list re-runs stored parity; the diff probes get the
  merged list as `--hide`. Its selectors print as `site presence.json`; a malformed one is an error naming it
  (gate.sh: exit 1 before any capture). After a change to the site `"*".hide`, re-explore both sides — chrome-compare
  reports `hide-mismatch` for records explored without it.
- **Writing the list is a step.** New `presence.mjs`: `seed` writes the runner's overlay selectors
  (`stardust/.labs/run.json` `siteOverlays`, env `STARDUST_SITE_OVERLAYS`) at Setup;
  `add --hide <sel,…> [--slug <s>] [--reason <R-nn>]` records the region the preserve-direction step identified (its
  register entry, `kind: per-visitor-region`, carries the `selector`) — idempotent, atomic, a malformed file refused
  with nothing written. `suggest <url>` lists the candidates read off the live page; `add --verify <url>` refuses
  (exit 2, nothing written) a selector that still matches nothing after a poll window and names the candidates
  instead; without `--verify`, add warns
  `presence: not verified against a live page — add --verify <url> (presence.mjs suggest <url> lists candidates)`.
- **A hide that matched nothing is never silent.** live-session derives the candidates from the DOM —
  `inFlowRegionsAboveHeader`, the in-flow blocks above the header (0-px wrappers kept), each with a selector verified
  unique — and `recountHides` counts each hide selector again right before the capture; one that matched nothing at
  both counts gives one line,
  `hide matched nothing on live — candidates: <selector> (<tag>, <h>px); … (<sel>, …)`.
  stitch-shot's `--json` record carries each hide's `nAtCapture` and `hideMiss { sels, candidates }`; gate-all
  (`WARNING <slug>: …`, the row's `hideMiss`, `totals.hideMiss`, one summary.md line), gate.sh
  (`gate.sh: WARNING …`, a reused live.png's record included) and chrome-parity (`WARNING …`, `hideMiss` in `--json`)
  print it — a warning, never a verdict. chrome-parity also prints
  `hint: an in-flow region above the header — presence.mjs add --hide <candidate selector>` when the header and its
  texts are offset by the same Δy on one side.
- **gate-evidence survives an error row.** A pixel-table row without a pixel measurement (a stitch error, a missing
  capture) no longer throws: the gate reads `OPEN: no pixel measurement — <the row's error> — —, height delta —, …`,
  never FAIL and never a pass, and the printed row shows `1440=—/Δ—`.
- **gate-all refuses a value flag without its value.** A missing value, or one that starts with `-` (another flag, a
  negative number), is one stderr line and the usage, exit 2, before any I/O:
  `gate-all --eds-host --only home` → `gate-all: --eds-host needs a value, got "--only"` (`got nothing` at the end of
  the arguments).

## 0.35.5 — a gate names what it could not measure; an override must earn its row

Recorded hands-off runs measured fix rounds against origin captures a consent wall or a geo modal had polluted, and
still got numeric PASS / FAIL verdicts with the normal exit code; one 99-page run then delivered 94 pages through
`overrides.json` rows that nothing validated or counted. The overlay sweep on the gate path knew English labels and
one consent manager by id; a stronger multilingual sweep existed twice, unused by the gates.

- **One consent table, one sweep (live-session).** `CONSENT_CANDIDATES` gains Cookiebot, Usercentrics (its accept
  button inside the shadow root), TrustArc, Didomi and "Allow all"; when no candidate matches, the last pass is
  `CONSENT_LABEL_SWEEP` — the multilingual accept labels (accept-like first, `decline` last) clicked only inside a
  dialog, a consent container or a fixed / sticky / high-z layer, open shadow roots included. style-census's own
  pass is now that sweep (a style-census next to an older live-session.mjs exits 2: re-copy it). Consent is still
  clicked, never removed.
- **dismissOverlays says what it left behind:** `overlayLeft` names an open modal dialog, a banner-sized part of a
  known consent root still visible, a fixed or sticky layer painting over ≥ 80 % of the viewport (content of the page beneath it — a sticky
  hero at the top is not one), `html` / `body` `overflow:hidden`, or a sweep click that navigated away. The label
  sweep never submits a form or follows a link out of a merely sticky header. stitch-shot runs the check
  once after its last sweep and `--hide`, prints `overlay-left: <sel>`, and `--json <file>` writes a capture record
  (`overlayLeft`, `fontsFailed`, dismissals, hides, height, overflow) — exit codes unchanged.
- **gate-all: INCONCLUSIVE rows.** A row whose origin fell back to the crawl screenshot, or whose either capture left
  an overlay (or wrote no capture record), has no pixel or height verdict: `inconclusive: true`, reasons
  `origin capture polluted: <why>` / `build capture polluted: <why>`, INCONCLUSIVE in `summary.md`,
  `totals.inconclusive`; the run exits 2. No such row is reused; fix rounds and live.png reuse refuse a capture whose
  record predates the check or names an overlay; `--skip-existing` re-shoots such a capture, and under `--compare-only`
  or a failed `--recapture-origin` it reads unchecked. gate-evidence reads the row OPEN (never FAIL); `update-coverage
  --gate` keeps the page's status and records `delivery.gate.inconclusive` (`pass: false` — no verdict is no pass);
  gate-triage lists it as "fix the capture — `--hide` / presence.json — not the page".
- **Overrides are validated mechanically.** An `overrides.json` row counts only when its `verdict` is `tier-shift`,
  `instrument-artifact` or `source-volatile`, its `reason` names an `R-<nn>` present in
  `stardust/replica/inconsistency-register.md`, and the row's clip and content checks PASS (n/a is no pass; the
  prototype stage has no content criterion) on a row that was measured — an override never stands in for a missing
  pixel comparison; otherwise the row stays FAIL with `override rejected: <rule>`. The
  summary prints counted / rejected overrides and their share of the roster; update-coverage records
  `delivery.gate.override = {verdict, reason, valid}` (an override from an older table, without `valid`, does not
  count); gate-triage triages rejected overrides as failing rows.
- **Fonts must load.** A declared face whose `document.fonts` status is `error` on either side (stitch-shot's existing
  check, now in its `--json` record) is the row reason `font-not-loaded:<family>`; the row cannot PASS. A check that
  could not run is recorded as not checked (`fontsFailed: null`, carried into gate.sh's `live.json`) and reads
  `font-check-skipped:<side>` — no PASS either.
- **gate.sh gives no verdict on an overlay left and settles both sides.** A live or build capture that prints
  `overlay-left:` ends the round with exit 1 ("no verdict: fix the capture"); a polluted live.png is removed, and a
  live.png whose `live.json` does not record the overlay check is retaken once. The build capture now runs with
  `--settle` like the live one, so a consent manager an EDS build loads late is dismissed there too; the gate
  reference drops its known-limit note. A stitch-shot copy without `--json` is refused up front (re-copy it).

Numbered 0.35.5 provisionally — the stack is renumbered at merge (the contract now says overrides are validated, which
may make the merged release a minor). No threshold or criterion moves: rows measured on clean captures keep their
verdicts; what changes is that a polluted capture, a face that did not load and an unvalidated override no longer
read as a pass. Costs: one extra origin capture per page whose record
predates the check, a slower settled build capture in gate.sh. crawl.mjs keeps its own label list until its owner
imports the shared table (a live-session test fails if the two drift).

## 0.35.4 — extract and migrate hand over what the agent otherwise rebuilds (#137)

Recorded hands-off runs wrote throwaway helpers wherever nothing shipped did the job: `state.json` built by hand and
representatives set with `node -e`, two media harvesters, a canon-chrome → nav/footer document converter, a
hand-written A′ sibling clone with a hard-coded media host, and five ad-hoc browser scripts (screenshot, side-by-side,
eval/probe, interact, menu check) that skipped consent dismissal. Another run assigned page types by URL pattern; the
variance probe exited 2 on all five templates and the siblings were cloned anyway. A run entered at a `/de/` URL while
its site plan captured nine English pages, and nothing flagged it before Phase 2.

- **`state.mjs init` builds `state.json` from a URL file** (`--pages <file|->`, `--types`, `--site-url`,
  `--page-cap`): every page record must pass provenance validation; a file holding pages is refused (`--force` only
  while all are still extracted), one holding only flow keys is filled, its keys kept. `state.mjs set <slug…>
  --representative <archetype> | --type <type>` replaces `node -e` edits; `summary` lists representatives.
- **`extract/scripts/media-harvest.mjs`** downloads every media file the captured pages reference once, into
  `stardust/current/assets/media/<base>-<hash8>.<ext>`, and writes `media-map.json` (source URL → local file);
  idempotent, each failure recorded in the map (`http-<code>`, `too-large`, `error`), never fatal.
- **`deploy/scripts/chrome-docs.mjs`** builds `content/nav.html` and `content/footer.html` from
  `stardust/canon/{header,footer}.html`, each ending in `Robots | noindex`; `--prefix <locale>` per locale, `--check`
  compares a fresh build with the files on disk (exit 2 on a difference).
- **`migrate.mjs render` forks the archetype for a directed sibling without its own proposed file** (`--from-archetype`
  forces it): each `data-slot` takes `pages/<slug>.json#slots`, the head comes from the capture, media resolve via the
  media map, then the media ledger, else stay with a `media-unmapped` decision. Refused only when the archetype has no
  proposed HTML, or `strict slots` (no slot marks, a missing value).
- **The variance probe gates cloning:** `sibling-variance.mjs` writes `stardust/rollout/variance/<template>.json`;
  `render` refuses an A′ sibling whose verdict is `differs` unless `--accept-variance "<reason>"` (sidecar `variance`,
  coverage `source.variance` via `inventory.mjs`); more than half of a template's siblings differing is refused even
  then — re-type the template. A sibling with no variance row renders, recorded `skipped`.
- **`diff/scripts/page-probe.mjs` is the one ad-hoc browser probe:** live-session navigation, consent and overlays
  dismissed, `--hide`, `--nav-timeout`, console errors printed; `--shot`, `--eval`, `--click`, `--sbs`. For looking,
  never gate evidence.
- **Entry-locale scope:** when fewer than half of the captured pages lie under the entry URL's locale prefix,
  `crawl.mjs` adds `captureGaps.scope` and a `detail` note — an owner decision before Phase 2.

The extract, migrate, deploy, replica and rollout docs, handoff contract rows 1–2, `state-machine.md` and
`scripts-index.md` name the new tools; touches #126. No gate changed: no verdict, threshold or criterion moved; the
variance refusal and the scope note only add caution, and a sibling rendered without a probe row is recorded skipped.

## 0.35.3 — delivery bookkeeping ships with the pages; the done-check proves it (#140)

A recorded 99-page hands-off run lost its container mid-gate with no checkpoint inside the unit: 20 published pages'
coverage rows and gate captures went with it. Parallel subagents collided in one worktree (`git add content`,
`pull --rebase` refusals, push races); propagation polls were gzip-blind in seven agents of a ten-page run; a recorded
run delivered 94 of 95 rows by override with nothing counting them. Agents edited content to satisfy an h1 check on
pages whose source has no h1; whitespace-only spacer paragraphs were dropped by the pipeline (#112); subagents read
whole SKILL.md files (about 200 KB and 65 KB) and full-page PNGs into context; a coordinator spawned new units after a
boundary ask and blocked on one subagent for hours.

- **`deploy/fresh-check.mjs` — a propagation wait compares the decoded body:** `<url> (--expect-file <f> |
  --expect-sha <hex> | --grep <marker>) [--max-s 180] [--every-s 5] [--json]`; Node's fetch decodes gzip / br /
  deflate, so the check reads what a browser reads. One bounded poll, `fresh|stale <url> after <n>s`, exit 0 fresh,
  3 stale after the deadline, 2 usage. The handoff contract, the deploy card, the DA protocol, the gate doc and the
  replica card point every propagation wait at it; the raw fallback is `curl -s --compressed`, never `curl -sf | grep`.
- **`stardust/unit-commit.mjs` — a unit's pages and bookkeeping commit under one lock, by explicit path:**
  `units/<unit>.paths` → `content/**`, their eds-schema files and gate sidecars, the shared coverage, progress and
  media ledgers, and per `--code blocks/<name>` the unit's block directory (header and footer, the frozen foundation,
  refused). Lock `stardust/.work/git.lock` (`--wait-s 120`, dead or untouched holders reaped); `--push` rebases only
  when the upstream moved and retries; every git step is time-bounded and no network step starts later than 180 s
  after the script started (`push deadline reached`, the local commit kept); exit 2 leaves nothing half-done (a
  commit that could not be pushed is kept and named). Fan-out subagents commit only through it — never
  `git add content`, never `git add -A`; the Code stage push is `unit-commit.mjs <unit> --code blocks/<name> --push`.
  Replica copies it.
- **Bookkeeping before the gate:** row C's per-page chain records `update-coverage.mjs <slug> --status deployed` and
  runs `unit-commit.mjs <unit>` right after the `.plain.html` checks, before the published-origin gate, so a
  delivered page's record is committed before its gate runs; those commits stay local until the unit's `--push`, so
  a container lost mid-unit can still take that unit's unpushed record with it. Every unit with pages writes
  `units/<unit>.paths` before its first page; rollout's Phase C mirrors the order.
- **§ 5 order for returning subagents:** each cluster or archetype subagent's unit is recorded and committed as it
  returns (`progress.json`, freeze check, `unit-commit.mjs <unit> --push`); no unit is spawned in the turn of a
  boundary ask; while subagents run the main agent waits in bounded checks (≤ 4 min each), never one blocking call.
  The `git add -A` checkpoint stays where no fan-out subagent runs (phase ends, migrate units, C0's end, C-final).
- **done-check proves delivery; `ledger.mjs check` pairs the phases.** New gaps: `pages_overridden:N` (rows passing
  only by override above 10 % of delivered rows, an override citing no `## R-<nn>` register heading, or one marked
  `valid: false`; the verdict-string and object shapes are both read), `unit_unproven:<unit>` (a done unit without
  `.paths`, or with a page not proven — `delivery.gate.pass === true` as last recorded and a recorded gate time at
  every `--widths` width), `sidecars_missing:N` (eds-schema; a gate width, judged only in the replica flow or when a
  coverage row carries a gate, else a `skipped:` line; the redirects line of a moved path, in the sheet or the
  `redirects-cdn.tsv` beside it), `ledger_unpaired:N`. New flags `--widths`, `--register`,
  `--schemas`, `--redirects`; a check that did not run is a `skipped:` line (`--json` `skipped[]`). `ledger.mjs check
  [--json]` lists every `end` without an open start, exit 1; an end later re-recorded by a full start → end pair no
  longer counts (`unpairedEnds(lines)` export). The handoff contract gives each new gap its remedy.
- **delivery-lint `spacer-whitespace` (P2) and the source-h1 trait:** a `<p>` / `<h1>`–`<h6>` of only whitespace,
  `&nbsp;` or `<br>` (or a `<div>` of only `<br>`) is flagged — the pipeline drops it; model the spacer as spacing
  CSS (#112). A page without `<h1>` whose source capture (`stardust/current/pages/<slug>.json`: `--slug`, else the
  coverage row of `--path`; `--current`) records headings and no h1 gets a `note`, not a P0; `verify.mjs --current`
  verifies it with the same note, `optimize.mjs` tags its `single-h1` finding as source parity (out of the score,
  the open P1 count, the gate and autofix), and `qa-gate.mjs --source-capture <json>` prints a WARN instead of the
  FAIL. A missing capture, or one with an h1, keeps the P0 and the failure — content is never edited to satisfy a
  verifier.
- **Chain hygiene:** `localize-links.mjs --redirects <f>` naming a file that does not exist is a note on stderr and
  the run continues on the content tree (`redirectsFound: false`); an existing unreadable path stays exit 1. Every
  `python3 -m http.server` example binds `127.0.0.1`: loopback only, and its host-name lookup can crash on a long
  container host name. A cluster or archetype brief names its read-set — four citations fetched with `section.mjs`,
  never a whole SKILL.md, never a full-page PNG in context (`crop-compare.mjs` bands instead).

Patch/contract: no gate verdict, pixel threshold, capture or freeze change. One criterion narrows: a page without an
h1 whose captured source has none is a note (delivery-lint, verify), source parity (optimize) or a WARN (qa-gate with
`--source-capture`), not a P0, a failure or an open P1; a missing capture, or one with an h1, keeps all of them.
done-check adds a 10 % override cap and new gaps, and `ledger.mjs check` a pairing check — these only add caution,
and every skipped check is named. Touches #112, #125, #134. The number is provisional (renumbered at merge):
handoff contract § 2, § 3 row C, § Fan-out discipline and § 5 change, and by plugin `AGENTS.md` a changed contract is
a minor release.

## 0.35.2 — instrument deadlines: one navigation timeout, every width read bounded, `run-bg wait` scoped to its caller (#135)

Recorded hands-off runs: `measure.mjs` hung 8× at 900 s on a site that navigates after load — after a resize or a
consent click — because it reused one page across widths with no deadline on the reads. The live instruments'
navigation defaults ranged from 20 to 90 s with no shared value. A bare `run-bg.mjs wait` in one agent waited on every
other agent's jobs, and `--timeout` on `wait` was silently ignored. A stitched capture of a page whose in-flow header
shrinks on scroll stopped as a scroll stall; the workaround was a different `--vh`.

- **One navigation timeout.** `diff/scripts/live-session.mjs` resolves it: max(env `STARDUST_NAV_TIMEOUT_MS` (ms, a
  floor; an invalid value is ignored with one stderr warning), 2 × `crawl.navMs.p95` from
  `stardust/current/_crawl-log.json`) clamped to 20–180 s, else the instrument's current default. `gotoLive` (60 s) and
  `measure-live.mjs` `visit()` (90 s) default to it (e.g. anchor, chrome-parity, sibling-variance, clip-probe,
  content-presence, unit-geometry rely on those defaults); `measure.mjs` (20 s), `cap-probe.mjs` (30 s),
  `style-census.mjs` (20 s) and `stitch-shot.mjs` (60 s) take it when their flag is not given — an explicit flag
  always wins — and the crawl's per-page goto (45 s) always. Callers that pass their own timeout keep it
  (e.g. motion-observe, visual-diff, content-diff: 60 s). measure and cap-probe record `navTimeout: {ms, source}` in
  `_provenance`.
- **The crawl measures the figure.** `crawl.mjs` records each page's `navMs` (its goto to `domcontentloaded`) in the
  page record, and `crawl.navMs` {n, p50, p95, max} and `crawl.navTimeout` {ms, source} in `_crawl-log.json`; it names
  its page goto timeout on one stderr line; the entry probe, the challenge reload and the slash retry keep their
  constants. Without `live-session.mjs` beside it the crawl keeps 45 s and says so.
- **Every width read races `--timeout-ms` (measure, cap-probe).** A page that navigated under a read (execution context
  destroyed) is re-read once on a fresh page in the same browser context, cookies and consent kept; a deadline is
  never retried (a second would double the wait). A width that still fails is recorded as `{url, width, error}` in
  `_provenance.failed`, `_provenance.partial` turns true and the next width starts on a fresh page; a bot challenge
  still exits 3. cap-probe's reads form one model per page, so its retry re-probes the whole page.
- **Exit 124 = no verdict — never a PASS or FAIL from half a measurement.** measure exits 124 only when every width
  read failed, else 0 with a first line `measure: PARTIAL — <k> of <n> width read(s) failed: …` (stderr under
  `--json`); precedence 3 > 1 > 124 > 0. A cap-probe capture exits 124 only when every page's probe failed a read
  (a load failure exits 1), else 0 with `PARTIAL`, and a partial capture never merges into `--write-design` (the skip
  is recorded in `_provenance.designWrite`); a cap-probe compare with a failed read on either side prints `NO VERDICT`,
  exit 124.
- **`run-bg.mjs wait` and `status` cover the caller's own jobs.** `start` records `ownerPid`: `RUN_BG_OWNER`, else the
  nearest ancestor that is not a shell or wrapper — the agent process behind the tool call's shell (where agents share
  one process, a fan-out subagent names its jobs or prefixes each run-bg call with `RUN_BG_OWNER=<unit>`). Bare
  `wait`/`status` select the caller's jobs, `--all` every owner's, `<job>…` names those; the report's first line names
  the selection and its count. `--timeout` on `wait`/`status` is a usage error (exit 125) naming `--max`. A job state
  without an owner is reached by name or `--all`.
- **A header that shrinks on scroll is a morph, not a scroll stall (`stitch-shot.mjs`).** A shortfall the document's
  own shrink explains continues the stitch at the shrunk height and records `headerMorph: <px>` in a new sidecar
  `<stem>.capture.json` beside the PNG (`writtenBy, url, width, vh, height, chunks, headerMorph, overflow, at`); the
  `stitched` line ends ` — header morph <px> px` when it is above 0. A no-op scroll with the height unchanged still
  exits 1; no `--vh` workaround is needed.
- **Docs:** the scripts index rows, one sentence each in the extract and replica skills, handoff contract § Fan-out
  discipline (`wait`'s scope), source-fidelity gate hardening rule 13 (`headerMorph`).

Patch: no verdict, threshold, criterion, gate-row or pairing change; the new states only add caution — a width not
measured is recorded as not measured, and a compare that could not measure both sides never exits with a PASS or FAIL
code; touches #124 (cap-probe). One contract touch: a bare `run-bg.mjs wait`/`status` now selects the caller's own
jobs and handoff contract § Fan-out discipline says so — the 0.35.0 entry counted such an edit as minor, so patch vs
minor is decided at merge with the renumbering — 0.35.2 and #135 are provisional.

## 0.35.1 — gate-all reads its published roster from the rollout coverage; `--eds-host` takes a bare host

Two recorded hands-off runs, a 100-page and a 10-page one, each hand-wrote a script that built a gate state file
from the rollout coverage: gate-all selected only `state.json` pages `deployed` with a `liveUrl` — which nothing in
the delivery flow writes — while the handoff contract told the agent to run gate-all with no state file. One run
lost a 43-minute roster run to "no pages selected"; the agent also found that `--eds-host` needed the scheme.

- **`gate-all.mjs --coverage <file>` is the published stage's roster** (default `stardust/rollout/coverage/pages.json`
  when it exists, else `--state`): rows `deployed` / `verified`, and `failed` with a `gate:` error so a fix round
  re-gates them, each with `delivery.deployedUrl` (the gated URL, its host rewritten by `--eds-host`) and
  `source.sourceUrl` (the origin). A `state.json` beside it is optional and lends `template` / `fidelityTier` /
  `deployedPath` by slug, so a page that was already selectable keeps its template, tier and units — and its gate
  key while its coverage `deployedUrl` / `source.sourceUrl` equal the state's `liveUrl` / `url`. The coverage
  wins over `--state` for the published stage; `--state` keeps the prototype stage and legacy projects (no coverage
  file). run-bg's roster estimate resolves the source the same way; an explicit `--coverage` also feeds the gate
  key's block list (the default path did already).
- **The first status line names the roster's source:** `roster: …` ends
  `; source: coverage|state <path> (<q> of <N> row(s) / page(s) qualified)`, counted before `--only`.
- **An empty selection names both files** (absolute paths) with their counts — coverage rows deployed / verified /
  gate-failed with a `deployedUrl` (and how many lack a source url), state pages deployed with a `liveUrl` — and the
  roster's source; exit 1 kept. From a coverage roster the hint says the coverage wins and points at
  `update-coverage.mjs <slug> --status deployed --url <deployedUrl>` (or `--coverage <file>`); a state roster keeps
  the `--coverage` / `--state` / deploy-first hint.
- **`--eds-host` takes a bare host or `https://<host>`.** gate-all adds `https://` when there is no scheme and
  normalises to `<protocol>//<host>` (lower-case host, a non-default port kept); a path, query, hash or credentials
  are refused before any I/O — one stderr line and the usage line, exit 2. A bare host had produced `host/path`
  capture URLs and `new URL` failures. The summary's `edsHostOverride` records the normalised origin. gate-triage
  normalises each page's recorded host the same way, so its re-gate commands carry `https://<host>` and a bare host
  and its URL form share one command (a value gate-all refuses is kept raw). gate.sh is unchanged — it takes full
  URLs, never a host.
- **The contract and docs name the roster source:** the handoff contract (§ 1 row 5, § 3 row C), the replica and
  rollout skills, the gate reference and the scripts index — coverage rows `deployed` / `verified`, and `failed` by
  the gate; the coverage row is recorded `deployed` with its URL before gate-all reads it; no state file, no
  hand-built roster. The stardust skill names an agent-written roster builder for gate-all as a deviation to record.

Patch: an input source added, no verdict change. Numbered 0.35.1 provisionally — the stack is renumbered at merge.
No threshold, criterion, capture or reuse change; a page that was already selectable keeps its template, tier and
units, and its gate key while its coverage `deployedUrl` / `source.sourceUrl` equal the state's `liveUrl` / `url`.

## 0.35.0 (stardust/replica-cluster-subunits) — C-deliver clusters over 16 siblings run as sub-units; fan-out subagents pause on request (#134)

A recorded 100-page hands-off run held a 64-sibling template as ONE recorded unit for 6 h 38 min across two sessions
and a wall-clock kill; six of its ten sessions overran a 90-minute session limit, because the main agent reaches its
boundary only between recorded units while a background subagent holds the unit; a ten-page run overran the same way
(106 min, first boundary ask after 87 min).

- **A cluster of more than 16 siblings (archetype out) runs as sub-units `cluster-<template>-1` … `-n`:** n =
  ⌈siblings ÷ 16⌉, near-equal (17 → 9 + 8), at most 16 pages, cut in sibling (`plan.json`) order, one after another
  (other clusters stay concurrent). Each has its own `progress.json` entry (same shape, kind `cluster`), subagent,
  `.paths` + batch ledger + log, fix rounds (cap 3), `gate-all --only` scope, `gate-triage.mjs --unit <sub-unit>`
  first pass, checkpoint commit and boundary ask. Target: no C-deliver unit runs longer than 90 minutes.
- **A boundary ask closes every unit end, C0 included** (§ 5: `progress.json` write → freeze check → commit → ask →
  next unit): the main agent lets its supervising process, if any, end or continue the session in whatever form the
  harness provides; with none it continues. Only at a unit end does a supervised session end without losing work;
  an ask made while other units are still in flight names them.
- **Pause on request: `STARDUST_PAUSE_FILE`** (JSON `{at, reason}`; the supervisor's file — the run never writes or
  deletes it). When set, every fan-out subagent checks the file at each batch or iteration boundary and, if present,
  finishes the iteration, reports and returns; the main agent records the unit `running` in § 5's order (verdict
  `paused: …`, resumed like any in-flight unit) and asks its boundary before anything new — with several units in
  flight, once the last has returned. Briefs: cluster (after each page, deploy batch, gate round), archetype (each
  gate iteration), roster-gate job (before each `run-bg.mjs wait`).
- **No script change:** no script loops gate rounds (`gate.sh`, `gate-all.mjs`, `run-bg.mjs`, `deploy-batch.mjs`: one
  each), so none reads the pause file; `done-check.mjs`, `gate-evidence.mjs` do not read the C-deliver unit ledger;
  `gate-triage.mjs --unit` takes any `[\w.-]+` name (`units/<name>.paths`); `token-ledger.mjs` gives each unit a row.

Contract change: handoff contract § 3 row C, the `progress.json` unit names, § Fan-out discipline, § 5's unit-end
order and the 90-minute unit target; touches #125, #126; no script, verdict, threshold, criterion or gate-row change.
Minor: a changed contract is a minor release (plugin `AGENTS.md`), hence 0.35.0 rather than a 0.34.x patch.

## 0.35.0 (stardust/migrate-shipped-encoder) — encoded siblings: the template's map, applied to each capture, replaces the row-2 clone (#139)

Minor: the row-2 and encoder contract change. A recorded hands-off run showed the clone is not needed: every sibling
encodes from its committed capture and the site's ledgers, while the clone was each sibling's heaviest copy and the
file two gates checked in place of the delivered document.

- **Row 2 becomes "Encoded sibling — the template's map applied to the capture; no clone"** for a template whose map
  round-trips on its gated archetype; any other template keeps the A′ clone. `migrate/scripts/encode.mjs` writes
  `stardust/encoded/<path>.html` in deploy's delivered form; `deploy/scripts/stage-content.mjs` stages it into
  `content/<path>.html` behind a hand-edit guard (`stardust/deploy/stage-ledger.json`) and prints the paths for
  `deploy-batch.mjs --force --paths`. No write-boundary change: `content/` keeps one owner, deploy. The handoff
  contract's per-page rows and row C follow; exit 0 means "encoded", never "done".
- **The encoder** (`encode.mjs` + `encode/`): the importer's walk, grammar v2 (compound cells, per-item wrap,
  id-reference cells, one cell per match, blank-container drops, metadata from a selector) and sanitise's `encode()`
  applied last, so the finalisers are no-ops on the staged file. No executable per-template code: what the grammar
  cannot express stops the page for the model. Hard stops (exit 2): `unmapped`, `flattened`, `variance` (a shape
  fingerprint against the archetype plus a census of unmarked modules, accepted per class in the map), `incomplete`
  (the L5 content count on the encoded document), `hand-edit`, `error`. Provenance in the sidecar (`encode`,
  `audit.encode`) and a per-template manifest; nothing is rewritten unless its bytes change. Verdict:
  `encoded N · unchanged N · stopped N`.
- **The map** (`stardust/import/<archetype>/vocabulary.json` + `transform.json`, schema
  `migrate/reference/encode-map.schema.json`, rules `migrate/reference/importer-recipe.md`): `--roundtrip` at `text`
  (every code point equal after sanitise, only ASCII whitespace runs collapsed) or `strict`, `--lint` (the authoring
  checks) and `--sweep` (a dry run over every sibling capture); the encoder refuses a template's siblings until the
  archetype encodes clean and round-trips at `text`.
- **Offline content count:** deploy's `content-inventory.mjs` gains `offlineInventory` / `diffOffline`, the count the
  `incomplete` stop runs; `content-count.mjs` is its standalone CLI.
- **Site inputs, each with a deterministic writer and a schema:** `chrome-map.mjs` (`stardust/rollout/chrome-map.json`,
  the nav/footer each page uses), `sources[]` on every `da-media-upload.mjs` ledger entry, and `rehost-docs.mjs`
  (linked documents into `docs/`, `stardust/deploy/asset-ledger.json`).
- **Consumers:** rollout `inventory.mjs` lists encoded pages from their sidecars, and a sibling that stopped and went
  the A′ path beside its clone is read as a clone page, so the exception stays deliverable; `gate-evidence.mjs` finds
  an encoded page's delivered file at its eds-path, lints it there, never a clone, and takes row 4 from the encoder's
  count; `publicUrl` reads the encoded path; `modules[]` comes from the encode.
- **C14 skip rule:** the encode records each page's block shape; under a harness key (encoder, map, block code, frozen
  foundation) a sibling whose shape the archetype passed inherits its local launches (`migrate.mjs harness` records
  `passedOn`, `plan.mjs` marks `needsHarness`, `gate-evidence.mjs` verifies); any key change re-arms.
- **Opt-in per template** until a second recorded run, preferably on a hand-built DOM, clears the same thresholds.
- **Yield** (a recorded run, 64 pages, 8 templates): 7 templates round-trip at `text`, 6 at `strict`, the 8th is an
  exception by design; after one widening round 62 of 64 pages encode clean, 60 match at `text`; re-runs write nothing.
- **Finding:** on two pages the encoder kept a paragraph the delivered documents had dropped — there it was more
  faithful than the delivered documents. The published gate stays the arbiter.
- **Port:** ported from the `stardust/next` branch (skills/migrate/scripts/importer-skeleton.mjs,
  reference/importer-recipe.md and their test fixtures; commits 9aaeff4f, 1080f2b6, d4a37277, 7662fda2), rewritten
  for the archetype-first order; the ported files keep their provenance header.

## 0.34.5 — replica self-hosts the source's brand faces; one hide list for in-flow bars across captures, probes and the header contract; cap-probe lists unpaired modules

A recorded ten-page hands-off run passed all four gated archetypes at both widths, but three of its six register
entries and most residual pixels came from one cause — the substituted brand face; a per-visitor bar shifted
every live measurement; and two probes misbehaved: cap-probe failed a module pair that compared two different
things, and content-diff read hidden image placeholders as missing icons.

- **replica follows deploy § 4 principle 2 from the archetype on (#138, extends #80).** The source's brand faces
  are self-hosted as-is (the files the live site serves, same weights and styles); the brand family stays first in
  every stack and a metric-matched substitute is only the fallback entry; proprietary faces raise deploy's
  licensing alert (banner, `fonts/LICENSING.md` at delivery, the hand-off message) plus ONE deferred register entry
  for all of them. The substitute had cost calibration iterations (derived font files with digit-width and
  ascent/descent overrides) and still re-wrapped paragraphs (+56 px on one archetype, line-count changes on
  others). The gate's pass bar treats a font fork as a defect (usually a face that did not load), never a justified
  substitute; the eval's `font_policy` criterion follows.
- **chrome-parity `--hide <sel,…>` and `--presence <file> --slug <slug>`** remove in-flow per-visitor regions (a
  location-suggestion bar above the header) on both sides after the settle, before measuring, and record them
  (`hidden live:` / `hidden build:`, JSON `hidden`); `--dismiss` clears overlays only. The bar had read as −88 px
  at 1440 and −268 px at 360 on all chrome text, logged as a residual on every archetype. chrome-parity imports
  playwright lazily (its `--help` and pure parts need no browser) and has a contract test.
- **The hide is a style rule too.** live-session's shared `hideRegions` hides every match inline AND injects one
  `<style data-stardust-hide>` rule per selector (one adopted stylesheet when a CSP blocks inline styles), so a bar
  the page re-renders after the hide pass stays hidden; chrome-parity uses it. Hardening: a bar the page renders
  after the hide pass escapes an inline-only removal.
- **One hide list for the captures, the probes and the header contract.** stitch-shot, content-diff, visual-diff,
  content-presence and clip-probe take `--hide <sel,…>` (two-sided probes apply the same list to both sides) and
  print/record what was hidden; presence.json gains `hide` per slug and `"*": { "hide": [...] }` for a site-wide
  bar. gate.sh merges its `--hide` with presence.json `hide` (its own regime's table first) for both captures and
  every probe but unit-geometry (chrome-parity: `--hide` + `--presence`), records the list in `live.json` and
  retakes `live.png` when it changed (or, hiding regions, when no `live.json` records it); gate-all reads only
  presence.json `hide` (both stitches, content-presence, clip-probe; rows record `hide`, origin/eds.json the
  stitch's hidden line). chrome-explore hides the list after every load and records it (`--hide`,
  `--presence --slug`); chrome-compare takes the expected list and raises one `hide-mismatch` error when the
  records differ; qa's header check re-explores with the contract's list. A capture, probe or cache taken with
  another list is not reused automatically; keys gain the list only when it is non-empty. content-diff removes
  the matches from the DOM (its inventories read `display:none` text).
  Recorded: the first delivered page passed only through a documented override — 1440 7.82 % / Δh 88 px, 360
  22.78 % / Δh 268 px, both the bar — and the header contract could not be compared at 360 because the bar hid
  the header from chrome-explore.
- **gate-triage's parity runs hide the gate's regions:** the gate's presence.json (`--presence --slug`) and the
  row's `hide` reach chrome-parity; `triage.json` records `parity.hide` and `_provenance.presence`, the md line
  names what was hidden. Recorded: triage's parity groups reported the bar's offset as a property delta.
- A malformed presence.json reads `presence.json <file> unreadable (…)` (chrome-parity said
  `--presence <file> unreadable`), exit 1; gate.sh now stops any round on it before capturing.
- **cap-probe lists an implausible module pair as `○ unpaired`** — widths differing by more than 40 % of the wider
  AND different cap elements (tag or role) — instead of failing it; the verdict line names
  `modules scored <s> of <n>[, <u> unpaired]`; fewer than half paired → `INCONCLUSIVE` (exit 0, a note to check
  `--main` / `--build-main`), while a failing wrapper/content-cap row still FAILs. Recorded: a FAIL the agent had
  to label an artifact — module 4/4 paired a live pagination list (552 px) with a build media column (280 px).
- **content-diff reads a hidden image placeholder as a placeholder, never a missing icon.** A ≤ 64 px image that is
  not shown, has a placeholder signal (data: URI, small intrinsic size, aria-hidden, a loaded sibling with the same
  alt or file) and its full image loaded or declared is listed under `placeholder images` (attributes line, JSON
  `attrs.placeholders`); an image with no current source stays an icon. The emitter was content-diff — clip-probe,
  content-presence and visual-diff raise no 🔴 on a hidden image. Its `--live-cache` key gains an inventory
  version, so an older cache re-probes once. Recorded: a hub archetype ended with two structural 🔴 —
  `MISSING ICON` on ~20×11 px lazy placeholders inside hidden tab panels, inside links, invisible on both sides.

Minor in substance: the replica font rule changes behaviour (a substitute becomes a self-hosted brand face with a
licensing alert). Numbered 0.34.5 provisionally — 0.35.0 is reserved; renumber at PR time if main moved.
Without hides, captures are unchanged (a malformed presence.json now stops a gate.sh round, exit 1) and verdicts
move only through content-diff's placeholder rule, cap-probe's unpaired rows / INCONCLUSIVE and chrome-parity:
`gate.sh --full` and gate-triage pass an existing presence.json to it, which hides that slug's
`variable` regions — its argv, its `chrome-live.json` / stored-result key and its verdict can change. Records gain
`hide` / `presence` fields (gate.sh's `live.json` always records `hide`, `triage.json` its
`_provenance.presence`); content-diff's live cache re-probes once (inventory version) and its JSON `attrs` gains
`placeholders`. No threshold change.

## 0.34.4 — roster gates sized to their deadline; an older gate table never reverts a newer verdict

A recorded 100-page hands-off run lost about 58 minutes to discarded roster gates (run-bg's 900 s default deadline
killed a 99-page roster at 1440 that needed 2152 s) and reverted 8 passing pages by ingesting an older gate table.

- **`update-coverage.mjs --gate`: the newest row per page and width wins.** `delivery.gate` records `at` as when
  the row was measured (a whole-row reuse's `reused` time, else the table's `_provenance.writtenAt`), not the
  ingest time; `width` is the table's breakpoint, `atByWidth` the newest applied row time per width. An older row
  of either width is skipped and counted (`N older row(s) skipped`); a gate recorded before 0.34.4 never blocks a row.
- **gate-all names the cause of an empty selection** instead of `no deployed pages selected`: the state file it
  read, its page count, how many are `deployed` with a `liveUrl` (published) or have a `prototypePath` (prototype),
  an `--only` that matched none, and the hint to pass `--state` from the project root or deploy first; exit 1 kept.
- **A roster gate starts only when its deadline can hold it.** gate-all prints its estimate (25 s × pages × widths)
  on each run's first status line (stdout, `_run.log`). run-bg exports the job's deadline as `RUN_BG_DEADLINE_SEC`;
  below it gate-all refuses to start (exit 2, no verdict, nothing written), naming `--timeout <estimate>`.
  `run-bg.mjs start` without `--timeout` gives a gate-all job max(900 s, the estimate summed over its gate-all
  invocations), logged; an explicit `--timeout` and every other job are unchanged; both `--help` texts say so.
- **The cluster verdict line records `first pass 360: x/y`**: x of the cluster's y siblings (archetype out) passed
  on their first row at 360. `gate-triage.mjs --unit <cluster>` prints `first pass <w>: x/y` (stdout only); handoff
  contract § 3 row C, the `progress.json` verdict and the replica skill's C-deliver sentence carry it.
- **The scripts-index lint cap is 13 KiB** (was 12): the index is 12,600 bytes and keeps its rows at full text.

Patch: no verdict, threshold, criterion, gate-row or capture change; the refusal fires only when a job's deadline
could not hold the roster; `delivery.gate` only gains fields; the verdict gains one advisory count, no unit step.

## 0.34.3 — gate-triage: failing gate rows grouped by shared cause before the next pixel round

A failing all-pages table usually holds a few causes repeated across many pages. One advisory script names them
before the next fix round, so each cause is fixed once and re-gated over the pages it touches.

- **`gate-triage.mjs` groups failing gate rows by shared cause, diffs the failing region's properties and routes
  foundation causes to `foundation-requests.md`; it never applies a fix.** It reads each gate table
  (`summary.json` and `--only` runs, newest row per page, each row's source recorded) with the page's `pixel` /
  `clip` / `content` / `units` evidence, the coverage share map and the unit families; files every failing row
  under `block:<name>`, `encoder:<template>`, `layout:<template>` (re-prototype candidate) or, from the property
  diff, `token:<property>`; runs `chrome-parity.mjs --no-defaults --region … --live-cache` once per group
  representative (at most 4 per run across all gate dirs; `--no-parity` skips it); names each group's re-gate scope
  (never smaller than its rows) with one `gate-all.mjs --only` command per eds host the pages were measured on;
  writes `triage.{json,md}` into each gate table dir, byte-identical on a re-run. Frozen-foundation causes become
  one `foundation-requests.md` line per width in the contract's format (a cause@width is queued once; a line whose
  property diff did not run says so, and a later real diff is queued once beside it; non-frozen shared blocks stay
  cluster fixes). Foundation causes are re-gated at C-final, after the queue is applied; with
  `stardust/rollout/units/<unit>.paths`, a cause with no row on the unit's pages reads "another unit's". On a
  recorded hands-off run's tables it filed 105 of 108 failing rows (97.2 %) under 21 shared causes.
- **replica Phase 5, handoff contract § 3 row C and the failing-row paragraph name it as advisory:** run it
  between fix rounds and act on causes with rows on your own pages; the rows stay the verdict, the 3-round cap
  and the foundation freeze stay.

Patch: a new advisory script and three one-sentence doc additions; no verdict, threshold, criterion, row or
capture change; the C-deliver wording is advisory, not a new required unit step.

## 0.34.2 — the source oracle holds still: fix rounds measure against this run's captured origin; browser budgets split

A fix round compares the build against the source capture its run already took instead of loading the source
again, the diff probes cache their live side the way chrome-parity always did, and browser jobs share one
machine-wide budget so parallel projects stop starving each other.

- **Fix rounds measure against the captured origin while it is fresh.** `gate-all --only …` (and
  `--recapture-eds`) reuse `<slug>/origin.png` and its presence inventory (`content-presence --origin-cache`)
  when they were captured in this run — at or after the last rollout `A-inventory` or replica `extract` start in
  `stardust/status.jsonl`; older captures are retaken once. Cross-run reuse is opt-in (`--origin-max-age <h>` /
  `STARDUST_ORIGIN_MAX_AGE_H`); `--recapture-origin` forces. Every reuse is recorded: the row's `originReused
  { from, at, policy }` and `presenceReused`, `origin.json`, `_run.log`. The published stage can also take the
  archetype round's `live.png` when its `live.json` matches gate-all's own stitch (URL, width, viewport height,
  locale, settle, built-in dismissal only) — in the documented order that capture (Phase 4) predates rollout's
  `A-inventory` start, so only under `--origin-max-age`. `--skip-existing` and a failed re-shoot keep the
  previous origin as a recorded reuse (`stale` plus a warning when it predates the run); a new origin capture
  drops the old presence inventory, and probes replay against a reused origin only when `probes.json` recorded
  it (`pair`). One policy for all of it in `diff/scripts/live-session.mjs`.
- **content-diff and visual-diff cache the live side like chrome-parity** (`--live-cache <json>`): the source
  side's inventories, or metrics and screenshots, under the same freshness rule and an exact key; the build side
  is always measured. `gate.sh --full` passes `content-live.json`, `visual-live.json` and `presence-live.json`, so
  later rounds of a run make no live navigation for those three probes. A blank or failed source render is
  measured but never cached, and retaking `live.png` drops the three caches. visual-diff answers `--help`
  without playwright installed.
- **gate-all `--one-load` (opt-in): presence, clip and unit inventories from the same settled load it stitches.**
  `stitch-shot --inventory` takes them at the top of the settled page, before the freeze; gate-all builds
  `content.json`, `clip.json` and `units.json` with the probes' own report builders, both sides on headed real
  Chrome — one navigation per side per page. A side without a usable inventory falls back to the standalone
  probes, logged and recorded (`oneLoad`); a fix round keeps only a one-load origin.
- **A machine-wide browser semaphore; origin and EDS pools have separate budgets.**
  `stardust/scripts/browser-lock.mjs` (ported from the `stardust/next` branch, attribution in its header;
  adapted: atomic slot handling — a slot file still being written counts as held, so two jobs racing for the
  last slot no longer both keep it) keeps one slot file per browser job under `~/.stardust/locks/browser/`
  (`STARDUST_BROWSER_SLOTS`, default 3, `0` = off). `run-bg.mjs` takes one slot per browser job and releases it
  when the job ends (`--lock` / `--no-lock` override); the job's children run inside it. A job waits for its slot
  queued, without a limit unless `STARDUST_BROWSER_WAIT` (seconds) is set — then exit 124, no verdict; a CLI
  holder keeps the 600 s default. gate-all's pools stay origin 2 (the source's bot budget) / EDS 4 / probe 2
  inside a slot: a slot bounds jobs, not browsers, and raising the EDS / probe pools (no bot risk) raises the
  job's Chromium peak. The master skill's write boundary names the lock dir.
- **unit-geometry's origin cache is per width** (`stardust/current/measure/<slug>-units-<w>.json`, URL in the
  key, same freshness rule): a 360 round no longer reads the 1440 origin inventory. A hit reaches the gate-all row
  (`unitsReused`) and `_run.log`.
- **gate.sh pins the capture locale and records `live.json`.** Both stitched captures run `--locale en-US`, as
  gate-all's do; a live capture writes `live.json` (URL, width, locale, settle, dismissal, capture time).

Patch: defaults unchanged except recorded same-run reuse of source captures on fix rounds (gate-all `--only`,
later `gate.sh --full` rounds) — the archetype gate's rule (one live capture per run, reused across iterations)
extended to the probes and to gate-all, bounded by the run's start line and recorded per row. Nothing else moves a
measurement: no threshold, criterion or pairing rule changes; the locale pin applies to both sides; the lock
only queues jobs (gate-all's pools unchanged); `--one-load` and cross-run reuse are opt-in; the new row and JSON
fields are additive (`originReused`, `presenceReused`, `unitsReused`, `oneLoad`, `liveCache`, `originCache`,
`pair`, `live.json`).

## 0.34.1 (stardust/replica-speed-instruments) — replica speed instruments: measure the run, stop paying for the same evidence twice

One new instrument shows where a run's tokens go; the gate, the deploy batch and the B2 dynamics probe stop
re-measuring evidence they already hold, and skip it only while it is provably unchanged.

- **`stardust/token-ledger.mjs` (ported from the `stardust/next` branch): advisory token usage per phase and per
  recorded unit.** It reads the session transcripts and writes `stardust/usage.{md,json}`: one row per ledger phase
  and per recorded C-deliver / migrate unit (unit timestamps read as instants, any ISO offset). `usage: unknown` when
  no transcripts are reachable; exit 0 except usage errors (exit 2).
- **gate-all `--skip-existing` replays a page's probes while its capture pair is unchanged.** Content presence, clip
  and unit geometry are replayed from `<slug>/probes.json` only while both captures they were taken against are the
  ones on disk; `--recapture-eds` / `--recapture-origin` invalidate them; the row says `reused`.
- **One published gate per unchanged build.** Rows carry a `gateKey` (frozen-foundation manifest, shared and page
  blocks with what they import, the page's document and every nav, footer and fragment document, the gate's
  criteria, sidecar entries and instruments with the modules they load), issued only while the gated host serves
  that tree (every hashed code path pushed on the host's branch and repo; documents equal to their delivered
  deploy-ledger `contentSha` for that org/repo). Under `--skip-existing` a PASS row with the same key is reused
  whole, and an EDS capture only while `<slug>/gate-key.json` proves it current (the same key, or — key unknown —
  the same hashed tree, reason and ledger rows); any other EDS side is re-shot. The C-archetype unit's
  `gate-all --only` row is the archetype's published row of record;
  cluster and C-final runs pass `--skip-existing`, and C-final re-freezes the foundation after applying the queued
  requests, before the roster gate.
- **The overflow assert reads the stitched build capture's own output.** `stitch-shot.mjs` prints an
  `overflow: scrollWidth=… viewport=… delta=…` line and `gate.sh` reads it instead of launching `measure.mjs` — one
  Chromium launch and navigation fewer per gate round; the verdict lines and `GATE_OVERFLOW_TOLERANCE` are unchanged,
  and `measure.mjs` stays the diagnosis tool. `stitch-shot.mjs` answers `--help` without playwright installed.
- **No timed late-modal window on EDS build and preview hosts.** One dismissal sweep, after the EDS delayed phase has
  fired, so a consent manager the build enables is still dismissed; live source sites keep their poll.
- **deploy-batch skips a live page only when its document is byte-identical to the one it delivered to the same
  org/repo** (`contentSha`, `verifiedOn` in the ledger). A changed document, or a page last delivered to another
  org/repo, re-deploys without `--force`, which now only means re-publishing identical documents. A page verified
  within `--verify-max-age` minutes (default 60) is skipped without a request; older ones are re-verified inside the
  pool. Ledger rows written before this version re-drive once.
- **B2 reuses a fresh `_dynamics.json`** (`dynamics-detect.mjs --reuse-if-fresh`): written after the run's
  `A-inventory` start, with the same probed URLs and rollout roster and every page loaded without error; `--fresh`
  re-probes; every reuse is appended to its provenance.

Minor: one contract step is new — C-final re-freezes the foundation after applying `foundation-requests.md`, before
the C-final roster gate. No threshold, criterion or pairing rule changes; the new row fields, sidecars and ledger
fields stay additive (`gateKey`, `reused`, `probes.json`, `gate-key.json`, `contentSha`, `verifiedAt`, `verifiedOn`);
every skip is recorded where it happened.

## 0.34.1 (stardust/rollout-block-origin) — block provenance: the export carries the source selector of every delivered block (#136)

Field learning: a client adopting a recorded hands-off run's export had to re-derive where every delivered block came
from in the source page. The contract had declared source selectors absent (the source snapshot named the page, not
the element), so nothing in the export said which element a block was built from.

- **`rollout/block-origin.mjs`** writes `stardust/rollout/workspace/mapping.json` (`formatVersion` 0.1.0): per
  template its sections, aligned across its pages with one selector that generalises over them and the pages where it
  hits that page's own section, and for every delivered block instance its coverage `pos` (the key a client matches it
  to the page's blocks by; each template block lists its `positions`), the CSS selector of its origin element in the
  page's captured source DOM, a confidence (the share of the block's text the element holds; image alt text never
  counts) and its source: the template's encoder map first (by default `stardust/import/<templateId>/vocabulary.json`,
  where the encoder writes it, when `stardust/import` exists, else under `stardust/migrate/encode`; `--encode`
  overrides, and a status line names the directory used) where it selects the block's element (a block it does not
  falls through), else text alignment, else, for a block whose text is not found (an image-only one, say), its
  position (confidence 0): a child of its section's element, else next to the nearest anchored neighbour, never
  another record's element, or no selector. Selectors are derived from and checked against the capture as stardust's
  own parser reads it, with no browser. Pages and blocks it could not map are listed under `skipped`; a section with
  no encoder-map or text-alignment anchor on any page (placement by position does not anchor) gets a null selector and
  no pages; keys are sorted and `generatedAt` is copied from the coverage, so unchanged inputs give the same bytes.
- **`--verify`** re-reads every capture and records per instance whether its selector resolves to exactly one element
  (`verified` true or false; without the flag null, recorded as skipped). It checks uniqueness, not that the element
  is the right one.
- **The rule:** clients read selectors only from mapping.json and only when its sha256 is listed in manifest.json
  outputs; a mapping whose `generatedAt` differs from pages.json's is stale. `workspace-manifest.mjs` hash-lists
  `workspace/mapping.json` under `outputs` when present (and so in `_provenance.readArtifacts`); nothing else in the
  manifest changes.
- **The export step** (Phase I, opt-in, non-gating) runs `block-origin.mjs --verify` before the final
  `workspace-manifest.mjs`. `reference/coverage-contract.md` gains "mapping — the source side" and no longer
  declares source selectors absent; schema `schemas/rollout-workspace-mapping.schema.json`. rollout `lib.mjs` gains
  `walkDelivered` (the delivered records with their nodes); `parseDelivered` returns what it did.
- No gate changed: verdict criteria, the capture discipline, the foundation freeze and `done-check` are as they were.
- Folded: the contract's exit-code list and judgement-draft details point to the scripts' `--help`.
- Tests (synthetic fixtures) cover text alignment, the position fallback, encoder maps, `--verify`, skipped pages and
  records, byte-identical re-runs, the schema and the project-copy layout; the manifest test covers the new `outputs`
  entry and that nothing else changes.

## 0.34.0 — coverage is the contract: the delivered block structure, versioned coverage files and one shared page-block shape (#133)

Field learning: a hands-off replica of a travel-brand site (64 pages in 11 locales, 8 templates, 12 blocks) ended
with a working site but nothing a catalog-driven migration tool could continue from. That tool would analyse the
live source again, generate blocks next to the delivered ones and restyle the site. Everything it needed except
screenshots and source selectors was already in the run's committed artifacts, but scattered, and in shapes only
stardust reads.

The fix extends the coverage rollout already commits, for three reasons. No client has shipped against these files
yet, so they are versioned 0.x (`formatVersion` 0.1.0); the rule that a minor release only adds fields applies from
1.0.0, declared once a client ships. Nothing is restated in a parallel file: the new data, each page's blocks in
document order with their option classes and sections, read from `content/`, lands in coverage. And there is one
shape: a page's blocks use the spec skill's record (`pos`, `block`, `variant`, `kind`, `section`, as in its
`page-blocks.jsonl`), with rollout's extras (`sectionPos`, `classes`, `variantId`, `rows`, `cells`).

- **`pages.json` `delivered`** (`inventory.mjs`, `--content <dir>`): per page, the blocks in document order, each
  block with its option classes, variant id and row and cell counts, and the default content between blocks as one
  `default` record; the sections with their style; `lang`, the source snapshot and a content hash. It is null while a
  page has no content file. Existing fields are unchanged.
- **`templates.json`** rows gain `type`, `representativeUrl` and `urls` (the template's source URLs, representative
  first).
- **`blocks.json`** module rows gain option classes (the delivered ones and those in the block's CSS), variants with
  stable ids (a hash of the block name and its classes; an id from the prior coverage is carried forward), a
  description from the block's JSDoc, its contract from the conversion log and a base type (`unknown` when none
  matches); `blocks.mjs --blocks <dir>`.
- **`formatVersion` on every coverage file**, documented in `reference/coverage-contract.md`: clients ignore fields
  they do not know, ignore identity fields and resolve identity from the repository they open. Unchanged inputs
  rewrite nothing, so two runs leave coverage byte-identical.
- **Opt-in `workspace-manifest.mjs`** writes `stardust/rollout/workspace/manifest.json`: hashes of the coverage files
  and of what they were built from (content, block code, judgement), and the handover state. It refuses coverage
  older than its inputs (content, block code or the judgement changed since inventory or blocks ran). Once the content
  is no longer tracked, because a client took the project over, it writes nothing and exits 3; `--force` overrides.
- **One short judgement** (`judgement.json`, drafted by `--draft-judgement`): template names and descriptions, base
  types, purpose and reuse guidance for custom blocks (8 templates and 8 custom blocks on that site). Its names and
  base types land in coverage; without it the page type and `unknown` stand.
- **Opt-in, non-gating:** runs in Phase I after `dashboard.mjs` only when `rollout.json` `exports` lists
  `migration-workspace` (`inventory.mjs --export migration-workspace`). There is no new ledger phase, `done-check`
  is unchanged, and a failure goes into the `I-dashboard` end line. It also runs alone on any delivered repo before
  handover.
- Folded: the dashboard's stage rules, legend and badges move to `dashboard.mjs --help`.
- Tests cover the `delivered` parse (sections, merged default content, chrome skipped), variant ids and their carry
  forward, the new template and block fields, every coverage file against its schema, no new identity, byte-identical
  re-runs, the stale-coverage and handover refusals, atomic writes and the opt-in key.

## 0.33.1 — consent overlays are dismissed on gate captures; the archetype ledger keeps its shape

Fixes from a recorded hands-off replica run on a site with a consent manager, verified against its artifacts.

- **`replica/scripts/gate.sh` dismisses overlays on its captures the way its probes do.** The probes ran under
  `--dismiss` while the stitched live capture had no way to receive a site-specific selector: the run captured
  the live side with the consent banner and its scrim up, and the first pixel rounds measured them as page
  difference (18–50 % hot bands) until `live.png` was re-taken by hand. Both captures now run the shared
  dismissal by default, `--no-dismiss` turns it off everywhere in the round (new on `stitch-shot.mjs` as well),
  and `--consent <sel>` / `--dismiss <sel,…>` — stitch-shot's own vocabulary — reach both captures, the diff
  probes and chrome-parity; `--no-dismiss` with either is a usage error. `diff/scripts/live-session.mjs` knows
  the `cmp`-prefixed consent-manager buttons, so that manager needs no flag; its candidate list has a test.
- **`stardust/replica/progress.json` is the map of every archetype — never one archetype's record.** The
  residual-logging example in `replica/reference/source-fidelity-gate.md` showed a bare
  `{pageType, archetype, breakpoints}` object, and the run wrote exactly that as the whole file, destroying the
  `types` map, the `siblings` / `migrate` blocks `gate-evidence.mjs` writes and the `_provenance` block the resume
  and unit-boundary readers depend on. The example now shows the record inside `types.<archetype>` beside those
  blocks, with the rule that the file is extended per entry; `gate-evidence.mjs` wraps a ledger whose top level
  is one archetype's record under `types.<archetype>` (lossless, noted in its output) and refuses only a record
  that names no archetype; a ledger with a `types` map is never second-guessed; with a test; `replica/SKILL.md`
  names the keys.

## 0.33.0 — martech: the source's Web SDK is read and offered as an `aem-martech` switch, off

Field learning: a full run on a consumer-brand site on Launch + Web SDK carried the tag stack over, but
the hand-off only said "aem-martech is an owner project". It gave the owner nothing to act on. The Launch library
already held everything the plugin needs: orgId, the Web SDK instance, edge CNAME, datastreams (two, chosen
by a data element per brand domain), and a self-hostable 2.34.2 extension. It also showed 129 data-layer rules
that only fire if the new pages push the same events. None of it was read.

- **`spec-martech.mjs`** reads the Launch orgId and the Web SDK extension: version, self-hosted support, library
  type, and each instance's edge domain, `defaultConsent` and datastream ids (resolving a `%data element%` to the
  ids it holds). Rules now record their event types.
- **`vendors.json`** gains a Web SDK row (`adoberesources.net`, `alloy.js`) carrying the `aem-martech` plugin
  facts: repo, path, default edge, the source's default consent, required Launch extensions.
- **`martech-contract.json`** gains `aemMartech`, always `enabled: false`. Its config comes from that evidence.
  Ambiguous datastreams stay null, with the candidates listed. A rebuild keeps the owner's choices.
- **`martech-handoff.md`** adds a data-layer section for any tag manager: the data-layer globals to keep, Launch
  rules with their push events and a count per event, the tag managers whose rules were not parsed, and a request for
  the owner's tagging plan. `spec-martech.mjs` saves every other tag-manager library (GTM and gtag by container id,
  read from inline snippets; Tealium, Ensighten, ... by src) to `martech/tags/`; the model reads them into the
  contract's `tagNotes` in Launch's shape (rules, data elements, consent groups, each citing `from`), which survive a
  rebuild and render in the same rewrite, data-layer and consent sections, marked as read by the model. The consent
  model comes from parsed evidence only; the model's reading is listed as evidence and never changes it. A Google
  Consent Mode default (inline `gtag('consent', 'default', …)`, or a saved library that sets one) is saved to
  `martech/consent-mode.json`; inline on the pages, it makes the model `google-consent-mode`. A custom GTM data-layer name
  (`l=`) is kept. Its header adds `dynamics-check.mjs` after the scaffold re-run. It also adds a Web SDK
  section: the values found, the consent default to keep (`in` on the source, `pending` in the plugin), missing extensions, and the four switch steps.
- **`martech-scaffold.mjs`**: with `aemMartech.enabled`, it loads the CMP, then `initMartech`/`martechEager`;
  `martechLazy` runs from `loadLazy()` after `loadFooter`, as the plugin documents, so page views do not wait for
  the delayed phase; `martechDelayed` loads the Launch property through `launchUrls`. A category starts the Web SDK
  `pending` whatever the source value and grants `collect` on consent.
  The scaffold refuses missing values, a missing `plugins/martech`, or the same property also enabled as a route.
  Off, the output is unchanged byte for byte.
- **Target** is read the same way: the at.js extension (or a page-level at.js) and the Web SDK rules that render
  decisions. The contract gains `target`, off, and the hand-off a Personalization section. With `target.enabled`,
  the scaffold sets `personalization`, only on top of `aemMartech`. at.js activities stay an owner move.
- **`dynamics-check`** treats the edge host as a route: forbidden on `/`, gated with a category, and expected on
  accept once enabled.

## 0.32.1 — spec knowledge, wave 4: what a reviewing client had to guess

Wave 4 of how clients use a spec's `stardust/spec/knowledge/`. A spec viewer that lets people review the spec
inferred four facts with a model or recomputed them; the judgement now records them. All four fields are additive, so
older judgement files still build (the fields read null).

- **`open-questions.json` `default_option`:** the index of the option the default is, or null when the default mixes
  or conditions options. A reviewer sees the default as a selected option without matching prose to labels. On a
  sports-federation run, 23 of 28 defaults are one of their options. An index outside the options stops S10.
- **`blocking` is defined:** confirm the default before launch, because a different answer means rework. The work
  proceeds on the default either way; read as "work waits", it contradicted "every open question ships a default".
- **`findings.json` `chapter` and `rank`:** where a finding belongs in the spec's story (`start`, `pages`, `build`,
  `dynamic`, `risks`, `decide`) and its rank there, so a client places the agent's interpretation next to the numbers
  it explains and leads with the most important one. An unknown chapter stops S10.
- **`redirects.jsonl` `needs_entry`:** 1 on a `migration` row whose path changes beyond the `.html`, index-name and
  trailing-slash rule. On the sports-federation run, 5,287 of 12,072 migration rows need their own entry. The
  template's redirect finding counted all of them; it now counts `needs_entry=1`.
- `templates/open-questions.json` gives every generic question a `default_option`; `templates/findings.json` shows
  `chapter` and `rank`. Tests cover the four fields and the two stops.

## 0.32.0 — the header is a contract: its behaviour is recorded from the source and gated before done (#132)

Field learning: several runs shipped headers that passed every pixel and style gate while every menu was wrong. They
had boilerplate one-level click dropdowns for hover mega menus, search and cart as plain links, and a static list for
a drill-down drawer. Every visual instrument sees the header at rest, with the pointer parked and motion frozen. Deploy
told the agent to keep the stock header's interaction code and treat the prototype's menu script as a visual reference.
Nothing in the final verdict looked at the header.

- **`diff/chrome-explore.mjs`** records the header by using it, at 1440 and 390. It hovers (desktop), clicks and
  opens from the keyboard every control, and records each opened state: links, headings, crop, `aria-expanded`,
  focus, scroll lock, motion, and close paths (Escape with focus return, outside click, toggle, pointer leave). It
  descends into tabs, flyouts and drawer levels within a budget, and a hit is reported. It types into search to record
  typeahead and the URL the submit lands on, and samples the header scrolled down, up and back. Navigations are
  answered 204, so the page never leaves.
- **`diff/chrome-compare.mjs`** is the header-parity gate. It exits 2 on any of these:
  - a missing control or state (hover rebuilt as click included);
  - missing panel links or headings;
  - keyboard behaviour, `aria-expanded`, close paths or scroll lock that differ.

  The `replica` profile adds open-state crops (2 % bar, with the crop gate's texture so a font substitution is
  visible), motion (every duration within max(80 ms, 25 %)) and scroll states. `functional`, for redesign and reskin,
  checks behaviour and content.
- **Only the site owner clears a finding**, in `stardust/chrome/header-decisions.json`; an entry signed by an agent is
  ignored and reported.
- **Wiring:**
  - extract `--prep` records the contract (`stardust/chrome/header-contract.json`) and puts its summary in the prep
    summary;
  - deploy Step 6 builds the header from the contract, with the stock code as the accessibility floor and large panels
    as nav fragments;
  - deploy Step 10 and replica C0 gate the foundation on it;
  - `done-check` gains `header_parity` for migration projects (contract, a fresh comparison of the flow's profile at
    every contract width on the live host, no undecided error);
  - qa gains a `chrome` check;
  - `dynamics-plan --chrome` adds a row per control family (cart and account decide their backend, the UI ships);
  - spec S9 explores the home header and knowledge gains `header.json`, its size per width.
- **The replica eval** gains `header_contract_recorded`.

Field run (a museum network's home page, a new EDS site):
- **The contract:** at desktop, 6 click mega menus and a search overlay (14 states, 35 links); at mobile, a drawer with
  a search form and 6 accordion levels (14 states, 37 links). It took about 5 minutes for both widths.
- **The stock EDS header** with the same nav content got 37 errors. Every accordion was flattened into one open list,
  search was a link, nothing had motion, the header was 64 px instead of 201 px, and the crops differed by 62–91 %. It
  correctly passed the desktop click, keyboard and close behaviour the source shares with the boilerplate.
- **A header block built from the contract** reached 0 errors under `functional`. Under `replica`, 7 open-state crops
  remain at 2.1–3.9 %. They come from the licensed brand face replaced by a system font: an owner decision.
  `done-check` listed them as `header_parity:7` and qa reported the same.
- **The field run fixed the explorer:**
  - a `<nav>` carrying `aria-expanded` was taken for a control;
  - items scrolled out of a scroll container read as hidden;
  - icon words in `aria-label`s and transparent-font icons broke pairing;
  - POST search forms were not followed to their results URL;
  - crops took the links' parent instead of the panel box;
  - one duration per property lost a second animated element.

## 0.31.6 — spec knowledge, wave 3: what a migration still had to recover from raw files

Wave 3 of how other skills use a spec's `stardust/spec/knowledge/`. These are the facts consumers still could not
get from the committed knowledge.

- **`urls.jsonl` `blocked`:** why an `error` row was not read (`challenge`, `refused`, `network`, `archive-miss`).
  Gate 4 probes those instead of treating them as dead. On the museum field run: 61 `challenge`, 2 `network`, and
  no `error` row without a reason.
- **Search probes** carry `feature`, `path` and `param` (the source search URL). `dynamics-plan --knowledge` drafts
  `dynamic-features.generated-parity.json`: one `search-query` check per probe, with the source's expectations and
  `resultSelector` left to the curator.
- **`martech.json` `evidence`:** spec-martech's `launch.json` and `onetrust.json`, unchanged. `martech.mjs
  readEvidence` accepts a knowledge folder. On a sports-federation run (about 12,000 pages), the martech contract
  from knowledge is identical to the one from the raw folder: OneTrust, 4 routes, 58 rewrite rules.
- **`archetypes.json`** (decision P3, step 2):
  - within each template, the layout variants covering 80% of its pages are page types;
  - the larger tail folds into the template's largest type;
  - a one-page variant or template is `unique`;
  - each type has one `rep_url`, so migrate's one-archetype-per-type rule holds;
  - extract `--prep` takes its types from it, and prototype `--prep`, replica and reskin take their representative.

  Every live page is placed exactly once: 29 types for 12,072 pages; 11 for 89 on the museum run, where the
  exhibitions listing became `unique` instead of borrowing the exhibition-page archetype.
- **Rollout pages record `sourceUrl`** (from the sidecar, else `state.json` by slug; schema updated). qa
  `from-knowledge` and `seed-redirects` join coverage by it, so a renamed page still matches.
- **qa routing** checks every expected redirect: a `stardust/redirects.tsv` row absent from the live
  `/redirects.json` is `redirect-missing` (error); a different destination is `redirect-dest-differs` (warn).
  Live, a planted missing row was reported, and the real 5 rows passed.
- **Additive fields:** `knowledge.md` now states that a patch only adds fields and clients ignore the ones they do
  not know; removing or renaming a field is a minor release.

## 0.31.5 — spec knowledge seeds dynamics, qa, rollout and the archetype pickers

Wave 2b of how the other skills use a spec's `stardust/spec/knowledge/`: each consumer reads it when present and
never requires it. Reading adds no wall time.

- **dynamics** (`dynamics-plan.mjs --knowledge [dir]`): the spec's curated features become draft rows. They keep
  the axes as judged (S10 checks them against the dynamics vocabulary). Their decision is the linked open
  questions' answer, or else the default. It also works without a detector run. A `decided-out` row with no
  recorded owner answer is flagged (`triage.md`). Phase 1's search probes: a spec's `search-probes.json` already
  holds them.
- **qa** (`qa/scripts/from-knowledge.mjs`, new): writes two inputs.
  - `stardust/template-map.json`: the inventory by layout variant at served URLs, delivered pages only when
    rollout's coverage exists.
  - Allowlist entries for links the source already had broken, as authored and as served.

  On a sports-federation run (about 12,000 pages): 114 variants and 1,251 source-inherited 404s that would
  otherwise read as migration defects.
- **rollout:**
  - D2 starts `helix-query.yaml` from the spec's draft;
  - Gate 4 reads dead (`http-*`, `redirect-broken`, `loop`) and bodyless source pages from `knowledge/urls.jsonl`
    instead of probing them. An `error` row was never read (on the museum field run, 63 pages behind a bot wall),
    so it is still probed.
- **Archetypes:** prototype `--prep`, replica Phase 3 and reskin default their representative page to the spec's
  `rep_url` of the type's largest layout variant.
- **Prose:** rollout's query-index paragraph restated `dynamics/reference/listings.md` § Getting an index at all
  step by step; it now points there.
- **Field run** (10 pages of a museum site on a new EDS site, with these scripts):
  - spec's draft `helix-query.yaml`, committed unchanged, indexed all 10 pages;
  - `dynamics-plan --knowledge` added 8 spec rows to 46 detector rows, all within the dynamics vocabulary;
  - qa's sweep with the derived template map ran on every delivered page.

  It also found three bugs, fixed here:
  - **qa missed the 0.31.4 folder-index rule.** It fetched `/x` and `/x.plain.html`, but a folder index lives at
    `/x/` and `/x/index.plain.html`. The inventory now keeps each page's served `url` next to its key, and its
    slash probe checks that a folder index still answers at `/x` (the redirect spec records) instead of expecting
    a leaf's `/x/y/`, which 404s by design.
  - **`seed-redirects` wrote redirects into pages of later waves.** qa reported 5 redirects landing on 404s. With
    rollout's coverage, only redirects to delivered pages are written; re-run the seed after each wave.
  - **Gate 4 would have dropped pages a bot wall hid.** It counted outcome `error` as dead, and all 63 such rows on
    the museum site were pages behind the bot wall.

## 0.31.4 — a folder index lives at `/x/`: sitemap, probes and links follow EDS

EDS serves a folder index (`x/index.html`) at `/x/`, and `/x` 404s on a plain site (one site seen adds a 301); a leaf page lives at `/x/y`, and
`/x/y/` 404s (checked on a live origin). Stardust's rule was "never a trailing slash", which is right for leaves
and wrong for folder indexes. Three consequences:
- the rollout sitemap listed every folder index at a URL that 404s;
- `done-check`'s live probe (`HEAD`, no redirects, 200 only) counted every delivered folder index as not live;
- `localize-links` wrote folder-index links that 404, and delivery-lint flagged the correct `/x/` as a P1;
- spec could not tell a folder index from its source path, so its redirects pointed at `/x`.

- **Rollout** (`lib.mjs publicUrl`): `pages[].path` stays the key; a page whose migrated file is `…/index.html` is
  published, fetched and probed at `path/` (`assemble.mjs` sitemap, `verify.mjs`, `loadPageHTML`, `done-check`).
- **`localize-links`** writes the served URL (`eds-path.mjs deliveredUrl`): `/x/` for a folder index, `/x/y` for a
  leaf; redirect destinations resolve the same way. Matching still uses the lookup key.
- **delivery-lint** judges a trailing slash by its target, with the content tree (`--content`, default `./content`):
  - a leaf's slash stays P1;
  - a folder index's slash passes;
  - a folder index without it is a new P1, `folder-index-slash` (it 404s);
  - a target outside the tree is a P2 advisory.

  First test file for the lint.
- **Docs:** the rule ("no `.html`; a slash only on a folder index") replaces "EDS 404s on `/x/`" in deploy and
  rollout.
- **spec** (`servedUrls`): a page with pages below it is a folder index, so its `eds_path` is `/x/` and a migration
  redirect `/x` → `/x/` is recorded (a plain EDS site 404s on `/x`).
- **Field rollout** of 10 pages (4 folder indexes) on a new EDS site: every sitemap URL, `done-check` probe and
  localised link answers 200; `/x` without the slash 404s, as above.

## 0.31.3 — one delivered-path contract; spec redirects seed rollout

Five path rules disagreed on the same input: spec's `edsPath`, rollout's path-safety lint, deploy's `canonicalPath`
and its copy in `davids-model-lint`, and rollout's own delivered path. `/a/index.html` gave `/a/`, `/a/index.html`
and `/a`. Checked on live EDS sites: a folder index is served at `/a/` (`/a` 404s on a plain site, `/a/index` too), a leaf
page at `/a/b` (`/a/b/` 404s), and `.html` 404s.

- **`deploy/scripts/eds-path.mjs`** (new, pure): `deliveredUrl` (spec's rule, now also collapsing `//`), `daPath`
  (`/a/` ↔ `/a/index`) and `pathKey` (the lookup key). spec's knowledge, `localize-links` and `davids-model-lint`
  import it, so the two `canonicalPath` copies are gone. spec's Setup copies the deploy scripts too.
- **`rollout/scripts/seed-redirects.mjs`** (new): when a spec exists, Gate 3 first appends its redirects to
  `stardust/redirects.tsv`:
  - every source URL that changes on EDS;
  - the source's own redirects, pointed at the delivered page.

  Rows already there win; external targets, targets outside the knowledge and loops are counted and skipped. On a
  sports-federation run (about 12,000 pages) it seeds 12,312 rows, 241 of them existing redirects made one hop; on a
  museum run, 33.
- **Prose:** rollout's path-safety rules are written once, in `delivery-gates.md` § Gate 3; two recorded anecdotes
  in deploy's link-localisation paragraph are folded.
- **A field rollout** (10 pages of a museum site on a new EDS site) found two more:
  - `localize-links` rewrote links through any redirect, including the seeded ones to pages of later waves, so 8
    links would have 404ed. A redirect now rewrites links only to a page of the content tree; the rest stay absolute.
  - The redirects sheet never matches a source containing `:` or `%` (those requests 404 first; measured with probe
    rows), and 31 of the museum site's 33 seeded rows had one. `seed-redirects` writes those to
    `stardust/redirects-cdn.tsv`, as CDN rules.
- **Open (next release):** rollout publishes a folder index at `/a`, which 404s on a plain EDS site, and the link
  rules call a trailing slash a 404 although a folder index is served there.

## 0.31.2 — notes cleanup: two retired notes removed, dangling note citations dropped

`notes/` held two documents nothing reads at run time, and six skill docs cited notes that were never in
this repository.

- **Removed** `notes/deploy-improvements-archive.md` (the frozen deploy ledger, findings #1–#80) and
  `notes/multi-agent-distribution.md` (the 2026-09 multi-harness assessment). The `(#NN)` citations stay as
  provenance; `deploy/SKILL.md` § References now says how to read the ledger from git
  (`git show 940b8795:plugins/stardust/notes/deploy-improvements-archive.md`). The README and
  `replica/reference/handoff-contract.md` no longer point at either file.
- **Dropped citations of missing notes:** `notes/variant-convergence.md` (`prototype/SKILL.md`, the
  `composition-delta-trivial` fixture), `notes/migrate-template-canon-refactor.md`
  (`prepare-migration/SKILL.md`, `stardust/reference/artifact-map.md`,
  `stardust/reference/data-attributes.md`) and `notes/prototype-broken-by-default-detector-2026-04-29.md`
  (`prototype/SKILL.md`). The rules they backed are unchanged.

## 0.31.1 — spec knowledge, wave 1: complete redirects, the dynamics vocabulary, a scoping entry

A review of how the other skills can read `stardust/spec/knowledge/` found gaps in spec's own output, and small
readers that would fail on it.

- **Redirects** (`spec-knowledge.mjs`): a migration row for every page whose delivered path differs from its
  source path. A path that changed only by its `.html` had no row, yet EDS answers 404 on `.html` and rollout
  wants a sheet row for each. On a sports-federation run (about 12,000 pages) the rows grow from 5,287 to 12,072.
- **Feature vocabulary:** S10 checks class, disposition, reproducibility and status against the dynamics triage
  vocabulary (`TAXONOMY`, exported by `dynamics/scripts/lib.mjs`) and stops naming each value outside it. The
  field run's judgement used five values dynamics would have rejected later.
- **Router:** a flow-neutral scoping entry ("scope / estimate / plan / spec the migration of X" → `spec`, never
  stamps `flow`). "Build a migration plan" no longer routes to `replica`. A large site (1,000+ sitemap URLs, no
  spec) gets a one-line offer to scope it first; it is never run unasked. The two copies of the wrong-flow anecdote
  are folded.
- **Ledger:** spec's stages are phases (`s1-inventory` … `s10-knowledge`); spec writes its status lines.
- **`localize-links --redirects`** reads JSON Lines (`{src, target}`, spec's `knowledge/redirects.jsonl`) and the
  published sheet (`{data:[{Source, Destination}]}`). It reported 0 pairs from the first and threw on the second.
  First test file for the script.
- **`crawl.mjs --max 0`** means no cap. It silently became 25, so a `--all` crawl translated to `--max 0` kept 25
  pages.
## 0.31.0 — publish always; done is one verdict

Two contracts a hands-off run had to be told from outside the skill, because the skill left them open. Both
are now the skill's own.

- **Publish always** (contract change). The replica handoff contract said "Publish is a decision… stay
  preview-only until it is made", while rollout Phase C says publish in the loop. Which rule won depended on
  which document the agent read last, and nobody owned the decision under hands-off. Now every delivered page,
  the redirects sheet and the chrome documents go live (`PUT → preview → live`). The decision step and its
  `eds-conversion-log.md` record are gone, C0 and the cluster deploys no longer hold `--no-publish`, and the DA
  protocol's publish step is the default rather than optional. `deploy-batch.mjs --no-publish` remains for an
  explicit preview-only ask. Deploy's font-licensing hold (self-hosted proprietary faces) is unchanged.
- **`done-check.mjs`** (new, rollout). One completion verdict from the ledgers the run already writes:
  - `pages_unfinished`: coverage rows not verified.
  - `pages_failed`: failed rows, or a failed published-origin gate.
  - `pages_not_live`: delivered rows that do not answer 200 on the live host.
  - `open_p1`: the optimize gate's own count, source parity excluded.
  - `rollout_incomplete`: the last `I-dashboard` line is not an `end`.

  Exit 0 complete, 1 gaps, 2 usage. `--offline` skips the live probe, and `--json` prints
  `{ complete, gaps[], liveChecked }`. Every reader that needs "is the run done" previously re-derived it from
  the same files.
- **Replica handoff** writes `replica handoff end` only on `done-check.mjs` exit 0, and closes each gap with its
  own remedy (handoff contract § 5). A gap only the owner can close is a `blocked` line.
- **Bounded entry captures dynamics:** `extract --single --dynamics` (and `--pages … --dynamics`), because Phase 2's
  dynamic-surface gate needs the per-page reach signals that `--single` alone does not record.

## 0.30.3 — spec: knowledge files instead of a database; one rule format instead of SQL

`spec` ended at `spec.sqlite`, but no stardust skill read it. Its one client, a viewer application, loads it into
its own database, and the file carried that viewer's tables, onboarding text and HTML findings. The skill now ends
at JSON files clients read, and knows no client. **Contract change** (released as a patch): `knowledge/` replaces
`spec.sqlite`, and judgement rules replace SQL.

- **Output** (`spec/reference/knowledge.md`): `stardust/spec/judgement/` (the agent's decisions) and
  `stardust/spec/knowledge/` (computed by S10, `spec-knowledge.mjs`): urls, page blocks, blocks with variants,
  templates, variants, redirects, broken links, bad links grouped by target, features with their pages, martech,
  metadata, query indexes with a draft `helix-query.yaml`, locales, open questions, findings. Committed. Raw
  material, captures and crops stay in `stardust/.work/spec/`. On a sports-federation site (about 13,000 URLs)
  the folder is 37 MB, about 2.5 MB compressed.
- **Rule format** (`rules.mjs`, knowledge.md § Rules) for feature `reach`, question `impact` and `{{…}}` in findings:
  URL terms (`live`, `sitemap`, `block:`, `signal:`, `nested`, `verdict:`), filters with globs, `urls`, `count`,
  `sum`, keyed and `max:` lookups. A rule that cannot be computed stops S10. `sql:`, `url:` and `bvariant:` are
  retired; `block:` no longer implies the sitemap (write `sitemap block:x`). No SQL engine is left in the skill.
- **Answers** in `judgement/answers.json` replace a question's default in `knowledge/open-questions.json`; the
  default stays recorded.
- **No viewer concerns:** no viewer tables, no tour or header label, findings as plain `{ title, text, numbers }`.
- **Config** at `stardust/spec/spec.config.json`; `work` names the raw-material folder.
- **Shared instruments:** spec-martech classifies hosts with the dynamics skill's `vendorFor` (a missing table now
  fails instead of returning nothing); the index yaml follows the dynamics skeleton (description meta, image as a
  path, robots, the chrome and search excludes); Setup copies the diff and dynamics scripts, which S1, S2 and S9 need.
- **Verified** on two recorded runs. Every rule from their judgement files (150) gives its SQL value on the same
  data, apart from an empty sum (0, not null). On the 13,000-URL run, `spec-knowledge.mjs` reproduces all 25 sets
  of its `spec.sqlite`, and a database rebuilt from `knowledge/` matches it table for table (meta aside).
- **Field run** on a museum site behind bot protection (generic profile, headed tier, 300-URL sample): S1–S10 ran in
  the new layout from the Setup copies, and a client database built from its knowledge. The CDN turned the headed
  browser away after about 100 pages; the spec covers the 89 pages read, and a finding says so. It found three
  0.30.1 bugs, fixed here:
  - **Drupal names:** the generic namer took the first nameable class, so `paragraph` hid
    `paragraph--type--<name>` and every paragraph became one component. Block-style classes now win (`lib.mjs`,
    shared by parse and capture).
  - **S4 refusals:** a bot wall's 403 on a link counted as a broken link. `spec-links` records it as `blocked`, not
    a 404 (`blockedBy` moved to `lib.mjs`).
  - **S1 crawl:** the crawl kept `<link>` icons, fonts and manifests as pages (`NOT_PAGE` widened).
- **Existing projects:** move `<dir>/{inventory,fetch,parse,links,rum,martech,dynamics,media,sheets}` to
  `stardust/.work/spec/`, `judgement/page-blocks.jsonl` and `variants.json` to `.work/spec/map/`, the config into
  `stardust/spec/`, then rewrite `sql:` rules and HTML findings.

## 0.30.2 — opt-in martech: carry the source consent and tag managers over, switched off

A migration dropped the source's CMP and tag managers silently, or left an agent to re-wire them by hand
against accounts it does not own. Martech now has one contract, built only when the owner asks, from the
evidence `spec-martech.mjs` already reads (`dynamics/reference/martech.md`).

- **Evidence**: `spec-martech.mjs --urls … --out stardust/martech` runs standalone, without a spec.
- **Contract** (`dynamics-plan.mjs --martech`): `stardust/martech-contract.json` and
  `martech-handoff.md`. It holds the CMP with its id, the source consent model (`per-tag` or
  `owner-decision`), the categories from the CMP configuration, one route per tag-manager loader, and
  the Launch rules and data elements to rewrite. Every part is written disabled, and a rebuild keeps
  the owner's choices. CMP scripts and loader patterns live in `vendors.json`; detection is unchanged.
- **Runtime** (`deploy/scripts/martech-scaffold.mjs`): `scripts/martech.js` from the enabled parts. The
  CMP loads in `loadEager()`, tag managers from `delayed.js`, and a route with a `category` waits for
  that consent group. Tags load only on production hosts; on preview `?martech=on` (plus
  `&consent=accept`) turns them on.
- **Verification** (`dynamics-check.mjs`, qa `dynamics`): a `martech` check aborts cross-site requests
  after recording the host. It asserts nothing loads by default, gated routes wait for consent, and
  enabled hosts are requested after accept.

## 0.30.1 — spec: any website, a page cap, and blocked origins

`spec` parsed AEM sites only. A WordPress news site (2,061 sitemaps, about 412,000 URLs) and a Next.js site with
utility-class markup showed what a generic parser and a cap need.

- **`generic` parser profile** (`spec/reference/config.md`): below main, single-child wrappers are skipped and the
  children are components, named from a component attribute, a block-style class (`wp-block-*`,
  `elementor-widget-*`, `paragraph--type--*`), a BEM or CSS-module block, or a shape label (`section.h2.list`) where
  classes are only utilities; hash prefixes are dropped (`stripPrefix` for a site's own). One rule set
  (`lib.mjs genericRules`) runs in the parser and in the capture tagger: on 5 of 6 sampled pages the two found
  identical path ids. The AEM profiles are unchanged: a re-parse of 12,345 AEM Core pages was byte-identical.
- **One rule set per profile, one layout walk** (`lib.mjs` `profileRules`, `componentLayout`): the capture tagger
  ran a hand-written copy of the AEM rules; parse and capture now share them, so path ids cannot drift. Parse output
  byte-identical on 12,345 AEM Core pages (5,192 grid rows), 200 AEM classic pages (651 column controls) and four
  generic sites; capture path ids and rows identical on the sampled pages of each profile.
- **Main region fallback** for sites without `main`: `[role=main]`, `#main`, `#content`, `#main-content`,
  `article`, then the body without header, footer and nav.
- **Inventory**: stops when the origin redirects (two of three sampled sites were configured with the wrong host);
  crawls links from the scope root when no sitemap URL is in scope; `--max` / `maxPages` keeps an even sample per
  section and the database says so (`meta.sample_note`, `inventory_total`).
- **Template**: a path-only rule (`{ "pathSegments": 1 }`) names templates by section alone.
- **Blocked origins** (a museum site behind a bot challenge): S1 and S2 classify challenges with the diff skill's
  `live-session.mjs` (the edge signatures replica's gate uses) and stop at 10% (exit 3) with the choice for the user —
  allow-list the crawler, `--headed` (the plugin's stealth real-Chrome tier: 5 of 6 sampled pages on the first pass,
  where bundled headless Chromium got 2), or `--archive <date>` (Internet Archive raw captures, recorded per page and
  in `meta.evidence_note`). `fetch/technique.json` records the tier so later stages start in it, as extract's
  `fetchTechnique` does. Pages not read plainly are captured from the fetched HTML with live assets; a page still
  showing a challenge is an error, never a screenshot. Parse and capture agreed on every path id of the captured pages.

## 0.30.0 — new skill `spec`: the migration spec before the migration, as one documented database

Scoping a migration was rebuilt by hand per engagement: a crawl, spreadsheets of templates and redirects, a
block-reuse guess, a list of "things to ask". Two recorded runs made the method a skill. The first, on a
medical-technology corporate site (about 2,900 sitemap URLs, AEM classic components), produced the method
and the database contract. The second, on a sports-federation site (about 12,400 sitemap URLs, AEM Core
Components), ran from the skill alone. It ended with 114 layout variants, 28 blocks (7 reuse, 5 variant, 16 new),
27 dynamic features and 28 open questions, and no component left unmapped.

- **Stages S1–S10** (`spec/SKILL.md`): inventory, resumable fetch (every redirect hop recorded), parse, link
  check, optional real-user data, capture, mapping, layout variants, implementation, package.
  S1–S6 and S8 measure; S7 and S9 are judgement files under `judgement/` with a rationale per decision.
- **Two parser profiles** (`reference/config.md`): `aem-classic` (`c-*` roots, colctrl rows) and `aem-core`
  (grid members, column widths → rows; the root is the first non-`aem-` class). Lazy images
  (`data-cmp-src`, `data-src`, `picture`) count as images.
- **Template rules** cover body attribute, body class or meta, plus `pathSegments` for sites whose CMS has one
  template for every page: the second run grouped by section, then by layout variant.
- **Mapping rules engine** (`spec-map.mjs`): direct, layout, styled sections, nesting containers, carousel
  slides, row heuristics, `dropIfEmpty` / `whenKids`. Re-run until nothing is unmapped. Measured against
  the first run's hand-built mapping, 26 of 29 blocks came out identical and the variant clustering was
  identical.
- **Martech from public artefacts** (`spec-martech.mjs`): headers and CSP, vendor hosts via the dynamics
  vendor table, tag-manager rules with path conditions, DOM selectors and the hosts their custom code loads,
  data elements that read the DOM, consent geo rule sets and categories.
- **Open questions ship a default** (`templates/open-questions.json`, 24 generic ones); findings carry
  `{{SELECT …}}` for every number, so no figure is typed.
- **One output, `spec.sqlite`** (`reference/database.md`): neutral meta keys and tables, plus consumer-owned
  tables (recorded decisions, saved views) that a reload keeps. Showing it is a separate application's job:
  the skill ships no viewer, and a consumer reads the database without crawling or judging.
- **Limits recorded**: bot protection answered 403 to the dynamics detector on 28 of 44 sample pages in the
  second run (logged as a site-config item, not retried around). Content behind a role or rendered after load
  can differ from the parsed HTML; the capture tagger maps paths at DOMContentLoaded and falls back to the
  current DOM. A redirected locale tree is measured by final URL, not by the sitemap path.

## 0.29.1 — replica `--target-breakpoints`: deliver on the platform's steps, map by intent, gate the shift (#131)

A recorded replica migration of a medical-technology site (about 105 pages) moved its breakpoints to
the EDS steps 600 / 900 / 1200 after delivery. Reused boilerplate blocks already sat on those steps
while recreated blocks copied the source's (the gate rewards matching them): about 20 distinct
breakpoint values in one codebase, spotted at once in review. Moving about 250 rules was quick; the
before/after re-gate (about 105 pages × 6 widths × 2 builds) took a night against a live CDN. At 900
the pass count fell from 35 to 2, yet every failure checked was one of two intended changes (desktop
header at 900 instead of 1024, about 40 px lower content; listings in their desktop row layout).
Optional and off by default: without the flag, output, gate widths and register are unchanged.

- **Input and state** (replica `SKILL.md` § Inputs): `--target-breakpoints <list>` (mobile-first
  `min-width` steps; `--breakpoints` keeps meaning gate widths), persisted once as `DESIGN.json`
  `extensions.breakpoints.target` — the one permitted addition to the promoted spec. The content cap
  is untouched.
- **Map in Phase 2, before any CSS** (`preserve-direction.md` § 4): source switch points from the
  live stylesheets, mapped by intent (layout tier, not nearest number) into
  `stardust/replica/breakpoint-map.md`; 1px pairs collapse, `max-width` becomes `min-width`. Phase 3
  and C0 apply the map, CSS and JS alike, and never decide it. One register entry, evidenced by a
  source | before | after strip.
- **Gate** (`source-fidelity-gate.md` § Target breakpoints): widths add each target step; inside a
  shifted band a failure is tier-shift (logged against the register entry, not iterated, outside the
  cap; an `overrides.json` row at the delivery gate) or a defect (still fails). A noise check covers
  widths outside every band.
- **Lint** (`breakpoint-lint.mjs`, new): every `@media` width, `matchMedia` string and `innerWidth`
  comparison under `blocks/ templates/ styles/ scripts/` must switch at a target step, all query
  forms normalised to their switch width; skipped when no target is set. C0 wires it into
  `npm run lint` (handoff contract § Boilerplate lint), so deploy and rollout run it before delivery.
  `--inventory` lists a source's switch points for the map.
- **`crop-compare.mjs --strip <out.png> [--c <c.png>]`** writes the bands side by side — the
  register entry's image from the gate's own captures.
- **Wording:** extract's content-cap line and recreation's cap rule no longer say the target keeps
  its own two breakpoints (true of a redesign only); deploy's `--nav-height` rule follows the target
  steps when set.

## 0.29.0 — the capture freeze is capture state, never the spec: media must play (#130)

A recorded replica run shipped "poster + paused video" and static first slides across a site while
26/26 dynamics parity rows passed. Four causes, all in the skills: the gate defined truth as what the
frozen instrument sees (stitch-shot pauses every `<video>` at t=0 and clears timers), so autoplay
loops were masked as "nondeterministic media, permanent residual"; the interaction-parity rule
"implement only behaviours that fired" read the frozen sampler's silence as dead; the freeze written
as a deferral became the delivery brief verbatim; and parity's `video-plays` verified presence
("video elements present and controllable"), as did qa's rendered sweep. Contract change (a mask is
now a promise, `video-plays` passes on playback), so a minor bump.

- **Capture state is a promise** (replica `recreation-procedure.md` § Carousels, § Interaction
  parity; `source-fidelity-gate.md` § Residual logging format): every freeze or mask the gate needs
  is a `captureState[]` entry whose `restoreAtDelivery` names the live behaviour as observed
  (autoplay muted loop, rotation interval, marquee speed; `null` only when live is static too).
  Timer-driven media IS a fired behaviour — "dead" means never fired on live, never "stopped by the
  freeze". "Poster + paused" is a capture artefact, not a deliverable.
- **The list travels with the brief** (`handoff-contract.md` fan-out discipline + Phase E row;
  rollout `SKILL.md` Phase C step 1, Phase E render check): C-deliver's brief carries the
  archetype's `restoreAtDelivery` list verbatim and implements it before `done`; Phase E asserts an
  `autoplay` video ≥ ¼ visible is playing and a rotating carousel advances unpoked.
- **The observer no longer blinds itself**: `motion-observe.mjs` samples a `media` block before
  any scroll or poke — per `<video>` autoplay/loop/muted, paused and `currentTime` twice 1.5 s
  apart (playing = advancing), plus class mutations that fire with nothing touched (timer
  rotation). `motion-compare.mjs` gains the `media` class: live playing → build must play (a
  paused/poster build is MISSING), unpoked live mutations → `auto-advance` MISSING when the build
  has none; older observations without `media` still load.
- **Parity means playback**: `dynamics-check.mjs video-plays` scrolls the `<video>` to ≥ ¼ visible
  and requires `!paused` + advancing `currentTime`; `playbackHost` is now optional (native video)
  and `reducedMotionPauses` reloads under `prefers-reduced-motion` and requires paused. Pure
  `judgeVideoPlayback` is unit-tested; `patterns.md § media-as-url` and `parity-report.md` rule 1
  say presence is not a pass.
- **qa `video-not-playing`** (rendered, error): an autoplay `<video>` ≥ ¼ visible that is paused,
  not advancing, or never buffered (`readyState < 2` — the `content.da.live` 401 class) with src,
  readyState, paused and Δt as evidence; `video-probe-failed` (info) when the probe errors.
  Fixture-tested (`judgeVideos`).

## 0.28.0 — a migration keeps its design unless the ask says to redesign it (#129)

A recorded hands-off run resolved a bare "migrate" to the redesign flow (brand-faithful mode) because
the ask carried no keep-design phrase; the owner expected a like-for-like move and got the prototype's
reinterpretation — a static poster for the hero motion, a rebuilt mega-menu, pages that differed
wholesale from the source. The master skill's third routing bucket ("anything else → ask; hands-off →
redesign") was the root cause. Contract change, so a minor bump. Touches 0.23.0 (flow keys),
0.19.1 (zero-movement hand-off).

- **Routing** (master § Two migration flows): the redesign flow is selected only by an explicit
  redesign phrase ("redesign", "modernise", "refresh", "new look", …); nothing is inferred. Every
  other migration ask is `replica` with `flowSource: "default"`, no question, interactive and
  hands-off alike; the first response carries replica's "Say `switch to redesign` now" line so the
  one decision stays visible.
- **Flow keys** (state-machine.md): `flowSource` is `user-phrase | default | question`;
  `hands-off-default` is gone. `prepare-migration` Setup stamps `redesign` only on an explicit
  phrase and hands anything else to `replica`; `migrate`'s flow guard reads the same default.
- **Eval** `routing-migration-flow`: prompt 1 expects `replica` without a question and
  `flowSource: "default"`.

## 0.27.2 — the favicon miss becomes a failing check: `favicon-default` (#128)

Several recent first passes shipped the aem-boilerplate icon. The rule was already written in three
places (deploy Step 3 § Favicon, replica's C0 foundation unit, prepare-migration assets prep) and
extract had captured the icon every time; what was missing was an instrument — the QA check HEADed
`/favicon.ico` and the boilerplate's own file answered 200, so every sweep passed. Prose repeated a
fourth time would not have changed that. Touches #110–#112 (deploy favicon WARN), 0.19.1 (favicon
HEAD at the origin).

- **qa `metadata`**: resolves the icon the home page links (any `rel~=icon`, default `/favicon.ico`),
  fetches the bytes and reports `favicon-broken` (error, was warn), `favicon-default` (error: sha256
  equals the boilerplate's `favicon.ico` — the site's icon never shipped) or `favicon-mismatch`
  (warn: differs from `stardust/current/assets/favicon.<ext>` when that capture exists — a format
  conversion is legitimate). `lib.mjs fetchUrl` gains `binary: true`; `test/favicon.test.mjs`.
- **rollout foundation-first gate** runs `qa.mjs --checks metadata` against the origin and names
  `favicon-default` as the first-pass miss; **deploy Step 3 § Favicon** step 4 points at the same
  check instead of a bare HEAD.

## 0.27.1 — site search is `self`, never decided-out by a hands-off assumption (#127)

A recorded hands-off run of a 100-page medical-device site had the query index live and the plan
script drafting the header search as `index-backed` / `self`, then wrote "site search out of scope"
into its own named assumptions, let the triage table cite that as the owner's decision (`decided-out`)
and left the header form posting to the source origin's results page — the one query-index feature
dropped while its three listing siblings shipped. The start prompt had named search as a dynamic
surface to handle. Touches 0.20.0 (dynamics triage) and 0.25.1 § Index, sitemap, search.

- **A hands-off assumption is the run's, never the owner's.** It may pick an interim tier; it cannot
  set `decided-out`, which takes an owner's statement or a hard blocker. Dynamics SKILL.md Phase 3 and
  § Hands-off resolutions, triage.md § Reproducibility, the hands-off table in the stardust skill.
- **Search over the site's own pages is `self` once the index exists** and ships over the migrated
  corpus; a corpus smaller than the source's is a parity note, not a reason to exclude. The header
  form never keeps the source origin's results URL (triage.md rule 4, patterns.md § search-index-backed).
- `dynamics-plan.mjs` no longer poses "results page scope" as the decision on the search row; it
  reads `none (corpus = the migrated pages; second corpora stay out)`.
- Folded: the search ranking summary repeated in dynamics SKILL.md Phase 4 and triage.md rule 9 now
  points at patterns.md.

## 0.27.0 — archetype-first delivery: deploy and gate the archetype at the origin before its siblings render (#126)

A recorded 96-page run migrated 78 siblings from archetypes whose EDS encoding had never been gated,
then re-deployed whole families in a five-workstream fix program; its sibling pixel bar ran on local
renders whose numbers understated on every page. The flow now proves the archetype where it counts
before anything inherits from it, and gates siblings once, where it counts.

- **Order.** C-deliver gains unit `C-archetype`, one per template, between the foundation and its
  cluster: convert the gated archetype (the encoder every sibling reuses) → PUT → preview → the full
  gate row on the preview URL (`gate-all.mjs --only`, both widths) → fix rounds, cap 3 → `done`; only
  then `migrate.mjs render` for the template's siblings. Handoff contract § 1 intro and § 3 row C,
  `progress.json` kind `archetype`, replica Phase 5, rollout Phase C, migrate Phase 2, fidelity-tiers.
- **Siblings gate once, at the published origin.** § 1 row 5 (the local prototype-regime sibling pixel
  bar) is replaced by the gate row after PUT + preview; `gatesPassed` pixel gates come from the page's
  row in `gates/all-<w>/summary.json`. Row 2: the structural clone is the encoder's INPUT, never a
  gated prototype; where it flattens a composition the encoder reads the hydrated capture.
- **What a failing row means** (gate doc): one block → fix the block, re-gate every sharing page;
  content in the capture but missing → fix the encoder, re-render; a composition the archetype cannot
  express → re-prototype (new archetype when two or more pages share it, else a standalone one). Cap
  3 fix rounds per page at the published origin, then that decision — never a fourth round.
- Not in this release: a scriptable per-template encoder in the plugin (today the deploy convert step,
  proven on the archetype, plays that role); when it lands, migrate emits `content/<path>.html` directly.

## 0.26.0 — published-origin gate hardened: element-level criteria beside the pixel number (#125)

A 96-page rollout of a pharmacy retailer gated every deployed page on stitched captures and
pixel-compare; its coupon-listing page PASSED at 6.7 % / Δh 69 px while all 284 cards were broken —
a fixed-height card with `overflow: hidden`, the body ~30 px low, the description clipped mid-glyph,
the details link pushed under the primary button, the sort control on another default. The links
were in the served DOM: pure CSS geometry, which pixelmatch underweights (16.5 % over the text
boxes alone). "PASS" meant "right shapes at the right places", not "every element present and
legible". Element presence and legibility are checkable — so the gate checks them. Cross-references
#115 (chrome crop gate), #124 (content-cap row) and the run's feedback items A1–A3.

- **New `replica/scripts/gate-all.mjs` (D0)** — the all-pages published-origin gate: per deployed
  page in `state.json`, stitched captures of both sides, `pixel-compare`, then the two DOM probes
  below in the same window-free real-Chrome tier; per-page dir + `summary.{json,md}`, `runs/` for
  `--only`. **Verdict = pixel % ≤ 10 AND |Δh| ≤ 5 % of origin height AND clipped ≤ 0 (+ documented
  allowance) AND content MISSING + HIDDEN links / headings = 0** (+ required repeated units within
  4 px); the pixel-only verdict is recorded beside it — every run is calibration data. Sidecars, each
  entry documented: `masks.json`, `overrides.json` (shown beside the number, never replacing it),
  `clip-allow.json`, `presence.json`, `units.json`. Origin fallback live → previous → crawl shot
  (asymmetric, flagged); `--eds-host` gates a code branch; a union (white-padded) pixel metric was
  tried as the height guard and rejected (white gaps score as matches) — the guard is explicit.
- **New `diff/scripts/clip-probe.mjs` (D1)** — text lines and controls against every overflow-
  clipping ancestor: TEXT CLIPPED / HIDDEN, CONTROL HIDDEN / CLIPPED counted (exit 2); line-clamp,
  "read more" collapsibles (`--more-words`), scrollable containers, horizontal cuts advisory;
  collapsed menus, sr-only, hidden subtrees, off-page boxes never reported. Emits the visible text
  line boxes. Recorded page: 379; the live origin and two known-good pages: 0.
- **New `diff/scripts/content-presence.mjs` (D2)** —
  visible headings, links (visible text), buttons, images, text blocks per band (h1–h3 aligned by
  LCS) + control state (`--count-words`); MISSING / HIDDEN LINK ×n and HEADING 🔴, buttons and
  CONTROL STATE 🟠, MOVED / EXTRA / COUNT / HEADING AS TEXT 🟡; symmetric scope, chrome left to
  the crop gate unless `--chrome`, `--variable` regions as counts (HIDDEN still counts), origin
  HTTP ≥ 400 fails loud (exit 4). Recorded page: HIDDEN 284, CONTROL STATE 2.
- **New `diff/scripts/unit-geometry.mjs` (D3) + `diff/scripts/measure-live.mjs`** (library) — the shared
  settle / session / shadow-DOM measurement lifted from the project measure scripts; per-element
  Δx / Δy / Δw / Δh of the first N repeated units relative to the unit, `hidden` where clipped,
  origin cached per slug. Recorded card: body +28…+47 px, details link +28 and hidden, badge
  70×70 at (−10,−10) vs 64×64 at (−27,−30), card 260 → 238.
- **`pixel-compare.mjs --text-boxes` (D4, auxiliary)**; `textBoxPct` exported. (`--pad`, the rejected
  union metric, is not shipped.)
- **The pixel-table rule.** Every crafted prototype and every deployed page is a row:
  `gate-all --stage prototype --proto-base <url>` writes `gates/prototypes-<w>/summary.{json,md}` at the
  end of Phase 4 (reusing each archetype's cached `live.png`), the default stage writes `gates/all-<w>/`;
  `gate-evidence.mjs` reads the tables as the source of record (`--tables`; a page without a row is
  `OPEN: no table row`, `--check` names a missing table), the eval requires the prototype table, rollout
  Phase H reports both totals. `gate.sh --full` runs clip-probe on the build side in every regime,
  content-presence in the published regime, unit-geometry when `stardust/replica/units.json` declares a
  repeated-unit family for the slug (`{ family: { origin, build, n, required, pages[], templates[] } }`
  — replica recreation-procedure § Repeated-unit families); element lines fail the round and outrank a
  pixel PASS in gate-evidence the way the overflow assert does.
- **Coverage carries the verdict; the roster run is a recorded unit** (review notes on the PR).
  `update-coverage.mjs --gate <summary.json>` writes each row into `delivery.gate` and flips a failing
  page (no documented override) to `failed`; `verify.mjs` never marks a page `verified` while
  `delivery.gate.pass` is false — completion derives from one place. Handoff contract § 3: each cluster
  subagent runs `gate-all --only` over its own pages inside the fan-out; C-final's roster run is unit
  `gate-all` (recorded `running` → `done`, resumable at its boundary) followed by `--gate`. Setup probes
  the deps before installing them (a harness that resolves them leaves the code repo untouched).
- **Upstreamed feedback.** A1 `launchStealthHeaded` is WINDOW-FREE by default
  (`STARDUST_HEADED_WINDOW=1` opts in). The tier is the BEST AVAILABLE and REGISTERED: Chrome when
  installed, else bundled Chromium with a warning, and every probe records `tier` (`chrome` |
  `chromium-fallback` | `chromium`) in its evidence; gate-all's summary has a `browser` column and
  counts degraded pages. A2 Akamai's HTTP
  400 escalation is a challenge marker. A3 setup steps install `playwright pixelmatch pngjs cheerio`
  as devDependencies, never `--no-save`. `deploy-batch.mjs` appends the admin `x-error` header to
  4xx (the DA 200-images-per-document cap; protocol step 3a').
- **Docs** — gate doc § The all-pages published-origin gate; replica Phase 5 + Setup; deploy
  Step 10 item 7; rollout Phase E; diff SKILL § The published-origin probes; scripts index. **Tests**
  for the four instruments (pure parts browser-free; clip-probe end-to-end on a fixture where
  playwright resolves). Calibration on the recorded roster: pixel-only 66 PASS → full 28 PASS.
- **Open** — default tolerances (`--clip-max 0`, `--unit-tol 4`, 25 % counts), how projects declare
  repeated-unit block families, whether buttons / control state should block.

## 0.25.2 — content cap: the container sizing model is measured, persisted and gated at a derived wide width (#124)

A hands-off replica run delivered a site whose live pages centre their content in two nested caps —
a 1920 px page shell and a 1600 px content article — as an edge-to-edge build: the token was
declared (`--container-max: 1920px`) and never applied, `main > .section > div { max-width: none }`,
and BOTH pixel gates passed (1440 ≈ 1.2 %, 360 within residuals) because 1440 is narrower than
either cap — the defect was invisible by construction. Extract had recorded the shell in a bespoke
field and missed the article; the optional ≥1920 box-map spot check (#116) never ran, and pinned at
1920 it could not have seen the shell: a probe AT a cap's width reads the cap as the viewport. The
two pixel gates are unchanged (1440 and 360, no third pixel gate); one cheap geometry-only read at a
DERIVED wide width is added and made mandatory. Cross-references #13 (qa-gate's hardcoded 1600 wide
pass) and #116 (the fluid-vs-fixed spot check, now folded into the row).

- **New shared instrument `replica/scripts/cap-probe.mjs`** — extract, replica and deploy all call
  the same script. Capture: render a page at 1440, then read the same boxes at a derived width (max(2560, largest
  cap × 1.25); re-read once wider when a cap sits at ≥ probe ÷ 1.25) and at 0.9 × that width —
  resizes, not navigations; a box is capped when the two wide reads agree (a 90 % container
  scales, a max-width does not) — and list every cap ORIGIN (a capped box not merely inheriting,
  padded or auto-margined inside a capped parent) with its
  px, how it is authored (`max-width` / fixed / other), DOM tier and KIND — `shell` (outermost cap
  holding ≥ 90 % of the content root's text), `content` (a further wrapper inside it), `module`
  (one top-level section); chrome caps are not modelled. `contentMaxWidth` = the innermost
  wrapper cap, else the module cap shared by half the capped sections, else null (fluid).
  `--write-design` merges `extensions.breakpoints.{containerMaxWidth, probeWidth, shellMaxWidth,
  caps[], modules[], capRegister[]}` into DESIGN.json; several archetypes aggregate, and a cap that
  differs between archetypes or sits on a single module lands in `capRegister` for the
  inconsistency register (a cap on the shell or on every archetype is design intent, whatever its
  value; source breakpoints are never inherited). Compare (`<live> --against <build> [--design
  DESIGN.json] [--slug <s>]`): rows by KIND — `wrapper cap`, one `module i/n` per section (advisory
  while the section counts differ), `content cap` when neither side has a wrapper — never by DOM
  depth; PASS = every live cap held within ±20 px, nothing capped only on the build; a ✗ prints the
  scaffold rule to change (`main { max-width }` for a wrapper cap, the section div for a module
  cap), never a pixel target. Evidence lands in `stardust/replica/gates/<slug>-<probeWidth>/
  cap-<label>.{json,txt}` like the pixel rounds. Exit 0 / 2 FAIL / 1 / 3 bot challenge / 125 usage;
  `--probe-width` pins the width for evidence runs only. `probePage` and the pure functions are
  exported; `test/cap-probe.test.mjs` covers classification, aggregation, rows, args, the
  DESIGN.json merge and — where playwright resolves — an end-to-end fixture (nested 1920/1600/1180
  page vs a fluid and a fixed build, plus the pinned-1920 blind spot). `scripts-index.md` row added.
- **Extract records the sizing MODEL, not a number.** `extract/SKILL.md` Phase 3: run the probe
  once over the archetypes (`--write-design stardust/current/DESIGN.json`, one navigation each,
  after the census); the `extensions` note names `breakpoints`; `brand-surface.md` § Spacing marks
  `containerMaxWidth` as measured; `token-contract.md` § Sizing: the replica flow inherits
  `containerMaxWidth` and `probeWidth` as-is, the step-up rules are redesign-only.
- **Replica pass bar gains the mandatory content-cap row.** `SKILL.md` Phase 4 command + pass-bar
  bullet; `source-fidelity-gate.md` § Pass bar item 6 (the ≥1920 § Wide-viewport fluid check is
  folded into it — same-KIND pairing, re-lift upstream, no pixel iteration);
  `recreation-procedure.md` § Lift the sizing MODEL reads the measured cap model before lifting,
  encodes a wrapper cap on `main` and a module cap on the section column, and never reproduces a
  source breakpoint. `evals/replica-source-fidelity`: `both_breakpoints_gated` also requires the
  row's evidence; `task.md` names skipping it as a failure mode.
- **Deploy.** Step 3 Foundation: the section scaffold honours the captured cap at its tier
  (`main { max-width: var(--max-width); margin: 0 auto }` for a shell/content cap, the boilerplate
  section div for a module cap, with the full-bleed escape for sections `modules[]` lists fluid).
  `qa-gate.mjs --design DESIGN.json` (default `./DESIGN.json`): the wide pass runs at DESIGN.json's
  `probeWidth` instead of a hardcoded 1600, asserts the OUTER cap through the shared `probePage`
  (FAIL when the content cap does not hold within ±20 px of `containerMaxWidth`, or when the build
  caps a fluid source), then the per-block `--maxw` warnings (default now `containerMaxWidth`); no
  DESIGN.json or no probe beside the script → one ⚠ and the old behaviour. Step 10 item 5 is the
  cap row on the deployed URL; Local QA paragraph, pitfall 13 and the checklist follow;
  `handoff-contract.md` § 4 row updated.
- **Evidence (anonymised, 2026-09-24).** A commerce home page. Capture: `shell 1920px max-width
  main > div.<cms-list> (tier 1, holds 98% of the text)`, `content 1600px max-width … > article
  (tier 2)`, `contentMaxWidth: 1600px shellMaxWidth: 1920px probeWidth: 2560 consistent: yes`.
  Pinned `--probe-width 1920`: only `shell 1600px` — the 1920 shell read as the viewport and
  vanished, the reason the width is derived, never fixed. Compare live vs the deployed origin:
  `✗ wrapper cap: live 1600px (content, … > article) → build NONE: content runs 2560px wide at
  2560 (module caps only: 620px ×2, 340px ×2, 1180px ×1, …) — fix the sizing rule, not pixels —
  deploy Step 3 scaffold: main { max-width: 1600px; margin: 0 auto }` → `cap-probe: FAIL at 2560 —
  1 of 5 rows failed`. After that rule in the project's `styles.css`, served locally by the dev
  server: `✓ wrapper cap: live 1600px = build 1600px (±20)` → `cap-probe: PASS at 2560 — 0 of 5
  rows failed`; `qa-gate.mjs --design` on the same render: `✓ content cap 1600px holds at 2560
  (#124)`. Second validation, the inverse defect on another delivered replica (a financial-services
  home page, `--main` at the live section wrapper): live modules are fluid (90 % framework
  containers, `contentMaxWidth fluid`), the build caps every section at 1430 px — `✗ content cap:
  build 1430px (module caps only: 1430px ×8) but live modules are fluid — fix the sizing rule, not
  pixels: remove the module cap` → `FAIL at 2560`. Skill prose is net smaller than before (the spot
  check section, duplicated port-probe and hardening rationale were folded).

## 0.25.1 — replica run follow-ups: gates that passed a broken site, index/sitemap/search verification, capture gaps, the thumbnail cap, token files, recorded migrate units

Fixes from two recorded hands-off replica runs of one 36-page source site — one at 0.22.1, one at
0.25.0 — verified against their artifacts. The shared documents carry the same rules:
`replica/reference/handoff-contract.md` (§ 1 rows 4, 5, 9 and the acceptance paragraph; § 3 rows D,
D2, E2; § 4 rows for `measure.mjs`, `thumb.mjs`, `ledger.mjs`, the uploader, the batch driver and
the rollout writers; § 5 ledger rule and migrate units), `stardust/reference/scripts-index.md` usage
lines, `state-machine.md` `site.captureGaps`, `journal-format.md`'s heading rule and
`replica/SKILL.md`'s pass bar.

### Gates that passed a broken site

- **`replica/scripts/gate.sh`, `measure.mjs`, `gate-evidence.mjs` — horizontal overflow is a hard
  assert, not a residual.** `measure.mjs` prints a root line per width per side (scrollWidth beside
  scrollHeight and the viewport, `◄◄ OVERFLOW +<n>px`; `root`/`rootDeltas` in the JSON); `gate.sh`
  runs it on the build side every round (no live hit) and fails the round on an overflow of more than
  `GATE_OVERFLOW_TOLERANCE` px (default 4 — scrollWidth and clientWidth are integers, a correct page
  whose widest box is 360.4 px reads +1, and the qa skill's rendered sweep fails above the same 4 px;
  a real overflow is 13 px and up) whatever the pixel number says; `gate-evidence.mjs` records `FAIL: horizontal overflow` over a PASS pixel line,
  withholds `pixel-gate-<w>`, shows `/ovf+<px>` on the row and `overflowX` in the ledger. A recorded
  hands-off run delivered two pages 373 and 400 px wide at a 360 viewport and passed them as
  "logged, not iterated further (3-iteration cap reached)"; `source-fidelity-gate.md` § Iteration
  discipline names the assert no cap waives.
- **`diff/scripts/content-diff.mjs` compares attributes and icons, not text nodes only — on the
  main root AND the chrome roots.** A second in-page inventory (`placeholder`, `aria-label`,
  `title`; small images by file name, inline svg, icon-font glyphs by `::before`/`::after` content,
  css icons, empty icon boxes) and a pure differ — MISSING/EXTRA <ATTR>, MISSING ICON, ICON DIFF,
  ICON KIND, EXTRA ICON, ICON MOVED. Severity: MISSING PLACEHOLDER / ARIA-LABEL, MISSING ICON and
  ICON DIFF are 🔴 on an interactive element (input, button, link or inside one) and 🟡 elsewhere;
  MISSING TITLE is 🟡 always (a title tooltip is not read by most assistive tech and is commonly
  dropped by design); ICON MOVED, ICON KIND and every EXTRA are 🟡. Roots: `--main` takes a
  comma-separated selector list; `--chrome` (default on) adds the `header` and `footer` roots — the
  first `<header>`/`[role=banner]` and `<footer>`/`[role=contentinfo]` outside the main root(s) —
  and `--no-chrome` disables; the report has one block per root, every finding line carries its
  root (`[header]`), `--json` gains `findings[]` (with `root`) and `roots{}`; the `Findings:` line
  gate.sh and gate-evidence read and the exit codes are unchanged; playwright loads lazily so
  `--help` and the unit test need no browser. Recorded first: every delivered page lacked the
  search input's localized placeholder, a locale root carried the wrong flag, social links were
  empty boxes — and the probe read 0 🔴. Then measured on a delivered 36-page replica (5 page
  pairs): real regressions found on 4 of 5 pages — share links without aria-labels and icons,
  dropped CTA aria-labels, a dropped localized search placeholder — and two false-red sources of
  the layer's own removed: anchor-only icon pairing (7 present icons read as missing on one page —
  the build hosts an FAQ page's accordion glyphs in text-less `<button>`s anchored `button#1…#7`
  where the source anchors each to its question; leftover icons now pair by identity and document
  order, within the same nearest block first, as `ICON MOVED` 🟡) and chrome outside the default
  root (the two chrome cases the layer was written for were invisible unless the caller passed
  `--main header`). `source-fidelity-gate.md` and `handoff-contract.md` § 1 row 4 say content-diff
  covers main and chrome roots on every gate page — the recreate and C-deliver commands need no
  new flag.
- **`replica/scripts/measure.mjs` reports the rendition per `<img>`** (`naturalWidth ×
  naturalHeight`, current source file; `img.naturalWidth`/`img.file` deltas) and
  `recreation-procedure.md` § Image renditions per breakpoint records which rendition live selects
  at each gate width and authors the same `srcset`/`sizes`; a sub-3 px root-height delta with equal
  boxes is a rendition-ratio symptom, not a layout bug (recorded: 0.64 px per inline image summed to
  2.2 px and cost iterations).
- **Box model is a lifted value.** `boxSizing` joins `measure.mjs`'s default props so `--against`
  names a content-box/border-box fork per box; `recreation-procedure.md` § Box model is a lifted
  value lifts it per container, declares it per block and scopes the boilerplate reset on a replica,
  never universal (recorded: a universal `border-box` reset over content-box source grids — chrome
  −9 px, a facts row −106 px at 360 — while every prototype gated ≤ 0.1 %).
- **`replica/scripts/gate-evidence.mjs` no longer demands media-reconcile on prototype files.**
  `--content <dir>` (default `content`); without the page's delivered content file the gate reads
  `n/a: no delivered content file yet` (never OPEN) and leaves the sibling acceptance set and
  `--check`; it is required again once the file exists. `source-fidelity-gate.md` places
  media-reconcile in the delivery chain (row C). Recorded: every sibling sidecar carried
  `media-reconcile: OPEN` until C-deliver.
- **`replica/scripts/gate.sh` retries a capture that exits 1 once.** Live capture, build capture and
  the overflow probe; two exit-1 attempts end the round with exit 1 "re-queue, not a verdict"
  (3/4/124 stay final; run-bg slots unchanged at 3). Recorded: about 8 of 62 sibling gate rounds
  under parallel Chromium load ended `build capture failed (exit 1)` and were read as verdicts.

### Index, sitemap, search

- **rollout Phase D / `assemble.mjs` — the served sitemap is verified, chrome is `noindex`.** The
  assembled `site/sitemap.xml` is the EXPECTED set only (`stardust/rollout/` is in `.hlxignore`; the
  platform serves its own `/sitemap.xml` from its index of published documents). Chrome and fragment
  documents (`/nav`, `/footer`, per-locale `nav-*` / `footer-*`, locale shells that are not pages)
  carry a `Robots | noindex` metadata row at write time; new `--verify-origin <live-origin>` fetches
  the SERVED sitemap (a sitemap index followed), compares its `<loc>` paths with the coverage rows,
  prints served / assembled counts with every extra and missing path, records
  `manifest.json.servedSitemap` and exits 1 on a mismatch; the `D-site end` ledger detail names the
  SERVED count. `helix-sitemap.yaml` + `helix-query.yaml` exclude globs documented as the additive
  alternative. A recorded hands-off run reported "sitemap 36 urls" from the local file while the
  served one listed 58 (every page plus 22 chrome documents).
- **rollout Phase D2 / dynamics — a missing query index is a yaml file, not a service.** A 404 on
  `/query-index.json` means no `helix-query.yaml` in the code branch: author it (skeleton in
  `dynamics/reference/listings.md` § Getting an index at all — `og:title` title, description, image,
  lastModified; chrome and search documents excluded), push, publish live, poll no more often than
  every 5 s for at most 10 minutes; no configuration-service write is involved (a 403 there with the
  migration token is expected); the sheet-backed interim index is the fallback only when the code
  branch is not writable (triage rule 8, patterns.md). A recorded hands-off run read the 403 as "no
  index can be configured" and built the interim index.
- **dynamics search — parity is count + titles, not presence.** `patterns.md` § search-index-backed:
  title matches rank first, description and body text only while fewer than N title hits (N = the
  source's visible count, read during detect), dedupe by title + description, cap the dropdown at N.
  `dynamics-check.mjs` `search-query` gains `expectCount` / `expectTitles` (+ `titleSelector`,
  `countTolerance`) and compares result COUNT and the top-3 titles with the source's recorded
  values, failing on a count mismatch or duplicates — pure `compareSearchResults()` with a fixture
  test (`dynamics/scripts/test/dynamics-check.test.mjs`). A recorded hands-off run's typeahead
  returned 10 unbounded entries for a term the source answered with 3.
- **rollout `update-coverage.mjs --new` — pages built outside the migrated tree enter coverage,
  once.** `--new <slug> --path </path> --template <id> --origin <origin> [--title …] [--status …]`
  adds a schema-shaped row under the coverage lock (the pages schema allows no origin property: the
  origin is recorded in `source.migratedHtml` as `<origin>:<slug>`), creates or extends the template
  row, is idempotent by slug and refuses captured slugs and taken paths; `assemble.mjs`, `verify.mjs
  --all` and `optimize.mjs` include the row. `inventory.mjs` keeps such rows on a re-run (the origin
  marker identifies them; status untouched, one `Kept` report line) until the migrated tree holds a
  file for the slug or a migrated page owns the path — the page is registered once, never
  re-registered after every inventory run (`inventory.test.mjs`). A recorded hands-off run left its
  D2-built search page out of all three.

### Bookkeeping, capture, tooling

- **`ledger.mjs` start guard.** An `end` now needs an open `start` for the same skill + phase — an
  earlier `start` with no later `end`, paired in canonical forms; missing → warning, and under
  `--strict` exit 2 with nothing written and one stderr line naming the missing start command.
  `run-status.md` § Rules: the `start` line is the FIRST command of a phase, before any script runs.
  Recorded: a hands-off run wrote a phase's `start` and `end` one second apart after 109 minutes of
  work, so its supervisor saw an idle run.
- **`ledger.mjs` journal check.** On `end`, a `stardust/journal.md` beside the ledger with no `## `
  heading naming the phase (case- and separator-insensitive) gets one warning — never an exit-code
  change; an absent journal is not checked. `replica/SKILL.md` bookkeeping: every phase, extract and
  preserve-direction included, opens with the start line and closes with `end` plus a journal
  section `## <Phase name> — <what happened> (<date>)`; `journal-format.md` reconciles its `##
  <ISO-8601 timestamp> — <one-line summary>` heading with it — in a stardust phase the summary
  starts with the phase name, and `ledger.mjs` accepts either shape. Recorded: one run's journal
  began at Session 2; another's had one section for the whole run.
- **`crawl.mjs` locale-root capture gaps.** After the crawl, every captured locale root (a one- or
  two-segment path of locale codes — `/en`, `/fr-ca`, `/ca/en`) has the same-origin links on that
  page under its own path listed and the uncaptured ones written to `_crawl-log.json#captureGaps`
  (`roots[{root, slug, linked, uncaptured[]}]` + a ready `detail` string, `uncaptured first-level
  targets: ca/en 15, fr/fr 0`) with one stderr line; `extract --prep` copies `roots[]` to
  `state.json.site.captureGaps` (documented in `state-machine.md`) and carries `detail` in its `end`
  ledger line. `crawl.mjs` is now importable (playwright imported inside `main`, real-path main
  guard) and has a fixture-HTML unit test. Recorded: two runs captured `/ca/en` while 15 `/ca/en/*`
  pages existed and learned it six hours later from the rollout link audit (15 × 404, then repointed
  because 15 > the 12-page threshold).
- **`thumb.mjs --max-bytes`.** Default 150000: a thumbnail over the cap is re-encoded at a lower
  `--max-height` (the same bottom crop) until it fits; every line now ends with the final size, a
  capped one also notes `re-encoded for --max-bytes <b>`; a cap unmeetable at one row is written,
  named on stderr, exit 1. `extract/SKILL.md` Phase 2.5: a thumbnail enters the context only after
  `thumb.mjs` has written it (≤ 150 KB), or the vision check runs in a subagent returning one line
  per thumbnail. Recorded: eight thumbnails of 268–608 KB — 3.2 MB — read into one context.
- **`thumb.mjs --max-bytes` scales the width before it crops, bisects on measured size, keeps at
  least 60 % of the page.** The first hands-off run with the cap cropped 25 of 27 thumbnails to a
  median 28 % of each page (minimum 9 %) — a hero strip the vision check read as the whole page —
  and landed at ~7.5 KB under a 120 KB cap: the crop was the first lever and the byte-ratio shrink
  loop overshot by an order of magnitude (PNG size is not linear in rows). Now a thumbnail over the
  cap is re-encoded narrower first (480 → 400 → 320 → 240 px, the whole page each time), then
  shorter by bisection on the measured size, never below `--min-share` (default 60 %); still over
  at the floor, the floor thumbnail is written, named on stderr, exit 1. New `--offset <px>`
  thumbnails the rows below a crop (`<dst>` gains `-<offset>`), the stdout line names the scale and
  the kept share, and `extract/SKILL.md` Phase 2.5 has the agent read a cropped page's `--offset`
  slice too. pngjs also resolves through `NODE_PATH`.
- **`da-media-upload.mjs` and `deploy-batch.mjs` — `--token-env <NAME>` / `--token-file <path>`.**
  The token comes from the variable named by `--token-env` (default `DA_TOKEN`) or from
  `--token-file` (read once at start, trimmed; never both; a missing or empty file is a usage error
  naming the path; the uploader's dry run reads no file); the expiry, HALT and re-run lines name the
  variable or file, never the value, and the file-mode re-run command carries no `<var>=<fresh
  token>` prefix. JWT-expiry preflight and the 401 policy unchanged; `deploy/SKILL.md` token
  paragraph: both drivers take both flags. Both test suites cover both flags
  (`deploy-batch.test.mjs` + 2 checks); the uploader drops an unused import. Recorded: the hands-off
  harness provided the token as a file while the uploader read `DA_TOKEN` only.
- **rollout `optimize.mjs` — findings that mirror the source are informational.** With the extract
  capture present (`--current <captureDir>`, default `stardust/current`: `pages/<slug>.json` +
  rendered sidecar), a baseline finding whose condition the source shares — the same `<title>`
  (title-length / title-missing), no meta description on the source either, no JSON-LD on the source
  either, the same title or description shared by the same pages — is tagged `fixability:
  out-of-scope` with the evidence prefix `source parity:` and autofix unavailable (the findings
  schema has no parity property); listed in its own report section and excluded from the health
  score, the open P1/P2/P3 counts and the gate (`lib.mjs`: `isSourceParity`, `markSourceParity`,
  `sourceParityCounts`; `computeScorecard` skips them). A recorded hands-off run accepted 63 such
  findings by hand.
- **migrate renders as recorded units.** The migrate phase — plan, the render of every sibling,
  state-and-report — is bookkept in `stardust/migrate/progress.json` with the C-deliver unit
  ledger's shape (`units.<name>: {status: pending|running|done|failed, kind:
  plan|render|assets|report, templates[], pages: n, startedAt, endedAt, verdict}`): one `plan` unit,
  one `render` unit per template cluster of at most ~8 siblings (`migrate.mjs render <slug…>` takes
  the slug list), one `assets` unit when media is rehosted there, one `report` unit. Per unit: the
  progress write, then the checkpoint commit, then the next unit — a unit end is a safe resume
  point; a session resumed inside migrate runs only the units not `done`, and a `running` unit
  re-renders its slugs (the driver is idempotent). `handoff-contract.md` § 1 row 9 + § 5,
  `migrate/SKILL.md` Phase 2. Recorded: on the 0.25.0 run the whole phase — 31 siblings through five
  parallel builders — ran as ONE unit inside one session, the most expensive session of the run,
  with no resume point between the plan and the final report.

## 0.25.0 — hands-off cost and autonomy: background instruments, inspection helpers, `--help` everywhere, bookkeeping writers, the Phase 5 contract

Source: Karl Pauls' `stardust/replica-cache-perf` (13 commits, recorded hands-off replica runs of
2026-09-18 to 2026-09-22), re-sliced into thematic commits, rebased over 0.22.2–0.23.1 and
hardened after a code review and a cross-check against the `stardust/next` research branch. The
theme is one number: a hands-off session's cost is its context, re-read on every model call and
re-written whenever a step outlives the five-minute prompt cache.

### Background instruments and the prompt-cache window

- **`replica/scripts/run-bg.mjs`** (new): `start` detaches an instrument under `run-capped`
  (900 s default) behind a first-come slot cap; `wait` returns within `--max` (100 s, ceiling
  110 s — inside the shell tool's default timeout of about two minutes, which applies only to a
  call that declares none; a declared longer timeout is honoured, and a recorded run completed
  waits of 179–181 s under a declared 200 s) with one line per job plus its verdict
  lines only, exit 75 while jobs are still going; `log --grep` reads the rest from
  `stardust/.work/replica/bg/<job>.log`; `wait`/`status` with no names report the latest batch.
  Recorded: one gate batch — three parallel steps, each `sleep 5|10|15;` then two rounds —
  blocked for 15 minutes and the next call re-wrote a 513k-token context, $6.30 for one silent
  gap, while every other gap in that session stayed under 184 s at a 96 % cache-hit ratio.
  Slots default to 3 (env override: `RUN_BG_SLOTS`, else `STARDUST_BROWSER_SLOTS`, lowers it on a
  small machine or raises it on a large one): each capture is a Chromium and a `gate.sh --full`
  round holds three at its peak, yet at 3 slots a recorded hands-off fan-out still queued 84 of
  272 jobs for more than 10 s (90th percentile 78 s). Job liveness is checked against the
  wrapper's recorded process identity, never a bare PID (a recycled PID after a reboot read
  "running" forever and `clean --all` would have signalled a stranger); the wrapper is the only
  writer of its state file after spawn; `clean --all` escalates to SIGKILL on the process group.
- **`gate.sh --full` + `--help`**: the whole Phase 4 probe set in one round — after the pixel
  verdict, content-diff, visual-diff and chrome-parity run in parallel under `GATE_PROBE_TIMEOUT`
  (300 s), reports to the gate dir, one verdict line each; exit 124 on any deadline, 2 on a pixel
  fail / structural 🔴 / chrome delta, 1 when a probe errored (no verdict is never a pass). When
  the pixel step itself gave no verdict (124, 1, 3, 4) the probes are skipped. The published round
  is the same command with the preview URL and `--marker`. The stale-instrument reaper matches
  node processes only, skips `--inspect`, and sends TERM before KILL.
- **Port probe without lsof** (replica, deploy, diff cards; gate.sh): `curl -sI localhost:<port>/`
  is the probe, a HEAD of your own file the reuse check; `lsof … || echo free` printed "free"
  beside a live listener on an image without lsof.
- **Cards**: the master card's 0.22.2 wait discipline gains the harness-neutral form (run-bg,
  `wait` as the next call, never after a `sleep`, never two long instruments as parallel tool
  calls, the main agent bound like its subagents — a 338 s foreground turn cost one cache
  re-write); one shell one working directory; author large files in parts (~150 lines a write —
  two whole-document writes each re-wrote a ~200k-token context).

### Inspection helpers and the reading discipline

- **`replica/scripts/section.mjs`, `css-rules.mjs`, `json-query.mjs`, `html-slice.mjs`** (new):
  a Markdown outline or one section (multi-section `--all` capped at 20 KB); the rule blocks
  matching a selector regex with their @media condition; the shape, key union or a bounded
  filtered table of any capture JSON, `--tsv` / `--path` for values a command consumes; one
  element of a captured page, attributes stripped, scripts and inline SVG removed. Recorded: 172
  steps carried 750k characters of tool output into a 535k-token context in 77 minutes.
- **`extract/scripts/thumb.mjs`** (new): box-filtered whole-page thumbnails (`--width 480`) so
  1-px rules survive the brand-gestalt read; the one exception to "one crop per fact".
- **`replica/reference/reading-discipline.md`** (new; the replica card goes from 35 KB on the
  source branch to 31 KB): the rules in full — which helper reads
  what, instrument output only through `run-bg.mjs wait` and `log --grep`, one crop per fact,
  never a stitched page or the live/build/diff triplet, script flags from the index then
  `--help`, never the source. The replica card carries a 15-line pointer.
- **`stardust/reference/scripts-index.md`** (new) + **`evals/lint/scripts-index.mjs`**: every
  shipped script on one line, kept complete by the lint (cap 12 KB).

### `--help` on every script

- Every script under `skills/*/scripts` prints its usage header on `--help` / `-h` and exits 0
  before parsing, reading a file or opening a browser (recorded: `section-schema` navigated to
  `--help` as a URL, `style-fingerprint` crashed, `davids-model-lint` and `sanitise` read it as a
  file). Scripts that write artifacts carry a `Writes:` block. The six scripts whose playwright
  import preceded the guard import it lazily, so `--help` answers without playwright.
- **`evals/lint/script-help.mjs`** (new, chained in `lint:stardust` and the validate workflow):
  runs every script with `--help` in an empty cwd; fails on a non-zero exit, missing usage text or
  a file written; pure libraries exempt by list.
- **Main-module guards by real path**: node resolves the entry's symlinks for `import.meta.url`
  but not for `process.argv[1]`; a symlinked checkout made each CLI a silent no-op.
- **Value flags never swallow the next flag**: `--to --force`, `--name --dir` and the like are a
  usage error naming the flag in the new parsers — run-bg, ledger, state, migrate,
  da-media-upload, the inspection helpers, thumb, measure, style-census, motion-compare (a
  status of "--force" would otherwise land in state.json).
- **`impeccable-version-check.mjs --where`** prints impeccable's skill directory offline.

### Bookkeeping writers

- **`stardust/scripts/ledger.mjs`** and **`state.mjs`** (new): one conformant `status.jsonl`
  line per phase transition, the phase name normalised against each skill's table (`--strict`
  refuses an unknown one; optional `--next` / `--owner`); `state.mjs advance <slug…> --to
  <status>` follows state-machine.md (backward refused without `--force`, `--history-only` for
  the re-prototype case, the 0.23.0 `flow` keys kept in place). Recorded: one run wrote five
  archetypes' ledger lines a session later from a throwaway script.
- **`migrate/scripts/migrate.mjs`** (new): the per-page render driver — page map, URL-literal
  output path (collisions checked on the AEM-folded path too), internal-link rewrite, asset
  bundling, `<head>` composition, strict validation, `_meta.json` sidecar, idempotent skip, the
  `migrate` block of `state.json` merged not replaced; `gate` / `deviation` / `decision` /
  `variant` / `modules` for the judgments only the agent records. Refuses to render on a
  project whose `state.json` carries no `flow` (0.23.0 routing).
- **`replica/scripts/gate-evidence.mjs`** (new): derives the sibling acceptance gates from
  run-bg job evidence into `gatesPassed[]` and `progress.json`, attributing jobs by their
  arguments and taking the latest ended job per page × instrument × width. A sibling absent from
  a variance probe is OPEN, never passed on the archetype's summary; a job that hit its deadline
  or gave no verdict is OPEN; every pixel line names its regime (`[prototype regime]` on a local
  build URL, `[published regime]` otherwise); `--check` fails on a gate whose latest evidence
  regressed; writes are atomic. `content-fidelity` stays the agent's declaration.
- **`replica/scripts/foundation-freeze.mjs`** (new): `freeze` writes the sha256 manifest of the
  delivery foundation (`styles/`, `fonts/`, `head.html`, `scripts/`, header and footer blocks);
  `check` exits 1 on any drift. Symlinks recorded, not followed.
- **`rollout/scripts/inventory.mjs`**: an archetype whose sidecar leaves `template` null groups
  under its own slug; its representative is the archetype; empty `modules[]` counted.
- **`rollout/scripts/lib.mjs` `blockCounts` + `update-coverage.mjs`**: a module the agent maps to
  EDS default content (title, text, image, button — no block needed) is recorded
  `--block <id> --status converted --eds-name default-content` and is never counted pending,
  whatever its status; `blocks.mjs` re-runs keep the mapping and the dashboard snapshot uses the
  same count. A recorded hands-off run left four such rows at `status: pending`,
  `rollout.json.lastRun.blocks.pending` stayed 4 with every page live and verified, and a
  downstream completeness check read the finished run as unfinished.

### Media and delivery

- **`deploy/scripts/da-media-upload.mjs`** (new): the DA media protocol as a script — multipart
  PUT, persistent ledger (atomic), capped retries, content URLs printed, the token never;
  `--scope media/<name>` refused (a recorded run doubled the folder, 242 wrong uploads). 401
  policy from both recorded failures: a JWT past its `exp` exits 3 before any request; the first
  upload runs alone to prove the token and a burst 401 on it is retried (a valid token was
  answered 401 across a whole first burst); a 401 that persists after the token was accepted
  HALTS the batch (exit 3, ledger persisted, the same command resumes) — never a per-file FAIL
  (an expired token once left an 894-row batch failing file by file for 5.5 hours).
- **`deploy/scripts/deploy-batch.mjs`** follows the same 401 policy: a JWT past its `exp` exits 3
  before any request; a 401 on PUT, preview or live is retried like a 429; a 401 that persists
  through its retries on any page HALTS the batch — exit 3, no new page started, pages in flight
  finished, ledger persisted through the lock-safe merge, the halted page keeps its status
  (`attempts` incremented), one stderr `HALT <path> 401 after <n> attempts — refresh DA_TOKEN and
  re-run: <the same command>` line. Before, 401 was not retryable there, the page went `put-fail`
  and the batch ran on through every remaining page with exit 1 — the shape the uploader's rule
  was written against. Exit codes documented (0 / 1 failed pages / 2 usage / 3 token halt);
  `--backoff-ms` and the env test hooks `DA_SOURCE_BASE`, `AEM_ADMIN_BASE`, `DEPLOY_VERIFY_ORIGIN`
  (production defaults unchanged); contract test `deploy/scripts/test/deploy-batch.test.mjs`
  against a local fake of the three hosts.
- **`rollout/scripts/media-reconcile.mjs`**: content-host URLs are decided `hosted` against the
  media ledger (`--media-ledger`, auto-detected), never fetched anonymously; a hosted URL missing
  from the ledger fails; with no ledger at all the URLs are `unresolved` (exit 1) — never a pass.
- **Shared ledgers safe under a fan-out** (`rollout/scripts/lib.mjs` + `update-coverage.mjs`,
  `deploy/scripts/file-lock.mjs` + `da-media-upload.mjs` + `deploy-batch.mjs`): the coverage
  files, the media ledger and the batch ledger were read whole, mutated in memory and rewritten
  in place — with several cluster subagents recording at once the last writer won, and a lost
  media row then failed the media gate. Each writer now takes a cross-process lock (a lock
  directory, stale after 60 s, a 30 s bounded wait), re-reads the file on disk, merges its own
  rows over it and writes through a tmp + rename. Contract tests spawn eight concurrent
  coverage updates and a second uploader's rows.
- **`deploy/scripts/build-harness.mjs`**: folds `section-metadata` blocks as the pipeline does
  and remaps DA image URLs to captured files via `--media-ledger`.
- **`replica/scripts/measure.mjs`** and **`extract/scripts/style-census.mjs`** (new): box-by-box
  live-vs-prototype deltas for a selector list; the computed-style census over every captured
  page. Both open the live side through the diff skill's `live-session.mjs` (real-Chrome UA and
  headers, consent dismissal, bot challenge = exit 3), never a bare launch; the census runs once,
  in the background, after the crawl.
- **`replica/scripts/motion-compare.mjs`** (new, advisory): one line per behaviour between two
  motion-observe outputs plus a summary; a MISSING / EXTRA line is confirmed on the class lines,
  never a gate by itself (the sampler misses class-toggled and pseudo-element mechanics).

### Phase 5 contract and fan-out rules

- **`replica/reference/handoff-contract.md`** (new): what the Phase 5 executor needs from
  migrate, deploy and rollout — sibling-tier steps, the editability, decode and DA protocols,
  rollout phases A–I with their ledger strings, one usage line per script, bookkeeping. C-deliver
  runs as recorded units in `stardust/rollout/progress.json`: C0 foundation authored and deployed
  by one foundation subagent, gated by the main agent on the published origin, then
  `foundation-freeze.mjs freeze` + commit; C1…Cn one subagent per template cluster runs the whole
  chain — local asserts, PUT → preview, the published-origin gates — driving its own
  `deploy-batch.mjs --paths … --ledger stardust/deploy/ledger-<cluster>.json --concurrency 2`
  (the shared ledgers are lock-safe, so clusters deploy at once; a recorded 36-page hands-off run
  delivered 36/36 this way with zero 401s and its coordinator at or below 131k tokens of context)
  and reports one verdict line; the main agent only spawns, waits and records; C-final applies the
  queued `foundation-requests.md` once. A unit end is a resume point, never by itself a reason
  to end the session.
- **The foundation is a subagent's unit**: a recorded run's main agent authored, deployed, gated
  and fixed the foundation itself in C0 and grew from 107k to 337k tokens of context inside that
  one unit — more than its four cluster units together; the coordinator now gates the shell only,
  and a failing gate goes back to the foundation subagent as one message carrying the numbers.
- **Rules placed where the agent acts** (replica, rollout, deploy cards): lint and commit the
  foundation before any cluster subagent spawns, no frozen-file rename after fan-out; lint rules in
  every brief; disjoint clusters spawn concurrently; the root `/` is served by the `index`
  document and must answer 200 (a `/` redirect row only when the source root itself redirects);
  captured pages are always delivered — the ≤ 12 default is for uncaptured in-scope targets,
  which are a capture gap (crawl first) when the direction caps meant to include them and scope
  extension (repoint) otherwise, both recorded in `direction.md`; one-shot helpers live under
  `stardust/.work/<skill>/probes/`; every `url()` in a lifted CSS rule is rehosted under
  `stardust/current/assets/`.
- **Sibling pixel bar**: each sibling is gated at 1440 AND 360 before delivery through run-bg
  (eleven siblings once failed the published 360 bar at 17–27 % after inheriting a gated
  archetype); recorded as prototype-regime evidence that never replaces the published-origin
  gate.
- **source-fidelity-gate.md**: the header/footer `crop-compare.mjs` invocation is complete on
  the card, each band number named with the shipped output it comes from; the published round is
  the Phase 4 command with the preview URL.

## 0.23.1 — chrome: hover-dropdown reachability rule (deploy § 6, replica mechanism cloning) + qa `dropdown-unreachable` rendered check

Recurring chrome defect: a hover-opened desktop dropdown whose sub-list is absolutely positioned
with an offset below the hovered `<li>` closes as the pointer crosses the gap; every crop and pixel
gate passes because the resting state is identical (recorded 2026-09-19: 5/5 dropdowns unreachable
on a deployed origin; an earlier same-symptom `pointer-events: none` case in the 2026-08 harvest).

- **`deploy/SKILL.md` § 6**: "Hover dropdowns need a contiguous hover surface" — `<li>` spans the
  nav row with the sub-list at `top: 100%`, or keep the lifted geometry and bridge the gap with an
  invisible `::before` (off in the mobile query; preferred in replica mode); pre-deploy grep.
- **`replica/reference/recreation-procedure.md`** Mechanism cloning rule item 4: hover-path
  reachability is part of the state machine — verify trigger → first sub-link keeps the menu open.
- **qa `dropdown-unreachable`** (rendered, desktop 1440, error): submenus discovered generically as
  header elements that become visible on hover over a `header nav li`; the pointer walks in 2 px
  steps straight down to the first sub-link; fails if the menu closes on the way or on arrival or
  the sub-link is not under the pointer. Once per distinct header; fixture test
  `qa/scripts/test/dropdown-unreachable.test.mjs`.

## 0.23.0 — routing enforcement: the migration flow is chosen once, recorded, and guarded at every entry

Evidence base: the same 48 field sessions. 0.18.5 fixed the routing *surface* (the two-flow table,
"never mix", the never-chain descriptions) and the class survived it: on 0.21.1 a keep-design ask
("migrate … to the final fidelity") loaded `prepare-migration`; on 0.18.5 a "same design" ask adopted
a redesign-only "train the template, then compile" plan and reverted it after an hour, 45 turns and
36 M tokens; a 144-hour resume session invoked no stardust skill at all and followed memory. Earlier
in the corpus (0.18.1–0.18.2): "build a 1:1 migration plan" ran the redesign cascade for two hours
before `direct` was asked for an "exact replica" and kept going — 2,207 pages published at 24–28 %
pixel diff; a migration assessment ran the prep cascade 3.5 hours before the user asked for the
keep-design flow and the work was discarded; `migrate <url>` / `extract <url>` as first commands on
two same-design migrations led to hand-built compilers tuned by eye. Routing must be enforced at the
sub-skill entry points and on the resume path, not only described in the master skill.

- **`state.json.flow`** (`"redesign" | "replica" | "reskin"`, + `flowChosenAt`, `flowSource:
  user-phrase | question | hands-off-default`) — `reference/state-machine.md` § Flow keys: stamped
  once by whichever entry resolves the choice (master routing, `replica` / `prepare-migration` /
  `reskin` Setup, `direct`'s hand-off); changed only by an explicit `--switch-flow`, which records a
  `MODE SWITCH` in `direction.md` and marks the old flow's prototyped/migrated pages stale.
- **Master skill § Two migration flows**: keep-design phrases ("exact replica", "1:1",
  "pixel-perfect", "faithful", "same design", "keep the current design", "re-platform only", every
  axis pinned) select `replica` without a question; redesign phrases select the redesign flow;
  anything else asks the one keep-vs-redesign question (hands-off: keep-design phrase → `replica`,
  else `redesign`, recorded). Planning aids are named per flow; a redesign procedure inside a
  replica run (or the reverse) is a routing defect to refuse or flag. § Routing: a resume (new
  session, "continue", memory-driven) starts with the state report and enters the next phase through
  its skill. § Journal rule: agent-authored crawlers, compilers, importers and gates that replace a
  skill phase are **named deviations** in `direction.md`. Description now says "resume a … migration".
- **Entry guards**: `migrate`, `deploy`, `rollout` and a migration-intent `extract` refuse to start a
  migration on a project with `state.json` and no `flow` (two-flow table, hand back);
  `prepare-migration` refuses under `flow: replica` and resolves an absent flow before running;
  `replica` refuses under `flow: redesign` and stamps `replica` when absent; `reskin` stamps `reskin`.
  A bare `extract` for redesign/audit/uplift and `deploy` on hand-authored prototypes (no
  `state.json`) are unaffected.
- **`direct` Phase 1**: a zero-movement phrase (every axis pinned) is not a direction — write the
  hand-off note, stamp `flow: replica`, stop with "run replica"; hands-off does not skip this.
  intent-dimensions § 9 says the same in one line.
- **First gate carries the choice**: `prepare-migration` Phase 1 gate prints `Flow: redesign …
  switch to replica`; `replica` Phase 1 surfaces `Flow: replica … switch to redesign`. The state report
  gains a `Flow:` line and replica-flow recommendations from `progress.json` (last gate numbers per
  archetype).
- **Gated-archetype precondition** (`flow: replica`): `migrate` (sibling tier) and `rollout` Setup
  read `stardust/replica/progress.json` and block a page type whose archetype has no gate result at
  each breakpoint that is a pass or over-the-bar with every residual carrying a `cause`. Reuses the
  gate's pass/residual semantics; thresholds unchanged.
- **`evals/routing-migration-flow/`** (new): four phrasings; asserts the flow is named first, the one
  question for plain asks, `flow` recorded, `replica` invoked and `prepare-migration` never loaded for
  keep-design, `migrate` never first, no hand-built pipeline.

Deferred to the T13 progress-surface work: the enriched state report as a script (`stardust status`).

## 0.22.2 — wait discipline: the coordinator never parks the conversation past the prompt-cache window

Evidence base: the same 48 field sessions (Aug–Sep 2026, 24 projects), 20.7k main-session
requests. 1,271 requests re-wrote most of their context (649 M of 713 M cache-creation tokens);
1,222 of them followed an idle gap of ≥ 5 minutes. Classified by what preceded each: 46 % were the
agent's own blocking waits — a foreground `sleep` (median 480 s), a 5–10-minute foreground gate
sweep, crawl or publish loop, or a blocking read of an agent's output with a 10-minute timeout —
worth 325 M tokens; 33 % were the user typing after a pause; 11 % were background-task
notifications that arrived after 5 minutes. The cliff is sharp: a foreground `sleep` of ≤ 240 s
missed the cache in 10 % of cases, 271–300 s in 18 %, ≥ 301 s in 85–87 %. Nothing in the plugin
mentioned the cache window; the existing rule forbade `sleep N; kill` around instruments only.

- **Master skill, hands-off defaults**: a "Wait discipline" bullet — long steps run in the
  background with a progress/summary file; the coordinator does independent work or checks the
  file at most every 4 minutes; never a fixed `sleep` ≥ 5 minutes, never a blocking output read
  with a long timeout, never a foreground command expected to exceed ~2 minutes. Ending the turn
  is for the user's benefit, not the cache's (a notification after 5 minutes misses too), so it is
  reserved for waits over ~45 minutes or decisions the user should take. A Claude Code-marked
  note names `run_in_background` and the harness's `promptCacheTtl: "1h"` owner setting (2× write
  price instead of 1.25×; on these sessions it alone would have cut cache-side spend by ~29 %,
  the rule alone by ~18 %).
- **Mirrors**: deploy § 7 (brief/reading discipline), source-fidelity-gate § Iteration discipline
  (gate rounds over several pages run in the background, not as foreground `for` loops — 58 % of
  the recorded 5–10-minute sweeps re-wrote the prefix), rollout execution model (the batch driver's
  log and ledger are the progress file).
- No instrument, gate, threshold or verdict changes; the DA protocol's capped `until … sleep 3`
  waits (≤ 3 min) stay as they are.

## 0.22.1 — replica instruments: the pixel-compare hang fixed, deadlines, live-side caches, a path lint

Evidence base: 48 field sessions (Aug–Sep 2026, 24 projects) plus the notes those runs wrote about
themselves. `pixel-compare.mjs` was slow or timed out in 17 of 24 runs and on every plugin version
since 0.18.1; seven projects' own notes name it, four describe it sitting at 0 % CPU after printing
its verdict; agents answered with `sleep 150; kill` loops that cost one page 30 fixed minutes.
Reproduced 2026-09-18: with stdout redirected (as gate.sh and every agent pipeline run it),
`process.exit()` after the compare hung Node's platform shutdown (`Environment::Exit →
DisposePlatform → WorkerThreadsTaskRunner::Shutdown → uv_thread_join`) in roughly 1 run in 4; nine
such processes from earlier migrations were still alive on the test machine, some for six days.

- **pixel-compare.mjs**: exits by draining (`process.exitCode`) instead of `process.exit()` —
  0 hangs in 10 runs where the original hung; plus a supervised `--timeout` (default 120 s,
  exit 124 = no verdict, not a FAIL) because the compare is synchronous and cannot time itself out.
- **run-capped.mjs** (new): the deadline wrapper — macOS ships no `timeout`; kills the whole
  process group (Chromium children included), passes exit codes through, 124 on the deadline.
- **gate.sh**: every capture runs under `run-capped` (`GATE_STITCH_TIMEOUT` 300 s,
  `GATE_COMPARE_TIMEOUT` 120 s), a partial live.png is never left for reuse, and this user's
  replica instruments older than `GATE_REAP_MIN` (15) minutes are reaped before a round.
- **chrome-parity.mjs `--live-cache`, anchor.mjs `--cache`**: the live side's measurement is
  probed once per breakpoint and reused while URL, width and selectors match — the same contract
  gate.sh already had for live.png (recorded: 5½-minute chrome-parity rounds ×3 ×4 archetypes).
  anchor.mjs also warns when `--main` matched a wrapper that still contains header/footer (the
  false-structural-red class recorded on four archetypes at once).
- **evals/lint/script-paths.mjs** (new, in `npm run lint:stardust` and CI): every plugin-internal
  `skills/<skill>/scripts/…` and `skills/<skill>/reference/…` path a skill doc names must exist.
  It found two dangling references on main (a gate example pointing at the wrong skill's
  `content-diff.mjs`, a hypothetical migrator path); both fixed.
- Docs: source-fidelity-gate § Iteration discipline names the deadlines and caches; replica Phase 4
  snippet uses them; deploy § 7 and the master skill's hands-off defaults get a brief-size and
  read-by-section rule (across twelve runs deploy/SKILL.md was read whole ~20× per run, once per
  dispatched agent; in one recorded run the watchdog-killed agents carried the fattest briefs); the DA protocol's two
  `until … sleep 3` waits are capped and fail loud.

## 0.22.0 — stardust owns `stardust/`: write boundary and versioning policy

Field projects answered "what do I commit" by hand, each differently; one lost its state machine
to a bare `state.json` exclude. Now: stardust writes only to `stardust/`, the impeccable root files
and the EDS project (via deploy / rollout / dynamics); run-only files go under `stardust/.work/`.
Three leaks fixed (replica's script copies left the boilerplate `scripts/`, deploy's harness left
root `qa/`, deploy's pre-render left `samples/`). New Setup step 6 installs `stardust/.gitignore`
(everything tracked except screenshots, `current/assets/`, `replica/gates/`, `migrated/assets/`,
`rollout/qa/`, `.work/`, run residue, session state), covers `.env`, lists `stardust/` in
`.hlxignore`, asserts `state.json` is not ignored, offers LFS above 50 MB. State report gains a
`Repo:` block; artifact-map gains § Versioning; qa baselines are local.

## 0.21.1 — evals: criteria.json in the tessl `weighted_checklist` schema

`tessl plugin publish` validates every `evals/*/criteria.json` against the registry schema
(`context`, `type: "weighted_checklist"`, `checklist[{ name, max_score, description }]`); the
plugin's evals used the runner's own `{ criteria[{ id, weight, description }], total }` shape, so
0.20.0 and 0.21.0 both failed to publish. All eleven rubrics are converted (ids → `name`, weights →
`max_score`); the runner normalises either shape (`normalizeCriteria`), so scoring is unchanged.

## 0.21.0 — AI readability: the checker formula, one gate, document-first listings

Four migrations (a family-entertainment chain, a semiconductor company's replica, a UK
package-holiday retailer, a beverage brand pilot) were scored 40–58 % by Adobe's "AI Content
Visibility Checker" while every stardust gate was green. Each session reverse-engineered a
different model of the tool — served-text parity, hidden text, markdown line diff — and each spent
a round on a fix the score did not reward (inlining nav/footer into 143 documents; clipping instead
of hiding; unwrapping generated anchors). The extension's own analyzer code settles it:
**score = min(100, served words ÷ rendered-DOM words)**, landmarks stripped by default, hidden text
counted as rendered, a count ratio and not a word-set diff. Reproduced to the word on one site.

- **New reference `deploy/reference/ai-readability.md`** (on demand): the formula and its
  consequences (what JS adds to the DOM is the whole defect; hidden text, chrome and generated
  anchors are neutral; served-only text inflates; short pages suffer most), the two metrics kept
  apart (checker score vs served-text parity), a cause-class table with remediation (loop clones,
  index-fed cards, runtime fragments, definition-driven forms, generated labels), six block rules,
  chrome inlining as a documented option with its trade-off, and the gate contract.
- **New gate `deploy/scripts/ai-readability.mjs`**: exact reimplementation, both toggles, `code`
  score (fragments credited, app blocks excluded), per-block served-gap attribution, allowlist by
  block + string, JSON report, exit 1 below `--min` (98). Runs in the deploy atomic delivery
  contract on the published page, as the new `qa` check `ai-readability` (K), and in `audit`
  Phase 4.
- **Block rule (deploy, always-on, one bullet): `decorate()` adds no words to the DOM** — clones
  presentational, listings document-first, generated text only for allowlisted runtime values.
  The D12 key-facts paragraph shrinks to a one-liner that points at the reference (net always-on
  growth ≈ 0).
- **Listings contract rewritten (`dynamics/reference/listings.md`)**: document-first — one authored
  row per item with the card's text, a heading row per group, a label-list row; the block uses the
  index for non-text fields and top-up; re-runs replace their own rows. Dynamics Phase 4 and
  rollout D2 point at it.
- **Replica**: loop clones carry no text/alt/href/aria (`recreation-procedure.md`).
- **Eval `evals/ai-readability/`**: clones, document-first listing, explicit fragment decision, no
  generated text, gate reported, checker facts stated correctly.
- Not adopted, on evidence: clip-instead-of-hide rules (hidden text is neutral), inlining nav/footer
  into every document as a default (does not move the default score; two of three owners declined),
  CSS-stretched links *for the score* (kept as the accessible-name shape only).

## 0.20.0 — dynamics: the dynamic surface of a migration

Three real migrations (a US health insurer's employers section rebuilt greenfield, a UK
package-holiday site on an existing EDS library, a consumer-credit site re-platformed at
~5,900 URLs) found the same thing: a site's dynamic surface — modals, players, forms,
search, tags, APIs, client-rendered and sheet-backed content — is invisible to a
block-scoped, pixel-verified pipeline, and invisible in a way every gate certifies as
correct. This release makes it visible, forces a decision per row before import, and
proves the behaviour after delivery. Migration-bound by design: default-on in both
migration flows, never for redesign-only work.

- **New sub-skill `stardust:dynamics`** (`skills/dynamics/`): detect → classify → triage →
  implement → verify. Triage on **four axes** — class (`L S F M V T A R X I18N CR D`),
  disposition (`rebuild-native · index-backed · data-fed · embed-passthrough · client-only ·
  static-snapshot · decided-out`), reproducibility (`self · needs-credential ·
  needs-human-capture · needs-backend · needs-business-decision`), status. Only `self` ships
  autonomously; the rest is one owner decision batch. Hard rules: reconcile against the
  migrated output first, never fabricate a blank client-rendered page, never auto-wire a
  regulated-PII form, a search box implies a results page, decided-out is explicit.
- **References** (loaded on demand, not in the always-on skills): classes-and-signals,
  triage (+ the `stardust/dynamic-features.md` inventory format, which subsumes the former
  dynamic-blocks map), patterns (catalogue with contracts and three embedded example
  mechanisms — modal loader, index search, JSON post with honeypot), listings (folded from
  rollout's dynamic-listings), off-origin-data (host-keyed endpoint indirection, code-bus
  snapshots, fetch shim, per-state rendered snapshots + `Source` row, sheet sync, chrome URL
  space), forms (controls not form tags; intake by content source; regulated data),
  parity-report, locale-trees. The plugin ships **contracts and tooling, not blocks**: no
  block was reused as-is across the three cases and an existing library must be fed, not
  forked.
- **Tooling** (`skills/dynamics/scripts/`, verified end to end on a local fixture):
  `dynamics-detect.mjs` (network log by host, first-party API paths with status, POST
  bodies, forms **and form-less control groups**, the trigger → dialog → content graph,
  player ids, iframes without src, tag-manager mount divs, settings-object keys, framework,
  auth/commerce/locale, client-rendered slots and pages, listing candidates; `--from-state`
  for one page per type; `--reach` folds the crawl's per-page signals in),
  `dynamics-plan.mjs` (four-axis draft per finding, `--target-origin` **host-bound** probe of
  every recorded API path, `--migrated` reconcile against delivered output, regulated-PII
  flag), `dynamics-check.mjs` (parity replay over a closed set of check types —
  `fetch-json`, `dom-count`, `click-dialog`, `search-query`, `form-flow`, `video-plays`,
  `consent-gate`, `no-page-errors` — third-party request statuses recorded per check),
  `snapshot-api.mjs`, `snapshot-forms.mjs`, `sync-sheets.mjs`, `vendors.json` (the
  classification engine: host pattern → class + role, product names only).
- **Hooks in the existing skills, ≤15 lines each:** `extract --dynamics` (opt-in per-page
  reach signals; never set by a bare extract, `uplift` or `audit`); `prepare-migration`
  Phase 4.5 and `replica` Phase 2 run Phases 1–3 as the pre-import gate; `migrate` Phase 1
  is the safety net for the hand-run flow; `deploy` reads the inventory as brief input and
  never flattens `client-only` / modal-bearing sections into prose; `rollout` B2 verifies the
  inventory against fresh evidence, D2 implements the `self` set and batches the rest, H
  reports parity; `qa` gains the `dynamics` check (`parity-missing` / `parity-failed` /
  `parity-env-limit` / `parity-unchecked`); master routing + both flows name it.
- **Origin-scoped site auth everywhere.** `resolveSiteAuth` / `attachOriginAuth` in the shared
  live-session helper and the qa runner (`--auth-header` / `--token-env`, default
  `SITE_TOKEN`): the secret rides a route filter on the base origin only — a context-wide
  header leaked it to a video vendor's playback API, whose CORS check then produced a player
  error real users never see.
- **Learnings ledger** failure classes `dynamic-gap` / `api-dependency` now point at the
  dynamics references. Removed: `rollout/reference/dynamic-listings.md` and the 0.19.9
  `dynamic-capabilities.md` (folded into `skills/dynamics/reference/`).

## 0.19.8 — impeccable dependency: unpinned by design, with an update hint

- **Dependency declaration** moves to the documented cross-marketplace object
  form — `{ "name": "impeccable", "marketplace": "impeccable" }` — still with
  NO version range, on purpose: impeccable's design craft should always be
  the current one. (The root marketplace's `allowCrossMarketplaceDependenciesOn`
  already lists `impeccable`.)
- **New `stardust/scripts/impeccable-version-check.mjs`** — Claude Code only
  announces plugin updates through marketplace auto-update, which is off by
  default for third-party marketplaces, so a user can sit on an old
  impeccable indefinitely. Setup step 1 now runs this check once per session
  and surfaces its one line when a newer impeccable exists (installed
  version from the plugin registry or `--local <dir>`; latest from the
  upstream manifest with a 6s timeout, falling back to the cached
  marketplace catalog; `--offline`, `--json`). Advisory only: always exits 0,
  fails silently to "unknown" — the registry paths it reads are Claude Code
  implementation details, not an API.
- **Manifest drift fixed:** the adobe-skills marketplace entry and the Tessl
  manifest both still said 0.18.1 while `plugin.json` was at 0.19.7 (the
  validator warned; `plugin.json` wins at install, so users were unaffected,
  but `claude plugin tag` requires agreement). All three now read 0.19.8.

## 0.19.7 — sibling variance probe (P12)

- **New `replica/scripts/sibling-variance.mjs`** — before cloning a gated
  archetype onto its siblings, probe the template-defining computed values on
  every sibling's LIVE page and diff against the archetype: per `--probe
  name=<sel>` the match count, first match's box + computed group (background
  layers incl. gradient scrims, colour, padding, font, radius), first heading
  and image, list-style and `::before` mechanism, and the number of distinct
  style families among matches; plus the top-level section list. Defaults
  (first section, most-repeated class, `li`) when no probes are given.
  Live-session hardening as the other replica instruments. Exit 0 constant,
  2 variance found. Read-only — it never edits the clone.
  Field evidence: eight "same-template" siblings varied in hero template
  (441 vs 528px), scrim direction, bullet mechanism and terms shape — all
  found late at the pixel gate.
- **Fidelity tiers:** the sibling tier is "variance-probed" first; new
  § Sibling variance probe — every delta is budgeted as a block VARIANT class
  emitted on the sibling's content (blocks stay generic, never forked per
  page); `gatesPassed` gains `variance-probe`, `_meta.json` gains
  `variants[]`. Replica Phase 5 and migrate's A′ branch point at it.

## 0.19.6 — replica: glyph-dense chrome noise floor, evidence-gated (P6)

- **`crop-compare.mjs` reports the diff TEXTURE** — the share of differing
  pixels with ≥5 differing neighbours: thin-edge = glyph-antialiasing noise,
  thick = blocks/bands (misalignment, missing paint). Reported in text and
  `--json`; never changes the exit code.
- **Gate doc, pass bar item 5:** a glyph-dense chrome band that fails the 2%
  bar may be logged as a justified residual (`cause: "glyph-antialiasing"`)
  — never a pass — only when all three hold and are attached as artifacts:
  `chrome-parity.mjs` exit 0 for the region at 1px tolerance, crop-compare
  texture thin-edge (≤15% thick), and a text-dense region (no imagery/icons).
  Field evidence: a ~50-link footer bottomed out at ~5% with every metric
  numerically identical; a hinted licensed face vs a self-hosted webfont
  rasterise differently per glyph. The 2% bar is unchanged; residual logging
  format gains the entry shape.

## 0.19.5 — deploy: link localization as a pipeline stage (P24)

- **New `deploy/scripts/localize-links.mjs`** — dependency-free, idempotent.
  Builds the URL map from the content tree (every served path, extensionless,
  `x/index.html` → `/x`) plus `--redirects` (rollout's `stardust/redirects.tsv`
  or a JSON map), rewrites every source-host `<a href>` (with/without `www.`,
  http/https/protocol-relative) whose path resolves in the map to the
  canonical root-relative form — no `.html`, no trailing slash, query and
  fragment preserved — and normalizes root-relative internal hrefs the same
  way. Everything else stays absolute and is REPORTED (the not-yet-migrated
  boundary). `--dry-run`, `--json`, and `--check` (write nothing, exit 2 when
  localizable links remain — the pre-deploy assertion).
  Field evidence: ~500 source-domain links across ~150 pages bounced visitors
  back to the live site for pages that existed on the new origin.
- **Deploy stage:** the Deploy table and the per-page atomic delivery contract
  gain the stage (run after every generator and before every write, over the
  WHOLE tree; re-run after every wave). The ENCODE D4 bullet and
  `davids-model.md` now say what D4 is — a capture-fidelity rule for media and
  external targets — and that internal links to migrated pages are
  root-relative. Checklist item added. Rollout Phase E2 points at the stage
  instead of a hand rewrite.
- **Lint (advisory):** `davids-model-lint.mjs --source-host <host[,host]>
  [--content-root <dir>]` flags a source-host `<a href>` whose path exists in
  the content tree as 🟡 D4 LOCALIZE. Advisory by design in this release;
  promote to 🔴 after one rollout has run the stage cleanly.

## 0.19.4 — replica: chrome-parity probe (P3)

- **New `replica/scripts/chrome-parity.mjs`** — computed-style parity for
  chrome. Probes the same regions on live and build (default header +
  footer; `--region strip=<liveSel>|<buildSel>` for sticky strips), pairs
  every text-bearing element by text, and prints only the deltas: font
  family / size / weight / style / line-height / letter-spacing / transform /
  colour / background / padding / radius, element rect, the clickable box
  of links and buttons, plus an icon inventory (count, size, signature)
  paired by order; MISSING / EXTRA texts on either side. Live-side hardening
  via the shared `live-session.mjs` (UA + headers, challenge fail-loud exit
  3, overlay dismissal, `--headed`, `--locale`). Exit 0 quiet, 2 deltas.
  Field evidence: one run found what many pixel-band rounds had not
  (italic-vs-normal note, regular-vs-bold link, wrong nav link colour, 12px
  row offsets, 97×40 vs 71×32 button, six missing icons).
- **Gate doc, pass bar item 5:** styles diagnose, pixels confirm — run the
  probe BEFORE any pixel iteration on chrome and clear its deltas; iteration
  discipline gains the same rule. Replica SKILL setup copies the script and
  the Phase 4 snippet shows the call; deploy Step 10 item 4 points at it for
  the deployed-origin chrome gate. The ≥98% crop gate remains the pass bar —
  the probe is a diagnostic, not a new threshold.

## 0.19.3 — replica field harvest, part 2: row-level instruments, masks, detectors (P1, P11, P22, P16, P19, P15, P20)

Second fold of the 2026-09 same-design-migration ledger: the entries that
needed a flag or a small script. Each is additive — a new instrument, a new
flag, or a lint/gate DETECTOR; nothing changes what the pipeline emits.

- **Replica — pass bar item 5 (chrome crop gate):** chrome means every
  site-wide repeating band (header, sticky strips, footer); crops are
  element-anchored PER SIDE (fixed-y crops false-read the moment one side's
  rhythm shifts — a strip read 66% mis-anchored, 1.6% re-anchored); and
  authored-volatile regions (campaign heroes) are masked out of the number.
  `pixel-compare.mjs --mask <yA:h[@yB]>` neutralises the row band on both
  sides, removes it from the denominator and prints every mask on the
  verdict line (P1).
- **Replica — new `scripts/row-profile.mjs`:** (1) a per-column colour-class
  scan (white/dark/brand/photo run lengths at N x positions) to establish
  section boundaries from the capture instead of eyeballing crops (P11);
  (2) brand-colour landmarks — rows dominated by a saturated brand colour,
  paired live-vs-proto in order, with per-pair delta and `gapShift` naming
  the one inter-landmark gap that absorbed a vertical offset (P22). Gate doc
  § Reading the band breakdown documents both; replica SKILL setup copies it.
- **Extract — `crawl.mjs` saves the settled rendered DOM** as
  `pages/<slug>.html` (`renderedHtml` field): capture once, parse offline;
  migrate's inputs name it as the structure source for importers (P16).
- **Deploy — Step 3:** page templates that cap `main > .section > div`
  define ONE full-bleed escape at template specificity; `qa-gate.mjs
  --full-bleed a,b` warns when a listed block's section wrapper computes
  narrower than the viewport (P19).
- **Deploy — D15 lint:** inline-script text lifted as copy (`window.`,
  `try {`, `function (`) is 🔴; ALL_CAPS_TOKEN tracking lookalikes are 🟡
  advisory. Detector only — no capture-time filtering was added (P15).
- **Deploy — `block-roundtrip`:** a dead text whose words are absent from
  the decorated unit is reported as **DROPPED CONTENT** (the decoder never
  consumed that element type) rather than DEAD TEXT; Step 8 names the full
  default-content set every decorate() must consume. Detector only — no
  leftovers pass was added to the scaffold (P20).

Deferred by design: P3 (chrome-parity probe), P6 (depends on P3), P12
(sibling variance probe), P24 (link-localization stage + lint tier).

## 0.19.2 — housekeeping: no site names in the plugin

Every reference to a real customer, test or donor site — in skill text,
reference docs, script comments, the deploy IMPROVEMENTS log, the notes
folder and this changelog — is replaced by a generic sector descriptor
("a financial-services site, 8 pages", "a fashion retailer's newsletter
modal"). Numbers, dates, finding IDs and technical content are unchanged;
no script logic was touched (comment lines only, syntax-checked). Kept as
is: vendor/platform names (Akamai, Cloudflare, OneTrust, Typekit, Shopify,
DA/EDS), Adobe's own properties, fictional sample brands (Wasatch Back,
Ledgerline, Evergreen Bank, Meridian Airways), design-vocabulary brands used
as aesthetic references, and the eval suite's live crawl target.
`notes/improvement-plan-2026-08-rwe-centene.md` is renamed to
`notes/improvement-plan-2026-08-replica-deploy.md`.

## 0.19.1 — replica field harvest (2026-09), part 1: one-bullet learnings (P2, P4, P5, P7–P10, P13, P14, P17, P18, P21, P23, P25)

First fold of a 25-entry learnings ledger from a same-design migration of
a large vendor-templated site (2026-08/09, published-origin gated, ~150
pages). This part ships
only the findings that scored 3/3/3 on general / safe / small — each is a
single bullet or an edit to an existing one; no scripts, no new sections.
The remaining entries (element-anchored + masked chrome crops, a
computed-style chrome-parity probe, sibling variance probing, capture-time
code-artifact filtering, rendered-DOM capture, a bundled link-localization
stage + lint tier) follow in separate PRs.

- **Replica — recreation procedure:** authoring step 1 reconciles component
  COUNTS from the capture before authoring (vendor templates repeat whole
  widgets; a big height delta with matching section order is a duplicate,
  not a missing section) and points at the paragraph-boundary rule; canon
  chrome is re-verified against EACH new archetype's live page before page
  content is iterated, with page-level compensation flagged for canon
  back-port; no foundation `text-wrap: balance` in replica prototypes/block
  CSS; the overlay-scrim bullet now reads the full computed
  `background-image` layer list FIRST and luminance-fits only when the scrim
  is genuinely undiscoverable; the sizing-MODEL lift covers heights and
  overlaps at two or three widths with the vw encoding formula; icons and
  vectors are harvested from the live DOM (`svg.outerHTML`), never
  approximated.
- **Replica — gate:** iteration discipline gains the post-pass typography
  spot-check (a pixel pass at the wrong base metric is latent sibling
  debt; compensating spacing is the tell); the wide-viewport check samples
  heights and one intermediate width; the published-origin gate gains two
  rules — re-probe live chrome metrics at deploy time (crawl captures are
  the content source, live-now the chrome source; mask authored-volatile
  regions) and budget one anchors-driven reconcile round at the published
  origin (the harness number is provisional); the EDS transform list notes
  that authored inner blocks may flatten, so `:has()`/block-class selectors
  are verified against the delivered `.plain.html`.
- **Migrate — content preservation:** paragraph boundaries come from the
  source's block-level nodes, never from splitting captured text on
  newlines (inline elements fragment a 5-paragraph disclaimer into 16
  `<p>`s and double the section height).
- **Deploy:** favicon delivery is verified with a `HEAD` at the published
  origin; Step 3 section styles that paint several wrappers as one surface
  contain child margins with `display: flow-root` (margin collapse through
  an unpadded wrapper paints a ground-colored stripe inside a "card");
  Step 6 chrome rows never pair a fixed `height` with vertical `padding`
  under the border-box reset; the Step 7 brief bans `<br>` inside flex/grid
  containers (it becomes a sized item) and bare `> span`-style child rules
  in variant CSS (they resurrect hidden elements); Step 10 item 5 samples
  section heights at an intermediate width.

## 0.19.0 — Experience Workspace editability contract (EW1–EW10) + gate

Every text an author wrote in a DA document must be inline-editable in
Experience Workspace (da.live canvas, "quick-edit") once generated block JS
has decorated the page — and the block must look the same while it is being
edited. Field finding (an energy-company site, 2026-09-03, two rounds: 3 blocks, then 17):
over a 29-page covering sample only 841 of 1452 authored texts were
editable; every template-slotted block was 0 %. The generated blocks were
correct implementations of the skill's own guidance (value-slotting,
`text(cell)`, clone-the-anchor) — the guidance was the bug. Mechanism
verified against da.live `editor-utils.js`/`prose2aem.js` and da-nx
`quick-edit.js`/`prose.js`; deploy improvement #123. Minor bump: new gate +
new qa check.

- **Deploy:** § Target runtime documents the workspace instrumentation
  (`data-prose-index` on outermost editables, `decorate()` re-runs over it,
  only surviving indices become editors). § 2b redefines template-slotted as
  **node-slotting** and bans value-slotting. § 3 ships three edit-mode
  foundation snippets (CTA repaint from `<strong>/<em>` marks under
  `.prosemirror-editor`, card-as-link inner anchor, `:where()` wrapper
  variants at equal specificity) + EW10 for section prose. § 5 Buttons,
  #55, #62/#71, #70 and § Section heads rewritten to MOVE authored elements.
  § 8 gets a move-based scaffold (`wrapNode`, `labelWrap`,
  `stripInstrumentation`) and the named **Experience Workspace editability
  contract (EW1–EW10)** with the gate command; Step-7 brief carries the
  contract; Local QA + Checklist gain the EW gate, edit-mode simulation,
  static review and pixel-parity lines; anti-patterns 18 (value-slotting)
  and 19 (class on the authored element); References cite the da.live/da-nx
  sources.
- **Scripts:** new `deploy/scripts/ew-editability-probe.mjs` (URL and
  `--content` harness modes, `--simulate-editor` drift report, `@ew-exempt`
  JSDoc tags); `block-roundtrip.mjs --ew` (default on) fails dead
  non-exempt texts and duplicated indices 🔴; `render-harness.mjs --ew
  --simulate-editor` + hides `body > header`; `section-schema.mjs` emits
  `editableTexts` per section; `content-inventory.mjs` exports the
  outermost-editable classifier and `content-diff` reports an
  `EDITABLE COUNT` advisory.
- **qa:** new `editability` check (`editability/dead-text` error,
  `editability/duplicated-index` warn, per-page summary; `--blocks-dir` /
  `--ew-exempt` for exemptions).
- **replica / rollout / reskin / migrate fidelity-tiers:** every block-authoring
  handoff cites the contract and the EW gate (the brief skipped it on 27/27
  blocks because it did not carry it).
- **Evals:** new `ew-editability` (node-slotting, move-not-rebuild,
  wrapper-descendant selectors, gate evidence, fidelity not traded).
- **Ledger:** deploy `IMPROVEMENTS.md` #123; master `reference/learnings.md`
  example entry.

## 0.18.5 — migration-flow routing: replica subsumes prepare-migration

Routing-surface fix, no pipeline behaviour change. Field finding
(an air-cargo site, 2026-09-03): asked "how do I migrate X to EDS with
stardust", the agent correctly proposed `replica` for the keep-the-design
route but could not say whether `prepare-migration` was also needed — the
subsumption fact lived only in `replica/SKILL.md`'s Phase 1–5 body, which
is never in context until replica is already invoked, and `replica` was
absent from the master skill's routing table altogether. One clarification
round-trip per migration conversation.

- **Master skill:** routing table gains the missing `replica` and `reskin`
  rows and marks `prepare-migration` as redesign-flow only. New § Two
  migration flows — pick one, never mix: redesign
  (`prepare-migration` → `migrate` → `deploy`/`rollout`) vs. keep-design
  (`replica` → `migrate` → `deploy`/`rollout`, where replica runs
  `extract --prep`, a mechanical direction-preservation step, and gated
  archetype recreation in place of the prep cascade), plus `reskin` for
  donor-design/same-content. Instructs stating the chosen flow — and that
  replica needs no separate prep — in the first response.
- **prepare-migration description:** "Redesign-flow only — for same-design
  migrations `stardust:replica` runs its own preserve-mode prep cascade;
  never chain prepare-migration with replica."
- **replica description:** "subsumes the `stardust:prepare-migration` prep
  cascade in preserve mode — no separate prep step; never chain the two."

Descriptions are the always-loaded routing surface, so the disambiguation
now holds even when only the sub-skill frontmatter is in context.

## 0.18.4 — commerce-site field harvest: chrome crop gate, sizing-model lifts, EDS authoring traps

Harvest of three learnings ledgers from a five-design Magento-PageBuilder →
EDS migration (two sibling commerce sites, be/nl + nl, 2026-08, published-origin
gated). The headline failure class: **small-area, high-salience defects that
pass the full-page bar** — both pilot runs shipped "green" pages whose
header/footer measured only 93–97% match, and a frozen `width:720px` lifted
from an authored `width:50%` passed both gate breakpoints byte-identically.
All changes are site-agnostic; deploy improvements #115–#122.

- **Replica:** new `scripts/crop-compare.mjs` (per-y-band pixelmatch,
  per-side offsets, default bar 2%); the pass bar gains item 5 — header AND
  footer bands each ≥98% over the same stitched captures, no extra live hit
  (#115). New § Wide-viewport fluid check: a ≥1920 box-map spot check
  catches fluid-vs-fixed width freezes both standard breakpoints render
  identically (#116). Recreation procedure gains § Lift the sizing MODEL,
  not the resolved value (two-width lift diff; encode the authored
  `%`/`vw`/max-width rule, never the resolved px; layout models, not
  wrap outcomes). Iteration discipline gains geometry-fix verification
  hygiene — rule-bearing element, cache-free serving check
  (`curl --compressed | grep`), back-computed reviewer viewport (#117).
- **Deploy:** ENCODE contract — never author `<hr>` (it is the section
  delimiter; fractures the section at ingestion — lint 🔴, rule `HR`,
  #119); rehost assets only from the CAPTURED src and diff
  dimensions/bytes after fetch (commerce CDNs answer 200 with a generic
  fallback for guessed paths, #118). Step 3 — one section-metadata `style`
  value per section (multi-value delivered only the first class; anchor a
  second axis with content-scoped `:has()`, #120); empty-section
  `display` overrides must scope to `[data-section-status='loaded']` or
  they defeat pre-load hiding (measured 0.75 CLS, #121). Step 10 gains the
  chrome crop gate, the ≥1920 box check, and the verification-hygiene
  items. The deployed computed-style guard also asserts `clientWidth > 0`
  per visible loaded image — loaded ≠ rendered; circular flex sizing
  collapses an image to 0×0 with `naturalWidth` still > 0 (#122).
  `sanitise.js` now refuses >2 arguments: the two-arg <input> <output>
  convention made a 3-file batch silently overwrite the second file with
  the first's content.
- **QA:** new `zero-size-image` check (warn) — loaded image renders 0px
  wide while participating in layout (`getClientRects()` guards against
  display:none false-flags).
- **Reskin:** Image-paint gate documents the same loaded-≠-rendered blind
  spot (paint asserts `naturalWidth`, not rendered area).

## 0.18.3 — dual-session field harvest: consent fallback, gate identity assertion, capture-freeze hardening

Harvest of two independent replica+deploy sessions (an energy-company site and a healthcare-insurer site,
2026-08-26/27, on 0.18.2). Three failures recurred in BOTH sessions and lead
the release: a stale cross-project `:8791` server silently gated a foreign
site (once in each direction — every skill doc suggests the same port, so
collision on a shared machine is guaranteed); consent widgets missed by the
selector list (on the healthcare-insurer site the banner baked into ground truth AND all 7 stitch
seams → 32% false pixel diff, one gate round invalidated); and live-data
embeds (mirroring the SAME src cancels the data out in the pixel diff —
freezing a snapshot guarantees a widget-sized residual). All changes are
site-agnostic and additive; the high-impact-but-not-low-risk items
(shared-classifier element-boundary separators, stitch-shot `--fullpage`,
per-project default ports) are deliberately deferred with rationale in
`notes/improvement-plan-2026-08-replica-deploy.md`.

- **Extract:** `crawl.mjs` consent dismissal gains a visible-button
  text-match fallback — exact short labels (Accept / Accept all / Allow all /
  Agree / OK / Decline / Alle akzeptieren / Accepter), overlay-container
  scoped, runs ONLY when the selector pass matched nothing, so existing
  selectors keep priority and an in-content link can never match. Favicon is
  now captured on the ENTRY page in every mode (bounded `--pages` extracts
  skip Phase 3 where favicon capture lived; deploy then skipped silently and
  shipped the default icon) via an in-page fetch that inherits the context's
  fingerprint. Bot-wall note: page-level walls usually do NOT gate assets —
  probe one asset with a browser-UA curl before building in-page-fetch
  machinery.
- **Replica scripts:** `gate.sh` asserts build-side identity BEFORE any
  capture — the fetched page must contain a marker (default: the `<slug>`;
  `--marker` overrides), exit 4 names the port listener via `lsof`; the
  documented default port is unchanged (the assertion makes collisions loud
  at near-zero cost). `stitch-shot.mjs`'s freeze now also pauses every
  `<video>` at t=0, clears all pending JS timers, and clicks the first
  slick-convention carousel dot — CSS-only freezing stopped neither video
  playback (~20% of one page was video noise) nor slick autoplay (slide
  identity arbitrary per capture; residual 4% → 0.8% once reset). Symmetric
  on both sides; a static page's capture is byte-identical to 0.18.2's.
- **Replica motion parity (observe, don't infer):** new
  `motion-observe.mjs` (sibling of stitch-shot, same live-session
  hardening, exit 3 on challenge) records what the live page actually
  DOES — animationstart/transitionstart events with element paths + text
  snippets, class mutations exposing the trigger mechanism, a down+up
  header-state timeline (dense near the top), `--click` widget frames,
  `--hover` computed-style diffs with the changed-property list
  precomputed. The interaction-parity pass is now a REQUIRED gate output
  per archetype — a motion inventory in `progress.json`
  (`motion: {observed, implemented, dead[]}`; live-classed-but-dead
  behaviors recorded as NOT implemented, the correct replica of a dead
  class) — because when optional it was skipped on 5 of 7 archetypes and
  every skipped one shipped visibly static. § Interaction parity is
  rewritten around the evidence rule: implement ONLY behaviors that
  measurably fired — static lifting invented motion three field-recorded
  ways (dead animation classes: 2 of 8 classed caption families ever
  fired; hover rules whose scope never matches at runtime; approximated
  chrome mechanisms allowing states impossible on live, e.g. a
  double-rendered header) — with static CSS remaining the authority for
  the exact keyframe/easing VALUES of fired animations, mechanisms cloned
  as the observed state machine, and a two-direction verification
  (pixel-compare must return to the gated number — field: 1.01% gated →
  1.06% with invented motion → 1.01% exact after the evidence-only
  rewrite — plus a behavior-match assertion off the observe JSON). Full
  spec: `notes/replica-motion-parity.md`.
- **Replica docs:** two new permanent-residual classes in the capture-state
  policy (live-data embeds — load the SAME embed same-src on both sides;
  randomized decorative elements — log, don't chase); AEM-classic richtext
  byte patterns are load-bearing (mirror them; diff `innerHTML` when a
  wrap-count mismatch survives width parity); `display: flow-root`
  reproduces clearfix margin containment (fixed −48/−20px per-section errors
  in one rule); iteration discipline gains the no-op-fix check (an unchanged
  differing-pixel count means the rule never applied — the round doesn't
  count); a "verify the port is yours" line wherever `:8791` is suggested
  (also in deploy Step 10 and the diff SKILL).
- **Deploy:** Step 3's reset now REQUIRES the global `border-box` the
  boilerplate doesn't ship — a bootstrap-era %-width+padding grid silently
  wrapped every column, +1731px doc height, all text gates green (#106);
  block DOM must not emit semantic `<header>` (the stock reservation clamps
  every one at once, #107); overlay chrome documented as the no-reservation
  #81 case (`--nav-height: 0` + absolute header, measured CLS 0.0004, #108);
  the block brief requires mobile overrides at the variant's own specificity
  (#109), `flow-root` on un-floating overrides (#113), and wrapper resets at
  lower specificity than the block's own rules (#114); never copy the
  pipeline's fallback `<img src>` (750px rendition) into a CSS background —
  rewrite `width=2000` (#110); `line-height: 0` on image paragraphs cancels
  the `<picture>` wrapper's baseline descender (#111); whitespace-only
  authored content is dropped by the pipeline — model live spacer line boxes
  as block CSS (#112); the no-favicon path is a loud WARN recorded in the
  deploy log, never a silent skip.

## 0.18.2 — replica field harvest: font-fork instrument fix, interaction parity, published-origin gate

Harvest of a full `stardust:replica` e2e run (a financial-services site → EDS,
2026-08-25/26, on 0.18.1): a home-page archetype gated to 3.55%/5.56% pixel
diff, then 8 pages published and gated against the live origin. All changes
are site-agnostic; the validated discipline (measure-first, fail-loud,
≤10% / Δ≤8px / 0-structural-red, hit minimization, no DOM copying) is
unchanged.

- **Instrument fix (diff `live-session.mjs`, F-B2):** the standard
  anti-bot header set now rides DOCUMENT requests only (via
  `context.route`), never subresources. Forced on every request it made
  cross-origin CORS-mode webfont fetches non-simple — they died with
  `net::ERR_FAILED` and every live capture silently rendered fallback type,
  poisoning the whole gate (live doc height moved 6669→6518 after the fix).
  Bot managers fingerprint the navigation request, which still carries the
  full set. Companion hardening: stitch-shot asserts fonts loaded after
  `document.fonts.ready` and warns loudly on any declared face with
  FontFace status `error` (gate doc rule 14 owns the instrument-induced vs
  capture-state decision).
- **Replica scripts:** new `anchor.mjs` (per-section `[y, height]` probe —
  run on both sides, fix the first mismatched section top-down; roughly
  halved iterations vs band-reading alone in the field) and `gate.sh` (one
  pixel round in one command, live capture cached, fail-loud on exit 3).
- **Replica gate doc:** new § The published-origin gate — only the
  published number counts for platform-delivered pages, with the three
  recurring EDS pipeline deltas (`<p><picture>` wrapping, empty
  metadata-section padding, `/media_<hash>` rewrites); calibration honesty
  (prototype-regime vs published-origin-regime numbers, same ≤10% bar);
  probe schedule per fix round (pixels every round, content/visual at
  milestones — content/visual re-runs cost 2 live hits each); iteration-cap
  bookkeeping (instrument-invalidated runs excluded once the defect is
  fixed and named; build-side-only probe passes are free); the script-edit
  rule narrowed (re-implementing retired adaptations stays a defect; a
  commented, ledgered, flagged-for-upstream instrument-bug fix is the
  correct move — fail-loud outranks script immutability).
- **Recreation procedure:** CSS lifting gains the text-rendering group
  (`text-rendering`, `-webkit-font-smoothing`, `font-synthesis`,
  `font-variant-numeric`, `font-kerning`) + the literal-string width
  diagnostic; new § Interaction parity (hover-diff and behavior-diff probe
  patterns, Swiper-lock semantics and the scroll-based replica that
  auto-degrades to the static case); new § Wrap-junction margins
  (collapsing-margin trap on cards-on-a-canvas sites); capture-state policy
  gains nondeterministic live elements (tickers, dates, counts — freeze a
  captured value, log as permanent residual); granularity parity states the
  widget policy: widgets are implemented, not justified away.
- **Replica SKILL:** archetype prototypes are per-archetype and CUMULATIVE
  (shared canon CSS + per-archetype CSS; never skip to direct platform
  authoring — prototyped archetypes held 3.5%/5.6% while direct-authored
  pages plateaued at 8–16%); Phase 5's final proof is now the mandatory
  published-origin gate.
- **Deploy:** preview `409 "error from content-bus"` gets a two-step
  fail-loud diagnosis (known-good doc to the same path, then a per-image
  sweep for SVGs over the ~40KB hard pipeline limit — rasterize to PNG);
  #99 extended accordingly.
- **Migrate:** sibling content-fidelity is now measured per page at import
  time — a role-classified node-count acceptance (headings / body / CTAs /
  images vs the captured page JSON; drops not covered by a logged
  `contentDeviations[]` entry fail the page), so dropped-content importer
  bugs surface while the importer is still cheap to fix.

## 0.17.0 — vanilla aem-boilerplate is the only deploy runtime; David's Model becomes a mechanical gate

The AuthorKit runtime dependency is removed end to end: `stardust:deploy`
targets stock `adobe/aem-boilerplate` — no runtime port, no vendored files,
no `.eslintignore`, no pinned author-kit ref. Validated by three full e2e
conversions onto a fresh boilerplate + DA site (6/11/13-section pages, root
and subfolder scopes); the third run shipped with zero live-only defects.

- **Runtime (deploy):** `bootstrap-authorkit.mjs` deleted; new "Target
  runtime" contract documents what stock boilerplate provides (never
  modified). Buttons are the vanilla family (`a.button.primary`/`.secondary`/
  `.accent` in `p.button-wrapper`; the probe records per-target drift —
  older clones emit `button-container`). Fonts move to `styles/fonts.css` +
  metric-matched `<brand>-fallback` faces (the stock convention); the
  `body.appear` gate is the runtime's and stays. Chrome is authored `/nav` +
  `/footer` documents fed to template-slotted `header`/`footer` blocks —
  nav links become authorable and interactive chrome is real block JS;
  per-page `nav:`/`footer:` metadata replaces `header: off` (and makes
  multilingual chrome routing a content concern, no runtime patching).
- **David's Model (deploy):** new `davids-model.md` maps all 15 rules to
  their enforcement points (`D#N` citations); the ENCODE contract gains the
  missing structural rules (D2 nested blocks, D3 spans, D4 URLs, D10
  columns, D13 alt-text, D15 code-as-text, D1 auto-blocked embeds); Step 2
  opens with D1/D11 triage (prose sections land as default content with a
  small closed section-`style` vocabulary; Block Collection patterns mirror
  collection models). New `davids-model-lint.mjs` gates the atomic delivery
  chain — three consecutive e2e runs produced 0 🔴 first-pass content
  structure with no model instruction in the run prompt.
- **New gates + findings from the validation runs:** `qa-gate.mjs` (stock
  Local-QA assertion run driven by the page's eds-schema — replaces
  hand-rolled probes); Local-QA scope boundary (CLS, `content-diff`/
  `visual-diff`, and chrome overrides are deployed-URL-only checks — the
  harness false-passes CLS); findings #96–#101 in `deploy/IMPROVEMENTS.md`,
  including: the pipeline `<p>`-wraps nav trigger links (#98),
  bitmap-embedding SVGs 409 the preview (#99, lint advisory added), and the
  metadata-first empty section defeats `waitForFirstImage` so hero blocks
  must eager-load their LCP image and reserve the media slot (#100).
- **Cross-skill:** rollout delivers chrome as published `/nav` + `/footer`
  documents (roster + coverage semantics updated; multilingual routing via
  per-language documents); diff's `BLANK_RENDER` hint now points at the
  runtime not booting instead of advising removal of the stock display gate;
  `edsName()` guards `-wrapper`/`-container` suffix collisions.

Measured effect across the validation runs: single-page conversion time fell
from ~74 to ~42 minutes as findings fed back into the skill, with fidelity
gates green throughout (content+roles matched 41/41, 94/94, 71/71 text
nodes; live CLS ≤ 0.01 after #100).

## 0.16.1 — container-width sizing guidance in the token contract

Docs only, no behavioral surface. New `## Sizing --max-width` section in
`skills/stardust/reference/token-contract.md`: stardust ships no default
container width — inherit the captured container when it holds up (widening
one step within the site's own framework vocabulary when it reads dated),
measure-first (1200–1280px) when the capture has no measurable container,
and persist the derived value to DESIGN.json
`extensions.breakpoints.containerMaxWidth` with the change flagged in the
page-shape brief. Cross-referenced from
`skills/prototype/reference/page-shape-brief.md` § Layout strategy.

## 0.16.0 — two new entry points: replica (same-design migration) and reskin (content × donor design)

Round-1 outcome of the three-new-use-cases exploration (research, candidate
designs, and validation evidence in `notes/new-use-cases/`). Both flows were
validated on real pages before codification — replica converged a typographic retail home page to
a 1.31% pixel diff with zero structural findings in 3 measured iterations;
reskin carried a healthcare site's content byte-identically (2281/2281 chars,
47/47 slots, 13/13 metadata) onto a payments-company donor's token system with 91% of
slots mapped to named donor modules. No existing skill was modified (round-2
synergy candidates are listed in `notes/new-use-cases/ROUND-1-REPORT.md`).

- **`stardust:replica`** (new): same-design migration to AEM EDS. extract
  `--prep` unchanged → mechanical preserve-direction (current-state spec
  promoted verbatim as target; deltas only via the inconsistency register) →
  clean re-authored archetype recreation (values lifted from the source
  site's own CSS, never DOM copies) → measured source-fidelity gate per
  breakpoint (diff's two probes `--profile generic` + new
  `stitch-shot.mjs`/`pixel-compare.mjs` stitched pixel probe with per-band
  breakdown, ≤3 iterations) → migrate sibling tier / deploy
  (template-slotted bias) / rollout unchanged.
- **`stardust:reskin`** (new): byte-faithful content onto a donor design
  system (live URL via extract `--design-source`, or local prototypes;
  Figma donor contract-defined, not implemented). Content-model capture with
  scope declaration + executable normalization ledger → mapping brief
  (≥80% slots mapped to named donor modules, no silent improvisation) →
  programmatic render from the model (never retyped) → dual gates: content
  (vendored `dom-equality.mjs`, Apache-2.0 attribution, structure
  informational + `slot-coverage.mjs` incl. metadata) and design-adoption
  (`donor-probe.mjs` token assertions; selector-missing = FAIL).
- Both skills were smoke-tested for generalization on fresh sites before
  shipping (replica: a furniture retailer, desktop converged to 1.06%; reskin:
  a university site × an analytics-vendor donor, 4883/4883 text bytes, 101/101 slot checks) and
  hardened from the findings: replica gained pointer-park capture hygiene,
  the fixed/sticky-chrome × stitched-capture procedure, per-breakpoint CSS
  lifting, and the full four-patch adaptation set for the diff probes
  (upstreaming them as diff flags is the recorded round-2 candidate);
  reskin gained the document-ordered render stream in the content model
  (`ordered` + tiling verification), root-kind slot classification, a
  shared image-visibility predicate across capture and gate, the
  scope-granularity smell check, and the bounded donor-sampling recipe.
  Smoke evidence: `/Users/paolo/stardust/smoke-{replica,reskin}/SMOKE-REPORT.md`.
- New evals: `replica-source-fidelity/`, `reskin-content-fidelity/`.

### Field-test hardening (5+5 home pages, findings ledger in the 2026-07 field report)

A 10-site field test (replica: a furniture maker, a luggage brand, a fashion
retailer, an EV maker, a fashion house; reskin: botanic-garden×SaaS-donor PASS,
museum×messaging-vendor PASS, humanitarian-nonprofit×hosting-vendor)
produced an 18-finding ledger; all skill-wrong findings are folded:

- **Shared live-measurement hardening (F-G, F-R1, luggage-brand-1; HIGH).** New
  `diff/scripts/live-session.mjs` — the one home for hitting live sites to
  *measure* them, as robust as extract's capture engine: real-Chrome UA
  **plus the standard request headers** (Akamai fingerprints on the absence
  of `Accept`/`Accept-Language`/`sec-ch-ua`, so UA alone still 403s —
  reproduced on the humanitarian nonprofit's origin, fixed to HTTP 200; the same header set
  un-blocked the luggage brand's gate headlessly), challenge detection that **fails
  loud** (exit 3, never silently measured as the source), headed-stealth
  escalation, and two-class overlay dismissal (consent + timed marketing
  modals, the fashion retailer's `#wps_popup` case — CH-1). Consumed by diff's two
  probes, replica's stitch-shot, and reskin's three live-hitting scripts.
- **diff flags replace replica's 10 hand-edits (F-B).** `--ua`,
  `--wait-until`, `--dismiss`, `--headed`, `--locale` on both probes and
  visual-diff `--main`, backward-compatible for local/deploy use;
  `source-fidelity-gate.md` § Script adaptations rewritten — a hand-edited
  project copy is now a defect.
- **replica:** bounded `--single` entry gets a satisfiable promotion
  contract (`bounded-single` synthesis branch — luggage-brand-3); `--main body`
  banned with the 103-false-🔴 reproduction (F-C); hit-minimization +
  media-density iteration budget (luggage-brand-2, CH-2); mobile-@media-first and
  role-parity recreation guidance (CH-3/FH-2); locale pinning for capture
  determinism.
- **reskin:** ordered stream is now `innerText`-consistent by construction
  (F-R2 — the botanic-garden site's a11y ghost labels eliminated at the source; 8/8
  `orderedVerified` vs 5 false in the field) with a sanctioned documented
  fallback; `formControl` stream nodes carry select/option/input text
  verbatim (F-R3 — the humanitarian nonprofit's course form now fully reconstructable, 13/13
  verified); slot-coverage gains a paint assertion so an origin-locked CDN
  can't hide behind a passing URL-string gate (F-R4, the botanic-garden site's 19 unpainted
  images); zero-output scope errors now guide discovery (F-D); first-match
  scope semantics and bounded-donor token sourcing documented (F-R5, F-R6).
- Manifest version aligned (F-A).
- **PR-review P1 fixes** (multi-agent review of PR #238): donor-probe expands
  CSS box shorthands canonically (3-value `[t,r,b,r]`, not cyclic — a
  pixel-perfect render no longer false-fails the design gate); stitch-shot
  fails loud on scroll-stall (inner-scroller/scroll-jacked pages can no
  longer produce silent black-row captures); the diff probes regain their
  advisory exit contract for HTTP errors (`gotoLive httpError:'measure'` —
  a 404 build side reports flags at exit 0 again; challenges still exit 3;
  reskin's byte gate keeps fail-loud); `defaultWaitUntil` centralized in
  live-session with a three-tier rule (localhost and `*.aem.page/.aem.live/
  .hlx.page/.hlx.live` → networkidle, other live → domcontentloaded) so
  deploy Step 10 never measures a half-decorated EDS page.
- **PR-review P2/P3 fixes**: the challenge solve-window runs headed-only —
  a challenged headless run now costs exactly 1 hit (was 4, the entire
  recorded Akamai block budget) before exit 3; slot-coverage routes live
  `--rendered` targets through live-session like its siblings (challenge →
  exit 3, no more swallowed navigation errors); case-insensitive stream
  matching no longer reuses indexes across case-folded strings (Turkish İ
  class — corrupted stream bytes fixed at the source); bootstrap re-runs
  preserve the favicon `<link>` when overwriting head.html (idempotent
  re-injection); typo'd `--flags` now error loudly in dom-equality /
  donor-probe / slot-coverage; the QA harness derives its favicon link from
  the shipped `favicon.<ext>` (or keeps the request-free `data:,` no-op).
## 0.15.0 — deploy accuracy: close the ENCODE/DECODE round-trip at authoring time (#93–#95)

The six-site e2e campaign showed `stardust:diff`'s structural probe catching
real dropped-CTA / role-swap defects on every site — post-deploy, when each
fix costs a redeploy loop. Root cause: authored rows (ENCODE) and block
decode (DECODE) are written independently and hoped to be inverses. This
release moves the defect-finding to conversion time so `deploy` Step 10
becomes a proof, not a repair loop:

- **#93 `section-schema.mjs`** (deploy, new): the per-section ENCODE/DECODE
  shared contract — ordered role inventory + repeating-unit groups emitted
  from the rendered prototype; authored rows and block decode are both
  written from it (new Step 2b).
- **#94 `block-roundtrip.mjs`** (deploy, new): in-loop per-block gate —
  decorates the authored content locally with the block's own JS+CSS (no DA,
  no dev server), diffs the decorated section against the prototype section
  with content-diff's own classifier, exit 2 on structural 🔴 or on any
  decorate error (a block that throws or whose inlined JS fails to install
  must never pass — its raw rows can false-match the prototype). Required per
  block before deploy, plus one whole-page run before the DA push.
- **#95 decode tiers** (deploy): template-slotted (verbatim prototype DOM +
  role slots — fidelity by construction, for fixed-composition sections
  nobody structurally edits) vs reconstructive (for authorable repeat
  groups); tier recorded per block.
- **diff**: classifier + differ factored into
  `skills/diff/scripts/content-inventory.mjs`, shared by content-diff /
  section-schema / block-roundtrip so every fidelity gate measures with the
  same instrument (content-diff CLI behavior unchanged).

## 0.14.5 — crawler clears Cloudflare managed challenges

`extract/scripts/crawl.mjs` — the bot-management fallback now validates the
probe **response**, not just that the navigation resolved. A Cloudflare managed
challenge returns an HTTP 403 interstitial (`cf-mitigated: challenge`) *without
throwing* — `domcontentloaded` fires — so the old fallback (which only fired on
a thrown network-fingerprint error) sailed past it and the block surfaced later
as a fatal capture-time `HTTPError`. Observed on a bot-challenged site during the 0.14.4
uplift validation batch, where it required hand-patching the crawler mid-run.

- **Challenge detection at the probe:** `isChallengeResponse()` flags an
  entry-URL 403/429/503 interstitial (`cf-mitigated`, `cf-ray`,
  `server: cloudflare`/`akamai`/edge markers). Either reject mode — a thrown
  fingerprint block *or* a challenge response — now triggers the headed
  fallback; the reason is recorded in `_crawl-log.json#discovery.botBlock`
  (`fingerprint | challenge`).
- **Stealth-hardened headed Chrome:** the fallback launches real Chrome with
  `--disable-blink-features=AutomationControlled` +
  `ignoreDefaultArgs: ['--enable-automation']` and spoofs
  `navigator.webdriver` via an init script on **every** context (probe +
  workers — the challenge re-fires per context, no cross-context cookie
  sharing). `fetchTechnique` becomes `headed-chrome-stealth`.
- **Challenge-solve window:** `clearChallenge()` waits for the non-interactive
  challenge's JS to set its clearance cookie and reloads before validating
  status — no-op on a normal 200, so zero overhead on the common path. If
  headed + stealth + the solve window still can't clear it, the run fails with
  a clear `BotChallengeError` (interactive solve required) rather than
  capturing the interstitial as content.
- Recipe doc (`extract/reference/playwright-recipe.md` § Bot-management
  fallback) updated with the two-reject-mode retry rule and the managed-
  challenge clearing procedure.

Validated end-to-end: patched crawler on the bot-challenged site auto-detects the challenge,
switches to `headed-chrome-stealth`, and captures the homepage at HTTP 200
(2 headings, ~8.9k chars, 9 images); the common headless path (example.com) is
unchanged (no fallback, no botBlock).

## 0.14.4 — Tessl quality pass, part 1 (descriptions)

Description rewrites for the two skills whose tessl-review drag included
description criteria: `extract` (adds a "Use when…" clause + natural trigger
terms — analyze/reverse-engineer/capture design tokens — and a "Not for"
scraping disambiguation) and `prepare-migration` (plain-language framing of
the prep cascade + trigger phrases + "Not for" migrate/deploy
disambiguation). Body text untouched — zero behavioral surface; the
conciseness/progressive-disclosure restructuring of extract/deploy is a
separate follow-up with its own validation run.

## 0.14.3 — seventh-site validation harvest (stardust.style) + review fixes

Learnings L1–L9 from the final validation run (full pipeline on
stardust.style, hands-off) plus the PR-review findings, folded:

- **crawl.mjs:** trailing-slash forms kept verbatim with slash-insensitive
  dedupe + a guarded 404 slash-retry that records the resolved URL
  (`_crawl-log.json#crawl.slashRetries[]`); `reducedMotion: 'reduce'` on every
  context + an 800ms post-scroll settle (animated h1s were silently dropped);
  visible `<pre>` contents captured as `codeBlocks[]`; collision-safe slug
  assignment (query-variant / flattened-path pages no longer clobber one
  file); sitemap-index recursion (child-sitemap `.xml` locs no longer queued
  as pages); `page.close()` on every exit path via try/finally.
- **Specs:** playwright re-probe rule at the start of every rendering skill
  (`--no-save` installs are pruned by any later `npm i`); token-hygiene gate
  at the FIRST phase commit (master SKILL.md); partial-inventory broken-link
  carve-out reconciled across content-preservation / migration-procedure /
  template-and-module-rendering; cinematic sibling handling specced in
  migrate (assets carried, `cinematic-variant-not-consumed` recorded);
  key-facts-in-server-rendered-content ENCODE rule (#86) with the declaration
  site defined (`DESIGN.json.extensions.metadata.keyFacts[]`); stale
  "closed catalog / 5 weaknesses" references reconciled in the master skill,
  divergence-toolkit, and artifact-map; diff JOIN/SPLIT limitation documented
  (#87, code fix pending).
- **Versions realigned** across plugin.json / tile.json / marketplace.json /
  README / this file (the #230 drift class).

## 0.14.1 — six-site E2E hardening (round 1, folded into extract)

Released as part of the six-site validation cycle; the crawl.mjs items listed
under 0.14.2's last bullet were folded here first. Documented retroactively —
see git history (`4a61c83`) for the full diff.

## 0.14.2 — six-site E2E hardening (round 2)

Fixes folded from validating the pipeline end-to-end on six live sites
(site D (airline), site E (tools retailer), site A (healthcare), site F (nonprofit
shelter), site B (industrial conglomerate), site C (agency)), ranked by
cross-site frequency.

- **migrate no longer dead-ends on missing canon (blocking; 4 of 6 sites).**
  The documented `prototype → migrate → deploy` path never runs
  `prepare-migration`, so migrate arrived with no canon and hard-stopped.
  `migrate` § Setup now auto-bootstraps canon from the first approved
  prototype (the `prototype --prep` write-back, run on demand) when canon is
  absent and an approved prototype exists; it only stops when there is nothing
  to derive canon from. (`skills/migrate/SKILL.md`)
- **bootstrap-authorkit is transactional + refuses the drift-prone default
  (blocking; 2 sites).** Boilerplate removal now runs *after* the mandatory
  edits verify, so a drifted/incompatible source leaves the original runtime
  intact instead of bricking the repo; `author-kit@main` is refused unless
  `--ref <sha>`, `--from-sibling`, or `--allow-unpinned` is given.
  (`skills/deploy/scripts/bootstrap-authorkit.mjs`)
- **atomic delivery contract now asserts computed layout (silent-failure
  guard).** A `.plain.html` pass is not a layout pass — the AuthorKit
  `.<name>.block` scoping bug ships a stacked single-column page green. The
  contract's final gate is now a headless computed-style check (grid blocks
  must compute `display:grid`, blocks decorated, 0 pageerror) once per
  template. (`skills/deploy/SKILL.md`)
- **crawl.mjs, folded in 0.14.1 and confirmed by the runs:** five-field
  `_provenance` emission, apex→www origin adoption, Usercentrics shadow-DOM
  consent, `<video>`/`<iframe>` capture, and the playwright preflight
  (`--no-save --legacy-peer-deps`) + copy-to-project ESM-resolution guidance.

Backlog (single-site or lower-frequency) tracked in the consolidated E2E
learnings digest.

## 0.14.0 — Fable 5 refactor

### Design quality

- **Reference-grounded direction.** `direct` researches real-site references
  via the optional refero MCP (`skills/stardust/reference/reference-research.md`)
  before committing to a direction; the curated seed roll is demoted to the
  fallback when refero is absent.
- **Brand-adjacent refinement tier.** A directed middle ground between
  faithful reproduction and full re-direction, so "polish, don't reinvent"
  is a first-class target rather than an improvised compromise.
- **Opened catalogs.** The uplift/prototype candidate catalogs (what-if
  amplifications, motion registers) are no longer closed lists: the agent may
  extend them with evidence-gated entries justified from the captured brand
  surface.
- **Vision verification gates.** `extract` and `prototype` verify their own
  screenshots/renders with vision checks before a step may pass, catching
  blank captures, broken renders, and layout collapse early.

### New capabilities

- **`stardust:audit`** — new skill: a design + SEO + LLM-visibility audit of
  a site, producing a scored HTML report. Uses the marketing-skills
  `seo-audit` / `ai-seo` methodology when that plugin is installed and
  built-in heuristics otherwise.
- **Cross-site same-brand extraction.** `extract --brand-source` /
  `--design-source` capture brand and design evidence from a sibling property
  of the same brand, with automatic sibling discovery.
- **Hands-off production mode.** `skills/stardust/SKILL.md § Hands-off mode`
  runs the full migration chain without conversational gates, folding the
  previously external master migration prompt into the skills.
- **Run contracts.** A per-run learnings ledger plus a `stardust/status.jsonl`
  run-status contract, so long runs are observable and each run feeds the
  next.

### Fidelity

- **Runtime-contract detection** in deploy/rollout: probe what the target
  runtime actually serves instead of assuming the authored contract survived.
- **Atomic per-page delivery verify** — each page is verified as a unit
  immediately after delivery, not batched at the end.
- **Foundation-first gate** — global foundations (nav, footer, styles,
  indexes) must verify before page fan-out begins.
- **Link audit** across the delivered site.
- **Query-index resilience** — index delivery/verification no longer
  false-fails or silently drops rows on slow propagation.

### Performance

- **Parallelism contracts.** Concurrent agents coordinate through a
  state-machine merge-by-slug contract instead of last-writer-wins on
  `state.json`.
- **Parallel prototype variants** and **crawl concurrency** in `extract`.

### Fixed

- **Version/reference drift.** `plugin.json`, `tile.json`, and the README now
  carry one version, and the impeccable dependency is declared consistently
  as **hard** everywhere (tile.json previously listed it as a soft
  dependency).
