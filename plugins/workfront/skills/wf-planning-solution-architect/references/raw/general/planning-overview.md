# Get started with Adobe Workfront Planning

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-general-information/planning-overview
Last update: Wed Apr 01 2026

Adobe Workfront Planning is an additional capability from Adobe Workfront. The purpose of Workfront Planning is to unlock comprehensive visibility into the operational details of an organization, and answer critical business questions at each stage of the work management lifecycle.

Questions WFP can answer:
- How many campaigns are we running in EMEA for Q4?
- Do we have any audience overlaps between concurrent campaigns?
- How well are the awareness programs doing right now?
- What do the assets look like for a particular campaign? Which of them must still be approved?

Main capabilities:
- Solve the problem of managing work across all stages and for all stakeholders.
- Fully customize workflows: decide what record types your organization uses and how they link.
- Link to object types from other systems for a coherent framework.

## Enabling WFP for users

After org purchases a WFP package, the Workfront admin must:
- Assign a layout template that includes Planning in the Main Menu to Light and Contribute users (Standard users and System Administrators have it by default).
- Assign users a Workfront license and WFP permissions to view or create objects.

## Terminology

Framework is fully customizable. Main objects/concepts:
- Workspaces
- Record types
- Records
- Workspace templates
- Fields
- Connected record types, records, and fields
- Lookup fields
- Hierarchies
- Views
- Automations
- Request forms

### Workspaces
Framework of an organizational unit. Collections of record types defining the operational lifecycle.

### Record Types
Object types in WFP. Populate workspaces. Unlike Workfront where types are predefined (Program, Portfolio, Project, Task, Issue), in WFP you create your own.

### Records
Instance of a record type. E.g., "Campaign" is a record type, "Summer Campaign for EMEA" is a record.

### Workspace templates
Predefined templates: Basic Marketing Management, Advanced Marketing Management, Enterprise Marketing Management, Sales Management, Product Management.

### Fields
Attributes added to record types. Considerations:
- Fields automatically associated with all records of that type.
- Display as columns in Table view.
- Unique to a record type, do not transfer between types.
- Accessible only in WFP, not from Workfront.

Predefined default fields on new record type: Name, Description, Start Date, End Date, Status.

Custom field types:
- Single-line text, Paragraph, Multi-select, Single-select, Date, Number, Percentage, Currency, Checkbox, Formula, People, Created by, Created date, Last modified by, Last modified date, Approved by, Approved date, Record ID.

### Connected record types, records, fields
Can connect:
- Two WFP record types.
- Record type and a Workfront project, program, portfolio, company, or group.
- Record type and an AEM asset or folder (requires AEM license).
- Record type and an Adobe GenStudio for Performance Marketing Brand (requires GenStudio license).

After connecting types, you can connect individual records. Connection displays as a connected record field.

### Lookup fields
After connecting record types and connecting records, you can reference fields from connected records.
Example: Campaign connected to Workfront Project → show Project's Budget on Campaign records.

Cannot add as lookup fields:
- Created by, Last modified by
- Workfront typeahead fields (Project Owner, Project Sponsor)
- People (in Production; available in Preview)

### Hierarchies
Organize connections into parent-child relationships. Up to 4 object types per hierarchy.
If a connection between two record types doesn't exist, it can be created as you set up the hierarchy.
Hierarchies generate breadcrumbs in record headers.

### Views
View types per record type page:
- Table view (default): rows are records, columns are fields.
- Timeline view: requires records to have at least 2 Date fields. Up to 5 connected record types shown.
- Calendar view: requires records to have at least 2 Date fields.

### Automations
Configure automations that create records when triggered from a Planning record. Created records auto-connected to triggering records.
Example: Trigger from a WFP Campaign → create a Brand and auto-connect.

### Request forms
Create a request form, associate with a record type. Share with others to submit requests that create records.

## Locating WFP

Workfront → Main Menu → Planning.

## Additional features (linked from this page)
- WFP AI Assistant
- WFP modules for Workfront Fusion
- WFP API basics
- WFP and GenStudio integration
- WFP reporting via Workfront Canvas Dashboard
