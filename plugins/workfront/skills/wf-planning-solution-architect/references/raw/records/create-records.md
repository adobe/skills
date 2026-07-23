# Create records

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-records/create-records
Last update: Fri Jan 30 2026

## Access requirements
- Standard license
- Contribute+ on workspace + record type → use "New record" button
- View on workspace + record type → use "Request record" button (requires that a workspace manager has built a request form)
- Manage on parent Workfront object → for child object creation

## 10 ways to create a record
1. New record / Request record button (any view)
2. Inline in the table view
3. Double-click in the timeline view
4. Double-click in the calendar view
5. Copy + paste from external list
6. Duplicate from table view
7. Connect from other records (records can be created at connection time)
8. Submit request form
9. Import from CSV/Excel
10. Automations

## Global record type visibility on create
- Records added to ORIGINAL workspace of a global type → visible from original workspace.
- Records added to a SECONDARY workspace → visible from THAT secondary workspace AND the original workspace.

## Permission gates
- View users CANNOT create records unless a workspace manager has built a request form for the record type.

## Field constraints when creating
- No mandatory fields exist by default. Recommended: always fill primary field.
- Fields referring to other record types (lookup fields, formula fields) are READ-ONLY.

## Table view inline creation
- Click "New record" in last row OR after last record in a grouping
- Shift+Enter on any cell → adds empty row below current
- Hover primary field → More → Insert above / Insert below
- When adding in a grouping, fields associated with the grouping auto-populate
- Auto-thumbnail attached to each new record (can replace via cover-image flow)
- Open Details icon to the left of the record name → opens preview box
- Undo/Redo: Ctrl+Z / Ctrl+Shift+Z (⌘ on Mac)

## Timeline view creation
- Requires 2 date fields on the record type
- Double-click anywhere on timeline → opens New record box
- Default date spans depending on zoom: Year → month, Quarter → week, Month → 3 days
- Drag bar margins to adjust dates after creation
- **Cannot create records in timeline view when bars are in a NAMED grouping**

## Calendar view creation
- Requires 2 date fields
- Double-click anywhere on calendar
- Default date spans: Month view → 1 day, Week view → 2 days

## Copy/paste from external
- Pre-create empty rows first (one per pasted row)
- Tabular paste — columns must match WFP fields' format expectations
- Common pattern for Excel → WFP imports

## Connect-and-create
- When connecting records, if the target doesn't exist, type a name and click "+ Add"
- Creates the connected record on the target record type
- WFP records: full set of types can be created this way
- Workfront objects: ONLY projects, portfolios, programs can be created via connect-and-create
- Groups and companies CANNOT be created from this flow

## Request form (View users)
- Both Workfront users and external users can submit if they have a form link
- Internal request submission via Workfront Requests area is Workfront-users only
- If form has approval, record is created only after all approvers sign off

## CSV/Excel import
- Two paths: when importing a record type (creates type + records) OR importing records into an existing record type
- See import-file-to-create-records.md

## Automations
- Configure automation on the record type
- When triggered, creates a connected record on another type
- Auto-connected to the trigger record

## SA notes
- "No mandatory fields" is a governance footgun — couple with request forms (which CAN enforce required fields) for critical data quality.
- Read-only fields on creation (lookups, formulas) mean planning the connection structure first matters: you can't backfill connection data from the creation form.
- Timeline view's "no creation in named grouping" constraint trips people up. If users complain about not being able to add records in timeline, check grouping settings.
- Connect-and-create is the cleanest path for "I need a new record but only in context of an existing one". Useful for the strategy→execution bridge pattern from best practices.
- The 10 creation paths reflect WFP's design intent of meeting users where they are — table editors, calendar planners, integration pipelines, etc.
