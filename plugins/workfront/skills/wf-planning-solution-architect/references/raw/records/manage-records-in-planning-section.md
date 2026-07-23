# Manage record connections from Workfront objects

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-records/manage-records-in-planning-section
Last update: Thu Oct 16 2025

## Two areas to view WFP records from Workfront
1. **Planning section** of a Workfront object: shows ALL connected record types and their connected records (Project, Portfolio, Program only)
2. **Planning connection custom field**: shows ONE record type, its records, and up to 7 lookup fields (Project, Portfolio, Program, Group, Company)

## Access requirements
- Standard license
- View+ on Workfront object (Project/Portfolio/Program)
- View+ on WFP workspace to view; Contribute+ to connect/disconnect

## Prerequisites
- Record types must already be connected to Workfront object types (architectural step done in WFP).
- "Create corresponding field on the linked record type" setting must be ON when establishing the connection (otherwise nothing displays).
- Workfront/group admin must add Planning section to layout template, OR add Planning connection field to a custom form.

## Planning section behavior
- Available on: Project, Portfolio, Program.
- Shows all WFP record types connected to the object.
- "Show all connections" toggle reveals record types without connected records (hidden by default).
- Disconnect from here also removes Workfront object from WFP record's connection field and clears lookup field values.
- Records still saved automatically when fields edited from preview.

## Planning connection field type behavior
- Available on: Project, Portfolio, Program, Group, Company.
- ONE record type per Planning connection field; unlimited fields per form.
- Display modes:
  - If only primary field selected: multiple-value field display
  - If lookup fields selected (up to 7): read-only table display
- **Cannot bulk-edit Planning connection fields** in Workfront's bulk-edit UI.
- A Planning connection field rejects records from wrong object type — warning shown if attempting to add records from a field configured for a different Workfront object.

## SA notes
- The "Planning section" is Adobe's recommended way to surface ALL connected planning context on a Workfront object. Lower-friction than per-field custom forms.
- The Planning connection custom field is the right choice when you want curated, single-record-type visibility on specific Workfront object forms (e.g., Campaigns visible on Project custom form for execution teams).
- "Create corresponding field on linked record type" must be ON at connection-creation time — easy to miss. Validate during workspace architecture review.
- Cross-object permissioning paradox: WFP workspace View grants visibility to ALL connected Workfront object data, regardless of Workfront permissions. Important for sensitive data handling.
- Planning section is read-write for connections; Planning connection field in a table form is read-only display of lookup fields (you can still connect/disconnect from the picker).
