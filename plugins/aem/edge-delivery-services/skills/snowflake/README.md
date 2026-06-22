# snowflake

A skill for converting AI-generated static HTML pages (Stardust,
Mobirise, Relume, Lovable, v0, Figma-derived hand-coded, etc.) into
Adobe Edge Delivery Services pages using the **overlay pattern**.

The overlay pattern preserves the original DOM byte-for-byte. Only
the text and image content becomes authorable in Document Authoring.
Header and footer remain static repository fragments. The page CSS
and any animation JavaScript ship per-template under the EDS code
bus.

This skill encodes the 6-phase methodology distilled from 5 R&D
iterations against varied generator outputs and bespoke pages.

## What's included

```
skills/snowflake/
├── SKILL.md                       Entry point (agent reads first)
├── phases/
│   ├── 1-capture.md
│   ├── 2-analyze.md
│   ├── 3-generate.md
│   ├── 4-wire.md
│   ├── 5-roundtrip.md
│   └── 6-reflect.md
├── knowledge/
│   ├── methodology.md             Canonical phase rules
│   ├── architecture.md            Overlay engine + slot writer reference
│   ├── eds-da-mechanics.md        EDS pipeline reference (overlay-runtime lore; DA HTML and admin API in da-content skill)
│   └── learnings.md               Cross-project findings (5 runs)
├── scripts/
│   ├── transform-da-to-eds.mjs    DA divs-with-class → drafts HTML
│   └── dom-equality.mjs           Source vs rendered DOM comparison
├── examples/
│   └── README.md                  Pointers to worked examples
├── HOST-NOTES.md                  Per-host adapter notes (Slicc, Claude Code, generic shell)
└── README.md                      You are here
```

## Prerequisites

The target EDS repo must have the **overlay substrate** in place:
`scripts/overlay-engine.js` with `applyTemplateOverlay`, the `writeSlot`
slot writers, and related template/slot logic. `scripts/scripts.js` is
Adobe's standard boilerplate lifecycle file (loadEager/loadLazy/etc.) and
receives only a small injected hook — an import of `overlay-engine.js` and
an overlay guard at the top of `loadEager` that early-returns for overlay
pages, skipping EDS decoration entirely. Also required: the
`blocks/header/header.js` / `blocks/footer/footer.js` fetch
decorators. See `knowledge/architecture.md` for the design.

**The skill installs this for you.** `phases/0-prereq.md` drives an
idempotent installer (`install-substrate.mjs`) that brings a vanilla
`adobe/aem-boilerplate` clone up to overlay-capable. Run it once per
target repo:

```bash
node <SKILL_DIR>/scripts/install-substrate.mjs --dry-run   # inspect plan
node <SKILL_DIR>/scripts/install-substrate.mjs             # apply
```

Overwritten files are backed up to `.snowflake/.backup/<timestamp>/`.
Subsequent runs of the skill detect the installed substrate via
`.snowflake/config.json` and skip Phase 0 silently.

See `HOST-NOTES.md` for per-host details (Slicc, Claude Code,
generic shell).

## Limitations of v1

This is the minimum-viable version. It runs the 6 conversion phases
sequentially, no parallel fan-out. Future-work items:

- Subagent fan-out at Generate (~4-6 min wall-clock savings)
- Generate-time validators (catches nested `[data-slot]` and
  non-absolute DA cell `<img>` URLs before round-trip)
- Spec-mode Analyze (structured `decisions.json` schema validation)
- Round-trip failure-triage subagent (Opus + extended thinking)

## Installation

See `HOST-NOTES.md` for the install command and configuration per
host (Slicc, Claude Code, generic shell).

## Contributing

The methodology, architecture, and learnings in `knowledge/` are
deliberately bundled with the skill, not referenced from external
sources. This keeps the skill portable and stable.

Users running snowflake against new sources accumulate
project-specific learnings in their own repos (under
`.snowflake/projects/<NNN>-<slug>/learnings.md` and optionally
`.snowflake/knowledge/learnings.md` for the repo-level pile).
When a finding is generic enough to benefit other snowflake users
— a new pipeline behavior, a new slot writer pattern, a class of
bug worth catching — please raise a PR to this skill repo with the
finding promoted into `knowledge/learnings.md` (and any
corresponding rule into `knowledge/methodology.md`).

Convention for `learnings.md` entries: dated `## YYYY-MM-DD — short
title` at the top of the file. Each entry: brief context, observable
symptom (if a bug), the rule.

## Status

**v1 — minimum viable.** Bundles the methodology and architecture
distilled across 5 runs. Single-sequence (no parallelism). Designed
to run on any host that provides bash + node + git + curl +
playwright-cli.

Open this skill's roadmap and known issues in the upstream PR.
