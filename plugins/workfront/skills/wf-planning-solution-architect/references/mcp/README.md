# MCP reference material vs public Adobe docs

This folder contains 7 reference files for the Workfront Planning MCP server (the API/tool surface used by AI agents to operate Planning). They complement the public Adobe docs crawled in `raw/` — public docs describe the UI/UX, MCP docs describe the API/tooling layer.

## Files

| File | Contents |
|---|---|
| `field-types.json` | Field type definitions, value types, config options, allowed colors, currency codes |
| `field-formats.json` | Value format rules for create/update via `bulk_record_actions` |
| `filter-operators.json` | `$-prefixed` operator syntax for `search_records` and view filters |
| `view-types.json` | TABLE / TIMELINE / CALENDAR types with capability lists |
| `connections.json` | External connection types (Workfront, AEM, Brand) and object type codes |
| `formula-documentation.txt` | Complete formula function reference (~50 functions, patterns, unsupported list) |
| `workspace-setup-guide.txt` | Opinionated playbook for building workspaces (record-type categories, build sequence, output constraints) |

## How to use these alongside `raw/`

- **`raw/`** = canonical UX reference. Use when a user asks "how do I do X in the Planning UI?"
- **`mcp-references/`** = canonical API/tool reference. Use when a user asks "how do I do X programmatically?" or when writing/debugging MCP scripts.

For most SA conversations both layers matter — answer with the UX path and mention the underlying API behavior when relevant.

## What the MCP refs ADD that public docs don't have

### API mechanics not in public UX docs
- Field ID format: `F` + 24 hex chars
- Record ID format: `Rc` + 24 hex chars
- Filter operator syntax: `$is`, `$isNot`, `$contains`, `$hasAnyOf`, `$hasAllOf`, `$isExactly`, etc. (with `$and`/`$or` for logical grouping)
- Bidirectional reference creation via `backField` parameter on `referenceOptions`
- `referenceOptions.isExternal` flag distinguishing native vs Workfront/AEM connections
- `bulk_record_actions` is NOT atomic — must check `hasErrors`
- Date values are ISO 8601 with mandatory Z timezone
- Percentage stored as decimal (0.75 = 75%)
- Currency codes: ISO 4217 (USD, EUR, GBP, etc.)
- People field values are `[{id: "userId"}]` arrays, not name strings

### Color palette (full enumeration)
20 named colors for single/multi-select options:
`light-blue, dark-blue, light-cyan, dark-cyan, light-teal, dark-teal, light-green, dark-green, light-yellow, dark-yellow, light-orange, dark-orange, light-red, dark-red, light-pink, dark-pink, light-purple, dark-purple, light-gray, dark-gray`

Public docs only say "swatches or hex code" without enumeration.

### Formula function reference (huge expansion)
Public docs list only the 6 WFP-only expressions (ARRAYJOIN, ARRAYUNIQUE, ID, JSONELEMENT, SETTIMEZONE, WEEKOFYEAR) and the 3 unsupported (ADDHOUR, SWITCH, FORMAT). The MCP doc lists ~50 supported functions across:
- Date/time: ADDDAYS, ADDWEEKDAYS, ADDMONTHS, ADDYEARS, CLEARTIME, DATE, DATEDIFF, DAYOFMONTH, DAYOFWEEK, DAYSINMONTH, DAYSINSPLITWEEK, DAYSINYEAR, DMAX, DMIN, HOUR, MINUTE, MONTH, SECOND, WEEKDAYDIFF, WORKMINUTESDIFF, YEAR, SETTIMEZONE, WEEKOFYEAR
- Math: ABS, AVERAGE, CEIL, DIV, FLOOR, LN, LOG, MAX, MIN, NUMBER, POWER, PROD, ROUND, SORTASCNUM, SORTDESCNUM, SQRT, SUB, SUM
- Text/Logic: ARRAY, ARRAYCONTAINS, ARRAYLENGTH, ARRAYELEMENT, CASE, CONCAT, CONTAINS, ENCODEURL, IF, IFIN, IN, ISBLANK, LEFT, LEN, LOWER, PASCAL, REMOVEACCENTS, REPLACE, REPLACEPATTERN, RIGHT, SEARCH, SORTASCSTRING, SORTDESCSTRING, STRING, SUBSTR, TRIM, UPPER
- Planning-specific: ARRAYJOIN, ARRAYUNIQUE, ID, JSONELEMENT, SETTIMEZONE, WEEKOFYEAR

