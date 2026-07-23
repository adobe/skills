# Create fields

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-fields/create-fields
Last update: Thu Jan 22 2026

## Access requirements
- Any Workfront + any Planning (or any Workflow + any Planning)
- Standard license
- Manage on workspace

## Six paths to create fields
1. From scratch (in table view, + icon or column-header Insert left/right)
2. By connecting record types (linked record fields)
3. By creating a record type (auto-creates Name, Description, Start/End Date, Status)
4. By creating a workspace from a template
5. By importing from CSV/Excel
6. By importing copies from Workfront (creates independent copies, no sync)

## CRITICAL constraint
**You cannot change the Field type after saving.** Plan ahead.

## Field types (17 total)

### Single-line text
- Up to 1,000 characters.
- Free-form alphanumeric.

### Paragraph
- Up to 10,000 characters per field.
- **Max 20 paragraph fields per record type.**
- Rich text formatting supported in table view + record details.

### Multi-select / Single-select
- Choices: unlimited count.
- Each choice has a color (swatch picker or hex code).
- Drag-drop reorder OR "Sort choices A-Z".
- New choices can be added inline when editing a record's value.
- "Show values" toggle exposes the underlying DB values:
  - Auto-assigned, match choice name in lowercase, spaces → underscores
  - Values can repeat across fields but must be unique within a field
  - Use these values in API calls and integrations

### Date
- Formats: Locale (browser), Standard (05/16/2023), Long (May 16, 2023), European (16/05/2023), ISO (2023-05-16)
- **"Include time" option is irreversible after save** — choose carefully.
  - 24hr or 12hr formats.

### Number
- **Precision: up to 6 decimal places.**
- "Allow negative numbers" option — **irreversible if negative values are stored.**
- In request forms, displays as Single-line text (format preserved on save).

### Percentage
- Precision: up to 6 decimal places.
- "Allow negative numbers" — irreversible if used.
- Display options: Number, Bar (default), Circle.
- **Show as choice only applies in table view.** Everywhere else (including lookup fields), shown as number + %.
- "Show as" CAN be changed when editing later (unlike many other field options).

### Currency
- Currency picker uses ISO codes.
- Precision: up to 6 decimal places.
- "Allow negative numbers" — irreversible if used.

### Checkbox
- Single boolean per record.
- Use for flags: completion, approval, binary attributes.

### Formula
- See formula-fields.md for details.
- Up to 20 formula fields per record type.
- 50,000 char expression limit.
- **Can reference fields up to 4 hops away** through connections (e.g., Activity → Campaign → Project → Budget).
- Cannot use Multi-select fields in formulas.
- Field names must match exactly (no Workfront text-mode syntax, no wildcards).
- Circular reference detection prevents save.
- Format options for result: Text, Number, Percent, Currency, Tags (good for arrays), Date.
- If result doesn't match format → error displays.

### People
- Type-ahead, can only add users already in Workfront instance.
- Primary job role + email shown next to name (email requires "View Contact Info" access).
- "Allow multiple values" — **irreversible if multi-user values are stored.**
- Displays as reference/connection field type in request form builder.

### Created by / Last modified by (read-only)
- Auto-populates with the user who created/last modified the record.

### Created date / Last modified date (read-only)
- Auto-populates with creation/modification date.
- Date format options same as Date field.
- "Include time" irreversible after save.

### Approved date (read-only)
- Populates only for records created via request form WITH approvers.
- Only the LAST approver's decision date is recorded if multiple approvers.

### Approved by (read-only)
- Populates only for records created via request form WITH approvers.
- If multiple approvers, names are comma-separated.

## SA notes / irreversibility gotchas
- Field type is locked in on save — plan field type choices carefully.
- "Allow negative numbers" on Number/Percentage/Currency: irreversible once negative data exists.
- "Include time" on date fields: irreversible once saved.
- "Allow multiple values" on People: irreversible once multi-user records exist.
- The 4-hop formula reach is powerful but creates hidden coupling — document formula dependencies separately, especially across record type boundaries.
- Multi-select cannot be used in formulas — common surprise. Use single-select for fields that need formula access.
