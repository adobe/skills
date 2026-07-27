# wf-planning-solution-architect skill

A Claude skill that turns Claude into an experienced Workfront Planning (WFP) solution architect for internal Adobe use: engineers, EMs, SAs, AMs, and the WFP product team.

## Install

Drop this folder into your Claude skills directory:
- Claude Desktop: `~/Library/Application Support/Claude/skills/` (macOS) or equivalent.
- Claude Code: `~/.claude/skills/`.
- Or upload as a zipped skill file.

After install, the skill activates automatically when you ask about anything WFP: workspace design, record types, limits and tiers, API usage, customer escalations, GenStudio integration, Canvas Dashboard reporting, formulas, filters, and more. Trigger keywords are in SKILL.md.

## What's inside

```
wf-planning-solution-architect/
├── SKILL.md                                    # Entry point: persona, triggers, routing
├── evals/
│   └── evals.json                              # Eval prompts and assertions by category
├── scripts/
│   ├── search.js                               # Keyword search over the docs index
│   └── docs-index.json                         # Experience League page index (titles, URLs)
└── references/
    ├── INDEX.md                                # Top-level map of all references
    ├── workspace-build-playbook.md             # Canonical build playbook (synthesized)
    ├── best-practice-template.md               # Fréscopa exemplar + known deviations
    ├── best-practice-template.json             # Trimmed Fréscopa sample export (minified, ~1.6 MB)
    ├── limits-and-tiers.md                     # SA-ready limit reference by tier
    ├── public-vs-api-discrepancies.md          # Reconciliation table
    ├── customer-conversation-framings.md       # Stock SA framings
    └── synthesized/                            # Content not published on Experience League
        ├── automations-deep-dive.md            # 5-surface automation decision tree
        ├── record-collaboration.md             # Comments, history, layout, sharing
        └── notification-preferences.md
```

Public Adobe documentation is deliberately **not** bundled. `scripts/search.js` ranks pages from `docs-index.json` and the agent fetches the live Experience League page (append `.md` to any doc URL for clean markdown), so public docs never go stale in this repo.

## How it works

SKILL.md routes incoming questions into 14 categories (A through N) plus cross-category cases. For each category, only the relevant references load; the skill does not preload the entire corpus.

Top-level synthesis files (workspace-build-playbook, best-practice-template, limits-and-tiers, public-vs-api-discrepancies, customer-conversation-framings) are the primary surfaces. The synthesized/ folder is the deep layer for specific lookups, and public UI/UX documentation is searched and fetched live. API-surface facts are stated inline in SKILL.md rather than in a separate reference file.

## Preferences honored

- No em dashes or en dashes introduced in skill-authored content (all newly authored .md files audit clean).
- Direct, internal, evidence-based tone.
- Architecture-before-limits posture on escalation framing.

## Refresh

Procedure for keeping references current is in `references/INDEX.md` under "Refresh procedure". Adobe public docs are fetched live and need no refresh; the best-practice template needs occasional re-export.

## Version

Authored: May 11, 2026 (Batch 4 of the WF Planning Solution Architect skill build).
Reference corpus: a 74-page Experience League search index (pages fetched live), the Fréscopa best-practice template, 5 authored synthesis files, and 3 synthesized references for topics Adobe does not publish.
