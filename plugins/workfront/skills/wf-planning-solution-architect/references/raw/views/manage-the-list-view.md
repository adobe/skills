# Manage the list view

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-views/manage-the-list-view
Last update: April 1, 2026

## Where list view is used
- **Connected records page** for projects in a record's details area
- **Request forms list** at the record type level

NOT available at the record type page (must use table view there).

## Connected records page list view
- Shows ONLY projects, not other connected record types.
- Requires Workfront Project type connected to WFP record type.
- Multiple list views per record's connected page supported.

## Request forms list view
- Auto-generated, ONE per record type's request forms list.
- Cannot create or edit additional list views.

## List view feature set
Similar to Workfront's "enhanced lists" pattern. Most enhanced-list features apply.

### View management
- Dropdown switcher in upper-left for view selection.
- More menu on view: Rename, Share, Delete.
- **Views are shared across record types** for the same target object (e.g., a Projects view created on one record type is reusable on others displaying connected projects).
- Cannot modify System Views.
- View permissions to a shared view: can reset to original or copy with changes.

### Filters
- Click Filter icon → conditions.
- Personalized filter tokens: Me, My teams, My home team, My groups, My home group, My company, My roles, My primary role.
- Filters cannot be named or saved separately, but are stored with views.

### Columns
- Click + icon → Column manager.
- Add only existing fields.
- Cannot remove primary field.
- Hover header → Rename (custom label, doesn't change source field), Sort.

### Conditional formatting (Format cells)
- Add conditions per rule, format target column.
- **Up to 10 conditions per rule, up to 20 rules per field.**
- AND/OR connectors.
- Compare to another field (must be same type).
- Cell fill color, text color, bold, italic.
- "Apply to row" toggle.
- Blue dot indicator on Format cells icon when formatting applied.

### Grouping
- Available if field is a column.
- Not all field types groupable.

### Row height
- Short, Standard (default), Medium, Tall.

## Editing inline
- Double-click cell → edit → Enter to save.
- Some fields read-only (e.g., system-calculated % complete).

## Action bar (multi-select)
For connected projects:
- **Delete** — deletes project (sends to Workfront Recycle Bin, admin can recover 30 days)
- **Disconnect** — removes from WFP record's connection, clears lookup fields
- For request forms: **Edit form**, **Unpublish**, **Share**, **Copy link**

## SA notes
- List view is the "enhanced lists" experience adapted for WFP. Behaves more like a classic Workfront list than the WFP table view.
- Cross-record-type view sharing is unique here — useful when many record types use the same project connection patterns.
- Conditional formatting (20 rules x 10 conditions per rule) is the most powerful per-cell rule engine in WFP. Use for status traffic-light dashboards inside records.
- Delete vs Disconnect distinction matters: Delete kills the Workfront project (30-day soft delete), Disconnect just unhooks. Confirm which the user actually wants.
- The list view fills the "I want a saved, shareable, configurable project list" gap that table view doesn't satisfy. Common request from PMs working with connected projects.
