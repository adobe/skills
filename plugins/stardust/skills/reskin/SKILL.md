---
name: reskin
description: Rebuild an existing site's pages with byte-faithful content on a separately-defined donor design system — another live site, local static HTML prototypes, or a Figma file read headlessly over the REST API. Content fidelity is gated byte-level (text, ordered images, SEO metadata); design application is flexible (content re-laid-out onto donor modules). Use when the user says "reskin my site with this design", "apply this design system to my content", "restyle my site to look like <other site>", "new design, same content", "rebrand my site using these prototypes", "use this Figma design for my site", "build my site from these Figma pages" (Figma-only: the frames hold the content, no live site), or names a content site plus a design donor. NOT for redesigning from intent (that's the stardust core extract/direct/prototype chain) and NOT for keeping the current design while migrating (that's the replica flow).
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, playwright-cli on PATH, and the impeccable skill (github.com/pbakaus/impeccable) installed alongside stardust.
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
  "May become" is never "may vanish": every region of the source page
  (inside the scope or not), every late-rendered block and every dark
  band lands on the target or is declared dropped with a why — gate
  (a′), `source-coverage.mjs`.
  Structure (element counts, tag sequences) is informational, never
  gating — a reskin re-structures markup by design.

The decisive rule, validated in the UC2-E1 experiment (a healthcare site ×
a fintech donor: 2281/2281 text bytes, 7/7 images, 47/47 slots, 13/13 metadata,
17/17 donor-token probe): **the page is generated programmatically from
the captured content model — content strings are never retyped.** Byte
fidelity then holds by construction and the content gate becomes a
regression check instead of a debugging tool.

## Inputs

- `<content-url>` — the site whose content is preserved. Required unless
  the project is **Figma-only** (no live site: the content is in the
  page frames of a Figma file). Then run `figma-donor.mjs init <url>`
  instead (writes `state.json` with `flowSource: "figma-only"`) and take
  the content in Phase 2′.
- Donor, exactly one of:
  - `--donor <url>` — a live site whose design system is adopted.
  - `--donor-dir <path>` — a directory of local static HTML
    prototypes (claude-design / Mobirise / Relume / Lovable / v0 /
    hand-coded). Served on localhost and captured through the same
    path — recipe in `reference/donor-sources.md` § Local prototypes.
  - `--donor-figma <url>` — a Figma file (a design, file, proto or
    branch URL; a `node-id` scopes it to a page or frame), read
    headlessly over the REST API. Needs `FIGMA_TOKEN` (a personal
    access token, `file_content:read`). Optional `--frames <ids>` and
    `--confidential` (refuses to write anything git would track;
    sticky for `curate` and `stamp`). Flags, schemas, exit codes:
    `figma-donor.mjs --help`.
- `--pages <slug,slug,...>` — optional. Restrict the content capture
  to specific pages. Default: the archetype set (one page per page
  family; a spec's `archetypes.json` names them; scale to siblings happens in Phase 6 via `migrate`).
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
2. **Import-resolvability probe** — same contract as
   `../extract/SKILL.md` § Setup:
   `node -e "Promise.all(['playwright','pixelmatch','pngjs'].map(m=>import(m))).then(()=>process.exit(0),()=>process.exit(1))"`
   from the project root; on failure
   `npm i -D playwright pixelmatch pngjs --legacy-peer-deps` (never
   `--no-save`: a later real `npm i` prunes it). Re-run the probe at
   the start of every phase that renders.
3. **Copy the scripts into the project and run the copies.** ESM
   resolves `import('playwright')` from the *script's* directory and
   the plugin tree ships no `node_modules`. Copy, byte-identical, into
   `stardust/scripts/{reskin,stardust,diff,replica,deploy,prototype}/`,
   the directories siblings: the exact script list and what each one
   imports are in `reference/gates.md` § Project copies.
4. **Origin collision** — if `stardust/state.json` records a different
   `site.originUrl`, stop and ask before mixing sites, per
   `../extract/SKILL.md` § Setup.

## Procedure

### Phase 1 — INGEST DONOR

The donor's design system is captured **separately** from the content
site, into `stardust/canon-source/`. Full recipes per donor type in
`reference/donor-sources.md`; summary:

- **Live URL** (`--donor <url>`): invoke
  `$stardust extract <content-url> --design-source <donor-url>` — the
  existing skill, unchanged. It lands in `stardust/canon-source/`
  (the donor's `pages/`, `assets/`, `_brand-extraction.json`,
  `_crawl-log.json`, a descriptive `DESIGN.md` + `DESIGN.json`) and stamps
  `state.json.designSource = { url, capturedAt, path }` — see
  `../extract/SKILL.md` § Cross-site brand sources.
- **Local prototype dir** (`--donor-dir <path>`): serve the directory
  on localhost (`python3 -m http.server <port> --directory <path>`)
  and run the **same** `--design-source` capture path against the
  localhost origin. Record the real provenance (localhost serve of
  `<path>`) in `canon-source/_crawl-log.json`. Recipe details —
  page listing, index-less directories, port hygiene — in
  `reference/donor-sources.md` § Local prototypes.
- **Figma** (`--donor-figma <url>`): no browser, no crawl. Run
  `$stardust extract <content-url>` (it creates `state.json`), then
  `node stardust/scripts/reskin/figma-donor.mjs capture <figma-url>`
  (for a component kit, `--list` first, then `--frames` with the
  foundation frames and one frame per module page); author
  `stardust/reskin/curation-rules.json` from the candidates and the
  frame screenshots; then `curate` and `stamp`. Judge the result
  against the screenshots and fix the rules, not the outputs. Recipe:
  `reference/donor-sources.md` § Figma.

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

**The pin-one-reference-page rule (hard).** When donor pages
disagree on a token, **pin ONE donor reference page per module
family**, record it in `donor-tokens.json` (`curatedFrom` + a note
naming the reference page) and demote the other pages to
corroboration — consolidating across them yields a chimera no live
page shipped (`reference/donor-sources.md` § Pin one reference page).

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
(full contract in `reference/content-model.md`): per section-slot, the
headings, leftovers, body paragraphs, list items, CTAs with **absolute**
hrefs, ordered **visible** images (`currentSrc` + alt) and the **ordered
stream** (`ordered`: the same content as kind-tagged nodes in document
order, the render surface Phase 4 consumes); page-level, full SEO
metadata, the whitespace-normalized visible text of the scope (the
content-gate reference string) and a full-page screenshot.

Two declarations are mandatory per page, because they are the
experiment's top two failure modes:

1. **CONTENT-ROOT SCOPE declaration.** Never trust `main` or `#content`
   blind: the obvious root silently dropped 30% of the experiment
   page's content, and byte equality passed against the incomplete
   reference. Run the
   **scope-discovery procedure** (`reference/content-model.md`
   § Scope discovery): compare the captured scope text against the
   whole-body text and the page screenshot, verify the h1 is inside
   the scope, widen with comma-separated multi-scope selectors until
   everything visible in the screenshot that isn't declared chrome is
   in the model. Chrome exclusions (nav, footer) are declared deltas
   (`D1`-style), not silent omissions. The capture script prints a
   coverage line (`bodyTextLen / scopeTextLen / h1InScope`) to make
   the check mechanical.
2. **EXECUTABLE NORMALIZATION LEDGER.** Cookie-consent chrome removal,
   carousel de-duplication (hidden slides are absent from `innerText`;
   clone slides duplicate it — rotating carousels break byte
   determinism), and any page-specific cleanup live in a per-page
   ledger module `stardust/reskin/normalize/<slug>.mjs` that extends
   the shared default (`scripts/source-normalize.mjs`). The **same
   ledger file is passed verbatim to the capture and to every gate**
   (`--normalize`), so the gate measures exactly the normalization the
   capture declared. The ledger is code, not prose. Format in
   `reference/content-model.md` § Normalization ledger.
3. **WHAT THE SCOPE DID NOT TAKE IN.** The capture records it so it
   cannot be lost silently: `residue[]` (every region beside the
   scope's ancestor chain — a breadcrumb, a section sidebar, a utility
   bar — with its text lines), `_provenance.settle` (it waits until the
   page text stops growing, so an XHR feed is in the model) and each
   slot's measured band `tone` (`dark | tinted | page`). Read the
   `residue` and `tones:` console lines: each non-chrome residue region
   and each dark band is a Phase 3 mapping decision — carry it (a block,
   page chrome such as a breadcrumb/section-nav layout, a tone variant)
   or declare it dropped in `stardust/reskin/coverage/<slug>.json`.
   Gate (a′) holds the decision.

### Phase 2′ — CONTENT FROM FIGMA (Figma-only projects)

No live site, so no `capture-content`. A Figma URL names the **file**, not
the page set: the linked node is only where the user was looking. Discover
every page and the kit first:

```bash
node stardust/scripts/reskin/figma-donor.mjs pages <figma-url> [--refresh] [--confidential]
node stardust/scripts/reskin/figma-donor.mjs capture <figma-url> \
  --frames <foundation frames>,<captureFrames> --max-frames <count + 10>
# add figma-pages.json modules[] to curation-rules.json modules, then curate + stamp
node stardust/scripts/reskin/figma-donor.mjs content <figma-url> --all [--only a,b]
```

`pages` writes `reskin/figma-pages.json`: every page of the FULL PAGES
canvases (one per page-set `Type`, its desktop frame plus the responsive
one; "Page: …" documentation frames skipped) and the **block library** —
every TEMPLATE SECTIONS (❏) and COMPONENTS (❖) canvas is one kit block and
one donor module, *whether a page uses it or not* (its public sets are
variant classes, its `.` sets parts). The kit library is a **proposal**:
block names, and block vs default content, are decided by
[`deploy` Step 2](../deploy/SKILL.md#2-decide-names--reuse--lock-before-writing-any-code) (D1/D11),
applied by `figma/eds-map.mjs` `edsEquivalent` — Q&A → `accordion`, Teaser →
`cards` (variant `teaser`), Button → default content (no block), Chips →
`chips` (no EDS match keeps its name), Input / Dropdown → `form` (field
type rows of the Block Collection form, never variants). Several other
canvases on one EDS block become its variants, never `-2` copies. Each page binds only the blocks it instances, by EDS block and
variant; a section matching no kit block and no EDS block is default
content, never a new block. `content --all` models every page (chrome once,
from the page with the commonest header), binds each section to its EDS
block (`section.kit`) and writes `reskin/mapping.seed.json` — the slot →
block map, the default-content slots, plus `library`: per kit block
`{ figma, block, variant, reason }`, the block list deploy builds. Canvas grouping,
granularity (`kit.blockPer: "canvas" | "set"`) and read depth are
`content-rules.json` `kit` overrides: `reference/content-model.md` § Pages
and the kit library.

"Exactly as in Figma" is the bar for these sites: `figma-donor.mjs renders
<url>` fetches the PNG of every page breakpoint frame and every library
variant (with its copy) into `reskin/figma-renders.json`. Deploy builds every
library EDS block, plus `/library/<page>`, a page per EDS block (`library.<key>.eds.page`)
that shows each variant as a section with `data-kit-component="<variant id>"`. Phase 5 (f)
gates pages and library against those renders.

A single frame still runs on its own:

```bash
node stardust/scripts/reskin/figma-donor.mjs content <figma-url> \
  --frame <page-frame-id> --slug <slug> [--responsive <id>] \
  [--pages <id>=<slug>,...] [--confidential]
```

It writes `reskin/content-model/<slug>/` — `content-model.json`
(`source.kind: "figma"`, same shape as a live capture), `text-ops.json`,
`flags.json`, `assets/` — plus the shared `_chrome` model and, unless one
exists, the page's delta file `reskin/deltas/<slug>.json` — and adds the
page to `state.json`. Image bytes come from the REST image endpoints
when `FIGMA_TOKEN` is set, else from a supplied file; a missing image is
a block flag. Rules (visibility, reading order, segmentation, casing,
headings, links, placeholders) and file shapes:
`reference/content-model.md` § Figma-sourced models. A placeholder-only
page exits 1: the design holds no content to reskin.

Review `figma-donor.mjs blocklist` before deploy: every open `block` or
`review` flag (missing alt, unresolved links, derived title, kit copy)
is fixed in Figma and `content` re-run, or acknowledged with
`figma-donor.mjs ack <slug> --flag <key> --why "…"`. Phases 3–5 run
unchanged except the content gate (Phase 5). Deploy goes to an isolated
preview, never over an existing DA document; there is no origin, so
`migrate` is skipped.

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
- **Casing / text-transform policy declared.** Captured text is
  *rendered-case* (`innerText` reflects `text-transform`); it stays
  byte-faithful and casing is applied via CSS `text-transform` only,
  never by editing the string (`reference/mapping-brief.md` § Casing
  policy).

Composite source sections (one wrapper div holding two logical
regions) are split into atomic slots in the brief — section ≠ slot.

Then write `stardust/reskin/mapping.json` — the same decisions in the
shape the renderer reads (`reference/mapping-json.md`): per page, per
slot, the `module`, `layout`, `width`, `tone`, `heading`, `columns`,
`inset` / `split`, plus the `chrome` zones (`header`, `footer`,
`footerTone`, `navAlign`). Then

```bash
node stardust/scripts/reskin/stream-render.mjs --check <slug…>
```

must exit 0 (one problem per line otherwise: unknown keys, bad values,
slots the content model lacks, pages missing). `mapping.md` is the
brief, `mapping.json` the record: every later per-section decision —
a gate fix, a review note, an EDS preview finding — is made in
`mapping.json` (or `donor-tokens.json`), re-rendered and re-gated,
never in the page or the EDS blocks alone.

### Phase 4 — PROGRAMMATIC RENDER

The decisive validated rule: **the page is GENERATED from
`content-model.json` — never retyped by hand.** The generic renderer
`scripts/stream-render.mjs <slug> --register [--localize-images]`
covers any donor and site; write a per-archetype
renderer (`stardust/reskin/renderers/<archetype>.mjs`) only where it
falls short. Either way the renderer:

- reads the page's `content-model.json` and interpolates **every**
  visible string, href, and image URL from the model (HTML-escaped) —
  if a string appears in the output HTML but not in the model, the
  renderer is wrong;
- takes each slot's structure from the **ordered stream**
  (`sections[].ordered`, `reference/content-model.md` § The ordered
  stream): kind-tagged nodes in document order, nesting preserved,
  `sep` flags marking zero-separator inline joins. It is
  innerText-consistent by construction, so emitting it verbatim is
  safe: nodes in stream order, `sep: ""` neighbours with no whitespace
  between them (inline), never reordered, and **order or separators
  never reconstructed** from `visibleText` (that route failed on
  duplicate strings, CTA/container nesting and tight inline joins);
- renders `formControl` nodes as **equivalent controls**, not text:
  a `<select>` carrying the captured option texts **verbatim, in
  order**; inputs/textareas carrying value/placeholder — restyled
  with donor tokens (the new-module composition rules apply), never
  flattened to prose and never dropped: a select's option text is
  part of the byte reference (`reference/content-model.md` § Slot
  taxonomy, formControls);
- keeps the structure the stream carries (`reference/content-model.md`
  § Structure the stream keeps): `table` nodes as tables, disclosures
  at the source's rest state (closed panels `hidden="until-found"`),
  icon-font ligatures as glyphs and visually hidden text as `.sr-only`
  (both still in innerText), content-sized images at their size — a
  renderer that flattens them passes the byte gate and loses design
  fidelity;
- carries the metadata block verbatim into `<head>` (title,
  description, canonical, OG, Twitter, JSON-LD — including source
  garbage like broken JSON-LD URLs: fidelity over repair; **flag**
  such items for the human in the run report, never silently fix or
  silently keep);
- takes its surface exclusively from `donor-tokens.json` + the donor
  module patterns assigned in `mapping.md`: it imports `rootTokens`
  from `../../scripts/reskin/render/root-tokens.mjs`, emits its `css`
  first in the first `<style>` and styles through `var(--…)` (per-module
  text styles are `--type-<kebab(key)>-*`: `cardTitle` is
  `--type-card-title-size`, and a camelCase name silently falls back);
  root names the donor does not supply (`absent`) go to the page's `flags[]`. Use the rendered-page conventions the Phase 5 probe
  asserts against: content in `<main>`, `.container` for the measure,
  `.btn` for the donor primary button (`reference/gates.md`
  § Rendered-page conventions);
- renders every `mapped` or `new-module` slot as one top-level
  `<section data-slot="<slot id>" data-module="<Mn>">` (`new-module`:
  no `data-module`), in `mapping.md` order — the Figma join reads
  them (`reference/gates.md` § (d));
- writes `stardust/reskin/pages/<slug>.html`, self-contained.

`--localize-images` downloads each image to
`stardust/prototypes/assets/img/` (migrate's root) and mirrors it beside
the page, `src="assets/img/…"`: the page shows it from
`stardust/reskin/pages/` and `migrate` bundles it with default flags.
`--register` (flow `reskin` only) records the page in `state.json`
through `state.mjs`: `prototypePath` set to the rendered file, the page
advanced to `prototyped` — a same-type sibling of an approved archetype
only to `directed`, the status `migrate` renders at the sibling tier.
`reskin-ledger record`, the canon bridge, preflight and `migrate` then
find it with no hand edit. Render the archetype candidates here; render
siblings after the archetype is approved (Phase 6), so they register as
`directed`.

Renderers may parse a single node's text apart (split a list-item row
into kicker/date/title) but must **fail loudly** (throw) when a parse
doesn't reproduce the node's text — a silent partial parse is a silent
content drop. A slot whose `orderedVerified` is `false` is inspected
before rendering, never trusted blind; stream text genuinely absent
from its `visibleText` is dropped and the drop recorded in the model's
provenance — the one sanctioned use of `visibleText` in a render
(`reference/content-model.md` § When `orderedVerified` is false).

### Phase 5 — GATES

Three gate families per page, plus (d) for a Figma donor and (e) for a
deployed page; commands,
pass bars, tolerances, and failure modes in `reference/gates.md`. Serve or `file://`-address the
rendered page and run:

**(a) CONTENT GATE** — all three must pass (a Figma-sourced page has no
source DOM: run `figma-text-gate.mjs` in place of `dom-equality` and
`slot-coverage --deltas reskin/deltas/<slug>.json`; see
`reference/gates.md` § figma-text-gate.mjs):

```bash
node stardust/scripts/reskin/dom-equality.mjs \
  --source <page-url> --source-scope '<declared scope>' \
  --normalize stardust/reskin/normalize/<slug>.mjs \
  --rendered stardust/reskin/pages/<slug>.html --rendered-scope main \
  --report stardust/reskin/reports/<slug>-content-gate.md
node stardust/scripts/reskin/slot-coverage.mjs \
  --model stardust/reskin/content-model/<slug>/content-model.json \
  --rendered stardust/reskin/pages/<slug>.html \
  --report stardust/reskin/reports/<slug>-slot-coverage.md
```

Then **(a′) SOURCE COVERAGE** — what the content reference above did
not take in (`reference/gates.md` § (a′)):

```bash
node stardust/scripts/reskin/source-coverage.mjs \
  --model stardust/reskin/content-model/<slug>/content-model.json \
  --target stardust/reskin/pages/<slug>.html \
  --declared stardust/reskin/coverage/<slug>.json \
  --out stardust/reskin/reports/<slug>-source-coverage.json
```

`dom-equality.mjs` gates on whitespace-normalized visible-text **byte
equality** and the **ordered, URL-normalized visible-image set**;
`slot-coverage.mjs` also proves every slot, CTA (text and absolute
href) and image present and asserts metadata carry-over
(`reference/gates.md` § (a)).

**(b) DESIGN-ADOPTION GATE:**

```bash
node stardust/scripts/reskin/donor-probe.mjs \
  --tokens stardust/reskin/donor-tokens.json \
  --rendered stardust/reskin/pages/<slug>.html \
  --model stardust/reskin/content-model/<slug>/content-model.json \
  --report stardust/reskin/reports/<slug>-donor-probe.md
```

`--model` lets the button probes SKIP on a page whose content has no
button (a sibling with only cards and links); without it they FAIL.

Computed-style assertions of donor token values on the rendered page —
bg/fg, font-family token string, display weight, button spec,
container width, band palette, section rhythm (tolerances:
`reference/gates.md` § Tolerances).
Then the **side-by-side judgment** (`reference/gates.md` § (b)): the
rendered page next to the donor reference-page screenshots
(`canon-source/assets/screenshots/`); the probe proves tokens, the
eyeball that the page *reads as* the donor. Record the verdict.
Paths in `donor-tokens.json` `coverage.absent` are SKIPs in
`donor-probe` and never fail it, so copy each into every page's
`flags[]` in `ledger.json`.

**(c) Sanity** — no horizontal overflow at 1440 and 360 (donor-probe
runs this automatically; `--widths` to override).

**(d) FIGMA FIDELITY** (Figma donor only) — the page against the
frames it was built from, offline (no token, no network). Read each
included module's outline with `figma-gate.mjs boxes --module Mn`,
author `stardust/reskin/figma-checks/<slug>.json` (schema:
`figma-gate.mjs --help`; coverage floor and waivers:
`reference/gates.md` § (d)), then run the whole check under `run-bg` and
read it with `wait` (repeat while it exits 75; no step blocks past
~110 s):

```bash
node stardust/scripts/replica/run-bg.mjs start --name figma-<slug> \
  --dir stardust/.work/reskin/bg -- \
  node stardust/scripts/reskin/figma-gate.mjs all --page <slug> \
  --url stardust/reskin/pages/<slug>.html
node stardust/scripts/replica/run-bg.mjs wait figma-<slug> --dir stardust/.work/reskin/bg
```

B0 (join), B1 (geometry) and B3 (`:root` tokens, type ramp)
block; B2 (frame pixels) is advisory and B4 (the divergence register,
`.work/reskin/gates/<slug>/figma/register.md`) informational. Exit 124
is no verdict: re-run once, never a fix iteration (the other exits and
the residual classes: `reference/gates.md` § (d)). `reskin-ledger.mjs
record` (e) copies `summary.json`'s `ledgerFragment` into `ledger.json`
`pages.<slug>.gates.figma`.

**(f) EXACT FIDELITY** (Figma-only sites, blocking) — every page at every
breakpoint frame, and every variant of every kit block on its library page,
against Figma's own render (`figma-donor.mjs renders <url>` once, then
offline). The library is the whole kit, used on a page or not
(`reference/gates.md` § (f)):

```bash
node stardust/scripts/reskin/figma-gate.mjs exact --page <slug> --url <page>
node stardust/scripts/reskin/figma-gate.mjs library --url-pattern 'http://localhost:3000/library/{page}'
```

**(e) DEPLOYED ACCEPTANCE** (any donor; skipped outside an aem-boilerplate
project) — the page `deploy` made, on its aem.page branch preview, after
the local gates pass. Recipe (`deploy` Steps 1–9 on the gated reskin page,
blocks and `block-roundtrip --map` from `stream-render <slug> --deploy-map`,
push, `deploy-batch`; design changes go back to `mapping.json`),
isolation, delta file, ledger and fix budget: `reference/deployed-leg.md`;
bars: `reference/gates.md` § (e).

```bash
node stardust/scripts/reskin/deployed-gate.mjs preview --page <slug> \
  --org <o> --repo <r> --branch <b> --path /<ns>/<slug> --namespace <ns>   # or --sandbox
node stardust/scripts/reskin/deployed-gate.mjs content --page <slug>   # no delta file yet: it measures
# author stardust/reskin/deltas/<slug>.json, then the whole leg:
node stardust/scripts/replica/run-bg.mjs start --name deployed-<slug> \
  --dir stardust/.work/reskin/bg -- \
  node stardust/scripts/reskin/deployed-gate.mjs all --page <slug>
node stardust/scripts/replica/run-bg.mjs wait deployed-<slug> --dir stardust/.work/reskin/bg   # repeat while it exits 75
```

Re-run (a′) on the preview (`--target https://<branch>--<repo>--<org>.aem.page/<path>`): a sidebar or a feed that is
page chrome or a client-rendered block in EDS exists only there.

The preview must be reachable without auth: a protected preview is out of
scope, and `preview` stops on it with exit 2.

`all` writes `summary.json`; copy its
`ledgerFragment` into `ledger.json` `pages.<slug>.gates.deployed`. Exits 124
and 3 and the fix budget: `reference/deployed-leg.md` § The fix budget.
`all` replaces only `deploy` Step 10's automated reconcile: its deployed
desktop/mobile eyeball, delayed-font/nav CLS probe (CLS < 0.1) and the
header-behavior checks `chrome` (A6) does not cover stay mandatory before handoff, their results or an
explicit `unresolved` in the ledger (`reference/deployed-leg.md` § Recipe, step 7).

**One fix iteration per gate family** (content; design-adoption/sanity;
Figma fidelity): fix once, re-run all gates; (e) has its own budget
(`reference/deployed-leg.md`). What still fails is logged in
`stardust/reskin/ledger.json` under `residuals[]`, never absorbed
(`reference/gates.md` § One fix iteration per gate family).

**(e) Record — the ledger is written by script, never by hand:**

```bash
node stardust/scripts/reskin/reskin-ledger.mjs record <slug>
node stardust/scripts/reskin/reskin-ledger.mjs eyeball <slug> --verdict pass --note "…"
node stardust/scripts/reskin/reskin-ledger.mjs residual <slug> --gate <g> --cause "…" --verdict accepted|needs-owner|blocked [--by <owner>]
```

`record` reads the three gate reports (`reports/<slug>-{content-gate,
slot-coverage,donor-probe}.md` or `gates/<slug>/{dom-equality,
slot-coverage,donor-probe}.md`, `**Overall: PASS|FAIL**`), runs the
prototype's mobile-adapt audit (static rules + `mobile-nav-audit.mjs`),
reads (d)'s `.work/reskin/gates/<slug>/figma/summary.json` into
`gates.figma` (and M2a's `…/deployed/summary.json` into
`gates.deployed`), and sets the page `gated` or `failing`. A Figma donor
with no figma fragment records `figma.*` NOT-RUN. A residual's `--gate`
for a Figma family is its class (`figma.geometry`, …). Chrome is never waived by an
agent: `deployed.sanity`/`deployed.chrome` residuals are refused, a header or footer
one needs `--by <owner>`, and `eyeball --verdict pass` is refused while
`deployed.chrome` fails. On an approved page it fills
`handoff.<type>` — the archetype, its prototype sha and the tier record
(gates passed, prototype gates waived) — which `reskin-preflight` and
`migrate` read. Re-run `record` after the approval and after every fix.

### Phase 6 — HANDOFF

Reskin owns the archetype pages; scale and shipping are the existing
pipeline:

- **Approve honestly.** The user approves the archetype
  (`state.mjs advance <slug> --to approved --by user --skill reskin`;
  `--history-only` on an already-migrated page); an agent may approve
  only in a hands-off run (`state.json` `handsOff: true`, `--by
  hands-off`) and only once Phase 5 (d) shows every gate PASS or
  accepted and the eyeball recorded. Then `reskin-ledger.mjs record
  <archetype>` again so the handoff entry exists.
- **Bridge, then check.** After the archetype is approved, run
  `scripts/canon-from-reskin.mjs <archetype-slug>` — it writes
  migrate's inputs (`canon/`, donor-sourced `DESIGN.*`, `direction.md`,
  `dynamic-features.md`), advances the approved type's `extracted`
  siblings to `directed` (migrate's sibling tier; then render each with
  `stream-render <slug> --register`) and, on a re-run with `--force`, flags
  approved/migrated pages stale where the canon change reaches them.
  A changed canon is captured to `stardust/reskin/approvals/` and
  pixel-compared with the previous approval (warn above
  `--visual-threshold`, default 10 %; recorded in the canon history).
  Then `scripts/reskin-preflight.mjs` must exit 0 — it is the
  `flow: reskin` predicate migrate and rollout require
  (`reference/handoff.md`). Never run
  `prepare-migration` or `direct` under `flow: reskin` — they rewrite
  the donor-sourced DESIGN.*.
- **Scale via the stardust `migrate` skill** (`../migrate/SKILL.md`) with the
  donor-pinned target (the `state.json.designSource` stamp Phase 1
  wrote is what `direct` reads for donor pinning;
  a bounded donor capture wrote no stamp — record the donor origin
  in the handoff instead, `reference/donor-sources.md` § Two
  first-class token-sourcing paths).
  Same-type sibling pages render at the **sibling tier** against the
  gated archetype; gate each migrated page (the three gates on
  migrate's output, reports in `reskin/gates/<slug>/migrated/`) and
  `reskin-ledger.mjs record <slug> --stage migrated`. Content rules are the ones reskin already
  enforces — `../migrate/reference/content-preservation.md` is
  inherited wholesale.
- **Ship via the stardust `deploy` and `rollout` skills.** An archetype
  page's first deploy is Phase 5 (e), preview-only
  (`reference/deployed-leg.md`); it is handed off once `deploy` Step 10's
  eyeball, CLS and header results (or `unresolved`) are in its ledger.
  Publishing and the rest of the site are
  theirs. Blocks written for donor modules obey the Experience Workspace
  editability contract (deploy SKILL.md § 8, EW1–EW10) and pass the EW
  gate (`block-roundtrip --ew`) before they are done.

Reskin writes its own state under `stardust/reskin/` — `ledger.json`
(written by `reskin-ledger.mjs`) holds per-page status (`gated |
failing`), gate results, eyeball, residuals and the `handoff` record. In
the core state machine (`../stardust/reference/state-machine.md`) it
only stamps `flow` (Setup) and `designSource` (Phase 1: `extract
--design-source` for URL and directory donors, `figma-donor.mjs stamp`
for Figma), registers each rendered page (`prototypePath` and
`prototyped`, or `directed` for a sibling — Phase 4 `--register`),
writes `approved` on the archetype and, through the bridge, `directed`
on its type's `extracted` siblings (Phase 6). The full
handoff contract — predicate, approval, tier record, bounded inventory,
sibling gate — is `reference/handoff.md`.

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
| `stardust/canon-source/foundation/`, `{role,module}-candidates.json`, `spec-tables.json` | Figma donor: normalized values with node ids, and the curation candidates |
| `stardust/reskin/curation-rules.json` | Figma donor: the authored rules, `curate`'s one non-mechanical input |
| `stardust/reskin/donor-tokens.json` | Curated probe-able token sheet, pinned to one reference page |
| `stardust/reskin/donor-modules.md` | Enumerated donor module vocabulary (M1..Mn) with screenshot evidence |
| `stardust/reskin/content-model/<slug>/content-model.json` | Byte-oriented per-page content model (+ source screenshot) |
| `stardust/reskin/normalize/<slug>.mjs` | Per-page executable normalization ledger (shared capture ↔ gates) |
| `stardust/reskin/mapping.md` | The mapping brief: every slot → donor module, status, rationale |
| `stardust/reskin/mapping.json` | The per-section decisions the renderer reads (`reference/mapping-json.md`; `stream-render --check`) |
| `stardust/reskin/renderers/<archetype>.mjs` | Programmatic renderers (model in, HTML out) |
| `stardust/reskin/pages/<slug>.html` | Rendered reskin pages |
| `stardust/reskin/reports/` | Per-page gate reports + screenshots |
| `stardust/reskin/figma-checks/<slug>.json` | Figma donor: the authored geometry, type and pixel checks (git-ignored under `--confidential`) |
| `stardust/reskin/deltas/<slug>.json` | Deployed leg: the page's declared source → preview differences (`--deltas`) |
| `stardust/reskin/gates/<slug>/` | Gate reports (alternate layout), `migrated/` for the sibling gate on migrate's output |
| `stardust/reskin/ledger.json` | Per-page status, gate results, eyeball, residuals, handoff record (`reskin-ledger.mjs`) |
| `stardust/scripts/reskin/` | Project-local copies of the skill scripts |
| `stardust/.work/reskin/{figma,gates/<slug>/{figma,figma-preview,deployed}}/` | Git-ignored evidence: the Figma REST cache and frame PNGs; each leg's checks, `summary.json`, divergence register and preview record |
| `stardust/reskin/content-model/<slug>/{text-ops,flags}.json`, `assets/` | Figma-only projects: figma-text-gate's text ops, the flags (deploy blocklist) and image bytes beside the Figma-sourced model; the page's `reskin/deltas/<slug>.json` is seeded with `metadata.absent` |

## References

- `reference/handoff.md` — reskin → migrate/rollout: the predicate,
  approval (D3), tier record (D4), bounded inventory, sibling gate.
- `reference/donor-sources.md` — the three donor types and their
  capture recipes; pin-one-reference-page; `donor-tokens.json` and
  `donor-modules.md` contracts; the Figma adapter (REST).
- `reference/content-model.md` — the capture contract: slot taxonomy,
  the ordered stream (the render surface), scope-discovery procedure,
  normalization ledger format, provenance.
- `reference/mapping-brief.md` — entry schema (the table form the
  Figma join reads), the ≥80% gate, new-module composition rules,
  casing policy.
- `reference/mapping-json.md` — `mapping.json`: every key the
  renderer reads, its values and defaults; `stream-render --check`.
- `reference/gates.md` — the gates' commands, pass bars, tolerances,
  failure modes, residual logging; § (d) the Figma checks; § (e) the
  deployed bars.
- `reference/deployed-leg.md` — the deployed leg: preconditions,
  isolation, recipe, delta file, ledger shape, fix budget.
- `../extract/SKILL.md` § Cross-site brand sources — the
  `--design-source` donor-capture path Phase 1 delegates to.
- `../migrate/reference/content-preservation.md` — the content rules
  reskin inherits (and tightens to byte level).
- `../diff/SKILL.md` — the pixel + structural probes; reuse them as a
  supplementary build-side check after Phase 6 deploy, `--profile eds`.
