---
name: reskin
description: Rebuild an existing site's pages with byte-faithful content on a separately-defined donor design system — another live site, local static HTML prototypes, or a Figma file read headlessly over the REST API. Content fidelity is gated byte-level (text, ordered images, SEO metadata); design application is flexible (content re-laid-out onto donor modules). Use when the user says "reskin my site with this design", "apply this design system to my content", "restyle my site to look like <other site>", "new design, same content", "rebrand my site using these prototypes", "use this Figma design for my site", or names a content site plus a design donor. NOT for redesigning from intent (that's the stardust core extract/direct/prototype chain) and NOT for keeping the current design while migrating (that's the replica flow).
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, and the impeccable skill (github.com/pbakaus/impeccable) installed alongside stardust.
metadata:
  version: "1.1.0"
---

# stardust:reskin — same content, donor design

The user has a site (the **content source**) and a design that already
exists somewhere else (the **donor**: another live site, or a directory
of static HTML prototypes, or a Figma file). Reskin rebuilds the
content site's pages so that every visible byte of content survives —
text, ordered images, CTAs, SEO metadata — while the surface comes
entirely from the donor's tokens and module vocabulary.

The two halves have different contracts:

- **Content is non-negotiable.** The gate is byte equality of
  whitespace-normalized visible text, the ordered visible-image set,
  and full metadata carry-over. Not "close" — equal, after an
  explicitly declared, executable normalization ledger.
- **Design is flexible.** Content is re-laid-out onto donor modules; a
  carousel may become a static card grid, a sidebar may become a band.
  Structure (element counts, tag sequences) is informational, never
  gating — a reskin re-structures markup by design.

The decisive rule, validated in the UC2-E1 experiment (a healthcare site ×
a fintech donor: 2281/2281 text bytes, 7/7 images, 47/47 slots, 13/13 metadata,
17/17 donor-token probe): **the page is generated programmatically from
the captured content model — content strings are never retyped.** Byte
fidelity then holds by construction and the content gate becomes a
regression check instead of a debugging tool.

## Inputs

- `<content-url>` — required. The site whose content is preserved.
- Donor, exactly one of:
  - `--donor <url>` — a live site whose design system is adopted.
  - `--donor-dir <path>` — a directory of local static HTML
    prototypes (claude-design / Mobirise / Relume / Lovable / v0 /
    hand-coded). Served on localhost and captured through the same
    path — recipe in `reference/donor-sources.md` § Local prototypes.
  - `--donor-figma <url>` — a Figma file (a design, file, proto or
    branch URL; the whole file is read, a `node-id` only recorded), read
    headlessly over the REST API. Needs a personal access token in
    `FIGMA_TOKEN`. Optional `--frames <ids>`
    and `--confidential` (refuses to write anything git would track;
    sticky for `curate` and `stamp`).
    Flags, file schemas and exit codes: `figma-donor.mjs --help`.
- `--pages <slug,slug,...>` — optional. Restrict the content capture
  (Phases 2–5) to specific pages. Default: the archetype set (one page
  per page type; a spec's `archetypes.json` names them; scale to
  siblings happens in Phase 6 via `migrate`). Never restricts the
  inventory: Phase 1 still crawls the whole site.
- `--scope <selectors>` — optional. Pre-declare the content-root
  scope for a single-page run (comma-separated, `!` suffix keeps a
  scope whole; see `reference/content-model.md` § Scope declaration).
  Without it, run the scope-discovery procedure per page.

## Setup

1. Run the master skill's setup (`../stardust/SKILL.md` § Setup):
   impeccable dep check, context loader, state read. **Flow.** Stamp
   `state.json.flow: "reskin"` if unset
   (`../stardust/reference/state-machine.md` § Flow keys); if another
   flow is set, print it and the switch command
   (`$stardust reskin --switch-flow`) instead of running.
2. **Playwright import-resolvability probe** — same contract as
   `../extract/SKILL.md` § Setup:
   `node -e "import('playwright').then(()=>process.exit(0))"` from the
   project root; on failure
   `npm i -D playwright --no-save --legacy-peer-deps`. Re-run the
   probe at the start of every phase that renders — a `--no-save`
   install is pruned by any later real `npm i`.
3. **Copy the scripts into the project.** ESM resolves
   `import('playwright')` from the *script's* directory and the plugin
   tree ships no `node_modules`. Copy `skills/reskin/scripts/`
   recursively except `test/` (sibling imports and the `figma/`
   helpers travel with it) byte-identical to
   `stardust/scripts/reskin/`, **and** the master skill's scripts (`../stardust/SKILL.md`
   § Setup, step 7): every reskin gate script resolves `browser.mjs` there at
   startup and exits 2 without it, even for `--help`, and
   `figma-donor.mjs stamp` writes through its `state.mjs`.
   Run the copies.
