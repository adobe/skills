# Delete fields

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-fields/delete-fields
Last update: April 1, 2026

## Access requirements
- Standard license
- Manage on workspace
- For global record type fields: Planning Plus / Prime / Ultimate

## Where deletion happens
- ONLY from the record type table view.

## Cannot delete
- The primary field of a record type.
- Fields on a global record type from a secondary workspace (only deletable from primary).

## Recovery
- **No recovery. Data is permanently lost.**

## Cascading deletion behavior

### Regular field
- Deletes the field on this record type.
- All lookup fields on OTHER record types that referenced it are also deleted.

### Connection field
- Deletes the connection field on this record type.
- Also deletes the corresponding connection field on the OTHER (target) record type.
- All linked lookup fields are deleted on this side.

### Lookup field
- Deletes the lookup field on this record type.
- The original field on the source record type is UNAFFECTED.

### Field on a global record type (primary workspace)
- Deletes from ALL secondary workspaces where the type has been added.
- Cannot perform this delete from a secondary workspace — must be done in primary.

## Example
Connect Campaign to Product. Campaign has Product connection field + Product Status lookup. If you delete the Product connection field from Campaign:
- Product connection field on Campaign — deleted
- Product Status lookup field on Campaign — deleted
- Campaign connection field on Product (corresponding) — deleted

## SA notes
- Field deletion is the most destructive routine field operation. Make a one-line review: "what depends on this field?" before deleting.
- Primary field deletion is blocked, but the workaround (change primary field, then delete the old) is common.
- Cross-workspace deletion blast radius for global types is dangerous — secondary workspaces have NO ability to recover their fields if primary admin deletes.
- Pair with the "no audit log" issue from edit-fields.md: deletion is permanent AND not logged in any visible audit trail.
