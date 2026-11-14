# wf-planning-fusion-optimizer skill

A Claude skill that reviews an exported Adobe Workfront Planning (WFP, also called "Maestro") + Fusion scenario blueprint and produces a prioritized, read-only optimization self-review. Written for practitioners who build and tune Fusion scenarios against the Planning connector: solution architects, integration engineers, and admins chasing slow runs, timeouts, high operations consumption, or rate-limit (429) errors.

## Install

Drop this folder into your Claude skills directory:
- Claude Desktop: `~/Library/Application Support/Claude/skills/` (macOS) or equivalent.
- Claude Code: `~/.claude/skills/`.
- Or upload as a zipped skill file.

After install, the skill activates automatically when someone shares a Fusion scenario blueprint that uses the Workfront Planning connector and wants it faster, cheaper, or more reliable. Trigger keywords are in SKILL.md.

## What's inside

```
wf-planning-fusion-optimizer/
├── SKILL.md                          # Entry point: scope, workflow, how to run and explain findings
├── evals/
│   └── evals.json                    # Eval prompts and assertions
├── scripts/
│   └── analyze_blueprint.py          # Static analyzer: parses the blueprint, emits a Markdown/JSON report
└── references/
    ├── findings.md                   # Full rationale and recommended fix for every finding code
    └── mcp-enrichment.md             # Optional workflow to make findings instance-specific via a live Planning MCP
```

## How it works

The analyzer walks the blueprint's flow, tracks iteration/loop nesting (the main multiplier of call volume, operations, and run time), and flags read-path, write-path, and throughput/reliability patterns against the Workfront Planning (`workfront-maestro`) connector specifically. If a blueprint has no Planning modules, it reports "not applicable" rather than reviewing it as a general Fusion scenario.

It never modifies the blueprint and needs no live workspace access. When a Workfront Planning MCP is connected, the optional enrichment step in `references/mcp-enrichment.md` resolves opaque record-type and field ids into real names and confirms read-collapse findings are feasible on the live schema, still read-only.

## Preferences honored

- Read-only: reports findings, never edits the blueprint or the workspace.
- No invented percentages: findings point to where the cost is; a real before/after measurement produces the number.
- Direct, evidence-based tone, consistent with the other Workfront Planning skills.
