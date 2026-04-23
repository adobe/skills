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

## When to use this skill

- The user is ready to design visuals — type scale, spacing, proportions, layout, visual weight.
- The user asks to change, refine, review, critique, or iterate on visual styling or any file under `aem-design/prototypes/**/*.html`.
- The user types `/aem-design:prototype`, or asks to "design the page" after briefings are ready.

## Do NOT use this skill

- For page copy — copy is owned by `briefings`. Propose a writeback to `briefings/{page}.md` if the user wants to save a new headline.
- For brand voice or identity decisions (colors, typography system, tone). Hand off to `brand`.
- For grey structural wireframes. Hand off to `wireframes`.
- To build EDS blocks or production HTML. Prototype stops at static HTML — EDS implementation is a separate downstream effort.

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

## Phase 0: Variant Count

Before designing, ask the user: **"How many variants would you like? (1 = single prototype, 2–4 = a set to choose from)"**. Default to **1** if the user skips or the skill is invoked as part of an automated pipeline.

- **1 variant** — produce `aem-design/prototypes/{page}.html` as before. Skip the rest of this phase.
- **N ≥ 2 variants** — the skill produces `{page}-a.html`, `{page}-b.html`, ... `{page}-{letter}.html`, each exploring a distinct design direction. Pick directions along axes that are load-bearing for *this* brand (e.g. if the brand voice is unsettled, vary type-voice; if the palette is rich, vary color-energy). Canonical axes to pick from:
  - **type-voice** — editorial serif-forward ↔ software sans-forward
  - **density** — airy/spacious ↔ catalog/compressed
  - **color-energy** — restrained/ink-led ↔ saturated/surface-led
  - **imagery-role** — decorative/background ↔ content/lead
- Record the chosen direction per file as a one-line comment inside the prototype's provenance block (e.g. `variant_direction: "editorial, Fraunces-forward, quiet"`).

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
- **Brand colors** for surfaces, text, CTAs, and accents per `brand-profile.json` color roles. Derive the page ground from the brand palette — do NOT default to cream (or any rebrand: vellum, kami, bone, ivory, eggshell). See [`../_shared/divergence-toolkit.md`](../_shared/divergence-toolkit.md) § 2.5 Ground-color seed.
- **Real component styles** — button patterns, border-radius, motifs from the brand profile.
- **Real copy** — briefing `# Copy` verbatim, or on-brand generated copy.
- **Images** — briefing `# Imagery` sources, or branded placeholders.
- **CSS custom properties in `:root`** that expose type scale, spacing, max-width, section padding, button proportions. These values are the **authoritative desktop tokens** — any downstream translation (to EDS CSS, another framework, a design handoff) reads them from here.
- Preserve `data-section`, `data-intent`, `data-layout` attributes from the wireframe so downstream stages can read structure.
- **Provenance block** — if any input was synthesized (brand, briefing, wireframe, or any `# Copy` slot), include a `<!-- aem-design:provenance ... -->` comment as the first child of `<head>` per [`../_shared/skill-contract.md`](../_shared/skill-contract.md). List each synthesized input and, for copy, each synthesized slot.

Write to `aem-design/prototypes/{page}.html` (single-variant mode) or `aem-design/prototypes/{page}-{letter}.html` for each variant (multi-variant mode). In multi-variant mode, each file is rendered independently — variants share the briefing's copy and the brand tokens, but differ on the design-direction axes chosen in Phase 0.

Follow the rendering rules in [design-guide.md](reference/design-guide.md).

## Phase 3: Serve

Prototypes are self-contained HTML files. To review:

- **Single variant**: `open "aem-design/prototypes/<page>.html"` (macOS) — open in default browser. Or `python3 -m http.server 8000 --directory aem-design/prototypes` and visit `http://localhost:8000/<page>.html` when a real HTTP origin is needed (fetch, service workers, relative asset URLs).
- **Multiple variants**: open each variant file. Present the set to the user alongside a short comparison table:

  | Variant | Direction | Key visual move | Risk |
  |---|---|---|---|
  | a | editorial, Fraunces-forward | oversized serif headline, narrow measure | may read as too quiet for a tech audience |
  | b | software-catalog, Inter-dense | table-led hero, hard geometric rhythm | may read as cold without warm imagery |
  | ... | ... | ... | ... |

  Ask the user: **"Which variant should we take forward?"** Wait for an explicit answer (`a`, `b`, ...) before moving on.

Tell the user which URL(s) to visit. Do not assume any project-specific dev server.

## Phase 4: Iterate in the Browser

This is a **design loop**, not a one-shot render. Expect multiple rounds.

In multi-variant mode, **iterate only on the variant the user named** (e.g. `landing-b.html`). Unchosen variants stay on disk as a design-history reference; do not delete or rename them without the user's explicit ask. Every subsequent iteration request refers implicitly to the chosen variant until the user picks a different one.

Common feedback and how to handle it:
- **"Headlines are too big/small"** → Adjust `--heading-*` custom properties, re-render, refresh.
- **"Section feels cramped"** → Adjust `--section-padding` or per-section spacing, re-render.
- **"Button needs more weight"** → Adjust button padding/font-size/weight in the design CSS.
- **"Try a different accent color"** → Swap the CSS variable value; do not edit `brand-profile.json` unless the user wants to make it the new brand default.
- **"This section should feel quieter"** → Adjust typographic weight or surface color on that specific section.

Every iteration updates the file under review — `aem-design/prototypes/{page}.html` in single-variant mode, or `aem-design/prototypes/{page}-{letter}.html` for the variant the user named in multi-variant mode. The user reviews in the browser and gives feedback. Keep iterating until they approve.

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
| `aem-design/prototypes/{page}.html` | Branded, high-fidelity static HTML per page — self-contained, EDS-independent. Single-variant mode. |
| `aem-design/prototypes/{page}-{letter}.html` | One file per variant (`-a`, `-b`, `-c`, `-d`) when the user asked for 2–4 variants. Each carries a `variant_direction` line in its provenance block. Unchosen variants stay on disk as design history. |