4. **Origin collision** — if `stardust/state.json` records a different
   `site.originUrl`, stop and ask before mixing sites, per
   `../extract/SKILL.md` § Setup.
5. **Full-inventory check** — on resume, and again after Phase 1's
   crawl: a capped crawl is a setup error; re-crawl with `--all`
   (`reference/full-site.md` § Full-inventory check).

## Procedure

### Phase 1 — INGEST DONOR

The donor's design system is captured **separately** from the content
site, into `stardust/canon-source/`. The same extract run crawls the
content site, always `--all` and never `--prep`
(`reference/full-site.md`). Recipes per donor type in
`reference/donor-sources.md`; summary:

- **Live URL** (`--donor <url>`): invoke
  `$stardust extract <content-url> --all --design-source <donor-url>`
  — the existing skill, unchanged. It lands in `stardust/canon-source/`: the
  donor's `pages/`, `assets/` (screenshots included),
  `_brand-extraction.json`, `_crawl-log.json`, and a descriptive
  `DESIGN.md` + `DESIGN.json`, and stamps
  `state.json.designSource = { url, capturedAt, path }` — see
  `../extract/SKILL.md` § Cross-site brand sources.
- **Local prototype dir** (`--donor-dir <path>`): serve the directory
  on localhost (`python3 -m http.server <port> --directory <path>`)
  and run the **same** `--design-source` capture path against the
  localhost origin. Record the real provenance (localhost serve of
  `<path>`) in `canon-source/_crawl-log.json`. Recipe details —
  page listing, index-less directories, port hygiene — in
  `reference/donor-sources.md` § Local prototypes.
- **Figma** (`--donor-figma <url>`): no browser, no donor crawl.
  `$stardust extract <content-url> --all`, then
  `node stardust/scripts/reskin/figma-donor.mjs capture <figma-url>`
  (the whole file), author `stardust/reskin/curation-rules.json`,
  then `curate` and `stamp`. Judge the result against the frame
  screenshots; fix it in the rules. Recipe:
  `reference/donor-sources.md` § Figma.

**Type every inventory page** before Phase 2 and print the count per
type with its archetype (`reference/full-site.md` § Page typing).

Then author two reskin-owned donor artifacts (contracts in
`reference/donor-sources.md`; for a Figma donor `curate` writes both):

- `stardust/reskin/donor-tokens.json` — the **curated, probe-able
  token sheet**: palette roles, type ramp, layout metrics, button
  specs, radii, shadows, motifs — every value a computed-style string
  the Phase 5 probe can assert verbatim. Curated from
  `canon-source/DESIGN.json` + `_brand-extraction.json` + the raw
  computed styles; cites the donor page each value came from. On a
  **bounded donor capture** (a single donor page, no full
  `--design-source` run) there is no `DESIGN.json`,
  `_brand-extraction.json`, or `designSource` stamp to curate from —
  the token sheet is authored entirely from raw computed-style
  sampling of the donor page, a first-class parallel path
  (`reference/donor-sources.md` § Two first-class token-sourcing
  paths).
