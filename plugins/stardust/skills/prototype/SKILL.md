---
name: prototype
description: "Create, refine, review, critique, or iterate on branded, high-fidelity HTML prototypes under `stardust/prototypes/**/*.html` — per-page visual design in the browser using the brand and (optionally) grey wireframes. Owns visual design decisions: type scale, spacing, proportions, button sizing, visual weight, section rhythm, layout, typography, and imagery placement. Produces self-contained static HTML; no build system or dev-server dependency. Iterate directly in the rendered page until the user approves. Use when the user is ready to design visuals, when the user asks to change, refine, refactor, review, improve, polish, critique, or iterate on visual styling, proportions, or layout (page copy is owned by briefings; brand voice/identity by brand), or whenever the user asks to modify a file under `stardust/prototypes/**/*.html`."
license: Apache-2.0
metadata:
  version: "0.1.0"
---

# Prototype

Design in the browser. Produce **branded, high-fidelity HTML** for each page — real fonts, real colors, real copy — and iterate on it directly with the user until they approve. The output is self-contained static HTML.

This is the stage where visual design decisions happen: type scale, spacing, proportions, button sizing, visual weight, section rhythm.

## When to use this skill

- The user is ready to design visuals — type scale, spacing, proportions, layout, visual weight.
- The user asks to change, refine, review, critique, or iterate on visual styling or any file under `stardust/prototypes/**/*.html`.
- The user types `/stardust:prototype`, or asks to "design the page" after briefings are ready.

## Do NOT use this skill

- For page copy — copy is owned by `briefings`. Propose a writeback to `briefings/{page}.md` if the user wants to save a new headline.
- For brand voice or identity decisions (colors, typography system, tone). Hand off to `brand`.
- For grey structural wireframes. Hand off to `wireframes`.
- To build EDS blocks or production HTML. Prototype stops at static HTML — EDS implementation is a separate downstream effort.

## Pre-flight

Run the procedure in [`../_shared/preflight.md`](../_shared/preflight.md) first.

## Contract

**Needs (reads if present):**
- `stardust/brand-profile.json`
- `stardust/briefings/{page}.md` (including optional `# Copy` and `# Imagery`)
- `stardust/wireframes/{page}.html`
- `.impeccable.md`

**Produces:**
- `stardust/prototypes/{page}.html` (self-contained, branded, desktop fidelity)

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

## Phase 0: Setup

Two setup questions before rendering begins. Ask both once per session (not per page). When the skill is re-invoked on an existing project, read answers from the last prototype's provenance block if present; re-ask only if any answer is missing.

### 0a · Variant count

Ask the designer to **confirm**, with **2 as the default**:

> **"I'll produce 2 variants of each prototype so you can compare — confirm, or give a different number (1–4)?"**

Wait for the designer's answer. Accept:
- `"ok"`, `"confirm"`, `"yes"`, Enter, `"2"` → 2 variants (default)
- `1` → single variant
- `3` or `4` → that many variants
- Any other input → re-ask once with the valid options

Default to **2** when:
- The designer skips or accepts the default
- The skill is invoked as part of an automated pipeline with no explicit variant count

- **1 variant** — produce `stardust/prototypes/{page}.html`.
- **N ≥ 2 variants** — the skill produces `{page}-a.html`, `{page}-b.html`, … `{page}-{letter}.html`, each exploring a distinct design direction. Pick directions along axes that are load-bearing for *this* brand (e.g. if the brand voice is unsettled, vary type-voice; if the palette is rich, vary color-energy). Canonical axes to pick from:
  - **type-voice** — editorial serif-forward ↔ software sans-forward
  - **density** — airy/spacious ↔ catalog/compressed
  - **color-energy** — restrained/ink-led ↔ saturated/surface-led
  - **imagery-role** — decorative/background ↔ content/lead
- Record the chosen direction per file as a one-line comment inside the prototype's provenance block (e.g. `variant_direction: "editorial, Fraunces-forward, quiet"`).

### 0b · Imagery mode

