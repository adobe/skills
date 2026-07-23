# References index

Map of reference files used by the wf-planning-solution-architect skill. Load only what the question requires; do not preload everything.

## Top-level synthesis references (read these first)

| File | When to load |
|---|---|
| `workspace-build-playbook.md` | Designing or building a workspace. Categories B and C in SKILL.md routing. |
| `best-practice-template.md` | Referencing the Fréscopa exemplar for patterns OR explicitly checking against the known deviations. |
| `best-practice-template.json` | Trimmed sample export (minified, ~1.6 MB): full structure, ~5 records per record type. Inspect only when a question requires field-level or record-level detail beyond the digest. |
| `limits-and-tiers.md` | Any limits, capacity, sizing, or tier question. Always check the customer's tier (Select / Prime / Ultimate) before quoting numbers. |
| `public-vs-mcp-discrepancies.md` | Whenever public docs and MCP behavior could disagree (precision, formulas, color palettes, connection naming, identity model, etc.). |
| `customer-conversation-framings.md` | When the user is preparing for or in a customer conversation (limit escalation, P95 ask, RPM comparison, reporting expectations, workspace build engagement, roadmap question, template adoption review). |

## Public docs layer (UI/UX surface)

Crawled from Adobe Experience League. Use for "how do I do X in the Planning UI?" questions and for canonical UX documentation. Each file carries source URL and last-update timestamp.

Folder map:
- `raw/general/`: Planning overview, AI Designer (beta), limitations.
- `raw/architecture/`: Workspaces, record types, connections, cross-workspace, hierarchies, templates. The largest cluster.
- `raw/fields/`: Field types, formulas, primary field, import from Workfront.
- `raw/records/`: Create, edit, delete, connect records; configure record-creating automations.
- `raw/views/`: Table, Timeline, Calendar views.
- `raw/access/`: License types, sharing permissions, share workspaces/types/views, permission requests.
- `raw/requests/`: Request forms, approvals, submit/unpublish.
- `raw/best-practices/`: 30-day launchpad, hierarchy patterns, marketing calendar, the bridge, scale playbook.
- `raw/api/`: API basics, filter syntax, identity model, HTTP semantics.
- `raw/fusion/`: Fusion modules for Planning (Watch Events, CRUD, search).
- `raw/ai-assistant/`: Planning-scoped AI Assistant, Workfront-wide AI Assistant. Separate from the beta AI Designer in raw/general.
- `raw/automations/`: `automations-deep-dive.md` is the canonical decision tree across the 5 automation surfaces (native button-click, native field-change, Fusion, AI Assistant, request-form approval). Load for Category G.
- `raw/genstudio/`: GenStudio integration, manage GenStudio workspace.
- `raw/canvas-dashboards/`: Canvas Dashboard overview, create, build table report.
- `raw/notifications/`: Notification preferences.

## MCP / API reference layer (programmatic surface)

Use for "how do I do X via API or MCP?" questions, formula questions, agentic workspace builds, and API mechanics.

| File | Contents |
|---|---|
| `mcp/README.md` | Original MCP-vs-public-docs comparison. Superseded by top-level `public-vs-mcp-discrepancies.md`. Keep for historical reference. |
| `mcp/field-types.json` | Field type definitions, value types, config options, allowed colors, currency codes. |
| `mcp/field-formats.json` | Value format rules for create / update via `bulk_record_actions`. |
| `mcp/filter-operators.json` | `$-prefixed` operator syntax for `search_records` and view filters. |
| `mcp/view-types.json` | TABLE / TIMELINE / CALENDAR types with capability lists. |
| `mcp/connections.json` | External connection types (Workfront, AEM, Brand) and object type codes. |
| `mcp/formula-documentation.txt` | Complete formula function reference (~50 functions, patterns, unsupported list). **Canonical formula source. Public docs are dramatically incomplete.** |
| `mcp/workspace-setup-guide.txt` | Opinionated MCP playbook for building workspaces. Synthesized into top-level `workspace-build-playbook.md`. Keep this file as the original MCP server-side source. |

## Loading strategy

For any given question, the routing in SKILL.md identifies the category (A through N). Load:
1. The 1 to 2 top-level synthesis files the category names.
2. Any raw or mcp files explicitly called out.
3. Stop. Do not preload neighbors.

If a question spans categories, load only the union of files; do not load every reference.

## Refresh procedure

**Public docs:** check the "Last update" timestamp in each raw/*.md file. Re-fetch source URL via web_fetch. Diff and update. Update visited URL log if new URLs are added.

**MCP refs:** retrieve current versions from the Workfront Planning MCP server itself (via `tool_search` or direct resource fetch in Claude Desktop), or request refreshed exports from the WFP engineering team.

**Best-practice template:** re-export when the canonical template changes meaningfully. Update both the .json (raw) and the .md (digest). Re-validate the "Known deviations" section against the current template state.

**Discrepancies file:** validate the reconciliation table against the live MCP server. Update the date at the bottom of the file when validated.

Date of this index: May 11, 2026.
