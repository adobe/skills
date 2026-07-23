# Adobe Workfront Planning modules for Workfront Fusion

Source: https://experienceleague.adobe.com/en/docs/workfront-fusion/using/references/apps-and-their-modules/adobe-connectors/workfront-planning-modules
Last update: January 14, 2026

## Connector facts
- Base URL: `https://{{connection.host}}/maestro/api/{{common.maestroApiVersion}}/`
- API tag: `v1.13.7`
- Auth: OAuth 2.0 only. **API keys are no longer used** for OAuth 2.0 connections to the Workfront API.
- Two supported connection patterns:
  - **Adobe Workfront auth connection** (user-context, Client ID + Client Secret + auth URL `https://{instance}/integrations/oauth2`)
  - **Adobe Workfront Server-to-Server connection** (service-account, Client ID + Secret + Instance name + Instance lane + Scopes)
- For Sandbox: create a separate OAuth2 application in the sandbox environment and use that env's Client ID/Secret.

## Access requirements
- Any Workfront Workflow package + Workfront Automation and Integration package, OR Workfront Ultimate.
- Prime/Select customers must purchase Fusion separately.
- Workfront license: Standard, Work, or higher.
- Org must be onboarded to Adobe Unified Experience (Planning is not available on legacy packages).

## Module catalog

### Trigger: Watch Events
The single event-based trigger. Watches records, record types, or workspaces for changes.

Configuration:
- Object type: records | record types | workspaces.
- State direction: "to" a value (new state) or "from" a value (old state).
- Workspace + Record type scoping (when watching records).
- Event filters: AND-only (no OR composition in the trigger itself).
- Objects to watch: new | updated | new and updated | deleted.
- "Exclude updates made by this connection" toggle prevents trigger feedback loops when the same scenario writes back to Planning.

**Hard constraint: event filters on an existing webhook are immutable.** To change filters, you must delete the webhook and create a new one.

### Action: Create a record
Inputs: Record type ID + dynamic field values per the selected record type.

### Action: Get a record
Inputs: Record ID. Returns a single record.

### Action: Get records by record type
Inputs: Workspace + Record type. Returns all records of that type. **No filter/sort/limit parameters at the module level** — use Search records instead for filtered queries.

### Action: Get record types
Inputs: Workspace. Returns the list of record types in a workspace.

### Action: Update record
Inputs: Record ID + new field values.

### Action: Delete a record
Inputs: Record ID.

### Action: Delete a record type
Inputs: Record type ID.
**Destructive: deletes the record type AND all records of that type.** No undo.

### Search: Search records
The filtered query module. Inputs:
- Workspace + Record type.
- Per-field filters (Record Fields): field, operator, value.
- Top-level filter condition: AND or OR (single global level — for complex boolean composition, use the API-basics `$and`/`$or` syntax inside a custom API call instead).
- Limit: max records returned per execution cycle.

### Action: Make a custom API call
Full escape hatch. Inputs:
- URL: path relative to `https://(YOUR_WORKFRONT_DOMAIN)/maestro/api/`
- Method: any standard HTTP verb.
- Headers: JSON object. Fusion adds authorization headers automatically.
- Query String: key/value pairs.
- Body: JSON.
Used when the prebuilt modules don't support the operation (e.g., bulk operations, view manipulation, complex `$and`/`$or` searches).

## JSONata recipe: human-readable record-types breakdown
Provided in the docs to flatten the API response into named structures:
```
(
    $s0 := ({"data":$ ~> | fields | {"options":(options){name:$}} |});
    $s1 := ({"data":$s0.data ~> | **.fields | {"options_name":(options.*){displayName:$}} | });
    $s2 := $s1 ~> | data | {"fields":(fields){displayName:$}} |;
    $s2.data{displayName:$}
)
```
Use case: documenting an existing workspace structure for migration/audit purposes.

## SA notes
- **Filter immutability on webhooks is the most expensive footgun.** Customers building event-driven integrations should treat the webhook configuration as if it were a code deploy. Lock down who can edit/recreate them.
- **"Exclude updates made by this connection" is essential** for any scenario that both reads and writes to Planning. Without it, the same scenario can fire on its own writes and either spin in a loop or rapidly burn through rate limit budget.
- **Search records module supports only flat AND/OR**, not nested `$and`/`$or`. For real filter logic, drop to Make a custom API call against `/v1/records/search` with the full filter shape from `api-basics.md`.
- **No native batch/bulk module.** Create/Update/Delete are one-at-a-time. High-volume integrations rope-in custom API calls + Iterator modules — and need to be paced against the 200 rpm per-user rate limit.
- **Get records by record type** has no filter/limit at the module level — it pulls everything. For record types approaching the 25K/50K ceiling, this is dangerous. Prefer Search records with a filter, or paginate via custom API call.
- For S2S connections, "Instance name" and "Instance lane" map to URL parts: `https://{instance}.{lane}.workfront.com`. Customers consistently mis-fill these.
- The connector requires Adobe Unified Experience. Legacy Workfront tenants cannot use Planning Fusion modules even if Fusion is licensed.
- The JSONata snippet for human-readable record-types breakdown is a useful artifact to save customers — they almost always want to dump their workspace schema as documentation, and the raw API response is unreadable.
- API tag `v1.13.7` is bound to the connector, NOT the underlying maestro API. The maestro API evolves independently. Custom API calls can target any maestro endpoint regardless of connector tag.
