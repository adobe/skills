---
name: figma-to-eds
description: Apply a design system defined in Figma — a component web kit or sample page designs — to an AEM Edge Delivery Services (EDS) site as reusable blocks, with design fidelity gated against Figma at the token and component level. Implements the capture half of the stardust reskin skill's Figma donor contract (donor-sources.md § 3, provenance class figma-mcp) and adds an EDS block target. Use when a site must adopt a Figma-defined design system ("make the blocks match the Figma web kit", "build these Figma pages as EDS blocks", "the design system source of truth is Figma"), the Figma file is reachable via the Figma MCP (desktop or remote server), and the output is an EDS code repo (styles + blocks). NOT for content migration (that's stardust extract/replica/migrate — content fidelity is gated upstream) and NOT for redesigning from intent (that's stardust direct/prototype).
license: Apache-2.0
---

# figma-to-eds — Figma design system, EDS blocks

The user has an EDS site (or an EDS migration in progress) and a design
system that lives in Figma. This skill captures the Figma source into
stardust's canon-source artifacts, curates a probe-able token sheet,
maps the Figma module vocabulary onto EDS blocks, applies it, and gates
the result **against Figma, not against any live site**.

The division of contracts mirrors the stardust `reskin` skill:

- **Content is out of scope here.** Text, images, metadata fidelity are
  gated by the upstream migration (replica/reskin content gates). This
  skill never edits content; it edits `styles/` and `blocks/`.
- **Design is gated against Figma.** Where an existing live site and
  the Figma kit disagree, **Figma wins**. Live-vs-new visual diffs are
  demoted to a *divergence report* in which every delta must be
  attributable to a Figma node id — never a design gate.

## Donor modes

- **`web-kit`** — the Figma file is a component library (foundation
  token pages + a module/component inventory). Page composition is
  inherited from the existing site's structure; every block's surface
  comes from the kit. The gate surface is per-component.
- **`sample-pages`** — the Figma file contains full page designs.
  Composition AND surface come from Figma; the gate surface is
  per-page frames plus per-component. First real run done on a
  single-page file: sample pages are built from library instances, so
  read `reference/figma-mcp-recipes.md` quirks 7–9 and § Desktop vs
  remote server before capturing (design context returns component
  defaults, not the page's overrides).

## Inputs

- A Figma MCP connection: the desktop server (`figma-desktop`, file
  **open and focused in the Figma desktop app**, local MCP server
  enabled) and/or the remote server. Verify with a no-argument
  `get_metadata` call — with nothing selected, the desktop server
  returns the file's page list. If it errors, relay the
  seat/permission/file checklist in `reference/figma-mcp-recipes.md`
  § Connection and stop. Sample-page files usually need the remote
  server for nested instance ids (§ Desktop vs remote server).
- An EDS project checkout (the target `styles/` + `blocks/` tree), or
  a decision to bootstrap one.
- Optional: an explicit scope contract inside the kit (e.g. a
  "future / do not develop" section) — honor it verbatim.

## Phases

### 1. Capture → `stardust/canon-source/`

Produce the same artifacts as reskin's other donor types, per the
fixed contract in stardust `skills/reskin/reference/donor-sources.md`
§ 3 — provenance class `figma-mcp`, every derived value cites the
Figma node id it came from, `_crawl-log.json` records
`fetchTechnique: "figma-mcp"` and states explicitly that no
`renderedBy: "playwright"` pages exist:

1. **Inventory** — no-arg `get_metadata` for the page list; classify
   pages (foundation / brand / atoms / modules / excluded / meta).
2. **Foundation tokens** — extract palette, type ramp, spacing,
   borders, shadows, motion into
   `canon-source/foundation/*.json` + `_brand-extraction.json`.
   Follow `reference/figma-mcp-recipes.md` exactly — the MCP has
   sharp edges (usage-scoped variables, oversized dumps) and the
   recipes encode the reliable paths. **Never retype a value**;
   parse dumps programmatically so exactness holds by construction.
3. **Module vocabulary** — enumerate module/component pages into
   `canon-source/donor-modules.md`: one row per module, node id,
   family, variants, status. Excluded sections are listed with status
   `excluded — do not develop`.
4. **Vision references** — `get_screenshot` per module frame →
   `canon-source/assets/screenshots/<module-slug>.png`.

### 2. Curate → `stardust/reskin/donor-tokens.json`

The probe-able token sheet: exact strings for colors, type, radii,
borders, shadows, spacing. Figma has no computed styles, so values
are authored from variables/spec tables rather than sampled — the
probe still works because the tokens are exact either way (the
contract's acknowledged gap). Semantic variables map to CSS custom
properties by a declared, mechanical naming transform (see
`reference/eds-mapping.md` § Token transform) recorded in the file
itself, so the probe can assert both name and value.

Curate with a re-runnable project script, not by hand: the
`canon-source/foundation/*.json` files are the input of record and
the sheet is regenerated from them after every capture change. What
is not mechanical is declared inside the sheet:
- `normalizations[]` — value-form rules the probe applies (percent
  line-height → unitless, kit weight names → the weights the licensed
  web font actually serves, font smoothing);
- `curations[]` — each decision with its evidence. A typo in a kit
  spec table stays verbatim in the foundation file and is corrected
  only here, citing the rule that proves it (e.g. the kit's own
  naming formula); a value that looks wrong but has no second source
  is kept and flagged as suspect, never silently fixed.

### 3. Map → `stardust/figma-to-eds/mapping.md`

The module ↔ EDS block mapping brief: for each Figma module, the
target block (existing block to restyle / new block to build /
variant of another), the variant model (EDS block classes), and the
atoms it composes. Existing blocks with no Figma counterpart go to
the divergence register with a proposed resolution, they are never
silently restyled by taste. Method in `reference/eds-mapping.md`.

### 4. Apply

Tokens first, then blocks: `styles/styles.css` gets the custom
properties and element type ramp (per the kit's HTML mapping, if it
publishes one); each block's CSS/JS is then written against tokens
only — a block that hardcodes a hex or px that exists as a token is
a defect even if it renders identically.

### 5. Gate → `stardust/figma-to-eds/gates/`

Three gates, in order:

1. **Token probe** — computed styles of rendered blocks assert
   byte-equal token values against `donor-tokens.json`; then
   `scripts/token-literals.mjs` checks consumption (no block
   hardcodes a value that exists as a token).
2. **Component diff** — each block rendered at the Figma frame's
   width, screenshot-diffed against the exported Figma frame.
   Structural mismatch fails; anti-aliasing/text-raster noise is
   declared in a per-gate tolerance note, not silently absorbed.
   The last round runs on the preview origin against DA-authored
   documents — delivered markup differs from fixtures
   (`reference/gates.md` § Real-content check).
3. **Divergence attribution** — if there is a pre-existing live
   site: for each visual delta live-vs-new, a register row citing
   the Figma node id that mandates it. A delta with no node id is a
   defect (unmandated drift). `scripts/divergence-viewer.mjs` renders
   the register per page for stakeholders.

Details in `reference/gates.md`.

## Artifacts

| artifact | contract |
|---|---|
| `stardust/canon-source/` | Figma capture: foundation JSONs, `_brand-extraction.json`, `donor-modules.md`, screenshots, `_crawl-log.json` (reskin donor contract, `figma-mcp`) |
| `stardust/reskin/donor-tokens.json` | probe-able exact-string token sheet |
| `stardust/figma-to-eds/mapping.md` | module ↔ block mapping brief |
| `stardust/figma-to-eds/gates/` | token probe and token-literals results, component diffs, divergence register, divergence viewers |

## Relationship to stardust

This skill implements the capture half of reskin's `--donor-figma`
contract plus an EDS-target apply/gate layer; reskin itself does not
accept a Figma donor yet. The capture phase is upstreamable into
`skills/reskin` as is. The curate phase is not: its token sheet uses
its own shape, which reskin's donor-probe does not read, so it has to
be mapped onto reskin's `donor-tokens.json` shape when the adapter
lands there. It assumes content fidelity is handled by the stardust
migration flow it runs alongside.

## Eval policy

Eval fixtures for this skill MUST be synthetic or public design
systems. Client web kits, client tokens, client screenshots, and
client node ids never enter the skill tree or its evals — validation
runs against real clients stay in the client project's `stardust/`
directory. Before any upstream PR, grep the skill tree for the client
vocabulary of every project it was hardened on.
