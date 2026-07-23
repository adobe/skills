# Adobe Workfront Planning API basics

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-general-information/planning-api-basics
Last update: October 21, 2025

## Architecture
- REST-ful over HTTP, JSON responses.
- Separate from the legacy Workfront API. Distinct schema, distinct authentication. Familiarity with Planning's data model (workspaces, record types, fields, connections) is a prerequisite for productive integration work.
- Full developer reference lives on developer.adobe.com: https://developer.adobe.com/wf-planning/

## Identity model
- All user-related fields return **Adobe IMS user IDs**, NOT Workfront user IDs.
- This is a hard schema break with the rest of Workfront. Any integration that joins Planning data against the legacy Workfront API must map IMS userId to Workfront userId.

## HTTP method semantics
- GET: retrieve by ID or search by query.
- POST: insert (also used for `/v1/records/search` body-based queries).
- PUT: edit existing.
- DELETE: delete.

## Search modifier syntax (filters)
All modifiers are `$-prefixed`. This is the same syntax used by the Workfront Planning MCP server's `search_records` tool (see `mcp-references/filter-operators.json`).

| Modifier | Notes |
|---|---|
| $contains, $doesNotContain | text-like fields only |
| $is, $isNot | exact match. Shorthand: `"fieldId": "value"` is equivalent to `"fieldId": { "$is": "value" }` |
| $isEmpty, $isNotEmpty | usable as bare string `"fieldId": "$isEmpty"` OR with null arg |
| $greaterThan, $greaterThanOrEqual, $lessThan, $lessThanOrEqual | numeric, percentage, currency |
| $isAfter, $isBefore, $isBetween, $isNotBetween | date-typed fields, ISO 8601 with Z timezone |
| $isAnyOf, $isNoneOf | single-select, created-by, updated-by |
| $hasAnyOf, $hasAllOf, $isExactly, $hasNoneOf | multi-select, user, reference |
| boolean | $is only |
| lookup | inherits from the linked field type |

## Field-type → modifier matrix (canonical)
- text / long-text / url / formula: $contains, $doesNotContain, $is, $isNot, $isEmpty, $isNotEmpty
- number / percentage / currency: $is, $isNot, $greaterThan, $greaterThanOrEqual, $lessThan, $lessThanOrEqual, $isEmpty, $isNotEmpty
- date / created-at / updated-at: $is, $isNot, $isAfter, $isBefore, $isBetween, $isNotBetween, $isEmpty, $isNotEmpty (created-at omits empty checks)
- single-select / created-by: $is, $isNot, $isAnyOf, $isNoneOf, $isEmpty, $isNotEmpty (created-by omits empty)
- multi-select / user / reference: $hasAnyOf, $hasAllOf, $isExactly, $hasNoneOf, $isEmpty, $isNotEmpty
- boolean: $is
- updated-by: $is, $isNot, $isAnyOf, $isNoneOf, $isEmpty, $isNotEmpty
- lookup: depends on the linked field

## Boolean composition
Filters can be combined with `$and` / `$or`, nested arbitrarily:
```
"filters": [
  {
    "$or": [
      { "launch_date": { "$isBetween": [...] } },
      {
        "$and": [
          { "launch_date": { "$isBetween": [...] } },
          { "status": "active" }
        ]
      }
    ]
  }
]
```

## Field projection
`?attributes=field1,field2,...` controls which fields come back.
- Case-sensitive.
- Same parameter referred to as `fields` in some places, `attributes` in others. The example in the official docs uses `attributes`.

## Sorting
`sorting` is an array of `{ fieldId, direction }` pairs; direction is `asc` or `desc`. Multiple sort keys supported.

## Pagination & limits
- **Default page size: 500 records.**
- **Hard max page size: 2000 records.** Above 2000, you MUST paginate.
- `offset` is 1-based in the docs example (`"offset": "2001"` to start at the 2001st record).
- **Always include a `sorting` clause when paginating** — without stable sort order, pages can skip or repeat records.
- Pagination parameters are sent as strings in the request body in the official example, but most clients accept integers. Be defensive.

## Search request shape (canonical)
POST `/v1/records/search`
```
{
  "recordTypeId": "Rt...",
  "filters": [ ... ],
  "sorting": [ { "fieldId": "F...", "direction": "asc" } ],
  "limit": 500,
  "offset": 0,
  "rowOrderViewId": "V...",
  "groupingFieldIds": []
}
```

## External lookup field bridge
Planning API can be called from a Workfront custom-form **External lookup field**. This is the supported pattern for embedding live Planning data into legacy Workfront custom forms without writing a full Fusion scenario or external integration.

## SA notes
- **Pagination is the #1 thing customers get wrong.** They build extracts that miss records because they paginate without a sort key. Always prescribe `sorting` + `offset` + stable `recordTypeId`.
- **The 2000-record page max is a per-call ceiling, NOT a per-record-type cap.** The 25K (and roadmap 50K) records-per-record-type architectural ceiling lives in the platform itself. Don't confuse customers between these.
- **IMS vs Workfront userId** is the single most common integration trap. Whenever a customer says "we joined Planning data with Workfront task data and got NULLs", this is the first thing to check.
- The filter syntax is shared with the Workfront Planning MCP server's `search_records` tool. If a customer is comfortable in one, they can read the other.
- For high-volume reads (5K+ records), POST `/v1/records/search` with `limit: 2000` + paginated `offset` is the supported pattern. There is no "stream all" or cursor-based equivalent.
- `rowOrderViewId` is an optional anchor — if the customer wants results in the same order as a view they see in the UI, pass the view ID.
- The 200 rpm per-user rate limit (industry-standard-tier for collaboration SaaS, on the lower side for high-frequency API) is a separate constraint from the page-size limit. Bulk integrations should use a service account and respect throttling.
- An External lookup field that hits the Planning API counts against the user's rate budget. If a custom form fans out lookups across many records in a list view, this can cascade into 429s.
