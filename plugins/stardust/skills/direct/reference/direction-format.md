# Direction format

Schema for `stardust/direction.md`. Written by `$stardust direct`,
read by every other sub-command (`prototype`, `migrate`, and the master
`$stardust` state report).

The file is **append-only** in normal use: the most recent direction is
the active one, prior directions are kept as history. A `--re-direct`
prepends a new active section; a refinement appends to the active
section as a sub-section.

---

## Top-level shape

```markdown
<!-- stardust:provenance
  writtenBy: stardust:direct
  writtenAt: 2026-04-25T15:42:00Z
  readArtifacts:
    - stardust/state.json
    - stardust/current/_brand-extraction.json
    - stardust/current/PRODUCT.md
  synthesizedInputs: []
  stardustVersion: 0.2.0
-->
---
title: "make it more expressive for a young audience"
resolvedAt: 2026-04-25T15:42:00Z
toolkitVersion: "v1.0 (stardust v2)"
schemaVersion: 1
---

# Active direction (2026-04-25T15:42:00Z)

## Phrase

> make it more expressive for a young audience

## Restatement

One paragraph in dimensional vocabulary. ~80 words. Plain English,
no jargon.

## Movements

- **register** — `brand` (inherited from `current/PRODUCT.md`)
- **expressive axis** — `restrained` → `committed` (moved by phrase)
- **tone** — `serious` → `playful` (implied by "young")
- **density** — unchanged
- **distinctiveness** — `familiar` → `distinctive` (implied by
  "expressive")
- **audience** — Gen Z college / first-job (resolved via Q1)
- **constraints** — none stated

## Gaps and questions

1. **Q:** Sharpen "young" — pick the closest: (a) Gen Z college /
   first-job, (b) millennial professionals 25-35, (c) digital-native
   parents 30-40, (d) other.
   **A:** (a) — Gen Z college / first-job.

2. **Q:** Should the design feel native to a specific cultural
   reference set? (Examples: indie publishing, gaming, streetwear,
   K-pop visual culture.) Optional.
   **A:** "skip"

(or `## Gaps and questions\n\nNone — phrase was sufficiently
specific.`)

## Anchor references

- (none)

## Anti-references

- The Generic-2026-SaaS silhouette (toolkit § 1) — explicitly
  guardrailed because "expressive" is the most common AI-default
  trigger for it.

## Divergence inputs

- **seed** — `Example Brand|2026-04-25` MD5 →
  `1970s × Riso print × zine × monochrome-tint`
- **picked_by** — `deterministic`
- **font deck** — `zine-maximalist`
- **palette** — `Brutalist Dawn` (picked from library, source:
  `https://coolors.co/...`); recommended_index = 2, picked_index = 2
- **anti-toolbox audit** — 1 hit (Sticky top navigation),
  justified by inherited site convention
- **brand-faithful inversions** — when the resolved direction
  preserves elements of the existing brand (palette, type, corner
  vocabulary, heading style, photo treatment), record any
  agent-default reflexes that are explicitly inverted for brand
  fidelity. The list below is the canonical set; auto-emit any
  inversion whose `applies-when` condition matches the captured
  brand surface so the agent doesn't compose each from scratch.

  Format per inversion: a one-line statement with the rule being
  inverted, the captured value being preserved, and the
  brand-specific justification.

  | inversion | applies-when | rule being inverted | sample line |
  |---|---|---|---|
  | **pure-white retention** | `palette[role="background"].value` is `#ffffff` AND brand-faithful direction | impeccable "no pure `#fff`" hard rule | "`#ffffff` retained as page ground (existing brand decision; `#fff` is canonical for `{brand}`). The 'no pure black/white' impeccable rule is inverted per brand-faithful direction." |
  | **pure-black retention** | `palette[role="text-primary"].value` is `#000000` AND brand-faithful direction | impeccable "no pure `#000`" hard rule | "`#000000` retained as primary text (existing brand decision). The 'no pure black/white' rule is inverted per brand-faithful direction." |
  | **hex format retention** | brand-faithful direction; existing palette captured as hex | impeccable "OKLCH only" rule for new token authoring | "Color tokens retained in hex format (matches captured brand surface and `DESIGN.md` Stitch frontmatter convention). OKLCH applies to new authoring; this is inheritance." |
  | **sharp 0px corner retention** | `motifs.borderRadius.primary` ≤ 2px AND brand-faithful direction | implicit "modern means rounded corners" reflex | "Sharp 0px corners retained on cards/inputs/buttons (existing brand uses square corners as a deliberate choice). The agent-default reflex toward 8–12px rounded is inverted per brand-faithful direction." |
  | **all-uppercase headings retention** | `voiceTable.toneMetrics.headingsUppercasePercent ≥ 25` AND brand-faithful direction | impeccable "use sentence case" reflex | "All-caps headings retained on H1/H2/H3 (existing brand uses uppercase headings as the visual signature; observed on {N}% of captured headings). The 'use sentence case' reflex is inverted per brand-faithful direction." |
  | **saturated color retention** | `palette[role="primary"]` saturation > 60 AND brand-faithful direction; agent's default would have moved to a tinted-neutral system | implicit "tinted neutrals over saturated colors" reflex | "Saturated `{primary}` retained as the primary brand color (existing brand uses it as the canonical voice). The agent-default reflex toward tinted-neutral primaries is inverted per brand-faithful direction." |
  | **photo treatment retention** | per-page CSS background or img has a clear non-default treatment (B&W documentary, sepia, hard-grain, ≥30% colored overlay) AND brand-faithful direction | implicit "use natural photography" default | "Existing photo treatment ({observed: B&W documentary / sepia / colored-overlay}) retained across hero and section backgrounds. The agent-default 'use the source image untreated' is inverted per brand-faithful direction." |
  | **reserved color** | a third+ saturated palette color whose usage is bound to a single semantic role (anniversary, alert, audit, legal, memorial) | implicit "spread accent colors across the system" reflex | "`{color}` retained as a reserved color for `{role}` surfaces only (centennial logo eyebrow, history sections, footer separator). The agent-default reflex would either spread it across the system or reject it as a third hue; both are wrong here. See `divergence-toolkit.md § color reservation`." |

  The inversion log is consumed by `prototype` (its `:root` block
  uses the same format as DESIGN.md; its render respects the
  retained corners / heading style / photo treatment) and by
  `migrate` (the deployable site preserves the inversion notes in
  DESIGN.json provenance so downstream tools know each preserved
  value was a deliberate choice, not a defaulted reflex).

  When direct enters Mode A (brand-faithful) per
  `direct/SKILL.md` § Phase 2 — Mode A, scan the captured brand
  surface for each `applies-when` and emit the matching inversion
  lines automatically. Brand-specific specialization (the actual
  brand name in the sample line) is the only authored component;
  the rest is mechanical.

