# Edit field settings

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-fields/edit-fields
Last update: April 1, 2026

## Where editing happens
- ONLY from the table view of the record type.
- Cannot edit field settings from the record page or other views.

## What CAN be edited after save
- Name
- Description
- Single-select/Multi-select options
- Formula expression
- Lookup fields (for connection fields)

## What CANNOT be changed after save
- Field type (final on creation)
- "Allow negative numbers" cannot be deselected if negative values already stored

## CRITICAL warnings about edits

### Data loss with no warning
- **Changing formula expressions OR adding/removing select-type options can cause data loss on existing records.**
- **No warning is displayed when this happens.**
- **No notification is sent to other users.**

### Real-time value updates with no audit log
- When formula expressions or options change, existing record values update in real-time.
- **No audit log captures the value changes triggered by field config changes.**
- All viewers see new values immediately.

## Inline new-choice creation (table view only)
- For single/multi-select fields, you can add a new choice while editing a record cell.
- Double-click cell → type new choice name → click "Add choice".
- New choice is added immediately to the field's options globally.
- Auto-assigned value (lowercase, underscored) is generated for API/integration use.

## SA notes / governance implications
- **The "no warning, no audit, no notification" pattern around field config edits is a major footgun.** Critical formula refactors should be coordinated and announced; expect downstream broken reports/dashboards if not.
- Plan a "field config change log" outside WFP if change tracking matters (e.g., a separate doc).
- Inline choice creation in table view is fast but ungoverned — every user with edit access to records can add new options. For controlled taxonomies, restrict edit access or audit periodically.
