# Connect records

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-records/connect-records
Last update: Mon Mar 02 2026

## What you can connect
- WFP records to WFP records
- WFP records to Workfront objects: Projects, Portfolios, Programs, Companies, Groups
- WFP records to AEM Assets: Image files, Folders

## Access requirements
- Standard license
- Contribute+ on workspace + record type to connect
- View+ on workspace + record type to view connections (regardless of access to the other app)
- View+ on the target objects in their native app (Workfront/AEM)

## Prerequisites
- Workspace + record type + at least one record exist
- Record-type-level connection already configured (see Connect record types in architecture section)
- For AEM: AEM Assets license + Adobe Business Platform/Admin Console onboarding
- For GenStudio Brands: GenStudio for Performance Marketing license

## Where you can connect (UI areas)
- Connected record fields in table view
- Record's preview box → Details tab
- Record's preview box → Connections tab
- Record's page → Connected records page tab

## Mechanics

### Click to connect
- Click inside a connected field → list opens
- Click target record name OR type and select from suggestions
- Record added automatically

### One-to-one / One-to-many warning
- If connection type is 1:1 or 1:many and target is already linked elsewhere, warning prompts: connecting will REMOVE from original connection.

### Create on the fly
- "+ Add" button → creates and connects new record on the target record type in one step.

### "See all" / Connect objects box
- Lets you bulk select multiple records to connect.

## Workfront object connections
- Cannot connect Workfront objects → WFP records from the Workfront side. Connections must originate from WFP.
- Once connected, ALL users with workspace View can see the Workfront object info, REGARDLESS of their Workfront access. Important data governance point.
- Workfront object date fields display in 24hr format in WFP (e.g., 3:00 PM → 15:00).
- Workfront typeahead/People-type fields (e.g., Project Owner) cannot be added as lookup fields in Production (Preview only).

## AEM Assets connection
- Asset details popup shows: thumbnail, filename, dimensions, size, description, file path, asset type, created/modified dates.
- Open in AEM icon → goes to native asset view.
- Once connected, ALL WFP workspace users can view connected assets regardless of AEM access.

## Lookup field editing post-connection
- Hover lookup field column header → drop-down → "Edit lookup fields"
- Add/remove from "Unselected fields" / "Selected fields"
- Removing a lookup field strips it from the WFP record but data remains in source app.

## Disconnect
- Hover connected card → "Disconnect record" icon
- Disconnects immediately. Lookup field values are cleared too.
- Same record removed from all areas of WFP where the connection showed.

## Connection from Workfront side (via Planning section)
- Workfront admin needs to:
  - Add "Planning section" to Project/Portfolio/Program Layout Template
  - OR add "Planning connections" custom field to a custom form (works on Project, Portfolio, Program, Group, Company)

## SA notes
- The "WFP sees through" pattern is the most important governance insight: once a Workfront object is connected to a WFP record, WFP workspace users see Workfront fields they may not otherwise be authorized to see in Workfront. Treat connection-field setup as a permission-boundary decision.
- 1:1 and 1:many connections silently relocate records — for "single owner" semantics, this is intentional, but expect surprised users if they don't realize.
- Lookup field add/remove is the most-used flow post-connection. It's the lever for "what info from the connected record do we surface here?"
- AEM connections require enterprise onboarding (Unified Experience / Admin Console). Common pre-implementation gate.
- The "no inverse from Workfront" rule shapes integration architecture: if you want bidirectional sync, set up the WFP-side connection AND a custom form / Planning section on the Workfront side.
