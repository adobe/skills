# Primary field overview

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-fields/primary-field-overview
Last update: Thu Jul 17 2025

## Core concept
The primary field is the field displayed in the first column of a record type's table view. Its value also serves as the record's title.

"Primary field" and "record title" are synonymous; primary field is preferred in table-view contexts.

## Eligibility
Default: Name field is primary.
Can be reassigned to any field of these types:
- Single-line text
- Number
- Formula

## Where the record title displays
- Header of record page and preview box
- Connected record fields
- Views

## Behaviors and constraints
- Primary field is **locked** — cannot be moved, hidden, or deleted in the table view (unless another field is designated primary first).
- Primary field is NOT part of horizontal scroll — always visible on the left.
- Changing the primary field in your table view changes it for ALL users who use that view.
- Changing the primary field affects ALL table views of the record type.
- Primary field value is always hyperlinked to the record's page.
- Edit primary field value with Contribute+ permission on workspace + record type.
- Exception: Formula primary fields cannot be edited inline (calculations update automatically).

## Reassignment procedure
- Done via the table view configuration (see manage-the-table-view).

## SA notes
- Picking a primary field is consequential: it dictates record identity in every other view and connection picker, AND it's locked-by-default visible. Plan it before bulk record creation.
- Unique primary field values are essential for connection pickers — when users select a record to link, they search by primary field. Duplicates cause confusion.
- Formula-type primary fields are powerful for derived identifiers (e.g., "FY26-EMEA-Q1-Brand") but cannot be edited inline. Useful when an identifier is composed from other fields.
- Changing the primary field globally on a record type is a high-impact action — every user's table view changes. Coordinate with workspace stakeholders before reassigning.
