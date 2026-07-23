# Cross-workspace record types overview

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-architecture/cross-workspace-record-types-overview
Last update: Thu Mar 12 2026

## Package requirements

### Connectable record types
- Any Workfront + any Planning, OR
- Any Workflow + Planning Prime or Ultimate

### Global record types
- Any Workfront + Planning Plus, OR
- Any Workflow + Planning Prime or Ultimate

## Two cross-workspace capabilities

- **Global**: a record type can be ADDED to other workspaces (the same type appears in many places).
- **Connectable**: a record type can be CONNECTED TO from other workspaces (linkable target across spaces).

## Global record types — primary (original) workspace properties

- Edit, share, delete, set connectable, manage request forms, manage automations — only from primary workspace.
- Can only delete from primary after all secondary instances are deleted.
- Records visible in primary:
  - Records added in primary
  - Records added in any secondary workspace ("roll up" to primary)
- Members of primary get View on rolled-up records, **even if they have no permissions on the secondary**.
- Permission to rolled-up records:
  - Records made in primary: same perms as on workspace and the type
  - Records made in secondary: same perms as on the secondary workspace and the type there
- **Connected types follow**: if the global type was connected to another type (e.g., Campaign ↔ Regions), then Regions becomes cross-workspace connectable from secondary workspaces where Campaign is added.
- Fields created on the global type are visible everywhere. Settings are read-only in secondary workspaces. Only original workspace managers edit field settings.

## Global record types — secondary workspace properties

### Permissions inherited from secondary workspace
- Contributors → Contribute on the global type (add and manage records).
- Viewers → View only.
- Managers can additionally: delete (from this secondary only), share, share views internally only.

### Cannot from secondary
- Edit appearance, cross-workspace flags, or original-workspace fields.
- Create/manage request forms.
- Create/manage automations.
- Share views publicly (only the original workspace allows public view sharing for global types).

### Delete behavior in secondary
- Removes type from this secondary only.
- Records added FROM this secondary are deleted from the secondary AND the primary.
- Records added from OTHER secondaries remain in their secondary and the primary.
- The type stays in primary and other secondaries.

### Record visibility cross-workspace
- Records made in a secondary workspace are visible from:
  - The secondary where created
  - The primary (rollup)
- If you have Manage on primary but no access to secondary, you can view secondary-created records in primary but cannot manage them there.
- If you have Manage on both primary and secondary, you can manage in both.

## API behavior for global record types
- When adding a record via API from a secondary workspace context: system checks user access to the **original** workspace.
- If user has access → record is created in the original workspace.
- If not → returns error: user must specify a workspace ID where they have access.

## Connectable record types

- Workspace manager designates which workspaces the type is connectable from.
- ONLY sysadmins can designate a type connectable from ALL workspaces in the system.
- The connectable record type still lives only in its original workspace.

## SA notes
- **Global vs connectable**: global = same type appears in many places (records pool); connectable = type stays put but other workspaces can link to it.
- Use connectable for taxonomies that should remain singular (Regions, Brands).
- Use global when distributed teams need their OWN records of the same type with a rolled-up view in a central workspace.
- Cross-workspace work is package-gated (Plus / Prime / Ultimate) — model accordingly.
- Big footgun: deleting global type secondary instances deletes the records from primary too. Educate workspace managers explicitly.
- Field control is centralized at the primary workspace. Don't let secondary workspace managers expect to add custom fields — they can add fields in secondary, but original-workspace fields are read-only there.
