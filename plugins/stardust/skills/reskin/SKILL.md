---
name: reskin
description: Rebuild an existing site's pages with byte-faithful content on a separately-defined donor design system — another live site, local static HTML prototypes, or a Figma file read headlessly over the REST API. Content fidelity is gated byte-level (text, ordered images, SEO metadata); design application is flexible (content re-laid-out onto donor modules). Use when the user says "reskin my site with this design", "apply this design system to my content", "restyle my site to look like <other site>", "new design, same content", "rebrand my site using these prototypes", "use this Figma design for my site", or names a content site plus a design donor. NOT for redesigning from intent (that's the stardust core extract/direct/prototype chain) and NOT for keeping the current design while migrating (that's the replica flow).
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
  gating.

The decisive rule: **the page is generated programmatically from the
captured content model — content strings are never retyped.** Byte
fidelity then holds by construction.

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
   Never edit a copied script (or `stardust/rollout/encoder/`): a
   script that can't handle the page is a residual. Read image sizes
   with node (`pngjs`, Playwright); python PIL is not assumed.
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
  screenshots; fix it in the rules. Run this ingest in one subagent
  that returns only the artifacts and frame list. Recipe and scope:
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
controls, carries the metadata block verbatim, crops images to the area the
source shows, takes its surface only from `donor-tokens.json`
(`render/root-tokens.mjs`) and the mapped modules, wraps each mapped
slot in `<section data-slot data-module>`, and writes
`stardust/reskin/pages/<slug>.html`. A text parse that does not
reproduce its node throws. Rules: `reference/render.md`.

**Keep behaviour.** A source pattern keeps its behaviour: sticky or
fixed trays (an ISI), modals, collapsed
accordions, fragment-loaded content. The content gate measures them
expanded and resolved, so never inline, open or un-stick one to pass
a gate; if a gate still can't read it, log a `gate.limitation`
residual. Content the source keeps on screen stays on screen.

### Phase 5 — GATES

Three gate families per page, plus (d) for a Figma donor and (e) for
a deployed page. Commands, pass bars, tolerances and failure modes:
`reference/gates.md`.

- **(a) Content gate** — `dom-equality.mjs` (visible-text byte
  equality, the ordered image set and image crop, with the page's
  normalize ledger) and `slot-coverage.mjs` (every slot, CTA pair, image and
  metadata field). All must pass.
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

**One fix iteration per gate family** ((e) has its own budget), then
re-run all gates. Failures left are `residuals[]`, never absorbed or
looped on. **The ledger is written by script, never by hand:**
`reskin-ledger.mjs record|eyeball|residual|step10|flag|delivery`
(`reference/gates.md` § Residual logging). **An agent never accepts
its own blocking failure**: a (d) `figma.*`, `exact`, `step10` or
header/footer residual is `--verdict needs-owner`; only `--by user`
accepts one. A hands-off run remaps the failing section instead: the
closest other kit module, then the source's own block
(`reference/gates.md` § Fallback ladder).

### Phase 6 — HANDOFF

Reskin owns the archetype pages; scale and shipping are the existing
pipeline, unchanged. **The default is the whole site**; archetypes-only
delivery is an opt-out the user asks for in words, recorded in
`ledger.json#delivery` (`reference/full-site.md` § Delivery scope).

- **Approve, bridge, check** (`reference/handoff.md`). The user
  approves the archetype (`state.mjs advance <slug> --to approved
  --by user`); an agent may only in a hands-off run (`handsOff: true`,
  `--by hands-off`), once every gate is PASS or covered by a residual
  the script lets it accept, and the eyeball recorded; `state.mjs`
  refuses otherwise. A `needs-owner` residual stops the run at
  handoff with the report. Then `reskin-ledger.mjs record <archetype>`,
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
  outside `donor-tokens.json`. An open-licence donor font (OFL, Apache)
  is self-hosted; a licensed one is adopted as the family *token
  string* with local fallback, never rebundled (`reference/gates.md` § (d)).
- **No silent slot drops.** Anything excluded from the gate scope is a
  declared chrome delta or a ledger normalization — declared in
  `mapping.md`, executable in the normalize module.
- **No hand-written ledger or state.** `flags`, `delivery`, residuals
  and approvals go through `reskin-ledger.mjs` and `state.mjs` only.
- **No partial site.** No capped content crawl, and no page of the
  inventory left unmigrated unless the user opted out (Phase 6).

## Stop conditions

- **Donor capture fails** (bot-block past the headed fallback,
  prototypes dir unservable) — surface extract's error verbatim.
- **Mapping ratio < 80%** — the donor vocabulary can't carry this
  content. Ask: widen the donor capture (more donor pages → more
  modules) or accept a larger explicit new-module list. Hands-off
  takes the list and flags the ratio.
- **Scope undecidable** — the content page's visible content cannot be
  covered by any selector set (heavy shadow-DOM, iframe-embedded
  content). Surface with the screenshot evidence.
- **Figma capture blocked** (exit 3: token, access, or a long
  rate-limit wait) — surface the script's checklist verbatim.

## Outputs

Every path a run writes: `reference/outputs.md`.

## References

- `reference/donor-sources.md` — donor capture recipes (URL, directory,
  Figma), token and module contracts.
- `reference/content-model.md` — capture contract, ordered stream,
  scope discovery, normalization ledger.
- `reference/full-site.md` — inventory, page typing, delivery scope.
- `reference/mapping-brief.md` — entry schema, the ≥80% gate, casing.
- `reference/mapping-json.md` — `mapping.json` keys and `--check`.
- `reference/render.md` — `stream-render` and renderer rules.
- `reference/handoff.md` — approval, bridge, preflight, sibling gate.
- `reference/gates.md` — gate commands, pass bars, residuals; (d), (e).
- `reference/deployed-leg.md` — the deployed leg.
- `reference/vocabulary.md` — building the whole donor vocabulary.
- `../extract/SKILL.md` § Cross-site brand sources — the
  `--design-source` donor-capture path Phase 1 delegates to.
- `../migrate/reference/content-preservation.md` — the content rules
  reskin inherits (and tightens to byte level).
- `../diff/SKILL.md` — the pixel + structural probes; reuse them as a
  supplementary build-side check after Phase 6 deploy, `--profile eds`.