Ask: **"For images in the prototype, do you want: (a) branded placeholder rectangles — fast, offline, free, or (b) real generated images? If (b), you'll need to pick a model and point me at a credential."**

Default to **(a) placeholders** when the user skips, the skill runs in full-pipeline auto-approve mode, or no credential is available.

If the user picks **(b) generated**, ask two follow-ups:

1. **"Which image model?"** — the assistant presents options based on what's installed. Currently known providers:

   | Answer | Provider | Model | Credential env var |
   |---|---|---|---|
   | `gemini` | Google | Gemini 3 Pro Image Preview | `GOOGLE_API_KEY` |
   | `flux` | fal.ai | FLUX Schnell | `FAL_KEY` |
   | `imagen` | Google Vertex | Imagen 3 | `GOOGLE_APPLICATION_CREDENTIALS` |
   | `dalle` | OpenAI | DALL-E 3 | `OPENAI_API_KEY` |

2. **"Where's the credential?"** — accept any of:
   - `env` → the credential is already exported as the env var from the table above
   - A file path ending in `.env` → the skill reads the env var from that file (do NOT echo the key to the designer; just read it in memory)
   - A raw token → the skill treats the string as the key value and uses it only for this session (do not write it to disk)

**Record the imagery mode in each prototype's provenance block:**

```html
<!-- stardust:provenance
  imagery_mode: placeholder
  ...
-->
```

or, when generation was used:

```html
<!-- stardust:provenance
  imagery_mode: generated
  imagery_provider: gemini
  imagery_credential_source: /Users/paolo/excat/az-sitebuilder/.env
  imagery_generated_at: 2026-04-24T15:12:00Z
  images: [
    { section: "hero", path: "images/landing-hero.png", prompt_hash: "abc123" },
    ...
  ]
-->
```

**Never log the actual key value** anywhere — not in provenance, not in terminal output, not in error messages.

### Imagery-mode consequences for Phase 2

- **placeholder** → Phase 2 renders branded placeholder rectangles per [design-guide.md](reference/design-guide.md) *Imagery* section, option (b).
- **generated** → Phase 2 invokes the `ai-image-generator` skill (from `eds-site-builder`, `sumi`, or `testing` plugin — whichever is registered) with the chosen provider + credential, passing the briefing's `# Imagery` direction + brand `photography` rules per section. Generated images land at `stardust/prototypes/images/{page}-{section}.png`. Prototype HTML `<img src>` points at those relative paths.

**Fallback behaviour** when `imagery_mode = generated` but the generation fails:
1. Retry once with a slightly simplified prompt
2. On second failure, fall back to a branded placeholder for that specific image slot (not the whole page)
3. Stamp `imagery_fallback: true` and the failed-slot list in the provenance block so the designer knows which slots to retry later
4. Continue rendering the prototype — do not abort the whole page over one failed image

## Phase 1: Plan

For each briefing:

1. Load structural input:
   - If `stardust/wireframes/{page}.html` exists, use it as the section order and layout reference.
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
- **Provenance block** — if any input was synthesized (brand, briefing, wireframe, or any `# Copy` slot), include a `<!-- stardust:provenance ... -->` comment as the first child of `<head>` per [`../_shared/skill-contract.md`](../_shared/skill-contract.md). List each synthesized input and, for copy, each synthesized slot.

Write to `stardust/prototypes/{page}.html` (single-variant mode) or `stardust/prototypes/{page}-{letter}.html` for each variant (multi-variant mode). In multi-variant mode, each file is rendered independently — variants share the briefing's copy and the brand tokens, but differ on the design-direction axes chosen in Phase 0.

Follow the rendering rules in [design-guide.md](reference/design-guide.md).

## Phase 3: Serve

Prototypes are self-contained HTML files. **Open each file in the designer's default browser immediately after writing** per [`../_shared/skill-contract.md`](../_shared/skill-contract.md) *Opening HTML artifacts*. Do not require the designer to open the files manually.

