# Delete records

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-records/delete-records
Companion: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-records/restore-deleted-records
Last update: Oct 15 2025

## Where deletion can happen
- Table view: right-click row → Delete (or hover → More → Delete)
- Record page: More → Delete
- **Cannot delete from timeline or calendar views**

## Recoverable for 30 days
- Records go to "Recently deleted" bin for 30 days.
- After 30 days, permanent deletion (unrecoverable).

## Linked-record impact
- Deleting a record does NOT delete records linked to it.
- The deleted record's value is removed from linked records' lookup fields.
- Restoring brings back the connection AND the lookup field values.

## Undo
- Ctrl+Z / ⌘+Z to undo the most-recent deletion.
- "Recently deleted" area in the record type page for older deletions.

## Restore flow
- Open Recently deleted → select records → Restore → Restore.
- Multi-select supported.

## SA notes
- 30-day soft-delete window is generous — much better than the field/workspace deletion model (which is hard-delete with no recovery).
- The "linked records keep working" behavior is important: deleting a record won't cascade-break references on connected records.
- Bulk delete is supported in table view (multi-select rows → Delete).
- Be careful with "Recently deleted" being permanently visible only to those with workspace permissions — sysadmins included.
