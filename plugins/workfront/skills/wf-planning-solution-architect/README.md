# wf-planning-solution-architect skill

A Claude skill that turns Claude into an experienced Workfront Planning (WFP) solution architect for internal Adobe use: engineers, EMs, SAs, AMs, and the WFP product team.

## Install

Drop this folder into your Claude skills directory:
- Claude Desktop: `~/Library/Application Support/Claude/skills/` (macOS) or equivalent.
- Claude Code: `~/.claude/skills/`.
- Or upload as a zipped skill file.

After install, the skill activates automatically when you ask about anything WFP: workspace design, record types, limits and tiers, MCP usage, customer escalations, GenStudio integration, Canvas Dashboard reporting, formulas, filters, and more. Trigger keywords are in SKILL.md.

## What's inside

```
wf-planning-solution-architect/
├── SKILL.md                                    # Entry point: persona, triggers, routing
├── test_prompts.md                             # Eval prompts by category
└── references/
    ├── INDEX.md                                # Top-level map of all references
    ├── workspace-build-playbook.md             # Canonical build playbook (synthesized)
    ├── best-practice-template.md               # Fréscopa exemplar + known deviations
    ├── best-practice-template.json             # Trimmed Fréscopa sample export (~2.7 MB)
    ├── limits-and-tiers.md                     # SA-ready limit reference by tier
    ├── public-vs-mcp-discrepancies.md          # Reconciliation table
    ├── customer-conversation-framings.md       # Stock SA framings
    ├── raw/                                    # Public Adobe docs (UI/UX surface)
    │   ├── general/  architecture/  fields/  records/  views/
    │   ├── access/   requests/      api/     fusion/   ai-assistant/
    │   ├── automations/  genstudio/  canvas-dashboards/  notifications/
    │   └── best-practices/
    └── mcp/                                    # MCP / API reference (programmatic surface)
        ├── README.md
        ├── field-types.json     field-formats.json     filter-operators.json
        ├── view-types.json      connections.json
        ├── formula-documentation.txt           # Canonical formula source
        └── workspace-setup-guide.txt           # Original MCP build playbook
```

## How it works

SKILL.md routes incoming questions into 14 categories (A through N) plus cross-category cases. For each category, only the relevant references load; the skill does not preload the entire corpus.

Top-level synthesis files (workspace-build-playbook, best-practice-template, limits-and-tiers, public-vs-mcp-discrepancies, customer-conversation-framings) are the primary surfaces. The raw/ and mcp/ folders are the deep layer for specific lookups.

## Preferences honored

- No em dashes or en dashes introduced in skill-authored content (all newly authored .md files audit clean; raw Adobe and MCP source content is preserved as-is).
- Direct, internal, evidence-based tone.
- Architecture-before-limits posture on escalation framing.

## Refresh

Procedure for keeping references current is in `references/INDEX.md` under "Refresh procedure". Adobe public docs carry a "Last update" timestamp; MCP refs come from the live MCP server; the best-practice template needs occasional re-export.

## Version

Authored: May 11, 2026 (Batch 4 of the WF Planning Solution Architect skill build).
Reference corpus: 80 public doc files plus 8 MCP reference files plus the Fréscopa template plus 7 newly authored synthesis files.
