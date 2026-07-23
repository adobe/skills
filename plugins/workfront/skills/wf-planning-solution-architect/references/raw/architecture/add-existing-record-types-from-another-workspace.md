# Add existing record types from another workspace

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-architecture/add-existing-record-types-from-another-workspace
Last update: Thu Feb 05 2026

Lets a workspace manager add a record type from another workspace, IF that type has been designated global.

## Package requirements
- Any Workfront + Planning Plus, OR
- Any Workflow + Planning Prime/Ultimate

## License
- Standard
- Manage permissions on the secondary workspace

## What gets added
- The record type itself
- All original fields
- All record connections (means: connected types follow the global type into the secondary workspace)

## What you canNOT see/do from secondary
- Cannot see records that were added in the original workspace (only visible from the original workspace).
- Cannot edit the record type's appearance, settings, or original fields. Edits only in original.

## What gets added that's new
- Read-only `Workspace` field on the record type's table view showing where each record was created.

## SA notes
- The mechanism is: from secondary workspace, click Add record type → Add existing → pick from list. Option doesn't appear if no global types exist.
- Don't expect federation: records created in primary stay in primary. Records created in secondary roll up to primary. Records created in OTHER secondaries are not visible in this secondary.
