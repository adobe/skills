# Manage the GenStudio workspace in Adobe Workfront Planning

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/planning-and-genstudio-integration/manage-gen-studio-workspace-in-planning
Last update: April 1, 2026

This is the operational counterpart to the integration overview. Covers the actual permission scoping rules and edit constraints when working in the GenStudio workspace.

## Permission scoping summary

| Org topology | Workfront admin gets | All other users get |
|---|---|---|
| Single Workfront instance | Manage on GenStudio workspace | Contribute |
| Multiple Workfront instances | Contribute (NOT Manage) | Contribute |

Multi-instance customers lose admin Manage access. To grant Manage in a multi-instance setup, the System Admin must do it explicitly.

## Sharing the GenStudio workspace
Three rigid rules:
1. Cannot remove GenStudio users after sharing — once granted access, they keep it.
2. GenStudio-licensed users cannot be downgraded to View on the GenStudio workspace — minimum is Contribute.
3. Cannot disable inherited permissions on GenStudio record types within the workspace.

## What "Manage record types" surfaces in GenStudio workspace
- Edit record type (rename, icon, advanced settings).
- Manage automations (yes, automations work on GenStudio record types).
- Manage request forms (multiple per record type; can be public or link-shared).
- Share record type / view / export view.

## Fields in GenStudio record types

### Adding Planning-side fields
- Requires Manage in Planning AND Manage in GenStudio.
- Visible in: Planning views, Planning record details, GenStudio record details.
- NOT visible in: GenStudio list view.

### Editing existing GenStudio fields
- Requires Manage in Planning AND Manage in GenStudio.
- Settings can be edited but the GenStudio field itself cannot be deleted from Planning.

### Hiding fields
- Even Contribute users can hide fields in their Planning table view (visual only — doesn't affect other users or GenStudio).

## Record CRUD constraints
- Add: any view, CSV/Excel import, request form. Records appear in GenStudio immediately.
- Edit: inline in table or via Details page. Real-time sync.
- Delete: from table; lands in Recently Deleted bin (Planning side, 30 days). Removed from GenStudio immediately.
- Restore from bin: returns the record to BOTH systems.
- **Activations: NO add, NO delete from Planning.** Only edit and view.

## Connection capabilities (from this page)
Plus icon → Fields | Connections. Connections can be made to:
- Any GenStudio record type to Brands (Products/Personas connected by default).
- GenStudio record type to other GenStudio record types.
- GenStudio record type to any Planning record type (with proper config).
- GenStudio record type to Workfront objects, AEM Assets objects.

## SA notes
- **The multi-instance permission downgrade is the single most surprising governance behavior.** A Workfront admin who has Manage everywhere else loses it on the GenStudio workspace if there are multiple Workfront instances under the IMS org. Plan for this BEFORE rolling out multi-instance setups.
- **"Cannot remove GenStudio users after sharing" applies even if you delete-and-re-share the workspace.** Once a GenStudio user has been in scope, they stay in scope. This is a deliberate guardrail.
- The constraint that GenStudio-licensed users cannot be downgraded to View seems counterintuitive — but the rationale is that GenStudio users need to be able to act on records they manage in their primary tool. Don't let customers fight this; redirect them to manage scoping on the GenStudio side.
- **Activation records being read-only-from-Planning** means any data-cleanup or migration workflow that uses Planning as the orchestration tool cannot touch Activations. Surface this in early architecture conversations to avoid late discovery.
- **Field hiding works for Contribute users** — useful in shared workspaces where individual users want streamlined views without admin involvement.
- The default Brand connection on Products and Personas is auto-added for workspaces created after Q1 2026. Older workspaces need manual addition — check this when troubleshooting "where's the Brand field?"
