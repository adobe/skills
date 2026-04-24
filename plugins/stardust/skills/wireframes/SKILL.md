---
name: wireframes
description: "Create, refine, review, critique, or iterate on low-fidelity grey wireframes under `stardust/wireframes/**/*.html` — structure, hierarchy, section order, spatial relationships, annotations, section metadata (`data-section`/`data-intent`/`data-layout`), and multi-page fragment/reuse mapping (`data-fragment*`). Rendered from briefings. No brand required. Optional stage: users can skip to `/stardust:prototype` for branded layout directly. Use when the user wants to validate page structure before visual design, annotate a wireframe, mark reusable fragments across pages, when the user asks to change, refine, refactor, review, improve, polish, critique, or iterate on structure, section order, or block placement, or whenever the user asks to modify a file under `stardust/wireframes/**/*.html`."
license: Apache-2.0
metadata:
  version: "0.1.0"
---

# Wireframes

Turn approved briefings into **grey, structural** wireframes — boxes, bars, shapes — so the user can validate page structure (section order, hierarchy, density, spatial relationships) before committing to visual design.

This stage is **optional**. A user who already has a clear structural vision can skip straight to `/stardust:prototype`.

## When to use this skill

- The user wants to validate page structure before visual design — section order, hierarchy, density, spatial relationships.
- The user asks to annotate a wireframe or mark reusable fragments across pages.
- The user asks to change, refine, review, critique, or iterate on any file under `stardust/wireframes/**/*.html`.
- The user types `/stardust:wireframes`.

## Do NOT use this skill

- For branded visual design, colors, typography, or final proportions. Hand off to `prototype`.
- For page copy or intent. Hand off to `briefings`.
- When the user explicitly wants to skip straight to branded design — suggest `/stardust:prototype` instead.

## Pre-flight

Run the procedure in [`../_shared/preflight.md`](../_shared/preflight.md) first.

## Contract

**Needs (reads if present):**
- `stardust/briefings/{page}.md` (one or more)
- `.impeccable.md` (tone for annotations)

**Produces:**
- `stardust/wireframes/{page}.html` (grey, annotated)

**If missing:**
- No briefings → prompt the user for a one-line page intent, synthesize a minimal briefing, stamp provenance on both the briefing and the wireframe, and proceed.
- No `.impeccable.md` → annotations use neutral-technical tone.
- Brand is intentionally not read at this stage.

---

## Phase 1: Plan

For each page with an approved briefing:

1. Read the page briefing from `stardust/briefings/{page}.md`.
2. Read the site briefing from `stardust/briefings/_site.md` if it exists (including the Content Reuse Map).
3. Plan the page's sections — UX discovery:
   - If the `impeccable` plugin is installed (`/impeccable shape` is registered), delegate section planning to `/impeccable shape`.
   - Otherwise, use the "For wireframe section planning" pattern in [`../_shared/fallback-brainstorm.md`](../_shared/fallback-brainstorm.md). Per [`../_shared/soft-deps.md`](../_shared/soft-deps.md), impeccable fallback runs silently.
   Either path answers: what sections does this page need, what's the visual hierarchy, and how does the user flow through the content.
   - `/shape` produces a design brief — use this as the structural plan.
4. For multi-page sites, plan the information architecture across all pages before wireframing individual ones:
   - **If `/write-plan` is registered in this session** (detect per [`../_shared/soft-deps.md`](../_shared/soft-deps.md)): delegate IA planning to `/write-plan`, seeded with the site briefing and the list of pages. Use its output as the multi-page structural plan.
   - **Otherwise (superpowers not installed):** announce the fallback **exactly once per session** using the verbatim text from [`../_shared/soft-deps.md`](../_shared/soft-deps.md) ("superpowers announcement") — unless it was already announced earlier in this session. Then sketch the IA inline: list pages, their primary content type, and the shared sections between them, and confirm with the user before moving on.

## Phase 2: Render (Grey Mode)

Render each wireframe as visual HTML in grey mode:

- **Pure grey layout:** boxes, bars, shapes. No brand colors, no real fonts (system-ui is fine).
- Background: light grey (#f5f5f5); elements in shades of grey.
- Placeholder text as grey bars; images as grey rectangles with labels.
- **Annotations are required** — every block gets a short italic `.note` or `.caption` describing what it represents, so the reviewer can evaluate the flow without guessing. Repeated items (pipeline nodes, host tiles, card grids) carry identifying labels ("01 · brand", "Claude Code"), not generic numbers. See [wireframe-guide.md](reference/wireframe-guide.md) Annotations section.
- Shows: section order, relative sizing, content density, spatial relationships.
- Each section gets `data-section`, `data-intent`, `data-layout` attributes so the design stage can pick up the structure.
- For multi-page sites: add `data-fragment`, `data-fragment-role`, and `data-fragment-source` attributes to reusable content sections — see [wireframe-guide.md](reference/wireframe-guide.md) Content Reuse & Fragments section.
- Include the JSON metadata block linking to the briefing (with `fragments` map for multi-page sites).
- Write to `stardust/wireframes/{page}.html`.

If the upstream briefing was synthesized (provenance comment present, or generated during this pre-flight), carry forward a provenance block on the wireframe per [`../_shared/skill-contract.md`](../_shared/skill-contract.md).

Follow the full rendering rules in [wireframe-guide.md](reference/wireframe-guide.md).

## Phase 3: Serve

Wireframes are self-contained HTML files. **Open each file in the designer's default browser immediately after writing** per [`../_shared/skill-contract.md`](../_shared/skill-contract.md) *Opening HTML artifacts*. On macOS: `open stardust/wireframes/{page}.html`. Do not rely on the designer to open it manually.

If multiple wireframes were rendered in this phase (multi-page run), open each one so the designer can review in tabs.

In pipeline-automation mode (no designer present), skip the open.

## Phase 4: Approval Gate

Soft gate — the user approves structure, not visuals.

Present the wireframe and ask: "Does this structure match what you had in mind? What should change?"

Common feedback:
- **"Swap these sections"** → Reorder, re-render.
- **"Add a section for [X]"** → Add new section with data attributes, re-render.
- **"This section is too big/small relative to the rest"** → Adjust proportions, re-render.
- **"I want something interactive here"** → Add `data-interactive` attribute.

Iterate until the user approves. Then:
1. If `stardust/brand-profile.json` exists: "Wireframes approved. Run `/stardust:prototype` to upgrade them to branded prototypes."
2. If not: "Wireframes approved. Run `/stardust:brand` to capture your brand, then `/stardust:prototype` to layer it onto these wireframes."

**Pipeline automation:** When invoked as part of a full pipeline run, auto-approve and continue.

## Why Wireframes Before Design

Wireframes let you make **structural** decisions (what goes where, in what order, at what relative size) without being distracted by **visual** ones (what colors, fonts, and proportions). Separating the two means each decision gets full attention.

Users who already know the structure can skip this stage entirely and go briefings → design.

## Artifacts Written

| File | Description |
|------|-------------|
| `stardust/wireframes/{page}.html` | Grey structural wireframes — self-contained HTML |
