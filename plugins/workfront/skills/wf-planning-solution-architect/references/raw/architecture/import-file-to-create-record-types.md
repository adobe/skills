# Create record types by importing CSV/Excel

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-architecture/import-file-to-create-record-types
Last update: Tue Dec 02 2025

## How import works
- Each sheet of Excel = a record type. Sheet name = type name.
- Single sheet or CSV: file name = record type name.
- Column headers = fields.
- Each row = a record.

## Import limits
- 25,000 rows per sheet
- 500 columns per sheet
- File size ≤ 5MB
- Empty sheets not supported

## Field types NOT supported in import
- Connection fields to Workfront / AEM Assets / GenStudio Brands
- Lookup fields from connected Planning records, Workfront, AEM Assets, GenStudio Brands
- Formula fields
- Created date / Created by
- Last modified date / Last modified by
- Approved date / Approved by
- People

## Mapping options on import
- Field tab: rename, change field type, update description
- Connection tab: map to fields from existing WFP connected record types
  - NOT possible: map to Workfront, AEM, or GenStudio connections

## Notes for SA
- Import is fast onboarding path but can't bring in cross-system connections — those have to be added after.
- After import, everyone with access to the workspace can view/edit imported record types.
