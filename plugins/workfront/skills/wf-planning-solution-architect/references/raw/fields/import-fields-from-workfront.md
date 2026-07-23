# Import fields from Adobe Workfront

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-fields/import-fields-from-workfront
Last update: April 1, 2026

## What it does
Creates COPIES of existing Workfront fields on a WFP record type.

**Critical**: copies are INDEPENDENT from the originals. They do NOT share data or sync.

## Compatible source objects
Native or custom fields from:
- Portfolio, Program, Project, Task, Issue
- Document, Company, Group, User, Job Role
- Assignment, Hour, Billing Record, Expense, Iteration

## Field type translation

| Workfront field | WFP field |
|---|---|
| Text-formatted single-line text | Single-line text |
| Number-formatted single-line text | Number |
| Currency-formatted single-line text | Currency |
| Paragraph | Paragraph |
| Text with formatting | Paragraph |
| Single-select dropdown | Single-select |
| Multi-select dropdown | Multi-select |
| User typeahead (filters not supported) | People |
| Calculated* | Formula |
| Date | Date |
| Checkbox group | Multi-select |
| Radio button | Multi-select |

(*) Calculated fields support is "coming at a later date". All other Workfront field types NOT supported.

## Filter options on import
- Filter by Object type
- Filter by Custom form (can select multiple, with or without an object type)

## Limits
- 500 fields per record type cap STILL APPLIES; imported fields count.

## SA notes
- "Independent copies" is the key SA insight: this is a one-time clone, NOT a sync. For live data, use connection lookup fields instead.
- The radio-button-and-checkbox-group → multi-select translation can surprise teams expecting single-value behavior on radios. Confirm with users post-import.
- User typeahead filter loss can break business logic — review carefully.
- This feature is most useful for "starting WFP record types from Workfront patterns", not for ongoing data integration.
