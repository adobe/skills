# Content from Figma (Figma-only projects)

Read by `reskin` SKILL.md Phase 2′ when the project has no live site.

No live site, so no `capture-content`. A Figma URL names the **file**, not
the page set: the linked node is only where the user was looking. Discover
every page and the kit first:

```bash
node stardust/scripts/reskin/figma-donor.mjs pages <figma-url> [--refresh] [--confidential]
node stardust/scripts/reskin/figma-donor.mjs capture <figma-url>   # the whole file
# add figma-pages.json modules[] to curation-rules.json modules, then curate + stamp
node stardust/scripts/reskin/figma-donor.mjs content <figma-url> --all [--only a,b]
```

`capture` takes the whole file, every page's top-level frames, sections,
components and component sets with their subtrees, so the foundation
frames, the page frames and the kit's main sets (`figma-pages.json`
`captureFrames`) are already in it. A main set nested inside a section is
in that section's node data, which `figma-gate` reads; pass `--frames`
only to give such a set a frame of its own, and then list the whole
selection with it (`_crawl-log.json#discovery.selected` plus the nested
sets), because `--frames` replaces the selection and never adds to it.
No `--max-frames`: a large file warns on stderr and is captured whole.

`pages` writes `reskin/figma-pages.json`: every page of the FULL PAGES
canvases (one per page-set `Type`, its desktop frame plus the responsive
one; "Page: …" documentation frames skipped) and the **block library** —
every TEMPLATE SECTIONS (❏) and COMPONENTS (❖) canvas is one kit block and
one donor module, *whether a page uses it or not* (its public sets are
variant classes, its `.` sets parts). The kit library is a **proposal**:
block names, and block vs default content, are decided by
[`deploy` Step 2](../../deploy/SKILL.md#2-decide-names--reuse--lock-before-writing-any-code) (D1/D11),
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
`content-rules.json` `kit` overrides: [`content-model.md`](content-model.md) § Pages
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
[`content-model.md`](content-model.md) § Figma-sourced models. A placeholder-only
page exits 1: the design holds no content to reskin.

Review `figma-donor.mjs blocklist` before deploy: every open `block` or
`review` flag (missing alt, unresolved links, derived title, kit copy)
is fixed in Figma and `content` re-run, or acknowledged with
`figma-donor.mjs ack <slug> --flag <key> --why "…"`. Phases 3–5 run
unchanged except the content gate (Phase 5). Deploy goes to an isolated
preview, never over an existing DA document; there is no origin, so
`migrate` is skipped.

## Outputs

| Path | Purpose |
|---|---|
| `stardust/reskin/figma-pages.json` | Every page and the kit block library (`pages`) |
| `stardust/reskin/content-model/<slug>/{text-ops,flags}.json`, `assets/` | figma-text-gate's text ops, the flags (deploy blocklist) and image bytes beside the Figma-sourced model; the page's `reskin/deltas/<slug>.json` is seeded with `metadata.absent` |
| `stardust/reskin/mapping.seed.json` | Slot → block map and `library` (`content --all`) |
| `stardust/reskin/figma-renders.json` | PNG of every page breakpoint frame and library variant, for gate (f) |