## Command sequence (proposed)

1. `$stardust direct` (this command — write the direction + tokens)
2. `$impeccable shape stardust/current/home.json` — Design Brief
   anchored on the resolved audience
3. `$impeccable craft` — primary expressive pass
4. `$impeccable colorize` — palette swap to "Brutalist Dawn"
5. `$impeccable typeset` — apply zine-maximalist deck
6. `$impeccable critique` — verify the move landed without slop
7. `$impeccable polish` — final pre-ship pass

## User confirmation

> "go"

## Pages in scope

- `home`, `about`, `pricing`, `features`, `contact` (the 5 pages
  marked `extracted` and not `requiresAuth`)

(or `all 25 extracted pages` for whole-site directions)

---

# History

## Prior direction (2026-04-22T11:10:00Z) — superseded

(prior `# Active direction` block, demoted to `## Prior direction`
with a `superseded` marker, when a `--re-direct` happens)

```

---

## Required vs optional sections

Required in every direction (active or historical):

- `## Phrase`
- `## Restatement`
- `## Movements`
- `## Divergence inputs` — at minimum `seed`, `font deck`, `palette`
- `## Command sequence (proposed)`
- `## User confirmation`
- `## Pages in scope`

Optional (omit cleanly when not applicable):

- `## Gaps and questions` — omit when the agent asked nothing
- `## Anchor references` — omit when none
- `## Anti-references` — never omit; if no explicit anti-refs, write
  `(none)` so the reader sees the agent considered the question

## Re-direct procedure

When the user runs `$stardust direct --re-direct`:

1. Read existing `direction.md`. If present, demote `# Active
   direction` to `## Prior direction (<resolvedAt>) — superseded`
   under a new `# History` section (or append to existing one).
2. Write the new `# Active direction (<new ts>)` block at the top
   of the file (after the YAML frontmatter, before `# History`).
3. Update YAML frontmatter `title` and `resolvedAt` to the new
   values; preserve `schemaVersion`.

A refinement (no `--re-direct`, user clarifies an existing direction)
appends a `### Refinement (<ts>)` block under the active direction
with the delta only — what changed and why. The original
`# Active direction` block is preserved.

## Pending direction (incomplete reasoning)

When `direct` cannot resolve the phrase even after two questions, do
not write the active direction. Instead, write a `# Pending
direction (<ts>)` section containing only `## Phrase`, `## Reasoning
so far`, and `## Open questions` (the questions still unanswered).
The user resolves later by re-running `direct` with more context.

State.json `direction.resolvedAt` stays `null` while a pending
direction is the latest entry. Sub-commands that require a resolved
direction (`prototype`, `migrate`) refuse to run.

## Why markdown rather than JSON

`direction.md` is the most human-facing artifact stardust writes —
the user reads it, reviews it, and may edit it directly to refine
the direction. Markdown with light structure beats JSON for this. The
fields downstream tools need (movements, divergence inputs, command
sequence) are surfaced via consistent headings rather than parsed
strictly; tools that need machine-readable state read
`stardust/state.json` and `DESIGN.json.extensions.divergence`
instead.
