# Public Adobe docs vs MCP reference: discrepancies and reconciliation

When Adobe Experience League documentation and the MCP server reference disagree, this file resolves which is authoritative for which question. Always reconcile before quoting a number or behavior to a customer.

## Why they diverge

Public Adobe docs describe the **UI/UX surface** of Workfront Planning. They document what users see and can do through the web interface.

MCP reference material describes the **API/tool surface**. It documents what the MCP server (and underlying Planning API) actually accepts and returns.

Both are real. They serve different purposes. Discrepancies usually fall into three buckets:
1. **UI vs storage** difference (display format vs stored format). Both correct in their layer.
2. **Public docs out of date** relative to current API behavior. MCP is more current.
3. **Public docs incomplete** (omitting supported features). MCP is more complete.

## Reconciliation table

| Topic | Public Adobe docs | MCP docs | Authoritative source | Notes |
|---|---|---|---|---|
| Number, Percentage, Currency precision (max) | "up to 6 decimal places" | "0 to 4" | **MCP** | Public docs likely outdated. Trust MCP for what the API will accept. If a customer commitment depends on the exact number, confirm against the live MCP server before quoting. |
| Currency default precision | Not specified | "Default: 2" | **MCP** | Use 2 unless explicitly configured otherwise. |
| Date format options | Locale, Standard, Long, European, ISO | API-only ISO 8601 with mandatory Z timezone | **Both** | Public refers to DISPLAY format choices in the UI. MCP refers to STORAGE/API format. Both correct in their layer. Do not conflate. |
| CASE function in formulas | Not mentioned (not in unsupported list either) | Supported, documented | **MCP** | Public docs are silent. CASE works. Use it. |
| Unsupported formula functions | ADDHOUR, SWITCH, FORMAT | Above plus SORTASCARRAY, SORTDESCARRAY | **MCP** | Use the MCP longer list. |
| Reference field mechanics | "lookup field with aggregator at connect time" | `referenceOptions.multiple`, `backField` parameter | **Complementary** | Public describes effect, MCP describes how. Use both when explaining. |
| Filter operators | UI labels (Contains, Has any of, etc.) | API tokens (`$contains`, `$hasAnyOf`, etc.) | **Both** | Map UI operator to API operator when switching layers. See `references/raw/api/api-basics.md` and `references/mcp/filter-operators.json`. |
| Color palette for select fields | "swatches or hex code" (unspecified) | 20 named colors enumerated (`light-blue` through `dark-gray`) | **MCP** | Public docs do not enumerate. The 20 named colors are: light-blue, dark-blue, light-cyan, dark-cyan, light-teal, dark-teal, light-green, dark-green, light-yellow, dark-yellow, light-orange, dark-orange, light-red, dark-red, light-pink, dark-pink, light-purple, dark-purple, light-gray, dark-gray. |
| Connection type names | Workfront, AEM, GenStudio | Workfront, AEM, Brand | **Both** | MCP uses `Brand` as the connection key for GenStudio Brands. In the UI picker this appears under "Adobe Applications". When writing API code, use `Brand`. When talking to customers, use "GenStudio". |
| Formula function reference | Lists 6 WFP-only expressions and 3 unsupported | ~50 supported functions across date/time, math, text/logic, and Planning-specific | **MCP** | Public docs are dramatically incomplete. Use `references/mcp/formula-documentation.txt` as the canonical list. |
| `bulk_record_actions` atomicity | Not addressed | Explicitly non-atomic; must check `hasErrors` | **MCP** | Partial success is the normal case. Always check the response. |
| Identity model (user IDs) | Not explicitly called out | Returns Adobe IMS user IDs, NOT Workfront userIds | **MCP / API basics** | Common integration footgun. Any join against legacy Workfront data needs an IMS-to-Workfront mapping. |
| Percentage value storage | Shows percent symbol in UI | Stored as decimal (0.75 = 75%) | **Both** | UI display vs API storage. Do not conflate. |

## How the skill should apply this

1. **For UI questions** ("how do I do X in the Planning UI?"): public docs lead.
2. **For API / MCP questions** ("how do I do X programmatically?", "what format does the API accept?"): MCP leads.
3. **For customer-facing answers** where the customer will encounter both surfaces: present both layers explicitly. "In the UI you see X; the API stores it as Y."
4. **For numerical limits, formats, or supported features**: if the two sources disagree, default to MCP and note the discrepancy. If it matters for a commitment, verify against the live MCP server.
5. **For formula questions**: always lead with `references/mcp/formula-documentation.txt`. The public formula docs are too thin to rely on alone.

## Refresh signal

If a customer or engineer reports behavior that contradicts this table, the table is the candidate for staleness, not the customer. Validate against the current MCP server (the source closest to ground truth) and update this file. Note the date of validation in the row.

Date of this reconciliation: May 11, 2026.
