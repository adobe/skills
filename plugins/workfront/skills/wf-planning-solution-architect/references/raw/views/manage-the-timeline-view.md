# Manage the timeline view

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-views/manage-the-timeline-view
Last update: Wed Apr 01 2026

## Prerequisites
- Record type must have at least 2 date fields. Otherwise Timeline option is dimmed.
- Eligible Start/End date sources:
  - Record's own date fields
  - System fields: Created date, Last modified date
  - Lookup date fields from connected types — only if you added an aggregator (MIN/MAX) at connection-creation time

## Records that DON'T display in timeline
- Start AND End dates are empty
- Either Start OR End date is empty
- Start date is AFTER End date

## Time frames
- **Year**: shows quarters and months
- **Quarter**: shows months and weeks
- **Month**: shows weeks and days

## Modes

### Standard (default)
- Each record gets its own line
- Required for Breakdown feature
- Drag/resize bars supported

### Compact
- Records whose date ranges don't intersect share lines
- More compact display
- **Breakdown NOT available in Compact mode**
- **Truncate bar details setting NOT available in Compact mode**

## Custom quarters
- If your admin enabled custom quarters and Workfront detects gaps/overlaps/missing months, you'll see a warning on first open.
- Without proper custom quarter setup, timeline displays classic quarters.
- Workfront admins can click "Go to Setup" from the warning to fix; non-admins must request.
- Each user sees the warning once.

## Edit operations on timeline
- Double-click empty space → create record
- Drag bar margins → resize (changes Start or End date)
- Drag whole bar → reposition (changes both dates)
- **Cannot drag/resize Workfront or AEM objects displayed in breakdowns**
- **Cannot create records via double-click inside groupings**

## Filters
- Same operators as table view (Single-line/Paragraph/Formula, Single-select, Multi-select/People, Number/Percentage/Currency, Date, Checkbox).
- Per-view, no names, unlimited conditions, AND/OR with nested groupings.
- Filters in timeline are INDEPENDENT from filters in table view of same record type.

## Grouping
- Up to 3 levels.
- Per-view; independent from table view groupings.
- Same group-by sort options:
  - A→Z / Z→A (text fields, selects, connections, people)
  - 0→9 / 9→0 (number, currency, percentage)
  - earliest→latest / latest→earliest (date)
- Drag-drop to reorder groupings in the picker.
- Inside groupings, records sorted by Start date (default).

## Settings panel

### Date and time
- Pick Start date field and End date field.
- "Use custom quarters" warning area (admin only).

### Bar style
- Choose what info appears on bars.
- Primary field (Name) default.
- **Maximum 5 fields per bar.**
- Thumbnail toggle (records must have thumbnails added in table view first).
- "Truncate bar details" setting (Standard mode only) — text truncates and shows on hover.

### Color
- Two coloring scopes: groupings + records (set independently).

#### Grouping color (only when groupings active)
- Default (gray)
- Field values (must group by a color-coded field type, e.g., single/multi-select)
- Cannot match to lookup fields from connected types

#### Record color
- Record type color (default)
- Field values (only color-coded fields)
- Grouping color (only when groupings applied)
- None (white bar)

## Breakdown feature
- Display connected records under the main record on the timeline.
- **Standard mode only.**
- Eligible to break down:
  - WFP records connected to the selected record type
  - Workfront object types or AEM assets connected
  - WFP records or other-app objects connected through intermediate records (e.g., Campaigns connected to Portfolios + connected to Products + Products connected to Projects → can break down Campaigns by Portfolios, Products, and Projects)
- **CANNOT include in breakdown:**
  - Workfront objects connected only in Workfront (e.g., Tasks on Projects)
  - GenStudio Brands
- Breakdown record types must have ≥2 date fields, displayed as lookup fields in main record's table view, with sequential start/end dates.
- **Maximum 5 record types in a single breakdown.**
- Breakdown is NOT hierarchical — order added is for display only.

## Search
- Same behavior as table view: highlights matching records, navigates with Enter and arrows.

## SA notes
- The "MAX/MIN aggregator at connection-creation" requirement for using lookup dates as timeline anchors is one of the most-missed setup gates. Audit existing connections during workspace review.
- Breakdown is Adobe's answer to "I want to see how my strategy maps to execution" — extremely powerful for SVP/VP timeline exec reviews when set up correctly.
- 5-record-type breakdown limit is rarely binding but worth knowing for complex hierarchies.
- Custom quarters affect not just calendar accounting but also the timeline view's quarter rendering. Common surprise for finance/ops users.
- The "no creation in named grouping" + "no creation in Compact mode" combo means power users sometimes complain they can't add records — check view mode first.
- 5-field-per-bar limit is the practical density ceiling. For more detail, use the record preview (click bar).