It also adds SORTASCARRAY and SORTDESCARRAY to the unsupported list (public docs don't mention these).

### Common formula patterns (copy-paste recipes)
Budget variance, spend ratio, duration, days-to-deadline, conditional status labels, day-name from date, URL building with ENCODEURL, null-safe display. None of these are in public docs.

### Workspace setup playbook (opinionated guidance)
`workspace-setup-guide.txt` is the most prescriptive material we have. Key opinions:
- Record types split into "Work/Activity types" (keep Name, Description, Start/End Date, Status defaults) vs "Reference types" (delete dates and status — they have no lifecycle)
- 3-6 sections per workspace, every section needs a record type
- Always create lookup fields on connections (counts, rollups, key attributes)
- Default to creating bidirectional connections via `backField`, unidirectional only for work-to-reference
- 2-3 views per work record type, only default Table for reference types
- Build sequence: workspace → sections → record types → fields → connections → sample records → views, fully complete each record type before moving on
- Never narrate intermediate steps — execute end-to-end then explain once
- Output constraints: clickable markdown links using display names, never raw URLs or technical IDs

## Discrepancies between public and MCP docs

| Topic | Public Adobe docs | MCP docs | Resolution |
|---|---|---|---|
| Number/Percentage/Currency precision max | "up to 6 decimal places" | "0-4" | MCP figures are likely the actual storage limit; public docs may be outdated. Trust MCP for API limits. Confirm with the WFP engineering team if uncertain. |
| Currency default precision | Not specified | "Default: 2" | Use MCP default. |
| Date format options | Locale, Standard, Long, European, ISO | API-only ISO 8601 | Public refers to DISPLAY format choices in the UI. MCP refers to STORAGE/API format. Both correct in their layer. |
| CASE function | Not mentioned (not in unsupported list either) | Supported, documented | MCP doc is more accurate — CASE works. Public formula docs omit it. |
| Unsupported functions | ADDHOUR, SWITCH, FORMAT | Above + SORTASCARRAY, SORTDESCARRAY | Use MCP's longer list. |
| Reference fields | "lookup field with aggregator at connect time" | `referenceOptions.multiple`, `backField` mechanic | Public describes effect; MCP describes how. Complementary. |
| Filter operators | UI labels (Contains, Has any of, etc.) | API tokens (`$contains`, `$hasAnyOf`) | Map UI operator → API operator when switching layers. |
| Connection types | Workfront, AEM, GenStudio | Workfront (with object type codes PROJ/TASK/etc.), AEM, Brand | MCP uses "Brand" as the connection key for GenStudio Brands — listed under "Adobe Applications" in the picker. |

## How this changes the skill plan

1. **The MCP reference set becomes the API backbone for SKILL.md** when authoring agentic flows (e.g., "build me a Q1 campaign workspace"). The workspace-setup-guide.txt is essentially a system-prompt-quality build playbook.

2. **For SA conversations about UI**, public docs in `raw/` still lead.

3. **Discrepancies above should be reconciled in the SKILL.md** with a "when public docs say X and MCP says Y, prefer Z" pattern. The most critical one is precision (4 vs 6 decimals).

4. **The CASE function gap** in public docs is worth a separate SA note — many users following public docs miss this.

5. **The formula function reference here is the canonical version** for SA recommendations. Don't paraphrase from public docs alone.