- **Single variant**: `open "stardust/prototypes/<page>.html"` on macOS (`xdg-open` on Linux). Tell the user: "Your prototype is open."
- **Multiple variants**: open each variant file at the same time so the designer can flip between browser tabs. Then present the comparison table:

  | Variant | Direction | Key visual move | Risk |
  |---|---|---|---|
  | a | editorial, Fraunces-forward | oversized serif headline, narrow measure | may read as too quiet for a tech audience |
  | b | software-catalog, Inter-dense | table-led hero, hard geometric rhythm | may read as cold without warm imagery |
  | ... | ... | ... | ... |

  Ask the user: **"Which variant should we take forward?"** Wait for an explicit answer (`a`, `b`, ...) before moving on.

If the designer needs a real HTTP origin (fetch, service workers, absolute asset URLs), additionally run `python3 -m http.server 8000 --directory stardust/prototypes` in the background and tell them the `http://localhost:8000/<page>.html` URL — but keep the browser-open via `open` first, which handles 95% of cases via the `file://` protocol.

In pipeline-automation mode (no designer present), skip the open.

## Phase 4: Iterate in the Browser

This is a **design loop**, not a one-shot render. Expect multiple rounds.

In multi-variant mode, **iterate only on the variant the user named** (e.g. `landing-b.html`). Unchosen variants stay on disk as a design-history reference; do not delete or rename them without the user's explicit ask. Every subsequent iteration request refers implicitly to the chosen variant until the user picks a different one.

Common feedback and how to handle it:
- **"Headlines are too big/small"** → Adjust `--heading-*` custom properties, re-render, refresh.
- **"Section feels cramped"** → Adjust `--section-padding` or per-section spacing, re-render.
- **"Button needs more weight"** → Adjust button padding/font-size/weight in the design CSS.
- **"Try a different accent color"** → Swap the CSS variable value; do not edit `brand-profile.json` unless the user wants to make it the new brand default.
- **"This section should feel quieter"** → Adjust typographic weight or surface color on that specific section.

Every iteration updates the file under review — `stardust/prototypes/{page}.html` in single-variant mode, or `stardust/prototypes/{page}-{letter}.html` for the variant the user named in multi-variant mode. **Re-open the file in the browser after every iteration** so the designer sees the change immediately (browsers with live-reload will pick up the change on re-open; otherwise the user may need to refresh). Keep iterating until they approve.

Before asking the user to look at a new iteration, run a critique:

If the `impeccable` plugin is installed (`/impeccable critique` is registered), use it. Otherwise, apply the rubric in [`../_shared/fallback-critique.md`](../_shared/fallback-critique.md). Per [`../_shared/soft-deps.md`](../_shared/soft-deps.md), impeccable fallback runs silently.

## Phase 5: Approval Gate

**Hard gate** in interactive mode — do not proceed until the user approves each prototype.

**Pipeline automation:** When invoked as part of a full pipeline run, auto-approve after two critique passes and continue.

When the user approves:
1. Confirm all prototypes are saved under `stardust/prototypes/*.html`.
2. Tell the user: "Prototypes approved. Run `/stardust` to see your next step."

## Why Prototypes Are Static HTML

Prototypes are platform-agnostic — they could in principle feed any downstream build later (EDS, a different SSG, a different CMS). They are pure HTML + CSS judgment calls.

Keeping prototypes static and platform-free means:
- Visual design can be iterated freely without implementation complications.
- Any downstream translation (to EDS CSS, to a framework component library, etc.) is mechanical, not judgmental.
- The prototype layer is portable across target platforms.

## Artifacts Written

| File | Description |
|------|-------------|
| `stardust/prototypes/{page}.html` | Branded, high-fidelity static HTML per page — self-contained, platform-independent. Single-variant mode. |
| `stardust/prototypes/{page}-{letter}.html` | One file per variant (`-a`, `-b`, `-c`, `-d`) when the user asked for 2–4 variants. Each carries a `variant_direction` line in its provenance block. Unchosen variants stay on disk as design history. |
