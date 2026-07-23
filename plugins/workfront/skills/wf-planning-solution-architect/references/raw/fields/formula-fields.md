# Formula fields overview

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-fields/formula-fields
Last update: Thu Oct 16 2025

## Core mechanics
- Formula fields generate values by combining other fields + functions.
- Reference fields on the same record type, OR on connected record types (with permissions to view those types).
- Field type CANNOT be changed after save.
- Calculation CAN be updated post-save; results auto-update for all records.
- Reference fields using their interface-display names (no text-mode syntax, no wildcards).
- Only fields visible in table view or record details can be referenced.

## Format options
- Text, Number, Percent, Currency, Tags (best for arrays), Date

## Update propagation
- Formula fields can reference OTHER formula fields.
- Cascading update: when a value updates, all downstream formula/lookup fields update automatically.
- Alert displays when:
  - Editing a formula that has dependent formula or lookup fields (lists dependents, asks to continue).
  - Deleting a field used in a formula expression or lookup (lists dependents, asks to continue).

## Limits
- **Max 20 formula fields per record type** (formula lookup fields from connected types do NOT count against this limit).
- Expression max 50,000 characters.
- Can reference fields up to 4 hops away through connections.

## #ERROR! conditions
- Field used in formula is deleted.
- An aggregated lookup field referenced contains #ERROR!.
- Value cannot be cast to selected format (e.g., Number format but referenced field is non-numeric text).

## Workfront expressions NOT supported in WFP
- ADDHOUR
- SWITCH
- FORMAT

## WFP-only expressions (NOT available in standard Workfront calculated fields)

### ARRAYJOIN
- Concatenates array elements by delimiter.
- Syntax: `ARRAYJOIN(delimiter, array)`

### ARRAYUNIQUE
- Returns array with unique values.
- Syntax: `ARRAYUNIQUE(array)`

### ID
- Returns the unique record ID.
- Syntax: `{ID}`

### JSONELEMENT
- Returns data from JSON by JSONPath. Empty if path doesn't exist.
- Syntax: `JSONELEMENT(JSONString, JSONPathString)`

### SETTIMEZONE
- Sets timezone of a date/time value.
- Syntax: `SETTIMEZONE(date, 'America/Los_Angeles')`

### WEEKOFYEAR
- Returns the week number in a year.
- Syntax: `WEEKOFYEAR(date, 2)` (2 = Monday) OR `WEEKOFYEAR(date)` (defaults to Sunday).

## SA notes
- The 4-hop cross-connection reach + 50K char expression budget makes formula fields surprisingly powerful — they can do complex rollups within a record type without external automation.
- Formula chains (formula → formula → formula) update automatically but can be hard to debug. Document them in a separate inventory.
- JSON parsing via JSONELEMENT is useful for ingesting JSON-shaped data from connected integrations or API calls.
- ARRAYJOIN + connected record multi-select fields = formatted text rollup of linked records. Common pattern for executive summaries.
- ADDHOUR not being supported means time arithmetic must use raw minutes/seconds or other math.
