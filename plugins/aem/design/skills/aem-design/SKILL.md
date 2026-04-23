---
name: aem-design
description: "Navigate the aem-design pipeline — assess project state under `aem-design/` and recommend the next design stage. Use when the user wants to check design-pipeline progress, doesn't know which stage to run next, asks a general question about `aem-design/` artifacts without naming a specific stage, says `/aem-design`, or asks about files under `aem-design/` (brand, briefings, wireframes, prototypes) without a clear edit target."
license: Apache-2.0
metadata:
  version: "0.1.0"
---

# aem-design Navigator

Assess the current design-phase state and guide the user to the right next step.

## How This Works

You are the navigator for the `aem-design` pipeline — four design stages that each produce a distinct artifact under `aem-design/`:

| Stage | Skill | Produces |
|---|---|---|
| Brand | `/aem-design:brand` | `aem-design/brand-profile.json`, `aem-design/brand-board.html`, `.impeccable.md` |
| Briefings | `/aem-design:briefings` | `aem-design/briefings/{page}.md` (and `_site.md` multi-page) |
| Wireframes | `/aem-design:wireframes` (optional) | `aem-design/wireframes/{page}.html` |
| Prototype | `/aem-design:prototype` | `aem-design/prototypes/{page}.html` |

You read artifacts on disk to determine where the project is, then recommend the next step. You NEVER write or modify files.

---

## Step 1: Read Project State

Check for these artifacts and record which exist:

```
Check: aem-design/brand-profile.json          → brand_extracted
Check: .impeccable.md                          → design_personality
Check: aem-design/brand-board.html             → brand_board
Check: aem-design/briefings/ (has .md files)   → briefings
Check: aem-design/wireframes/ (has .html files)→ wireframes (optional)
Check: aem-design/prototypes/ (has .html files)→ prototypes
```

## Soft-Gate Model

Every `aem-design` skill uses a soft-gate model: missing upstream inputs are synthesized with provenance stamps, never blocked on. You recommend the ideal next step, but the user is free to skip around — they will see provenance notes when they open the artifacts.

## Step 2: Determine Pipeline State

Brand, briefings, wireframes, and prototype can each run in any order. The ideal path is **brand → briefings → wireframes → prototype**, but any skill runs with upstream gaps. Your job is to recommend the most useful next step, not to enforce a sequence.

| State | Condition | Next Step |
|---|---|---|
| **Fresh project** | Nothing in `aem-design/` | Recommend `/aem-design:brand` or `/aem-design:briefings` first — either can come first. |
| **Brand in progress** | `brand-profile.json` but no `brand-board.html` | Complete brand: render the board. |
| **Brand only** | brand artifacts present, no briefings | Run `/aem-design:briefings`. |
| **Briefings only** | briefings present, no brand | Run `/aem-design:brand`. |
| **Both ready** | brand + briefings present, no wireframes and no prototypes | Run `/aem-design:wireframes` (optional grey pass) **or** `/aem-design:prototype` (skip wireframes, go straight to branded). |
| **Wireframes approved** | wireframes exist, no prototypes | Run `/aem-design:prototype`. |
| **Prototypes in progress** | some prototypes rendered, others not | Continue `/aem-design:prototype`. |
| **All rendered** | every briefing has a prototype | Suggest iteration or next-page work. |

## Step 3: Present Status

Report to the user:

```
## aem-design Pipeline Status

- ✓ Brand extracted (brand-profile.json)
- ✓ Design personality set (.impeccable.md)
- ✓ Brand board rendered
- ✓ Briefings: 3 pages authored
- ✓ Wireframes: 3 pages (grey, approved)
- → Prototypes: 1 of 3 rendered

### Next Step
Continue `/aem-design:prototype` to render the remaining pages.
```

Adapt the format to what's actually present. If nothing exists yet:

```
## aem-design Pipeline Status

This is a fresh project. No pipeline artifacts found yet.

### Next Step
Run `/aem-design:brand` or `/aem-design:briefings` — they are independent; either can come first.

Brand needs one of:
- A brand guidelines URL (Corebook, Frontify, etc.)
- A brand guidelines PDF
- Or we can discover your brand through conversation

Briefings need one of:
- A one-line prompt per page
- Or a structured description of intent, audience, CTAs
- Or fully-specified copy and imagery
```

## Step 4: Offer Entry Points

If the user already has artifacts from outside the pipeline (e.g., an existing `brand-profile.json` imported from another tool), acknowledge:

- "I see you already have a brand-profile.json — want to review it, extend it, or start a briefing?"

## Full Pipeline Run (End-to-End)

When the user asks to run the full pipeline end-to-end (e.g., "run all aem-design stages", "design the whole thing", or provides a detailed brief with brand source + page requirements), execute each stage in sequence without waiting for approval at each gate:

1. **`/aem-design:brand`** — extract brand identity, render board, auto-approve.
2. **`/aem-design:briefings`** — capture page intent from the user's brief, auto-approve.
3. **`/aem-design:wireframes`** — grey structural pass, auto-approve. (Skip if the user explicitly opts out — going straight to `prototype` is valid.)
4. **`/aem-design:prototype`** — branded prototype per page, auto-approve after critique.

Brand and briefings are independent and can run in either order, but the end-to-end default runs brand first so briefings can reference brand voice when the user wants fully-specified copy.

Each stage skill has a "pipeline automation" note in its approval gate section — when running end-to-end, skip interactive approval loops and continue to the next stage.

At the end, report the file paths of rendered prototypes (and any server URL if one was started).

## Pipeline Reference

Consult [artifact-map.md](reference/artifact-map.md) for the complete artifact specification including file formats, required fields, and detection logic.

## Skills in the Pipeline

| Stage | Skill | What it does |
|---|---|---|
| Brand | `/aem-design:brand` | Extract brand → profile + board + personality |
| Briefings | `/aem-design:briefings` | Capture page intent (standalone, no brand dependency) |
| Wireframes | `/aem-design:wireframes` | Optional — grey structural pass from briefings |
| Prototype | `/aem-design:prototype` | Branded, high-fidelity HTML prototype — iterated in the browser |
