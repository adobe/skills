---
name: reskin
description: Rebuild an existing site's pages with byte-faithful content on a separately-defined donor design system — another live site, or local static HTML prototypes (Figma donors are contract-defined, not yet implemented). Content fidelity is gated byte-level (text, ordered images, SEO metadata); design application is flexible (content re-laid-out onto donor modules). Use when the user says "reskin my site with this design", "apply this design system to my content", "restyle my site to look like <other site>", "new design, same content", "rebrand my site using these prototypes", or names a content site plus a design donor. NOT for redesigning from intent (that's the stardust core extract/direct/prototype chain) and NOT for keeping the current design while migrating (that's the replica flow).
license: Apache-2.0
---

# stardust:reskin — same content, donor design

The user has a site (the **content source**) and a design that already
exists somewhere else (the **donor**: another live site, or a directory
of static HTML prototypes; Figma is future scope). Reskin rebuilds the
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

The decisive rule, validated in the UC2-E1 experiment (hirslanden ×
stripe: 2281/2281 text bytes, 7/7 images, 47/47 slots, 13/13 metadata,
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
  - `--donor-figma <url>` — **not yet implemented.** The contract is
    defined (`reference/donor-sources.md` § Figma) but the adapter is
    future scope. Tell the user exactly this: *"Figma donors are not
    implemented yet. Export the frames as static HTML prototypes (or
    point me at a live staging URL of the design) and re-run with
    `--donor-dir` / `--donor`. The Figma adapter — variables→palette,
    text styles→type, frame screenshots→vision references, provenance
    class `figma-mcp` — is specced in
    `skills/reskin/reference/donor-sources.md` and will land in a
    later release."* Do not improvise a partial Figma capture.
- `--pages <slug,slug,...>` — optional. Restrict the content capture
  to specific pages. Default: the archetype set (one page per page
  family; scale to siblings happens in Phase 6 via `migrate`).
- `--scope <selectors>` — optional. Pre-declare the content-root
  scope for a single-page run (comma-separated, `!` suffix keeps a
  scope whole; see `reference/content-model.md` § Scope declaration).
  Without it, run the scope-discovery procedure per page.

## Setup

1. Run the master skill's setup (`../stardust/SKILL.md` § Setup):
   impeccable dep check, context loader, state read.
2. **Playwright import-resolvability probe** — same contract as
   `../extract/SKILL.md` § Setup:
   `node -e "import('playwright').then(()=>process.exit(0))"` from the
   project root; on failure
   `npm i -D playwright --no-save --legacy-peer-deps`. Re-run the
   probe at the start of every phase that renders — a `--no-save`
   install is pruned by any later real `npm i`.
3. **Copy the scripts into the project.** ESM resolves
   `import('playwright')` from the *script's* directory and the plugin
   tree ships no `node_modules`. Copy `skills/reskin/scripts/*` (all
   five files — `capture-content.mjs` and `dom-equality.mjs` import
   `source-normalize.mjs` as a sibling) byte-identical to
   `stardust/scripts/reskin/`, **and** `skills/diff/scripts/
   live-session.mjs` to `stardust/scripts/diff/` — every reskin gate
   script (capture-content, dom-equality, donor-probe, **and**
   slot-coverage) imports it unconditionally at startup, regardless
   of target type: without the copy each one exits 2 immediately,
   even for `--help` or a local-file `--rendered` target. It supplies
   ALL live-target hardening (real-Chrome UA + standard headers,
   challenge detection, headed-stealth escalation), resolved from
   `../diff/` next to `../reskin/`, so keep the two dirs siblings.
   Run the copies.
4. **Origin collision** — if `stardust/state.json` records a different
   `site.originUrl`, stop and ask before mixing sites, per
   `../extract/SKILL.md` § Setup.

## Procedure

### Phase 1 — INGEST DONOR

The donor's design system is captured **separately** from the content
site, into `stardust/canon-source/`. Full recipes per donor type in
`reference/donor-sources.md`; summary:

- **Live URL** (`--donor <url>`): invoke
  `stardust:extract <content-url> --design-source <donor-url>` — the
  existing skill, unchanged. It lands in `stardust/canon-source/`: the
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
- **Figma** (`--donor-figma`): FUTURE. Surface the exact message from
  § Inputs and stop.

Then author two reskin-owned donor artifacts (contracts in
`reference/donor-sources.md`):

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
  set the Phase 3 mapping brief maps onto.

**The pin-one-reference-page rule (hard).** Real donors run multiple
design systems concurrently — the experiment's donor served radius-4px
/ 1266px on its homepage and pill-radius / 1080px on older product
pages. Consolidating across them produces a chimera no live page ever
shipped, and the token probe then asserts against nothing. When donor
pages disagree on a token, **pin ONE donor reference page per module
family**, record it in `donor-tokens.json` (`curatedFrom` + a note
naming the reference page), and demote the other pages to
corroboration.

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

1. **CONTENT-ROOT SCOPE declaration.** Naive scoping silently dropped
   30% of the experiment page's content — the hero and a banner
   carousel lived inside `<header>`, outside the obvious `#content`
   root, and byte equality would have "passed" against the incomplete
   reference. Never trust `main` or `#content` blind. Run the
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

The decisive validated rule: **the page is GENERATED from
`content-model.json` — never retyped by hand.** Write a renderer
script per archetype (`stardust/reskin/renderers/<archetype>.mjs`,
modeled on the experiment's `render-reskin.mjs`) that:

- reads the page's `content-model.json` and interpolates **every**
  visible string, href, and image URL from the model (HTML-escaped) —
  if a string appears in the output HTML but not in the model, the
  renderer is wrong;
- takes each slot's structure from the **ordered stream**
  (`sections[].ordered`, `reference/content-model.md` § The ordered
  stream): kind-tagged nodes in document order, nesting preserved
  (a CTA wrapping its heading and vice versa), `sep` flags marking
  zero-separator inline joins. The stream is **innerText-consistent
  by construction** (its text nodes are sliced from the parent's
  rendered `innerText` — the byte-gate basis), so emitting it
  verbatim is safe. Emit nodes in stream order; emit
  `sep: ""` neighbours with no whitespace between them (inline);
  never reorder, and never reconstruct **order or separators** from
  `visibleText` —
  the first field run did exactly that (per-type arrays matched
  greedily against `visibleText` as an oracle) and burned three
  debug rounds on duplicate identical strings, both directions of
  CTA/container nesting, and zero-separator inline `li` runs, all
  of which the stream now captures structurally;
- renders `formControl` nodes as **equivalent controls**, not text:
  a `<select>` carrying the captured option texts **verbatim, in
  order**; inputs/textareas carrying value/placeholder — restyled
  with donor tokens (the new-module composition rules apply), never
  flattened to prose and never dropped. A select's option text is
  part of the source's `innerText`, so dropping the control fails
  the byte gate with nothing structured to render from
  (`reference/content-model.md` § Slot taxonomy, formControls);
- carries the metadata block verbatim into `<head>` (title,
  description, canonical, OG, Twitter, JSON-LD — including source
  garbage like broken JSON-LD URLs: fidelity over repair; **flag**
  such items for the human in the run report, never silently fix or
  silently keep);
- takes its surface exclusively from `donor-tokens.json` (emitted as
  CSS custom properties) + the donor module patterns assigned in
  `mapping.md`. Use the rendered-page conventions the Phase 5 probe
  asserts against: content in `<main>`, `.container` for the measure,
  `.btn` for the donor primary button (`reference/gates.md`
  § Rendered-page conventions);
- writes `stardust/reskin/pages/<slug>.html`, self-contained.

Renderers may parse a single node's text apart (split a list-item row
into kicker/date/title) but must **fail loudly** (throw) when a parse
doesn't reproduce the node's text — a silent partial parse is a silent
content drop. A slot whose `orderedVerified` is `false` is inspected
before rendering, never trusted blind; when inspection shows stream
text genuinely absent from the slot's `visibleText`, the
**sanctioned fallback** is to drop that text before rendering and
record the drop in the model's provenance — filtering ghosts against
`visibleText` is the documented resolution, distinct from the
forbidden order-reconstruction move
(`reference/content-model.md` § When `orderedVerified` is false).

### Phase 5 — GATES

Three gate families per page; commands, pass bars, tolerances, and
failure modes in `reference/gates.md`. Serve or `file://`-address the
rendered page and run:

**(a) CONTENT GATE** — all three must pass:

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

`dom-equality.mjs` (vendored + adapted from github.com/aemcoder/skills,
Apache-2.0) gates on whitespace-normalized visible-text **byte
equality** and the **ordered, URL-normalized visible-image set**;
element count and tag sequence are reported but informational.
`slot-coverage.mjs` additionally proves every model slot present
(slot text substring, every CTA as a (text, absolute-href) pair,
every image) and asserts metadata carry-over field by field.

**(b) DESIGN-ADOPTION GATE:**

```bash
node stardust/scripts/reskin/donor-probe.mjs \
  --tokens stardust/reskin/donor-tokens.json \
  --rendered stardust/reskin/pages/<slug>.html \
  --report stardust/reskin/reports/<slug>-donor-probe.md
```

Computed-style assertions of donor token values on the rendered page —
bg/fg, font-family token string, display weight, button spec,
container width, band palette, section rhythm. Tolerances (exact for
colors/radius/family; ±2px button padding; ±20px container; ±16px
section rhythm) documented in `reference/gates.md` § Tolerances.
Then the **side-by-side judgment**: open the rendered page next to the
donor reference-page screenshots (`canon-source/assets/screenshots/`)
and judge adoption with your eyes — the probe proves tokens, the
eyeball proves the page *reads as* the donor. Record the verdict.

**(c) Sanity** — no horizontal overflow at 1440 and 360 (donor-probe
runs this automatically; `--widths` to override).

**One fix iteration per gate family** — one for the content gate,
one for design-adoption/sanity. On a failure in a family, fix once,
re-run all gates (a fix for one gate can break another). Residual
failures after a family's iteration is spent are logged in
`stardust/reskin/ledger.json` under the page's `residuals[]` — never
silently absorbed, never looped on indefinitely. (Both field runs
support the budget: the validation experiment spent one iteration on
360px chrome; the smoke run spent exactly one per family — a
content-side separator emission fix and a sanity-side 360px chrome
fix. A single shared iteration would have forced a false residual;
per-family keeps the loop bounded without absorbing real failures.)

### Phase 6 — HANDOFF

Reskin owns the archetype pages; scale and shipping are the existing
pipeline, unchanged:

- **Scale via `stardust:migrate`** (`../migrate/SKILL.md`) with the
  donor-pinned target (the `state.json.designSource` stamp Phase 1
  wrote is exactly what `direct`/`migrate` read for donor pinning;
  a bounded donor capture wrote no stamp — record the donor origin
  in the handoff instead, `reference/donor-sources.md` § Two
  first-class token-sourcing paths).
  Same-type sibling pages render at the **sibling tier** against the
  gated archetype. Content rules are the ones reskin already
  enforces — `../migrate/reference/content-preservation.md` is
  inherited wholesale.
- **Ship via `stardust:deploy` / `stardust:rollout`**, unchanged.

Reskin writes its own state under `stardust/reskin/` — `ledger.json`
holds per-page status (`captured → mapped → rendered → gated`), gate
results, and residuals. It makes **no changes to the core state
machine** (`../stardust/reference/state-machine.md`); the only
`state.json` touch is the `designSource` stamp that extract itself
writes in Phase 1.

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
- **Figma donor requested** — future scope; exact message in § Inputs.

## Outputs

| Path | Purpose |
|---|---|
| `stardust/canon-source/` | Donor capture + descriptive DESIGN.md/json (extract `--design-source`, unchanged) |
| `stardust/reskin/donor-tokens.json` | Curated probe-able token sheet, pinned to one reference page |
| `stardust/reskin/donor-modules.md` | Enumerated donor module vocabulary (M1..Mn) with screenshot evidence |
| `stardust/reskin/content-model/<slug>/content-model.json` | Byte-oriented per-page content model (+ source screenshot) |
| `stardust/reskin/normalize/<slug>.mjs` | Per-page executable normalization ledger (shared capture ↔ gates) |
| `stardust/reskin/mapping.md` | The mapping brief: every slot → donor module, status, rationale |
| `stardust/reskin/renderers/<archetype>.mjs` | Programmatic renderers (model in, HTML out) |
| `stardust/reskin/pages/<slug>.html` | Rendered reskin pages |
| `stardust/reskin/reports/` | Per-page gate reports + screenshots |
| `stardust/reskin/ledger.json` | Per-page status, gate results, residuals |
| `stardust/scripts/reskin/` | Project-local copies of the five skill scripts |

## References

- `reference/donor-sources.md` — the three donor types and their
  capture recipes; pin-one-reference-page; `donor-tokens.json` and
  `donor-modules.md` contracts; the Figma future contract.
- `reference/content-model.md` — the capture contract: slot taxonomy,
  the ordered stream (the render surface), scope-discovery procedure,
  normalization ledger format, provenance.
- `reference/mapping-brief.md` — entry schema, the ≥80% gate,
  new-module composition rules, casing policy.
- `reference/gates.md` — both gates' commands, pass bars, tolerances,
  failure modes, residual logging.
- `../extract/SKILL.md` § Cross-site brand sources — the
  `--design-source` donor-capture path Phase 1 delegates to.
- `../migrate/reference/content-preservation.md` — the content rules
  reskin inherits (and tightens to byte level).
- `../diff/SKILL.md` — the pixel + structural probes; reuse them as a
  supplementary build-side check after Phase 6 deploy, `--profile eds`.
