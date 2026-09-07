# figma-to-content

Turn a **Figma design** into an Adobe Edge Delivery Services
(EDS / AEM / Franklin / Helix) **content page** and deploy it to Document
Authoring (`da.live`). Give it a design and the skill **infers** each section's
mapping against the project's existing blocks and **confirms the plan** with you
before building — no annotations needed ("just migrate this page"). If a design
*happens* to be annotated, those annotations are used as an optional
accelerator, but they are never required.

Runs standalone in plain Claude / Coworker with just a **Figma MCP** (to read
the design) and a **DA IMS token** (to write content) — no proprietary web app
or migration tooling required.

## Two paths

The skill classifies each section of the design and follows the matching path:

- **Content only** — every section maps to a block the project **already
  has**. Author content into existing blocks and deploy. No code changes.
- **Content + code** — a section needs a block the project **does not have**,
  or an existing block matches structurally but its **styling diverges**. The
  block is created as a **new, isolated block** (via the public block-building
  skills), its code is pushed, then content is authored and deployed. **Existing
  blocks are never skinned** — the only global change is retargeting the
  project's design tokens to the design system.

A single design usually mixes both, plus default content.

## How it works

```
preflight: Figma MCP reachable · file access · DA token · project checkout    (fail fast)
        ▼
Figma frame (annotations optional)
        │  Figma MCP (get_metadata, get_design_context, get_screenshot, get_variable_defs)
        ▼
  section inventory ──► resolve each section  (infer + confirm; annotations optional)
        │                 ├─ existing block (structure + visual fit) ─► author content
        │                 ├─ needs one / look diverges → new block ───► build isolated block
        │                 │                                              (content-driven-development), push code
        │                 └─ default content ──────────────────────────► author prose/media, no block
        ▼
  resolution plan ──► confirm with user (ask on low-confidence; flag overwrite of an existing page)
        ▼
  content/<path>.html  ──► PUT admin.da.live/source  ──►  POST admin.hlx.page/preview
                            (da-content contract)          (+ Code Sync first, for new blocks)
        ▼
  pre-publish gate: legibility · no placeholder · icons resolve · blocks decorate · metadata present
        ▼
  da.live edit URL + aem.page preview URL
```

The flow is bracketed by two safety gates: a **preflight** (fail fast on a
missing Figma MCP, no file access, no DA token, or no project checkout — one
actionable message instead of a half-built page) and a **pre-publish gate**
(the page is not "done" until legibility, placeholder-free content, resolvable
icons, decorated new blocks, and a populated `metadata` block are all verified —
an un-run check counts as failed, never as a pass).

It **orchestrates existing public skills** rather than reinventing them — the
net-new logic is reading the Figma design, resolving each section to a block
(inferred by structure + visual fit and confirmed with you, or from annotations
when the frame has them), and mapping content into it. DA rules, auth, and block-building all defer
to the skills below.

## What's included

```
skills/figma-to-content/
├── SKILL.md                          Entry point (agent reads first)
├── README.md                         This file
├── package.json
└── references/
    └── annotation-contract.md        The annotation spec (optional path; proposed)
```

## Depends on (public skills)

- [`da-auth`](../da-auth) — DA IMS token
- [`da-content`](../da-content) — DA HTML rules + Source API + preview/publish + media
- [`block-collection-and-party`](../block-collection-and-party) — whether a block exists + its authoring model
- [`block-inventory`](../block-inventory) — survey the available block palette
- [`content-modeling`](../content-modeling) — design a content model for a new block
- [`content-driven-development`](../content-driven-development) — full dev workflow for a reusable new block (invokes [`building-blocks`](../building-blocks), [`testing-blocks`](../testing-blocks))
- [`testing-blocks`](../testing-blocks) — render a block + screenshot and compare to the design; reused directly for the **reuse gate's visual check**

## Status

**Draft (v0.1.0).** The infer-and-confirm path is the primary, fully working
flow. Before v1.0.0, close the open questions in `SKILL.md` (chiefly the default
image-hosting choice). The **annotation contract**
([`references/annotation-contract.md`](./references/annotation-contract.md)) is
an **optional enhancement** for teams that want to pre-declare section mappings
— nice to have, not required.

Intended destination:
`adobe/skills → plugins/aem/edge-delivery-services/skills/figma-to-content`.
