# Create objects using Workfront Planning record automations

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-records/create-wf-objects-using-planning-automations
Last update: April 1, 2026

## What can be created via automation
- Workfront Planning record
- One or multiple projects
- Group, Program, Portfolio

## Access requirements
- Standard license
- Contribute+ on workspace + record type
- Edit access to create the target Workfront object type
- Manage on parent Workfront object (e.g., Portfolio) to add children (Programs/Projects)

## Naming patterns

### Single object creation
- New object inherits the source record's name.

### Multi-project creation
- Pattern: `[ Name of the record ] Name of the field choice`
- Example: Campaign "Summer breeze" with multi-select Region (EMEA selected) → project "[ Summer breeze ] EMEA".

## Trigger behavior
- Does NOT overwrite existing objects in the connected field.
- Re-running the same automation adds MORE objects to the connected field (cumulative).
- Bidirectional: source record is added to the new object's connected field automatically.

## Usage flow (Button click automation)
1. Open record type table view.
2. Select one or more records (checkbox).
3. Action bar appears at bottom with automation buttons.
4. Click the automation button.
5. Confirmation message at bottom of screen.
6. Refresh page to see new objects in the connected field.

## SA notes
- Cumulative-not-overwrite behavior is sensible but can cause confusion: users running the same button multiple times can get duplicate projects. Educate or use field-value-change triggers for "create once" semantics (sysadmin-only).
- Multi-project creation from select fields is the killer feature for fan-out — see the "Create multiple projects" pattern in configure-automations-to-create-records.md.
- Always verify post-automation that the connection was set correctly. Edge cases (deleted target fields, missing custom forms) can produce silent failures.
- The naming pattern `[ record ] field-choice` is non-customizable — for branded naming conventions, you'll need to post-process via Fusion or rename manually.
