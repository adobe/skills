---
name: reskin
description: Rebuild an existing site's pages with byte-faithful content on a separately-defined donor design system — another live site, local static HTML prototypes, or a Figma file read headlessly over the REST API. Content fidelity is gated byte-level (text, ordered images, SEO metadata); design application is flexible (content re-laid-out onto donor modules). Use when the user says "reskin my site with this design", "apply this design system to my content", "restyle my site to look like <other site>", "new design, same content", "rebrand my site using these prototypes", "use this Figma design for my site", "build my site from these Figma pages" (Figma-only, no live site), or names a content site plus a design donor. NOT for redesigning from intent (that's the stardust core extract/direct/prototype chain) and NOT for keeping the current design while migrating (that's the replica flow).
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project's stardust/ scripts, and the impeccable skill (github.com/pbakaus/impeccable) installed alongside stardust.
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
- **Design is flexible.** Content is re-laid-out onto donor modules (a
  carousel may become a card grid); structure is informational, never
  gating — but no source region silently vanishes (gate (a′)).

The decisive rule: **the page is generated programmatically from the
captured content model — content strings are never retyped.** Byte
fidelity then holds by construction.

## Inputs

- `<content-url>` — required. The site whose content is preserved.
  Figma-only (no live site): `figma-donor.mjs init <url>`, then Phase 2′.
- Donor, exactly one of:
  - `--donor <url>` — a live site whose design system is adopted.
  - `--donor-dir <path>` — a directory of local static HTML
    prototypes (claude-design / Mobirise / Relume / Lovable / v0 /
    hand-coded). Served on localhost and captured through the same
    path — recipe in `reference/donor-sources.md` § Local prototypes.
  - `--donor-figma <url>` — a Figma file (a design, file, proto or
    branch URL; the whole file is read, a `node-id` only recorded), read
    headlessly over the REST API. Needs a personal access token in
    `FIGMA_TOKEN`. Optional `--frames <ids>` and
    `--confidential` (refuses to write anything git would track;
    sticky for `curate` and `stamp`). Flags, schemas, exit codes:
    `figma-donor.mjs --help`.
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
2. **Node 22+ and an import probe from `stardust/`** for `playwright`,
   `pixelmatch` and `pngjs`. On failure install into `stardust/` as
   its own package root, never into the project (a root install can
   rewrite the lockfile and prune the project's dev tooling), and never
   `--no-save`. After any install `git diff --stat package-lock.json`
   must be empty. Commands: `reference/gates.md` § Install. Re-run the
   probe at the start of every phase that renders.
3. **Copy the scripts into the project and run the copies**,
   byte-identical, into sibling dirs under
   `stardust/scripts/{reskin,stardust,diff,replica,deploy,prototype}/`: every
   reskin gate script resolves the master skill's `browser.mjs` there
   and exits 2 without it. List: `reference/gates.md` § Project copies.
4. **Origin collision** — if `stardust/state.json` records a different
   `site.originUrl`, stop and ask before mixing sites, per
   `../extract/SKILL.md` § Setup.
5. **Full-inventory check** — on resume, and again after Phase 1's
   crawl: a capped crawl is a setup error; re-crawl with `--all`
   (`reference/full-site.md` § Full-inventory check).
   Figma-only: the inventory is every page `figma-donor.mjs pages` finds.

## Procedure

### Phase 1 — INGEST DONOR

The donor's design system is captured **separately** from the content
site, into `stardust/canon-source/`. The same extract run crawls the
content site, always `--all` and never `--prep`
(`reference/full-site.md`). Recipes per donor type in
`reference/donor-sources.md`; summary:

- **Live URL** (`--donor <url>`):
  `$stardust extract <content-url> --all --design-source <donor-url>`,
  unchanged; it stamps `state.json.designSource`
  (`../extract/SKILL.md` § Cross-site brand sources).
- **Local prototype dir** (`--donor-dir <path>`): serve it on
  localhost and run the same `--design-source` capture against that
  origin, recording the real provenance in
  `canon-source/_crawl-log.json`.
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
  token sheet**: every value a computed-style string the Phase 5 probe
  can assert verbatim, citing the donor page it came from.
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
(contract: `reference/content-model.md`): per slot, the content and
the **ordered stream** Phase 4 renders; per page, full SEO metadata,
the normalized visible text (the content-gate reference) and a
screenshot.

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
3. **RESIDUE, BANDS, RAILS.** Each one the capture prints is carried
   in Phase 3 (a rail via `mapping.json` `"rail"`) or declared dropped in
   `stardust/reskin/coverage/<slug>.json` (`reference/content-model.md`
   § Placement).

### Phase 2′ — CONTENT FROM FIGMA (Figma-only projects)

Replaces Phase 2: read `reference/figma-only.md` in full. Clear the
`blocklist` before deploy; isolated preview only; no `migrate`.

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
  *rendered-case*; it stays byte-faithful and casing is applied via CSS
  `text-transform` only (`reference/mapping-brief.md` § Casing policy).

Composite source sections (one wrapper div holding two logical
regions) are split into atomic slots in the brief — section ≠ slot.

Then write `stardust/reskin/mapping.json`, the same decisions in the
shape the renderer reads (`reference/mapping-json.md`);
`stream-render.mjs --check <slug…>` must exit 0. Every later
per-section decision is made there and re-rendered, never in the page
or the EDS blocks alone.

### Phase 4 — PROGRAMMATIC RENDER

**The page is generated from `content-model.json`, never retyped by hand.**
`stream-render.mjs <slug> --register --type <page type>` renders any
donor and site (flags: `reference/render.md`); write a per-archetype
renderer only where it falls short. The renderer interpolates every visible string, href and image URL from the model
(HTML-escaped), emits the ordered stream in order and never rebuilds
order or separators from `visibleText`, renders form controls as
controls, keeps the structure the stream carries (`reference/content-model.md`
§ Structure the stream keeps), carries the metadata block verbatim, crops images to the area the
source shows, takes its surface only from `donor-tokens.json`
(`render/root-tokens.mjs`) and the mapped modules, wraps each mapped
slot in `<section data-slot data-module>`, and writes
`stardust/reskin/pages/<slug>.html`. A text parse that does not
reproduce its node throws. Rules: `reference/render.md`.

### Phase 5 — GATES

Gates (a)–(c) per page; (d) Figma donor; (e) deployed; (f) Figma-only. Commands, pass bars, tolerances and failure modes:
`reference/gates.md`.

- **(a) Content gate** — `dom-equality.mjs` (visible-text byte
  equality, the ordered image set and image crop, with the page's
  normalize ledger) and `slot-coverage.mjs` (every slot, CTA pair, image and
  metadata field). All must pass. Figma-sourced: `figma-text-gate.mjs`
  replaces `dom-equality`.
- **(a′) Source coverage** — `source-coverage.mjs`, also on (e).
- **(b) Design-adoption gate** — `donor-probe.mjs` asserts the
  donor tokens as computed styles, then the **side-by-side
  judgment** against the donor screenshots; record the verdict.
  Paths in `donor-tokens.json` `coverage.absent` are SKIPs in the
  probe, so copy each into every page's `flags[]` in `ledger.json`.
- **(c) Sanity** — no horizontal overflow at 1440 and 360.
- **(d) Figma fidelity** (Figma donor) — offline: author
  `stardust/reskin/figma-checks/<slug>.json` from `figma-gate.mjs boxes
  --module Mn`, run `figma-gate.mjs all` under `run-bg`. B0 join, B1
  geometry and B3 tokens block; B2 pixels advisory. Exit 124 is no
  verdict, re-run once.
- **(e) Deployed acceptance** (aem-boilerplate project only) — after
  the local gates, `deployed-gate.mjs` on the page's aem.page preview,
  never published; an auth-protected preview stops with exit 2. It
  replaces only `deploy` Step 10's automated reconcile: the eyeball,
  CLS and header checks stay mandatory. Recipe, delta file and budget:
  `reference/deployed-leg.md`.
- **(f) Exact fidelity** (Figma-only, blocking) — `figma-gate.mjs
  exact` and `library` (`reference/gates.md` § (f)).

**One fix iteration per gate family** ((e) has its own budget), then
re-run all gates. Failures left are `residuals[]`, never absorbed or
looped on. **The ledger is written by script, never by hand:**
`reskin-ledger.mjs record|eyeball|residual|step10`
(`reference/gates.md` § Residual logging); agents never waive chrome.

### Phase 6 — HANDOFF

Reskin owns the archetype pages; scale and shipping are the existing
pipeline, unchanged. **The default is the whole site**; archetypes-only
delivery is an opt-out the user asks for in words, recorded in
`ledger.json#delivery` (`reference/full-site.md` § Delivery scope).

- **Approve, bridge, check** (`reference/handoff.md`). The user
  approves the archetype (`state.mjs advance <slug> --to approved
  --by user`); an agent may only in a hands-off run (`handsOff: true`,
  `--by hands-off`), once every gate is PASS or accepted and the
  eyeball recorded. Then `reskin-ledger.mjs record <archetype>`,
  `canon-from-reskin.mjs <archetype>`, render the siblings, and
  `reskin-preflight.mjs` must exit 0. Never run `prepare-migration` or
  `direct` under `flow: reskin`.
- **Scale via the stardust `migrate` skill** with the donor-pinned
  target (`direct` reads Phase 1's `designSource` stamp; a bounded
  capture records the donor origin in the handoff instead). Every
  non-archetype page renders at the sibling tier; a type without an
  archetype gets one, never a skip. Gate each migrated page
  (`reference/handoff.md` § Sibling gate). Content rules:
  `../migrate/reference/content-preservation.md`, inherited wholesale.
- **Ship via the stardust `deploy` and `rollout` skills** — `rollout`
  over the full migrated tree. An archetype's first deploy is (e),
  preview-only; publishing is theirs. Donor-module blocks pass the EW
  gate (`block-roundtrip --ew`, deploy Step 8).
- **Hand off the whole vocabulary**: every included `donor-modules.md`
  row gets built (`reference/vocabulary.md`);
  `vocabulary-check.mjs --library <dir>` exits 0 before handoff.

Reskin's state is `stardust/reskin/ledger.json` (`gated | failing`,
gates, eyeball, residuals, `handoff`). In `state.json` it stamps `flow`,
`designSource` and `pages[].type`, registers rendered pages, approves
the archetype and, through the bridge, moves siblings to `directed`.

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
| `stardust/reskin/mapping.json` | Per-section decisions the renderer reads |
| `stardust/reskin/renderers/<archetype>.mjs` | Programmatic renderers (model in, HTML out) |
| `stardust/reskin/pages/<slug>.html` | Rendered reskin pages |
| `stardust/reskin/reports/` | Per-page gate reports + screenshots |
| `stardust/reskin/figma-checks/<slug>.json`, `deltas/<slug>.json` | Figma checks (d); declared preview differences (e) |
| `stardust/reskin/ledger.json` | Per-page status, gate results, residuals |
| `stardust/scripts/reskin/` | Project-local copies of the skill scripts |
| `stardust/.work/reskin/` | Git-ignored: Figma REST cache, frame PNGs, per-leg gate evidence |

## References

Each `reference/` file is named where its phase uses it. After Phase 6
deploy, `../diff/SKILL.md` (`--profile eds`) is a supplementary
build-side check.
