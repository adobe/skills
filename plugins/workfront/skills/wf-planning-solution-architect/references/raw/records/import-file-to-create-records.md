# Create records by importing information from a CSV or Excel file

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-records/import-file-to-create-records
Last update: Thu Oct 16 2025

## Access requirements
- Standard license
- Contribute+ on workspace + record type
- Manage on workspace to also import new select-field choices

## File constraints
- **Max 25,000 rows**
- **Max 500 columns**
- **Max 5MB file size**
- Empty sheets unsupported
- Excel files: only one sheet imported per import (chosen during preview)

## Mapping mechanics
- Column headers map to record type fields
- Each row becomes a new record
- Preview shows first 10 rows

## Field types NOT supported in import (cannot be mapped)
- Connection fields to Workfront and AEM Assets object types (only Planning record type connections are supported)
- Lookup fields (from any connected types)
- Formula fields
- Created date, Created by
- Last modified date, Last modified by
- Approved date, Approved by
- People

## "Create missing options" toggle
- When importing single/multi-select data with choices NOT already in WFP, this option adds them.
- Manage on workspace required.
- Without Manage: import proceeds but missing choices are silently dropped. Warning displayed: "The choices that do not exist in connection, single- or multi-select fields will not be added".

## Outcome
- New records appended to the bottom of the table view.
- New choices added to single/multi-select fields if "Create missing options" was on.
- Visible to everyone with workspace access immediately.

## SA notes
- This is the primary path for bulk-loading WFP from spreadsheets (e.g., migrating from a tracker spreadsheet to WFP).
- The 25K-row / 5MB limit per import is the practical migration ceiling per record type — for larger migrations, batch the import.
- Cannot import People-type values via CSV. For owner / assignee data, plan separate post-import update via UI or API.
- Cannot import lookup or formula values — these recalculate from referenced data. Plan the order: import the source records first, set up connections, THEN import dependent records.
- Cannot import Connection fields to Workfront/AEM. For those connections, run a Fusion or API step after the CSV import.
- For Planning-record-type connection fields, the value must reference the linked record's primary field — confirm uniqueness before importing.
