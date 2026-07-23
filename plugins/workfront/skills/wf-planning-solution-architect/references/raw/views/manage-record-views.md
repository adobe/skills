# Manage record views

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-views/manage-record-views
Last update: Fri Feb 06 2026

## Four view types
- **Table** — structured columns + rows, default
- **Timeline** — chronological bars
- **Calendar** — date-grid layout
- **List** — only available in Connected records pages, NOT on record type pages

## Access requirements
- Standard license to create/delete views
- Contributor+ to update view elements
- Manage on view to share/delete; View on view for temporary changes
- Light/Contributor: needs Planning layout template

## Key principles
- Views are record-type-specific. Cannot apply one view to two record types.
- User-created views are private until shared.
- Modifying/deleting a shared view affects ALL users with permission to it.
- **Per-user view limit: 100 views.** Record type can have >100 total (across users), but each user's authoring ceiling is 100.

## What's tied to each view (not the record type)
- Filters
- Sort (table only)
- Row colors (table only)
- Fields shown (table only)
- Breakdown (timeline only)
- Grouping (table + timeline)
- Bar appearance (timeline + calendar)
- Row height (table + monthly calendar)

## View capability matrix (key feature differences)

| Feature | Table | Timeline | Calendar | List |
|---|---|---|---|---|
| Display in table format | ✓ | | | ✓ |
| All fields as columns | ✓ | | | ✓ |
| Hide/show fields | ✓ | | | ✓ |
| Edit field values | ✓ | | | ✓ |
| Add records as rows | ✓ | | | ✓ |
| Display in timeline | | ✓ | | |
| Display on calendar | | | ✓ | |
| Filter | ✓ | ✓ | ✓ | ✓ |
| Group | ✓ | ✓ | | |
| Sort | ✓ | ✓ | | |
| Color-code records | ✓ | ✓ | ✓ | |
| Color-code groupings | ✓ | | | |
| Search | ✓ | ✓ | ✓ | |
| Share | ✓ | ✓ | ✓ | ✓ |
| Display by year/quarter | | ✓ | | |
| Display by month | | ✓ | ✓ | |
| Display by week | | | ✓ | |
| Export | ✓ | | | |
| Full screen | ✓ | ✓ | ✓ | |
| Create records | ✓ | ✓ | ✓ | ✓ |
| Breakdown by connections | | ✓ | | |

## Creating a view

### Prerequisites
- Table view is auto-created when a record type is created.
- Timeline and Calendar require **at least 2 date fields** on the record type.

### Start/End date selection for timeline/calendar
- Can use record's own date fields OR lookup date fields from connected types.
- Lookup date fields REQUIRE an aggregator (MAX or MIN) at connection-creation time — otherwise they're not eligible for timeline/calendar start/end.

### View name auto-format
- `Table <number>`, `Timeline <number>`, `Calendar <number>` (incrementing).

## Renaming and reordering
- Drag-drop in dropdown to reorder.
- Double-click name to rename, or More menu → Rename.

## Full screen
- Full-screen icon in upper-right of view.
- Escape key or icon to exit.

## Real-time presence
- Always-on avatars in upper-right showing active viewers.
- Table view also field-level highlight of others' active edits.
- NOT available in list view.

## SA notes
- The 100-views-per-user cap is rarely hit but worth knowing. Power users hitting this can either delete obsolete views or have admin re-author a few in another user's name.
- The "aggregator at connection time" requirement for timeline/calendar date lookups is a setup-time decision — easy to miss until users complain that a connected date won't show in their timeline. Audit connections proactively.
- Views are private-by-default — until shared, others can't use them. New workspace launches need explicit view-sharing plans (often forgotten in rollout).
- List view exists only inside Connected records pages — it's NOT a primary navigation pattern. Don't promise users a "list of all my records like a spreadsheet"; that's the table view.
