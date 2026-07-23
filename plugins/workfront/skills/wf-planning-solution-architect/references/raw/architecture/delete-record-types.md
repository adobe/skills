# Delete record types

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-architecture/delete-record-types
Last update: April 1, 2026

## Permissions
- Manage on workspace
- For deleting global record types: Planning Plus or Prime/Ultimate

## What gets deleted
- All records of that type
- All fields associated with the record type
- All views (filters, groupings, sortings)
- Removed from all users with access

## Recovery
- Permanent. Not recoverable.
- Confirmation requires typing "delete".

## Global record type rules

### Original workspace deletion
- A global record type added to other workspaces CANNOT be deleted from its original workspace.
- Must first delete from all secondary workspaces, then can delete from the original.

### Secondary workspace deletion
- Record type remains in original workspace.
- Records added FROM that secondary workspace are deleted from both the secondary and the original workspace.
- Records added from other secondary workspaces remain in their workspaces and the original.
- Views from the secondary workspace are preserved and remain visible elsewhere if shared.

### Deletion path quirks
- You cannot delete a global record type from a secondary workspace via the record type's page — only from the record type card in the workspace.

## SA notes
- Deleting global record types is risky — be sure record traceability between workspaces is understood. Records from secondary workspaces are gone from the original too.
- Recommend recreating fields and records on another type before deleting.
