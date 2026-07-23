# Field overview

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-fields/fields-overview
Last update: Tue Sep 09 2025

Fields are attributes of record types in WFP.

## Where fields can be created
- ONLY from the table view of a record type page (add as a column).
- Cannot create fields from the record's page itself.
- Fields display as columns in table view AND on record pages.

## Creation paths

### Manual
- Adding columns in the table view.
- Creating connection / linked fields via "Connect record types".
- Importing existing Workfront fields (see import-fields-from-workfront).

### Automatic
- New record type defaults:
  - Name, Description, Start Date, End Date, Status (with values: Development, Planned, Active, Completed, On Hold — renameable / addable)
- When using a workspace template.
- When importing CSV/Excel for record type creation.

## Field scope
- Fields are associated to a record type. Cannot be added to another record type directly.
- Same field is available to all records of that type.
- WFP fields NOT accessible from Workfront.
- Workfront fields accessible from WFP only via connection lookup fields.

## Limits
- 500 fields per record type.
- 250 characters per field name.

## Deletion behavior
- Delete record type / workspace → all fields + values are GONE, no recovery.
- Delete a field referenced in a formula → formula field changes.
- Modify a formula referenced by other formulas → cascading impact.

## Permissions
- View/update field settings requires Manage on the workspace AND record type.

## SA notes
- Field creation is bound to table view UX — you cannot "design fields" in isolation; they're created as columns on a specific record type.
- Cross-record-type field reuse is achieved only via connection lookup fields, never via direct field sharing. This is fundamentally different from RDBMS schema design.
- The 250-char field name limit allows for descriptive naming but discourages overloading meaning. Plan a naming convention upfront.
- Formula dependency tracking is implicit — there's no native dependency graph. Treat formula refactors carefully.
