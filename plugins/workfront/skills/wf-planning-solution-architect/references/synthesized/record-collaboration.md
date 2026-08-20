# Record collaboration: comments, history, layout, sharing

Sources:
- https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-records/manage-record-comments (April 1 2026)
- https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-records/history-section-overview (April 1 2026)

## Right-panel sections
- **Comments**: user-authored discussion
- **History**: system-recorded field changes

## Access for both
- Contributor+ license
- View+ on workspace + record type
- Light/Contributor users need a Planning-enabled layout template

## Comments behavior

### Where
- Right panel of record page or record details box (in any view)

### Tagging
- `@user` or `@team` triggers in-app + email notifications.
- Team tagging notifies all team members.

### Isolation
- Comments are SCOPED to the WFP record they're on.
- Comments on a linked WFP record do NOT appear on the linking record (e.g., Product comments don't appear on Campaign).
- Comments on a connected Workfront object do NOT appear on the WFP record, and vice versa.

### Formatting
- Rich text toolbar: emojis, links, formatting.
- Images NOT supported in record comments.

### Draft persistence
- Unsaved comment text persists across sessions until deleted or submitted.

### Deletion
- Comment author can delete via More menu → Delete.

## History section

### What's recorded
- Field changes: old + new value, full name of editor, timestamp.

### Display rules per field type

#### Always show old (strikethrough) + new
- Text, Paragraph, Currency, Date, Number, Percentage, Single-select

#### Show old in strikethrough ONLY when value was REMOVED
- Multi-select, Linked record fields, People
- Pure additions show only new value

#### Always shows current state only
- Checkbox

#### NOT tracked in History
- Lookup fields, Formula fields
- Created by, Created date, Last modified by, Last modified date

### Removed-field artifact
- If a field is deleted later, its prior History entries REMAIN visible.
- No indication that the field has been removed.

## SA notes
- **History is the only built-in audit trail.** But it doesn't cover lookup/formula recalculation, field config changes, or deletions — the gap is significant for governance. Pair with weekly Fusion exports if audit compliance matters.
- Comment isolation across linked records is a common source of "where did that comment go?" confusion. Educate users that comments live on the record where they were written.
- WFP records ↔ Workfront comments are NOT shared. For cross-app discussions, choose one canonical place (typically Workfront execution-side for project-level discussion, WFP for strategic discussion).
- The "removed field stays in history with no indication" pattern can produce stale audit entries for fields no longer in the record type. Don't be alarmed when reviewing old history.
- Bulk comment actions are not supported; mentions to teams scale the audience but each comment is per-record.
