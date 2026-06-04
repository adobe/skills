# MCP wiring — `.mcp.json` and `.cursor/mcp.json`

> **Beta Skill:** Outputs must be reviewed before applying to production.

This step is non-destructive: existing files are never overwritten or
rewritten. The skill either creates a placeholder when nothing exists, or
leaves the file untouched.

## 1. Decision flow

```
.claude/ detected AND .mcp.json present?
  yes → valid JSON?
    yes → leave file untouched
    no  → log warning, do not touch
  no → if .claude/ detected → write placeholder from templates/mcp.json.template

.cursor/ detected AND .cursor/mcp.json present?
  yes → valid JSON?
    yes → leave file untouched
    no  → log warning, do not touch
  no → if .cursor/ detected → mirror the placeholder under .cursor/mcp.json
```

## 2. Placeholder shape

See [`templates/mcp.json.template`](./templates/mcp.json.template).

The placeholder lists **categories** of MCP servers an agentic harness
typically depends on (AEM developer MCP, Cloud Manager MCP, Content MCP)
but does not name specific Adobe MCP server packages, command-line
invocations, or credentials. Those belong to the harness or the customer's
own setup.

## 3. What this step never does

- Hard-codes credentials, tokens, or program IDs.
- Names specific Adobe MCP server packages or version pins inside any
  AGENTS.md / per-module AGENTS.md body.
- Overwrites or mutates a customer's existing `.mcp.json` or
  `.cursor/mcp.json`.
- Writes to any path outside `.mcp.json` and `.cursor/mcp.json`.

## 4. Self-validation

- If `.claude/` was detected and `.mcp.json` was missing → now exists with the marker.
- If `.cursor/` was detected and `.cursor/mcp.json` was missing → now exists with the marker.
- No pre-existing file was modified — `git status` shows zero changes to pre-existing files.
