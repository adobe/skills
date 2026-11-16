# figma-to-content: phase 3, existing block, new block or default content

The text of this part of `SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

## Phase 3A — Map content into an EXISTING block

**Reuse gate — structure AND visual.** An existing block is a valid target
only when the section both (a) **fits the block's authoring model** (its
row/cell structure and field types) *and* (b) **matches the block's rendered
appearance** under the project theme, using only tokens and variants the block
already defines. Structural fit alone is **not** enough: if the section's
visual identity — bespoke layout, corner radius, shadow, decorative treatment —
lives in that block's own CSS, you cannot reproduce it without editing the
block (forbidden), so route the section to **Phase 3B** (new block). Global,
token-level differences (palette, fonts, type scale) do **not** break reuse —
they are absorbed once by retargeting the project's design tokens (see
Guardrails). **How to run the visual check — reuse testing-blocks, don't invent
one:** get a rendered example of the candidate block — its `liveExampleUrl`
(block-collection-and-party) or the project's own block
rendered at `localhost:3000` with the section's **actual** content — including
secondary text, captions, and CTAs over whatever background or media the block
places them on, not just placeholder cells — then follow **testing-blocks**'
browser/Playwright-MCP screenshot pass (mobile/tablet/desktop) and its "compare
implementation to design" step, comparing that screenshot against the Figma
**section screenshot** from Phase 1. Watch for treatments a block applies to
only its primary element: one that (say) whitens a heading over dark media but
leaves the supporting text and buttons at body color passes a structural check
yet renders that text illegibly — a divergence the token retheme cannot fix.
Divergence beyond what the token retheme explains ⇒ new block (or a new
variant), not reuse. This outcome is **blocking**: the section is not resolved
until its rendered look — that text included — is faithful, and the fix is a new
isolated block/variant, never an edit to the shared block. Recording the gap in
the plan and reusing the block anyway is a **plan note, not a fix** — the Phase 5
pre-publish gate treats such a box as failed.

Once the gate passes, **invoke block-collection-and-party** to learn the block's
authoring model (its examples show the row/cell structure and variants) — read
the block from the skill, don't guess its model from its CSS source. Then pour
the Figma content into that structure:

- **Text** → matching cells; preserve heading levels from the design.
- **Variants** → extra class tokens on the block (e.g. `cards highlight`).
  Only apply a variant the block actually defines. (Adding a *new* variant =
  modifying an existing block = Phase 3B, not 3A.)
- **Links/buttons** → a **standalone link** (the only content of its
  paragraph) auto-promotes to a button; wrap in `<strong>` for a primary
  button, `<em>` for secondary. Do not add `target="_blank"` (decoration
  handles external links). Validate the href's URL scheme and escape the
  link text/attributes before emitting — see Phase 4, *Sanitize everything
  derived from the design*. *(da-content SKILL.md)*
- **Images** → Phase 4 (they need real URLs).

## Phase 3B — Create a NEW block (content + code)

Only for sections Phase 2 routed here (a needed block is missing, or an existing
block's look diverges) — the **3B** case. **Guardrails (strict):**

- Create **new, isolated block folders** only (`blocks/<new-name>/`).
- **Do NOT** skin this block by editing an existing block, `scripts.js`, or
  `head.html`, or by adding block-specific rules to global CSS — keep it
  self-contained under `blocks/<new-name>/`. *(Retargeting the project's
  global design tokens in `styles/styles.css` — the `:root` custom properties
  and base typography — is a separate, allowed project-theming step, not part
  of building this block; see Guardrails.)*
- New block **names and variant tokens** must obey EDS block-name rules
  (da-content, Blocks): lowercase alphanumeric + single hyphens,
  **no underscores, no double dashes, must not start with a digit** (stricter
  than the pipeline, which normalizes underscores; this is the house rule)
  (`pricing-table` ✓, `pricing_table` / `2col` / `promo--wide` ✗). Names must
  be unique and not collide with existing blocks.

**Build route — invoke content-driven-development (don't hand-write the block).**
Build every new block by **invoking content-driven-development** — not by writing
block JS/CSS from scratch off this file's summary. It invokes **content-modeling**
(design the authoring model from the Figma structure/tokens) then
**building-blocks** and **testing-blocks**, and produces a self-contained
`blocks/<name>/` — no source URL, no installed substrate, no page chrome, and no
global styles. That is the route that honors the 3B guardrails above, and its
testing-blocks pass is the block's Stage B verification (Phase 5). Build a **bespoke, one-off** section
the same way — it is still an ordinary isolated block, and "one-off" changes
nothing about how it is generated.

> **Do not use snowflake here.** Snowflake converts an *already-rendered* page:
> it requires a reachable **Source URL**, **installs an overlay substrate** into
> the repo, and in block mode emits **header/footer fragments and global
> styles/tokens** — each of which violates this skill's constraints (isolated new
> block, don't touch globals, work from the **Figma frame**, not a live URL).
> Snowflake is the right tool for a *different* entry point — converting an
> existing static/rendered site — as noted under "When NOT to use".

Use the Figma design context/tokens from Phase 1 as the source of truth for
layout and styling. New-block **CSS must target structure, not authored
classes** — inline wrappers like `<span class="…">` are stripped inside block
cells at delivery (da-content SKILL.md), so a class you emit in a
cell will not survive.

**Make the block responsive.** A Figma page frame is almost always a single
**desktop** width, but EDS pages are responsive. Author the block mobile-first
(or with explicit breakpoints) so a multi-column layout collapses to one column
on narrow viewports, and verify at mobile / tablet / desktop via
**testing-blocks** — don't ship a fixed desktop-width block. If the design
provides a **separate mobile frame**, use it to derive the breakpoint behavior
(what stacks, what hides, how type scales) — it's the *same page*, so it feeds
one responsive block, **not** a second page (see Inputs on frame variants).

The new block's code must be **committed and pushed to the deploy branch on
GitHub and built by Code Sync** before the page can render it — see Phase 5
(content+code).

## Phase 3C — Author DEFAULT CONTENT (no block)

For sections Phase 2 routed to default content — the **3C** case — emit standard
document elements directly inside the section `<div>` (see Phase 4 skeleton) — no
block wrapper:

- Headings `<h1>`–`<h6>` (preserve levels), paragraphs, lists, images.
- A **standalone link** in its own `<p>` becomes a button (`<strong>`/`<em>`
  for primary/secondary) — same rule as 3A.
- Do **not** add `class`, `id`, or `style` — decoration adds them at delivery.

*(da-content SKILL.md)*
