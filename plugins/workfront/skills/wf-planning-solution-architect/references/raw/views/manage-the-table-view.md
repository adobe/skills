# Manage the table view

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-views/manage-the-table-view
Last update: Mon Mar 02 2026

## Why the table view matters
- ONLY view where record EDITING happens.
- Default view when you open a record type page.
- Supports the most view-element types of any view.

## Row height options
- Short, Medium, Tall

## Limits
- **500 fields (columns) max per table view**
- **50,000 records (rows) max per record type**

## Adding/removing columns
- Add columns = adds fields to the record type (same operation).
- Hide columns: column header arrow → Hide field, OR Fields toolbar → toggle off.
- Hidden field count badge displayed next to Fields icon.
- Reorder: drag column header (with brief blue highlight), OR drag in Fields box.
- **Column width and order changes are PERMANENT and visible to all users.**

## Primary field
- Always first column.
- Cannot be moved without designating another field as primary.
- Hover column → arrow → "Set as primary field" → confirm.

## Search
- Search box in toolbar.
- Only searches visible fields. Hidden fields are not searchable.
- Enter to navigate matches; up/down arrows for multi-match.

## Rows (records)
- Saved immediately; visible to all View+ permission holders.
- Thumbnail toggle in Fields setting shows thumbnail column left of primary.
- Drag-drop handle reorders rows ONLY when no sort is applied.

## Filters

### Operators per field type
- **Single-line, Paragraph, Formula**: Contains, Does not contain, Is, Is not, Is empty, Is not empty
- **Single-select**: Is, Is not, Is any of, Is none of, Is empty, Is not empty
- **Multi-select, People**: Has any of, Has all of, Is exactly, Has none of, Is empty, Is not empty
- **Number, Percentage, Currency**: =, ≠, <, >, ≤, ≥, Is empty, Is not empty
- **Date**: Is, Is not, Is after, Is before, Is between, Is not between, Is empty, Is not empty
- **Checkbox**: Is

### Filter scope
- Per-view, not per record type.
- AND / OR operators, with nested AND/OR groupings supported.
- Unlimited filter conditions.
- Can filter on connected record fields, lookup fields, and lookup fields with multiple values.
- **4-hop reach** through connections (e.g., Activity → Product → Campaign → Project's Budget).
- **No filter names** — cannot label filters; they're inline only.
- Removing a filter removes it for all users on the same view.

## Sort
- Per-view, persistent across navigation.
- Can sort by as many fields as visible in the table.
- **Cannot sort by connected record fields** directly, but CAN sort by lookup fields from connected types.
- Lookup fields with multi-values (no aggregator): sort uses the FIRST value.
- **4-hop reach** through connections.
- Removing sort removes it for all users.

## Grouping
- **Up to 3 levels** of nested grouping.
- Per-view.
- Can group by connected record fields or lookup fields.
- Multi-value lookups (no aggregator): groups by each unique combination of values.
- 4-hop reach through connections.
- Groupings listed alphabetically by value.
- Records can be added at end of any grouping (auto-populates grouping fields).
- Right-click grouping header → expand/collapse group, all, or subgroups.

## Row colors
- Define conditions per field; pick a color (custom or swatch).
- Multiple sets of conditions for different colors.
- "Apply to the entire row" toggle: off by default → only a narrow left-edge indicator. On → full row color.
- **Row colors CANNOT be applied to the entire row when groupings are active.**

## Real-time presence
- Avatars in upper-right of all views.
- Table view: field-level highlighting in the actively-edited user's color.
- Gray avatar = stopped editing > 30 seconds ago.
- "Show collaborators" toggle to disable.
- Click cell triangle to see list of users editing that field.

## SA notes
- Table view IS the editing surface. All other views are display-and-summarize. Plan accordingly.
- 50K records per type is the soft ceiling for a single record type, discussed extensively in internal architecture reviews (roadmap targets 50K initially; multiple enterprise customers pushing on this).
- The 4-hop reach on filter/sort/group is enormously powerful for cross-record reporting. Document the reach in architecture diagrams.
- "Column width and order is permanent and visible to all" is a frequent source of accidental "my view changed!" reports — educate users that changes ripple unless they personally own the view.
- Filters have no names — for "saved query" patterns, build separate views (each with its own filter set).
- Multi-value lookup sort uses first value — gotcha for users expecting summary-based sort. Add aggregators (MIN/MAX/SUM/AVG/etc.) at connection time to get deterministic sorting.
