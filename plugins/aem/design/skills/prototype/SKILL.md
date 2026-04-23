---
name: prototype
description: "Create, refine, review, critique, or iterate on branded, high-fidelity HTML prototypes under `aem-design/prototypes/**/*.html` — per-page visual design in the browser using the brand and (optionally) grey wireframes. Owns visual design decisions: type scale, spacing, proportions, button sizing, visual weight, section rhythm, layout, typography, and imagery placement. Produces self-contained static HTML; no EDS or dev-server dependency. Iterate directly in the rendered page until the user approves. Use when the user is ready to design visuals, when the user asks to change, refine, refactor, review, improve, polish, critique, or iterate on visual styling, proportions, or layout (page copy is owned by briefings; brand voice/identity by brand), or whenever the user asks to modify a file under `aem-design/prototypes/**/*.html`."
license: Apache-2.0
metadata:
  version: "0.1.0"
---

# Prototype

Design in the browser. Produce **branded, high-fidelity HTML** for each page — real fonts, real colors, real copy — and iterate on it directly with the user until they approve. The output is self-contained static HTML.

This is the stage where visual design decisions happen: type scale, spacing, proportions, button sizing, visual weight, section rhythm.

## Pre-flight

Run the procedure in [`../_shared/preflight.md`](../_shared/preflight.md) first.

## Contract

**Needs (reads if present):**
- `aem-design/brand-profile.json`
- `aem-design/briefings/{page}.md` (including optional `# Copy` and `# Imagery`)
- `aem-design/wireframes/{page}.html`
- `.impeccable.md`

**Produces:**
- `aem-design/prototypes/{page}.html` (self-contained, branded, desktop fidelity)

**If missing:**
- No brand-profile.json → synthesize a neutral brand shape (system-ui fonts, mono palette, straight voice). Stamp provenance in the design's `<head>`.
- No briefing → prompt the user for a one-line page intent; synthesize a minimal briefing (in memory only, unless the user says "save it"); stamp provenance.
- Briefing has no `# Copy` → generate on-brand copy following `brand-profile.json` voice rules and `.impeccable.md`. Stamp provenance per section.
- No wireframe → shape structure from the briefing directly.
- No `.impeccable.md` → use brand-profile defaults only.

## Copy Ownership

The briefing is the source of truth for copy.

- If a section has `# Copy` in the briefing, use those strings **verbatim**. Never rewrite.
- If a section has no `# Copy`, generate on-brand copy and record provenance (per-section, in the `<head>` provenance block — e.g. `hero.headline: synthesized`).
- **Never auto-write generated copy back to the briefing.** If the user asks ("also save this to the briefing") perform a single, targeted writeback and report what changed.

---

## Phase 1: Plan

For each briefing:

1. Load structural input:
   - If `aem-design/wireframes/{page}.html` exists, use it as the section order and layout reference.
   - If not, plan the sections from the briefing:
     - If the `impeccable` plugin is installed (`/impeccable shape` is registered), delegate to `/impeccable shape`.
     - Otherwise, use the "For wireframe section planning" pattern in [`../_shared/fallback-brainstorm.md`](../_shared/fallback-brainstorm.md). Per [`../_shared/soft-deps.md`](../_shared/soft-deps.md), impeccable fallback runs silently.
2. For each section, check the briefing's `# Copy`:
   - Present → use **verbatim**. Do not rewrite under any feedback loop unless the user explicitly says to change the words in the briefing.
   - Absent → generate on-brand copy; add the slot to the design's provenance block (e.g. `hero.headline: synthesized`).
   - Never write generated copy back to the briefing automatically. Offer: "Want me to also save these lines to the briefing?" after the first render — act only on explicit confirmation.
3. Re-read the briefing's `# Imagery` section — follow source hints; otherwise generate branded placeholders.

## Phase 2: Render (Branded Mode)

Render each design as a self-contained HTML file at desktop fidelity (1440px design target):

- **Brand fonts** via `@import` or `<link>` to web fonts.
- **Brand colors** for surfaces, text, CTAs, and accents per `brand-profile.json` color roles.
- **Real component styles** — button patterns, border-radius, motifs from the brand profile.
- **Real copy** — briefing `# Copy` verbatim, or on-brand generated copy.
- **Images** — briefing `# Imagery` sources, or branded placeholders.
- **CSS custom properties in `:root`** that expose type scale, spacing, max-width, section padding, button proportions. These values are the **authoritative desktop tokens** — any downstream translation (to EDS CSS, another framework, a design handoff) reads them from here.
- Preserve `data-section`, `data-intent`, `data-layout` attributes from the wireframe so downstream stages can read structure.
- **Provenance block** — if any input was synthesized (brand, briefing, wireframe, or any `# Copy` slot), include a `<!-- aem-design:provenance ... -->` comment as the first child of `<head>` per [`../_shared/skill-contract.md`](../_shared/skill-contract.md). List each synthesized input and, for copy, each synthesized slot.

Write to `aem-design/prototypes/{page}.html`.

Follow the rendering rules in [design-guide.md](reference/design-guide.md).

## Phase 3: Serve

Prototypes are self-contained HTML files. To review one:

- Simple case: `open "aem-design/prototypes/<page>.html"` (macOS) — open in default browser.
- When you need a real HTTP origin (for fetch, service workers, relative asset URLs): `python3 -m http.server 8000 --directory aem-design/prototypes` and visit `http://localhost:8000/<page>.html`.

Tell the user which URL to visit. Do not assume any project-specific dev server.

## Phase 4: Iterate in the Browser

This is a **design loop**, not a one-shot render. Expect multiple rounds:

Common feedback and how to handle it:
- **"Headlines are too big/small"** → Adjust `--heading-*` custom properties, re-render, refresh.
- **"Section feels cramped"** → Adjust `--section-padding` or per-section spacing, re-render.
- **"Button needs more weight"** → Adjust button padding/font-size/weight in the design CSS.
- **"Try a different accent color"** → Swap the CSS variable value; do not edit `brand-profile.json` unless the user wants to make it the new brand default.
- **"This section should feel quieter"** → Adjust typographic weight or surface color on that specific section.

Every iteration updates `aem-design/prototypes/{page}.html`. The user reviews in the browser and gives feedback. Keep iterating until they approve.

Before asking the user to look at a new iteration, run a critique:

If the `impeccable` plugin is installed (`/impeccable critique` is registered), use it. Otherwise, apply the rubric in [`../_shared/fallback-critique.md`](../_shared/fallback-critique.md). Per [`../_shared/soft-deps.md`](../_shared/soft-deps.md), impeccable fallback runs silently.

## Phase 5: Approval Gate

**Hard gate** in interactive mode — do not proceed until the user approves each prototype.

**Pipeline automation:** When invoked as part of a full pipeline run, auto-approve after two critique passes and continue.

When the user approves:
1. Confirm all prototypes are saved under `aem-design/prototypes/*.html`.
2. Tell the user: "Prototypes approved. Run `/aem-design` to see your next step."

## Why Prototypes Are Static HTML

Prototypes are platform-agnostic — they could in principle feed any downstream build later (EDS, a different SSG, a different CMS). They are pure HTML + CSS judgment calls.

Keeping prototypes static and EDS-free means:
- Visual design can be iterated freely without implementation complications.
- Any downstream translation (to EDS CSS, to a framework component library, etc.) is mechanical, not judgmental.
- The prototype layer is portable across target platforms.

## Artifacts Written

| File | Description |
|------|-------------|
| `aem-design/prototypes/{page}.html` | Branded, high-fidelity static HTML per page — self-contained, EDS-independent |
