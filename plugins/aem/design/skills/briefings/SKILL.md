---
name: briefings
description: "Create, refine, review, critique, or iterate on page briefings under `aem-design/briefings/**/*.md` (including `_site.md`) — intent, audience, key messages, CTAs, tone, page copy (headlines, hero, section copy), imagery direction, plus site-level information architecture and multi-page content reuse maps. Sole source of truth for page copy. Independent of brand extraction: can be authored before or after `/aem-design:brand`. Use when the user wants to plan pages, write briefings, define audience or CTAs, plan imagery, map shared sections across pages, when the user asks to change, refine, refactor, review, improve, polish, critique, or iterate on any file under `aem-design/briefings/`, or whenever the user asks to modify a file under `aem-design/briefings/**/*.md`."
license: Apache-2.0
metadata:
  version: "0.1.0"
---

# Briefings

Help the user express their page vision as briefings that capture business intent. A briefing can be as lightweight as a single sentence of intent, or as detailed as final copy and image direction — the user chooses the fidelity.

## When to use this skill

- The user wants to plan pages, write briefings, define audience or CTAs, or map shared sections across pages.
- The user asks to change, refine, review, critique, or iterate on any file under `aem-design/briefings/**/*.md` (including `_site.md`).
- The user types `/aem-design:briefings`.

## Do NOT use this skill

- For brand identity (voice, colors, typography). Hand off to `brand`.
- For structural wireframes or layout decisions. Hand off to `wireframes` or `prototype`.
- To render pages. Hand off to `wireframes` (grey) or `prototype` (branded).

## Pre-flight

Run the procedure in [`../_shared/preflight.md`](../_shared/preflight.md) first.

## Contract

**Needs (reads if present):**
- User description of pages to plan
- `.impeccable.md` (tone hints)
- `aem-design/brand-profile.json` (voice; not required)

**Produces:**
- `aem-design/briefings/_site.md` (multi-page only)
- `aem-design/briefings/{page}.md` (one per page; **sole source of truth for page copy**)

**If missing:**
- No input at all → ask the user which pages they need and start with the most important one.
- No brand-profile.json → briefings still proceed; tone defaults to neutral-technical.

## Copy Ownership

Briefings own page copy. If the user wants final words baked in, put them in
`# Copy` per section. Design will use those strings verbatim and will never
rewrite them. Briefings without `# Copy` are valid — downstream skills
synthesize on-brand copy and stamp provenance.

---

## Phase 1: Scope

If no briefings exist yet:

1. Ask the user: "What pages do you need? Let's start with the most important one."
2. For multi-page sites, create `aem-design/briefings/_site.md` first — see [briefing-format.md](reference/briefing-format.md) for the site briefing schema.
3. For each page, ask the user how much intent they want to capture:
   - **Prompt-only** — a single sentence of intent. Everything else is inferred downstream.
   - **Structured** — the full frontmatter + Intent + Audience + Key Messages + CTAs + Tone.
   - **Fully specified** — structured plus `# Copy` (final headlines, body, microcopy) and `# Imagery` (image direction per section, source hints, alt-text).

If briefings already exist, read `aem-design/briefings/` and confirm which pages are covered. Ask which page to work on next (new, edit, or deepen fidelity).

## Phase 2: Draft

1. When the user wants to talk through concepts, run a discovery interview:
   - **If the `superpowers` plugin is installed** (`/brainstorm` is registered), delegate to `/brainstorm`.
   - **Otherwise**, run the "For briefings discovery" pattern in [`../_shared/fallback-brainstorm.md`](../_shared/fallback-brainstorm.md). Per [`../_shared/soft-deps.md`](../_shared/soft-deps.md), announce the fallback once per session on the first use.
   Example prompts either path uses: "What should visitors feel when they land on this page? What's the one action you want them to take?"
2. Draft the briefing at the requested fidelity. The agent helps draft; the user owns the content.
3. Present the draft and wait for approval before writing the file.
4. Write approved briefings to `aem-design/briefings/{page}.md`.

If the briefing was synthesized from a one-line prompt (not authored in a full conversation), stamp a provenance comment at the top of the file per [`../_shared/skill-contract.md`](../_shared/skill-contract.md).

## Phase 2.5: Content Reuse Map (Multi-Page Sites Only)

Before the user moves on to wireframes, plan how pages connect through shared content. This is not just cross-links — it's **content reuse**: the same recipe card, testimonial quote, or capability highlight appears on multiple pages, authored once.

1. Identify the main content types each page owns (e.g., recipes page owns recipe cards, stories page owns testimonials).
2. Map where each content type gets reused as excerpts on other pages.
3. Add a `# Content Reuse Map` section to `aem-design/briefings/_site.md` — see [briefing-format.md](reference/briefing-format.md) for the table format.
4. Present the map to the user for approval before closing the stage.

**Key principles:**
- The **homepage is a hub** — it should pull excerpts from every major content page.
- **Inner pages cross-link to at least 2 siblings** through reused content sections (not just nav links).
- Reused sections show **3–4 items** from a source that has more, creating "see more" motivation.
- Every reused section includes a **CTA to the source page**.

## Phase 3: Approval Gate

This is a soft gate. The user may want to write briefings for some pages now and others later.

- After each briefing is approved, ask: "Another page, or are we done for now?"
- When the user is done, tell them:
  - If `aem-design/brand-profile.json` exists: "Briefings saved. You have brand + briefings — you can now run `/aem-design:wireframes`."
  - If not: "Briefings saved. Run `/aem-design:brand` when you're ready to capture your brand, then `/aem-design:wireframes` to render these pages."

**Pipeline automation:** When invoked as part of a full pipeline run, auto-approve each briefing and continue.

## Why Briefings Are Standalone

Briefings capture *what the experience should be* — intent, audience, messages. That work does not depend on having a brand. A user can:
- Write briefings first, then extract brand, then wireframe.
- Extract brand first, then write briefings, then wireframe.
- Write briefings without ever running brand (useful for scoping conversations or paper-only planning).

Keeping briefings independent lets teams split the work: one person captures intent while another extracts the brand.

## Artifacts Written

| File | Description |
|------|-------------|
| `aem-design/briefings/_site.md` | Site-level briefing (multi-page only) |
| `aem-design/briefings/{page}.md` | Page-level briefings — any fidelity from prompt-only up to full copy + imagery |