- `stardust/reskin/donor-modules.md` — the **enumerated module
  vocabulary** (M1..Mn): one row per donor module with where-seen
  screenshot evidence and an anatomy description. This is the closed
  set the Phase 3 mapping brief maps onto. Its EDS block column is a
  proposal settled by [`deploy` Step 2](../deploy/SKILL.md#2-decide-names--reuse--lock-before-writing-any-code)
  (D1/D11) — `reference/donor-sources.md` § donor-modules.md.

**Pin one donor reference page per module family (hard)** when donor
pages disagree on a token; record it in `donor-tokens.json`
(`curatedFrom`) and demote the rest to corroboration
(`reference/donor-sources.md` § Pin one reference page).

### Phase 2 — CONTENT-MODEL CAPTURE

The new capability: a **byte-oriented** capture of each content page —
distinct from extract's design-oriented capture. Run the ported
capture script per page:

```bash
node stardust/scripts/reskin/capture-content.mjs \
  --url <page-url> \
  --scope '<sel1,sel2!,...>' \
  --normalize stardust/reskin/normalize/<slug>.mjs \
  --out stardust/reskin/content-model/<slug>/
```

It writes `stardust/reskin/content-model/<slug>/content-model.json`
(full contract in `reference/content-model.md`): per section-slot —
headings with levels, eyebrows and other leftovers, body paragraphs,
list items, CTAs with **absolute** hrefs, ordered **visible** images
(`currentSrc` + alt), plus the **ordered stream** (`ordered`) — the
same content as kind-tagged nodes in document order with nesting and
separator flags, the render surface Phase 4 consumes; page-level —
full SEO metadata (title,
description, canonical, OG, Twitter, JSON-LD, lang, favicon), the
whitespace-normalized visible text of the scope (the content-gate
reference string), and a full-page screenshot.

Two declarations are mandatory per page, because they are the
experiment's top two failure modes:

1. **CONTENT-ROOT SCOPE declaration.** Never trust `main` or
   `#content` blind: a hero inside `<header>` once dropped 30% of a
   page and the byte gate still "passed". Run the scope-discovery
   procedure (`reference/content-model.md` § Scope discovery) and
   widen with multi-scope selectors until everything visible that is
   not declared chrome is in the model; check the capture's coverage
   line (`bodyTextLen / scopeTextLen / h1InScope`). Chrome exclusions
   are declared deltas, not silent omissions.
2. **EXECUTABLE NORMALIZATION LEDGER.** Cookie-consent removal,
   carousel de-duplication and page-specific cleanup live in
   `stardust/reskin/normalize/<slug>.mjs` (extends
   `scripts/source-normalize.mjs`). The **same file is passed to the
   capture and to every gate** (`--normalize`). Format:
   `reference/content-model.md` § Normalization ledger.

### Phase 3 — MAPPING BRIEF

Author `stardust/reskin/mapping.md` — the cross-origin mapping brief.
Full contract and entry schema in `reference/mapping-brief.md`. Per
**every** content slot in the content model:

- assigned donor module id (from `donor-modules.md`'s closed
  vocabulary) + a one-line rationale grounded in slot anatomy vs
  module anatomy;
- status ∈ `{mapped, new-module, chrome, carried-invisible}` —
  the last for sr-only/visually-hidden content inside the byte scope
  (carried verbatim into an equivalent hidden element, no donor
  module; `reference/mapping-brief.md` § Status semantics).

Gates before any rendering:

- **≥ 80% of content slots `mapped`** onto named donor modules. Below
  that, the donor vocabulary doesn't cover this content — stop and
  surface (see § Stop conditions).
- **Every `new-module` entry is explicitly composed from donor
  tokens** (name the tokens it borrows: input spec + primary button
  spec, etc.) and listed in the brief's stats block. New modules are
  never silently improvised mid-render.
- **Chrome swaps documented** — nav/footer replaced by donor chrome
  carrying the source's links is a declared delta, excluded from the
  content-gate scope.
- **Casing / text-transform policy declared.** The donor may render
  eyebrows uppercase (or the source may — Chrome's `innerText`
  reflects `text-transform`, so captured text is *rendered-case*).
  The underlying text stays byte-faithful; casing is applied via CSS
  `text-transform` only, never by editing the string. Policy details
  in `reference/mapping-brief.md` § Casing policy.

Composite source sections (one wrapper div holding two logical
regions) are split into atomic slots in the brief — section ≠ slot.

### Phase 4 — PROGRAMMATIC RENDER

**The page is generated from `content-model.json`, never retyped by hand.**
A renderer per archetype (`stardust/reskin/renderers/<archetype>.mjs`)
interpolates every visible string, href and image URL from the model
(HTML-escaped), emits the ordered stream in order and never rebuilds
order or separators from `visibleText`, renders form controls as
controls, carries the metadata block verbatim, takes its surface only
from `donor-tokens.json` and the mapped modules, and writes
`stardust/reskin/pages/<slug>.html`. A text parse that does not
reproduce its node throws. Rules: `reference/render.md`.

### Phase 5 — GATES

Three gate families per page. Commands, pass bars, tolerances and
failure modes: `reference/gates.md`.

- **(a) Content gate** — `dom-equality.mjs` (visible-text byte
  equality and the ordered image set, with the page's normalize
  ledger) and `slot-coverage.mjs` (every slot, CTA pair, image and
  metadata field). All must pass.
- **(b) Design-adoption gate** — `donor-probe.mjs` asserts the
  donor tokens as computed styles, then the **side-by-side
  judgment** against the donor screenshots; record the verdict.
  Paths in `donor-tokens.json` `coverage.absent` are SKIPs in the
  probe, so copy each into every page's `flags[]` in `ledger.json`.
- **(c) Sanity** — no horizontal overflow at 1440 and 360.

**One fix iteration per gate family**, then re-run all gates.
Failures left after it are logged in `stardust/reskin/ledger.json`
under the page's `residuals[]` — never silently absorbed, never
looped on.

### Phase 6 — HANDOFF

Reskin owns the archetype pages; scale and shipping are the existing
pipeline, unchanged. **The default is the whole site**; archetypes-only
delivery is an opt-out the user asks for in words, recorded in
`ledger.json#delivery` (`reference/full-site.md` § Delivery scope).

- **Scale via the stardust `migrate` skill** (`../migrate/SKILL.md`) with the
  donor-pinned target (the `state.json.designSource` stamp Phase 1
  wrote is what `direct` reads for donor pinning;
  a bounded donor capture wrote no stamp — record the donor origin
  in the handoff instead, `reference/donor-sources.md` § Two
  first-class token-sourcing paths).
  Every non-archetype inventory page renders at the sibling tier;
  a type without an archetype gets one, never a skip.
  Content rules are the ones reskin already
  enforces — `../migrate/reference/content-preservation.md` is
  inherited wholesale.
- **Ship via the stardust `deploy` and `rollout` skills**, unchanged —
  `rollout` over the full migrated tree. Blocks
  written for donor modules obey the Experience Workspace editability
  contract (deploy SKILL.md § 8, EW1–EW10) and pass the EW gate
  (`block-roundtrip --ew`) before they are done.

Reskin writes its own state under `stardust/reskin/` — `ledger.json`
holds per-page status (`captured → mapped → rendered → gated`), gate
results, and residuals. It makes **no changes to the core state
machine** (`../stardust/reference/state-machine.md`): Setup stamps
`flow`, and Phase 1 stamps `designSource` (`extract --design-source`
for URL and directory donors, `figma-donor.mjs stamp` for Figma) and
fills `pages[].type`.

## What reskin never does

- **No content rewriting or summarizing.** Not headlines, not body,
  not CTA labels, not casing-by-editing. Faithful ≠ clean: source
  garbage is carried verbatim and *flagged*, not fixed.
- **No invented sections.** Every rendered slot traces to a
  content-model slot; every module traces to `donor-modules.md` or an
  explicit new-module entry in `mapping.md`.
- **No donor-token drift.** No colors, fonts, radii, or spacing
  outside `donor-tokens.json`. Licensed donor fonts are adopted as the
  family *token string* with local fallback, never rebundled.
- **No silent slot drops.** Anything excluded from the gate scope is a
  declared chrome delta or a ledger normalization — declared in
  `mapping.md`, executable in the normalize module.
- **No partial site.** No capped content crawl, and no page of the
  inventory left unmigrated unless the user opted out (Phase 6).

## Stop conditions

- **Donor capture fails** (bot-block past the headed fallback,
  prototypes dir unservable) — surface extract's error verbatim.
- **Mapping ratio < 80%** — the donor vocabulary can't carry this
  content. Ask: widen the donor capture (more donor pages → more
  modules) or accept a larger explicit new-module list.
- **Scope undecidable** — the content page's visible content cannot be
  covered by any selector set (heavy shadow-DOM, iframe-embedded
  content). Surface with the screenshot evidence.
- **Figma capture blocked** (exit 3: token, access, or a long
  rate-limit wait) — surface the script's checklist verbatim.

## Outputs

| Path | Purpose |
|---|---|
| `stardust/canon-source/` | Donor capture + descriptive DESIGN.md/json (extract `--design-source`, unchanged; or `figma-donor.mjs` for Figma) |
| `stardust/canon-source/foundation/`, `{role,module}-candidates.json`, `spec-tables.json` | Figma donor only: normalized Figma values with node ids, and the candidates the agent curates from |
| `stardust/reskin/curation-rules.json` | Figma donor only: the authored rules, the one non-mechanical `curate` input |
| `stardust/reskin/donor-tokens.json` | Curated probe-able token sheet, pinned to one reference page |
| `stardust/reskin/donor-modules.md` | Enumerated donor module vocabulary (M1..Mn) with screenshot evidence |
| `stardust/reskin/content-model/<slug>/content-model.json` | Byte-oriented per-page content model (+ source screenshot) |
| `stardust/reskin/normalize/<slug>.mjs` | Per-page executable normalization ledger (shared capture ↔ gates) |
| `stardust/reskin/mapping.md` | The mapping brief: every slot → donor module, status, rationale |
| `stardust/reskin/renderers/<archetype>.mjs` | Programmatic renderers (model in, HTML out) |
| `stardust/reskin/pages/<slug>.html` | Rendered reskin pages |
| `stardust/reskin/reports/` | Per-page gate reports + screenshots |
| `stardust/reskin/ledger.json` | Per-page status, gate results, residuals |
| `stardust/scripts/reskin/` | Project-local copies of the skill scripts |
| `stardust/.work/reskin/figma/` | Figma donor only: raw REST cache and frame PNGs (git-ignored) |

## References

- `reference/donor-sources.md` — donor capture recipes (URL, directory,
  Figma), token and module contracts.
- `reference/content-model.md` — capture contract, ordered stream,
  scope discovery, normalization ledger.
- `reference/full-site.md` — inventory, page typing, delivery scope.
- `reference/mapping-brief.md` — entry schema, the ≥80% gate, casing.
- `reference/render.md` — renderer rules.
- `reference/gates.md` — gate commands, pass bars, residuals.
- `../extract/SKILL.md` § Cross-site brand sources — the
  `--design-source` donor-capture path Phase 1 delegates to.
- `../migrate/reference/content-preservation.md` — the content rules
  reskin inherits (and tightens to byte level).
- `../diff/SKILL.md` — the pixel + structural probes; reuse them as a
  supplementary build-side check after Phase 6 deploy, `--profile eds`.
