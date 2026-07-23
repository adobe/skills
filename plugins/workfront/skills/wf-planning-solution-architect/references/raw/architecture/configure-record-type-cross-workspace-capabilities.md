# Configure cross-workspace capabilities for record types

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-architecture/configure-record-type-cross-workspace-capabilities
Last update: Thu Mar 12 2026

## License requirements (Production)

### To make a record GLOBAL
- Standard or higher

### To make a record CONNECTABLE
- System Administrator (in Production)
- Standard can do connectable to specific workspaces in Preview environment

## Configure global record type

1. Open Edit record type → Cross-workspace settings tab.
2. Enable "Allow adding this record type to other workspaces".
   - Once added to another workspace, this setting CANNOT be disabled.
3. In "Select who can add this record type to workspaces they manage":
   - Add users, groups, teams, roles, companies.
   - Must designate at least one entity to enable.
   - Your own name auto-included; can remove after save.
4. Save.

### Effects
- Card shows global record type icon (no arrow).
- A system field `Workspace` is added to the record type's table view + record details.
  - Read-only, undeletable.
  - Shows the workspace from which each record was created.
  - Empty value = record came from a secondary workspace where the global type was later deleted.
- Original workspace can see all workspaces where the type is used in "Workspaces where this record type is used" section (with workspace owner names).

### Secondary workspace appearance
- Same global icon but with an arrow added; hover shows source workspace name.

## Configure connectable record type

1. Open Edit record type → Cross-workspace settings tab.
2. Enable "Allow connecting to this record type in other workspaces".
3. Choose scope:
   - **All workspaces**: only sysadmin can enable. Standard users see this option dimmed.
   - **Specific workspaces**: pick from a list. Workspace managers with Standard license can do this.

### Effects
- Card shows connectable record type icon.
- Type can now be selected when creating connection fields in the designated workspaces.

## SA notes
- Global flag is sticky once used. Plan its setup carefully.
- Connectable scope matters: "All workspaces" is sysadmin-only; for federated team setups, specify workspaces explicitly to avoid uncontrolled cross-team coupling.
- The `Workspace` system field on global types is the audit trail for "where did this record come from".
