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

Public Adobe documentation is **not bundled**. It is fetched live from Experience League, so it never goes stale in this repo.

Use `scripts/search.js` to find the right pages, then fetch the `markdownUrl` from the results (any Experience League doc URL with `.md` appended returns clean markdown):

```bash
node scripts/search.js [--all] <keyword1> [keyword2] [...]
```

`scripts/docs-index.json` backs the search: one entry per Planning documentation page with its title, section, description, headings, and URL. Sections covered: general, architecture, fields, records, views, access, requests, best-practices, api, fusion, ai-assistant, genstudio, canvas-dashboards.

## Synthesized references (not available on Experience League)

| File | When to load |
|---|---|
| `synthesized/automations-deep-dive.md` | Canonical decision tree across the 5 automation surfaces (native button-click, native field-change, Fusion, AI Assistant, request-form approval). Load for Category G. |
| `synthesized/record-collaboration.md` | Comments, history, record layout, and record sharing behavior. |
| `synthesized/notification-preferences.md` | Notification preference behavior. |

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
2. Any mcp or synthesized files explicitly called out.
3. If the question needs public UI/UX documentation, run `scripts/search.js` and fetch the top 2 to 3 results.
4. Stop. Do not preload neighbors.

If a question spans categories, load only the union of files; do not load every reference.

## Refresh procedure

**Public docs:** nothing to refresh. Pages are fetched live from Experience League at answer time. If Adobe publishes new Planning articles, add entries to `scripts/docs-index.json` (path, url, title, section, description, headings) so the search can surface them.

**MCP refs:** retrieve current versions from the Workfront Planning MCP server itself (via `tool_search` or direct resource fetch in Claude Desktop), or request refreshed exports from the WFP engineering team.

**Best-practice template:** re-export when the canonical template changes meaningfully. Update both the .json (raw) and the .md (digest). Re-validate the "Known deviations" section against the current template state.

**Discrepancies file:** validate the reconciliation table against the live MCP server. Update the date at the bottom of the file when validated.

Date of this index: May 11, 2026.
