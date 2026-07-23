# Manage the calendar view

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-views/manage-the-calendar-view
Last update: April 1, 2026

## Prerequisites
- Record type must have at least 2 date fields. Otherwise Calendar option is dimmed.
- Eligible date sources: record's own date fields OR lookup date fields from connected types.

## Records that DON'T display
- Both Start and End dates empty → not shown
- Only one is empty → record shown as a one-day event
- Start date AFTER End date → not shown

## Time frames

### Month
- Records display as bars on a monthly grid.
- Row height affects how many records show per cell.

### Week
- Multi-day records: top of calendar (all-day band).
- Single-day records: lower half, by hour if time is included.

## Row height (Month view only)

| Setting | Max records per cell (1 field) | Max records per cell (>1 field) |
|---|---|---|
| Short | 2 | 1 |
| Standard | 4 | 2 |
| Medium | 8 | 4 |
| Tall | 12 | 6 |
| Fit to content | All up to 500 | All up to 500 |

When cells overflow, "more" link expands the day.

## Edit operations
- Double-click empty space → create record
- Drag bar margins → resize (Start or End date)
- Drag whole bar → reposition (both dates)

## Filters
- Same operators as table/timeline view.
- Per-view, no names, unlimited conditions, AND/OR with nested groupings.
- Filters independent from other views on same record type.

## Settings panel

### Date and time
- Pick Start date and End date fields (defaults available + any date field).

### Bar style
- Choose what info shows on bars.
- Name (primary field) selected by default.
- **Maximum 5 fields per bar.**
- Thumbnail toggle (requires thumbnails already added in table view).

### Color
- Record color options:
  - **Record type** (default) — matches record type icon color
  - **Field values** — match to a color-coded field's value
  - **None** — white bars
- Only fields with color-coded options selectable for "Field values"
- No grouping color option (calendar doesn't support groupings)

## What calendar DOESN'T have (compared to timeline)
- No groupings (see view capability matrix in manage-record-views.md)
- No sort
- No breakdown of connected records
- No quarter/year views (Month and Week only)

## SA notes
- Calendar is the right view for "deadline-driven, day-by-day" planning (e.g., a marketing comm calendar).
- For multi-quarter strategic planning, prefer timeline view.
- Lookup date fields don't require aggregators for the calendar view — but DO require them for the timeline (caught in manage-record-views).
- "Fit to content" row height with hundreds of records will look messy. Recommend filters to limit volume.
- Color-by-field-values for status indicators (e.g., status, priority) is the high-leverage configuration. Without it, all records are the same color and the calendar provides little ranking signal.
