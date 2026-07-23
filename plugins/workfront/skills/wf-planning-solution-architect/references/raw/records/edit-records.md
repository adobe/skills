# Edit records

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-records/edit-records
Last update: Thu Mar 12 2026

## Access requirements
- Standard license
- Contribute+ on workspace + record type

## Six places to edit
- Inline in table view
- Resize/drag in timeline view (dates only)
- Resize/drag in calendar view (dates only)
- Record's preview box
- Record's details page
- A Workfront object's Planning section (for connected WFP records)

## Read-only field types (NOT editable)
- Linked / lookup fields from connected records
- Formula fields
- System fields: Created by, Created date, Last modified by, Last modified date, Approved by, Approved date, Record ID

## Real-time sync
- Edits in ANY view propagate immediately to ALL views and record pages for ALL users.
- Avatar indicators show who's editing what (in table view, field-level highlighting; in other views, just presence in upper-right corner).
- "Show collaborators" toggle (real-time indicator in preview/details page) highlights fields being edited by others in real time.

## Bulk edit
- **You CANNOT edit records in bulk natively.** This is a significant limitation.

## URL behavior
- Single-line text fields auto-render values as links ONLY when they start with: `http://`, `https://`, `ftp://`, or `www.`

## Records connected across workspaces
- Edits to a record reflected on its linked records in all workspaces.

## Timeline / Calendar date editing
- Drag bar margins → updates Start or End date
- Drag whole bar → updates both dates, preserving duration
- **Blocked when the Start/End date is a lookup or formula field** (read-only)

## Copy/paste mechanics in table view
- Copy/paste within same field type across records
- Column → column copy (must be similar types)
- Shift-click rows → copy → paste in multiple new rows
- Single-cell copy → multi-cell paste
- Drag lower-right corner of cell → fill adjacent cells
- External paste (e.g., from Excel) supported for: Planning connection fields, People (single-value only)
- External paste NOT supported for: Workfront/other-app connection fields, lookups, system fields
- Keyboard: Ctrl+C / Ctrl+V (⌘ on Mac), Ctrl+Z / Ctrl+Shift+Z for undo/redo

## Where copy/paste DOESN'T work
- Record page (only table view supports it)
- Lookup fields (created from connecting record types)
- System fields

## Paragraph field formatting
- Rich text: bold, italic, underline, add link, bulleted list, numbered list

## Cover image and thumbnail
- Cover: large header image. Unique per record.
- Thumbnail: appears in views. Different from cover.

## Inline adding of single/multi-select choices
- Table view only.
- Double-click cell → type new choice name → click "Add choice".
- Choice added immediately, value (lowercase, underscored) auto-generated for API use.

## SA notes
- **No bulk edit is a major gap.** Workarounds: import CSV (overwrites or appends), Fusion automation, or AI Assistant. Educate users early.
- The "read-only when Start/End date is formula or lookup" gotcha in timeline/calendar trips up users who set up rollup date fields. Confirm what fields drive the visible dates.
- Real-time presence is genuinely useful for high-collaboration workspaces but adds visual noise — power users may want to disable "Show collaborators".
- Inline choice creation is governance-loose — any contributor with table edit access can add new single/multi-select options. For taxonomy hubs, lock this down by limiting edit access or using request forms instead.
- URL recognition only fires on standard prefixes — users typing "example.com" won't get a link. Document this.
