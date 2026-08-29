---
name: figma-to-eds
description: Apply a design system defined in Figma — a component web kit or sample page designs — to an AEM Edge Delivery Services (EDS) site as reusable blocks, with design fidelity gated against Figma at the token and component level. Implements the stardust:reskin Figma donor contract (donor-sources.md § 3, provenance class figma-mcp) and extends it with an EDS block target. Use when a site must adopt a Figma-defined design system ("make the blocks match the Figma web kit", "build these Figma pages as EDS blocks", "the design system source of truth is Figma"), the Figma file is reachable via the Figma desktop MCP, and the output is an EDS code repo (styles + blocks). NOT for content migration (that's stardust extract/replica/migrate — content fidelity is gated upstream) and NOT for redesigning from intent (that's stardust direct/prototype).
license: Apache-2.0
---

# figma-to-eds — Figma design system, EDS blocks

The user has an EDS site (or an EDS migration in progress) and a design
system that lives in Figma. This skill captures the Figma source into
stardust's canon-source artifacts, curates a probe-able token sheet,
maps the Figma module vocabulary onto EDS blocks, applies it, and gates
the result **against Figma, not against any live site**.

The division of contracts mirrors stardust:reskin:

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
  per-page frames plus per-component. (Contract defined; harden this
  mode on its first real run.)

## Inputs

- The Figma file **open and focused in the Figma desktop app** with
  the local MCP server enabled (server `figma-desktop`). Verify with a
  no-argument `get_metadata` call — it returns the file's page list.
  If it errors, relay the seat/permission/file checklist in
  `reference/figma-mcp-recipes.md` § Connection and stop.
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
   byte-equal token values against `donor-tokens.json`.
2. **Component diff** — each block rendered at the Figma frame's
   width, screenshot-diffed against the exported Figma frame.
   Structural mismatch fails; anti-aliasing/text-raster noise is
   declared in a per-gate tolerance note, not silently absorbed.
3. **Divergence attribution** — if there is a pre-existing live
   site: for each visual delta live-vs-new, a register row citing
   the Figma node id that mandates it. A delta with no node id is a
   defect (unmandated drift).

Details in `reference/gates.md`.

## Artifacts

| artifact | contract |
|---|---|
| `stardust/canon-source/` | Figma capture: foundation JSONs, `_brand-extraction.json`, `donor-modules.md`, screenshots, `_crawl-log.json` (reskin donor contract, `figma-mcp`) |
| `stardust/reskin/donor-tokens.json` | probe-able exact-string token sheet |
| `stardust/figma-to-eds/mapping.md` | module ↔ block mapping brief |
| `stardust/figma-to-eds/gates/` | token probe results, component diffs, divergence register |

## Relationship to stardust

This skill is the implementation of reskin's `--donor-figma` adapter
(capture + curate phases are upstreamable into `skills/reskin`
verbatim) plus an EDS-target apply/gate layer. It assumes content
fidelity is handled by the stardust migration flow it runs alongside.

## Eval policy

Eval fixtures for this skill MUST be synthetic or public design
systems. Client web kits, client tokens, client screenshots, and
client node ids never enter the skill tree or its evals — validation
runs against real clients stay in the client project's `stardust/`
directory. Before any upstream PR, grep the skill tree for the client
vocabulary of every project it was hardened on.
