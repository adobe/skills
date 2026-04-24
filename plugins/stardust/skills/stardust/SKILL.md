---
name: stardust
description: "Navigate the stardust design pipeline — assess project state under `stardust/` and recommend the next design stage. Use when the user wants to check design-pipeline progress, doesn't know which stage to run next, asks a general question about `stardust/` artifacts without naming a specific stage, says `/stardust`, or asks about files under `stardust/` (brand, briefings, wireframes, prototypes) without a clear edit target."
license: Apache-2.0
metadata:
  version: "0.1.0"
---

# stardust Navigator

Assess the current design-phase state and guide the user to the right next step.

## When to use this skill

- The user asks "where do I start?", "what's next?", or "what's the status" in the context of `stardust/`.
- The user types `/stardust` with no other intent.
- The user references `stardust/` artifacts in general without naming a specific edit target.
- The user asks to run the full pipeline end-to-end.

## Do NOT use this skill

- To create, modify, or render any artifact. The navigator only reads state. Use `brand`, `briefings`, `wireframes`, or `prototype` for writes.
- To pick a stage on the user's behalf when they've already named one (`/stardust:brand`, "edit the landing briefing", etc.). Hand off directly to that stage skill.

## How This Works

You are the navigator for the `stardust` pipeline — four design stages that each produce a distinct artifact under `stardust/`:

| Stage | Skill | Produces |
|---|---|---|
| Brand | `/stardust:brand` | `stardust/brand-profile.json`, `stardust/brand-board.html`, `.impeccable.md` |
| Briefings | `/stardust:briefings` | `stardust/briefings/{page}.md` (and `_site.md` multi-page) |
| Wireframes | `/stardust:wireframes` (optional) | `stardust/wireframes/{page}.html` |
| Prototype | `/stardust:prototype` | `stardust/prototypes/{page}.html` |

You read artifacts on disk to determine where the project is, then recommend the next step. You NEVER write or modify files.

---

## Step 1: Read Project State

Check for these artifacts and record which exist:

```
Check: stardust/brand-profile.json          → brand_extracted
Check: .impeccable.md                          → design_personality
Check: stardust/brand-board.html             → brand_board
Check: stardust/briefings/ (has .md files)   → briefings
Check: stardust/wireframes/ (has .html files)→ wireframes (optional)
Check: stardust/prototypes/ (has .html files)→ prototypes
```

## Soft-Gate Model

Every `stardust` skill uses a soft-gate model: missing upstream inputs are synthesized with provenance stamps, never blocked on. You recommend the ideal next step, but the user is free to skip around — they will see provenance notes when they open the artifacts.

## Step 2: Determine Pipeline State

Brand, briefings, wireframes, and prototype can each run in any order. The ideal path is **brand → briefings → wireframes → prototype**, but any skill runs with upstream gaps. Your job is to recommend the most useful next step, not to enforce a sequence.

| State | Condition | Next Step |
|---|---|---|
| **Fresh project** | Nothing in `stardust/` | Recommend `/stardust:brand` or `/stardust:briefings` first — either can come first. |
| **Brand in progress** | `brand-profile.json` but no `brand-board.html` | Complete brand: render the board. |
| **Brand only** | brand artifacts present, no briefings | Run `/stardust:briefings`. |
| **Briefings only** | briefings present, no brand | Run `/stardust:brand`. |
| **Both ready** | brand + briefings present, no wireframes and no prototypes | Run `/stardust:wireframes` (optional grey pass) **or** `/stardust:prototype` (skip wireframes, go straight to branded). |
| **Wireframes approved** | wireframes exist, no prototypes | Run `/stardust:prototype`. |
| **Prototypes in progress** | some prototypes rendered, others not | Continue `/stardust:prototype`. |
| **All rendered** | every briefing has a prototype | Suggest iteration or next-page work. |

## Step 3: Present Status

Report to the user:

```
## stardust Pipeline Status

- ✓ Brand extracted (brand-profile.json)
- ✓ Design personality set (.impeccable.md)
- ✓ Brand board rendered
- ✓ Briefings: 3 pages authored
- ✓ Wireframes: 3 pages (grey, approved)
- → Prototypes: 1 of 3 rendered

### Next Step
Continue `/stardust:prototype` to render the remaining pages.
```

Adapt the format to what's actually present. If nothing exists yet:

```
## stardust Pipeline Status

This is a fresh project. No pipeline artifacts found yet.

### Next Step
Run `/stardust:brand` or `/stardust:briefings` — they are independent; either can come first.

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

When the user asks to run the full pipeline end-to-end (e.g., "run all stardust stages", "design the whole thing", or provides a detailed brief with brand source + page requirements), execute each stage in sequence without waiting for approval at each gate:

1. **`/stardust:brand`** — extract brand identity, render board, auto-approve.
2. **`/stardust:briefings`** — capture page intent from the user's brief, auto-approve.
3. **`/stardust:wireframes`** — grey structural pass, auto-approve. (Skip if the user explicitly opts out — going straight to `prototype` is valid.)
4. **`/stardust:prototype`** — branded prototype per page, auto-approve after critique.

Brand and briefings are independent and can run in either order, but the end-to-end default runs brand first so briefings can reference brand voice when the user wants fully-specified copy.

Each stage skill has a "pipeline automation" note in its approval gate section — when running end-to-end, skip interactive approval loops and continue to the next stage.

At the end, report the file paths of rendered prototypes (and any server URL if one was started).

## Pipeline Reference

Consult [artifact-map.md](reference/artifact-map.md) for the complete artifact specification including file formats, required fields, and detection logic.

## Skills in the Pipeline

| Stage | Skill | What it does |
|---|---|---|
| Brand | `/stardust:brand` | Extract brand → profile + board + personality |
| Briefings | `/stardust:briefings` | Capture page intent (standalone, no brand dependency) |
| Wireframes | `/stardust:wireframes` | Optional — grey structural pass from briefings |
| Prototype | `/stardust:prototype` | Branded, high-fidelity HTML prototype — iterated in the browser |
