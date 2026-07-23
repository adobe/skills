# Configure Adobe Workfront Planning automations

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-records/configure-automations-to-create-records
Last update: April 1, 2026

## Access requirements
- Standard license
- Manage on workspace + record type
- **System Administrator** required for "Field value change" trigger automations

## Where automations live
- Configured per record type.
- Access: record type page → More → Manage automations.

## Two trigger types

### Button click
- Manual: user selects record(s), clicks the named button.
- Most common pattern. Customizable button label.

### Field value change
- Automatic: fires when conditions met.
- Up to 5 condition fields per automation.
- Eligible field types: Single-select, Multi-select, Single-line text, Paragraph, Number, Checkbox, Date.
- **Sysadmin-only** to create this kind of trigger.

## Six action types

### Create a single project
- Required: connected field where project displays.
- Optional: project template.

### Create multiple projects
- Required: connected field.
- Required: multi/single-select field whose CURRENTLY selected choices generate projects (one per selected choice).
- Optional: "Use the same template" toggle. Otherwise, per-choice template selection.

### Create portfolio
- Required: connected field + Workfront portfolio custom form (must pre-exist).

### Create program
- Required: connected field + parent portfolio + program custom form.

### Create group
- Required: connected field + group custom form.

### Create record (WFP record)
- Required: target record type + connected field on the new record type where the source record will show.
- Field mapping: Transfer from (source fields) → Transfer to (target fields). Types must match.
- Without field mapping, new records are named "Untitled record".

## "Add connected field" (when none exists)
- Auto-creates bidirectional connection fields:
  - On the target record type: a "Connected record" or "Connected <source>" field.
  - On the source record type: a field named after the target type.
- Same applies for Workfront object connections.

## Important constraints
- **Action cannot be changed after save.** You can re-create with a different action but cannot edit it on existing.
- **Field value change automations cannot be edited after save.** Only viewed or deleted.
- Button-click automations CAN be edited (except for the Action field).

## Disable vs Delete
- Disable: removes from record table view UI. Records created earlier remain connected.
- Delete: cannot be recovered. Existing connected records stay.
- Disabled → Activate to re-enable.

## SA notes
- Button-click is the recommended starting pattern: lets the human pick when to trigger, easier governance.
- Field-value-change automations are powerful but sysadmin-only and not editable after save — design carefully BEFORE creating. Treat them as production deploys.
- The "Create multiple projects" / "one per selected choice" pattern is the killer feature for fan-out: e.g., a campaign with selected channels (Email, Social, Web) → creates 3 child projects.
- For Workfront object creation, custom forms are not auto-attached for Projects — only for Portfolios/Programs/Groups. Plan a follow-up custom-form attach if needed.
- WFP-to-WFP record creation is the pattern for the Tactic→Activity hierarchy without going through Workfront execution.
- Always pre-stage custom forms before configuring portfolio/program/group automations — the picker requires them.
