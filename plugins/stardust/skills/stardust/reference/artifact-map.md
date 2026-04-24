# stardust Artifact Map

All pipeline state lives under `stardust/`. The pipeline has four design stages; each produces a distinct artifact.

## Stage 1: Brand (`/stardust:brand`)

| Artifact | Path | Format | Description |
|----------|------|--------|-------------|
| Brand Profile | `stardust/brand-profile.json` | JSON | Structured brand tokens: colors, typography, spacing, voice, photography, personas |
| Design Personality | `.impeccable.md` | Markdown | Design context for impeccable quality gates (project root) |
| Brand Board | `stardust/brand-board.html` | HTML | Visual brand board for designer approval |
| Logo Assets | `icons/` | SVG/PNG | Logo variants, brand icons |

**Required input:** Brand guidelines (PDF, URL, or conversation)
**Human gate:** Designer approves brand board

## Stage 2: Briefings (`/stardust:briefings`)

| Artifact | Path | Format | Description |
|----------|------|--------|-------------|
| Site Briefing | `stardust/briefings/_site.md` | Markdown | Cross-cutting: sitemap, nav, shared messaging, content reuse map |
| Page Briefings | `stardust/briefings/{page}.md` | Markdown | Per-page intent. Fidelity spans prompt-only → structured → fully specified (with copy + imagery) |

**Required input:** None. Briefings are independent of brand extraction and can be authored before, after, or in parallel with `/stardust:brand`.
**Human gate:** User approves each briefing.

## Stage 3: Wireframes (`/stardust:wireframes`) — optional

| Artifact | Path | Format | Description |
|----------|------|--------|-------------|
| Wireframes | `stardust/wireframes/{page}.html` | HTML | Grey, structural wireframes — no brand colors, no real fonts |

**Required input:** `stardust/briefings/*.md`. Brand is **not** required — wireframes are intentionally pre-brand and focus on structure only.
**Human gate:** User approves each wireframe's structure.
**Optional:** users who already have a clear structural vision can skip this stage and go briefings → prototype.

## Stage 4: Prototype (`/stardust:prototype`)

| Artifact | Path | Format | Description |
|----------|------|--------|-------------|
| Prototypes | `stardust/prototypes/{page}.html` | HTML | Branded, high-fidelity static HTML per page — self-contained; authoritative desktop tokens in `:root` |

**Required input:** `stardust/brand-profile.json` **AND** `stardust/briefings/*.md`. Optionally uses `stardust/wireframes/*.html` as structural input.
**Human gate:** User approves each prototype (iterative loop in the browser).
**Platform:** Self-contained HTML. No build step, no dev server, no CMS dependency. The approved prototypes can inform any downstream implementation.

## Navigator Detection Logic

The navigator reads the filesystem and reports status per stage:

| Check | Status |
|-------|--------|
| `stardust/brand-profile.json` exists | Brand: complete |
| `.impeccable.md` exists | Design personality: set |
| `stardust/brand-board.html` exists | Brand board: rendered |
| `stardust/briefings/` has `.md` files | Briefings: authored |
| `stardust/wireframes/` has `.html` files | Wireframes: created (grey) — optional stage |
| `stardust/prototypes/` has `.html` files | Prototypes: created (branded) |
