---
name: briefings
description: "Create, refine, review, critique, or iterate on page briefings under `stardust/briefings/**/*.md` (including `_site.md`) — intent, audience, key messages, CTAs, tone, page copy (headlines, hero, section copy), imagery direction, plus site-level information architecture and multi-page content reuse maps. Sole source of truth for page copy. Independent of brand extraction: can be authored before or after `/stardust:brand`. Use when the user wants to plan pages, write briefings, define audience or CTAs, plan imagery, map shared sections across pages, when the user asks to change, refine, refactor, review, improve, polish, critique, or iterate on any file under `stardust/briefings/`, or whenever the user asks to modify a file under `stardust/briefings/**/*.md`."
license: Apache-2.0
metadata:
  version: "0.1.0"
---

# Briefings

Help the user express their page vision as briefings that capture business intent. A briefing can be as lightweight as a single sentence of intent, or as detailed as final copy and image direction — the user chooses the fidelity.

## When to use this skill

- The user wants to plan pages, write briefings, define audience or CTAs, or map shared sections across pages.
- The user asks to change, refine, review, critique, or iterate on any file under `stardust/briefings/**/*.md` (including `_site.md`).
- The user types `/stardust:briefings`.

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
- `stardust/brand-profile.json` (voice; not required)

**Produces:**
- `stardust/briefings/_site.md` (multi-page only)
- `stardust/briefings/{page}.md` (one per page; **sole source of truth for page copy**)

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
2. For multi-page sites, create `stardust/briefings/_site.md` first — see [briefing-format.md](reference/briefing-format.md) for the site briefing schema.
3. Default to the **structured** shape for every page. Do NOT ask the user to pick a fidelity level. If a section's content is not known yet, emit `[TBD]` in that section — downstream skills synthesize on-brand content for `[TBD]` fields and stamp provenance. Fidelity is a consequence of how much the user fills in, not a gate the user has to cross.

   Deepening the fidelity ladder:
   - **Structured (default)** — full frontmatter + Intent + Audience + Key Messages + CTAs + Tone. Any field may be `[TBD]`.
   - **Fully specified** — adds `# Copy` (final headlines/body/microcopy) and `# Imagery` (image direction per section, source hints, alt-text). Reached by filling in those sections, not by re-answering a fidelity question.

If briefings already exist, read `stardust/briefings/` and confirm which pages are covered. Ask which page to work on next (new, edit, or deepen by filling in `[TBD]` fields or adding `# Copy` / `# Imagery`).

## Phase 2: Draft

1. Run the soft-deps discovery decision before any interview question:

   **If `/brainstorm` is registered in this session** (detect per [`../_shared/soft-deps.md`](../_shared/soft-deps.md)): hand off to `/brainstorm` with a seeded prompt that includes the page name and any existing briefing content, and ask it to produce the structured shape (Intent + Audience + Key Messages + CTAs + Tone). Wait for its output; use the result to populate the briefing. Do NOT run any inline interview question once this delegation is made — that would double-interview the user.

   **Otherwise (superpowers not installed):** announce the fallback **exactly once per session**, using the verbatim text from [`../_shared/soft-deps.md`](../_shared/soft-deps.md) ("superpowers announcement"). Then run the "For briefings discovery" pattern in [`../_shared/fallback-brainstorm.md`](../_shared/fallback-brainstorm.md). On every subsequent briefing in the same session, skip the announcement (already seen) and run the inline pattern directly.

   Either path uses the same discovery prompts: "What should visitors feel when they land on this page? What's the one action you want them to take?"

   The user must be able to tell which path ran — either by `/brainstorm`'s visible hand-off UI or by the one-time announcement. Silent inline interviews are a bug.
2. Draft the briefing in the structured shape. Fill every section; where the user has not provided content, write `[TBD]` verbatim (not a rephrased placeholder). The agent helps draft; the user owns the content.
3. Present the draft and wait for approval before writing the file.
4. Write approved briefings to `stardust/briefings/{page}.md`.

If any `[TBD]` fields remain, or the briefing was synthesized from a short prompt rather than a full conversation, stamp a provenance comment at the top of the file per [`../_shared/skill-contract.md`](../_shared/skill-contract.md) so downstream skills know which fields to treat as synthesizable.

## Phase 2.5: Content Reuse Map (Multi-Page Sites Only)

Before the user moves on to wireframes, plan how pages connect through shared content. This is not just cross-links — it's **content reuse**: the same recipe card, testimonial quote, or capability highlight appears on multiple pages, authored once.

1. Identify the main content types each page owns (e.g., recipes page owns recipe cards, stories page owns testimonials).
2. Map where each content type gets reused as excerpts on other pages.
3. Add a `# Content Reuse Map` section to `stardust/briefings/_site.md` — see [briefing-format.md](reference/briefing-format.md) for the table format.
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
  - If `stardust/brand-profile.json` exists: "Briefings saved. You have brand + briefings — you can now run `/stardust:wireframes`."
  - If not: "Briefings saved. Run `/stardust:brand` when you're ready to capture your brand, then `/stardust:wireframes` to render these pages."

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
| `stardust/briefings/_site.md` | Site-level briefing (multi-page only) |
| `stardust/briefings/{page}.md` | Page-level briefings in the structured shape (Intent + Audience + Key Messages + CTAs + Tone), with `[TBD]` placeholders where content is not yet captured. May additionally contain `# Copy` / `# Imagery` when the user has committed to final words or image direction. |
