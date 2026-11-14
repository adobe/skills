# Planning API v2 and versioned filters

API v2 became available to all customers on May 28, 2026. Version 1 remains available, but Adobe recommends switching to v2. The release adds workspace, record-type, and field CRUD, record management, PATCH partial updates, bulk operations, and improvements to URLs, filtering, pagination, errors, and permissions.

Sources: [Q3 release notes](https://experienceleague.adobe.com/en/docs/workfront/using/product-announcements/product-releases/planning-release-activity/planning-release-activity-26-q3), [Planning API basics](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-general-information/planning-api-basics), and [developer reference](https://developer.adobe.com/wf-planning/).

## Choosing a version

- Use `/maestro/api/v2` for new direct integrations. Record listing, creation, search, and bulk operations are scoped under `/record-types/{recordTypeId}/records`. Single-record GET, PUT, PATCH, and DELETE use `/records/{id}`.
- For Fusion, the [Fusion Planning modules page](https://experienceleague.adobe.com/en/docs/workfront-fusion/using/references/apps-and-their-modules/adobe-connectors/workfront-planning-modules) documents a separate **Workfront Planning V2 connector** with workspace, record type, record, field, view, and permissions modules, Watch Events, and a custom API call module with an API Version selector. Create, search, and update record modules come in V2 and Legacy variants. Older text in [Planning API basics](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-general-information/planning-api-basics) and the Q3 notes (written May 2026) says the connector "will continue to use Version 1 until further notice"; the V2 connector docs are newer (July to September 2026), so follow them. Check which connector and modules an existing scenario uses, and match request bodies to that version.
- PATCH and bulk operations are not available in v1.
- Use the endpoint's developer reference for pagination and error handling rather than carrying v1 request and response shapes into v2.

## Filters are versioned and field-typed

v2 POST search:

```json
{
  "filter": {
    "operator": "AND",
    "conditions": [
      {"fieldId": "<statusFieldId>", "condition": "IS_ANY_OF", "value": ["active", "planned"]},
      {"fieldId": "<nameFieldId>", "condition": "CONTAINS", "value": "launch"}
    ]
  }
}
```

Send this body to `POST /maestro/api/v2/record-types/{recordTypeId}/records/search`. Filter groups use `operator: AND|OR` and `conditions`; do not mix v1 `$` keys into v2 groups.

All ordinary empty-value-capable fields below support `IS_EMPTY` and `IS_NOT_EMPTY` in v2, `$isEmpty` and `$isNotEmpty` in v1, in addition to the listed operators.

| Field | v2 conditions | v1 counterparts |
|---|---|---|
| Text, paragraph, text-valued formula | `CONTAINS`, `DOES_NOT_CONTAIN`, `IS`, `IS_NOT` | `$contains`, `$doesNotContain`, `$is`, `$isNot` |
| Number, percentage, currency | `IS`, `IS_NOT`, `GREATER_THAN`, `GREATER_THAN_OR_EQUAL`, `LESS_THAN`, `LESS_THAN_OR_EQUAL` | `$is`, `$isNot`, `$greaterThan`, `$greaterThanOrEqual`, `$lessThan`, `$lessThanOrEqual` |
| Date | `IS`, `IS_NOT`, `IS_AFTER`, `IS_BEFORE`, `IS_BETWEEN`, `IS_NOT_BETWEEN` | `$is`, `$isNot`, `$isAfter`, `$isBefore`, `$isBetween`, `$isNotBetween` |
| Single-select | `IS`, `IS_NOT`, `IS_ANY_OF`, `IS_NONE_OF` | `$is`, `$isNot`, `$isAnyOf`, `$isNoneOf` |
| Multi-select, People/user, reference | `HAS_ANY_OF`, `HAS_ALL_OF`, `IS_EXACTLY`, `HAS_NONE_OF` | `$hasAnyOf`, `$hasAllOf`, `$isExactly`, `$hasNoneOf` |
| Lookup | Follow the source field's type | Follow the source field's type |

Live check, October 9, 2026: read-only Hub searches through the Planning MCP tool's v1-style `filters` payload accepted single-select `$isAnyOf`/`$isNoneOf` and returned the expected 1/4 matches from five existing records. Multi-select and multi-valued Planning connection fields rejected `$is` and `$isNot` as unsupported. Positive controls using `$hasAnyOf`/`$hasNoneOf` returned the expected 3/2 matches for multi-select and 1/4 for the connection. This is a scoped Hub observation, not a release-note change or verification of every tenant, People field, or connection cardinality. The MCP tool does not expose its underlying HTTP URL.

The Q4 UI relabels multi-value "Has any of"/"Has none of" to "Is any of"/"Is none of" (Preview October 1, fast October 14, everyone October 15). This does **not** change the API's `HAS_ANY_OF`/`HAS_NONE_OF` tokens. A single-select filter and a multi-select/reference filter are not interchangeable.

For v1 record search, retain the `filters` JSON array:

```json
{
  "recordTypeId": "<recordTypeId>",
  "filters": [
    {"<nameFieldId>": {"$contains": "launch"}},
    {"<statusFieldId>": {"$is": "active"}}
  ],
  "offset": 0,
  "limit": 500
}
```

## Partial updates and bulk operations

Prefer `PATCH /maestro/api/v2/records/{id}` for targeted updates to a single record. PATCH uses merge-patch semantics: include only the data keys being changed; use explicit `null` to intentionally clear a writable field according to its schema. `PUT /v2/records/{id}` is full replacement: every field not provided is set to null.

Source: [v2 endpoint reference](https://developer.adobe.com/wf-planning/api/v2/) and its [OpenAPI specification](https://developer.adobe.com/wf-planning/v2.json), operations `patchRecord` and `updateRecord`.

Bulk operations live at `/maestro/api/v2/record-types/{recordTypeId}/records/bulk`: POST creates, PATCH partially updates, PUT fully replaces (omitted fields become null), and DELETE removes. Each request is limited to 100 records; PUT and PATCH items must include an `id`. Prefer bulk PATCH over bulk PUT unless full replacement is intended.

Bulk operations are not atomic. Check the response for per-record errors rather than treating the HTTP status alone as confirmation that every record succeeded.
