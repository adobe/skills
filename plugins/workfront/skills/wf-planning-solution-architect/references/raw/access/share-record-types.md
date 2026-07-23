# Share record types

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-access/share-record-types
Last update: Wed Jan 21 2026

## Key principles
- Workspace permissions automatically grant the same level on record types ("Inherited permissions" on by default).
- Sharing a view does NOT grant record type permissions. Only workspace sharing does.
- Permissions on a record type CAN be lowered relative to workspace, but cannot be raised.
- Cannot remove a user from a record type without removing them from the workspace; they always retain at least View if they have workspace View.

## Workspace manager protection
- Users with Manage on workspace ALWAYS retain Manage on record types, even when Inherited permissions are turned off.

## What sharing a record type lets you do
- Grant View-only access to a brand-new user (who has no workspace perms) — this auto-grants View on workspace too.
- Make a record type view-only for the workspace (Disable Inherited permissions on record type — workspace contributors become viewers of THAT record type only; workspace managers keep Manage).
- Lower a contributor's perm to View on a specific record type.

## What you CANNOT do
- Cannot grant higher permission on record type than workspace permission.
- Cannot remove access entirely from a record type while the user still has workspace access.
- Cannot give workspace managers less than Manage on any record type.
- Cannot share externally.

## Where sharing happens
- Card → More → Share
- OR record type page → Share button → "Share the record type"

## Inherited permissions toggle
- Default: ON. List of inherited entities shown (not removable individually).
- Disable: switch the record type to opt-in mode. Workspace managers keep Manage. Other users default to no access on the record type until explicitly added.

## Permission options on share
- View
- Contribute (only if workspace permission allows)
- Manage (only if workspace permission is Manage)

## Sysadmin behavior
- Sysadmins receive Manage on record types shared with them. Indicator displays user is sysadmin.

## Global record types
- Shareable from both original AND secondary workspaces.

## Notifications
- Recipients get in-app + email when shared.
- **NO notification** on removal.
- When granting record type access to a user without workspace access, they get a second notification confirming workspace View.

## SA notes
- The "Disable Inherited permissions" pattern is the granular tool for confidential record types (e.g., a sensitive Budget taxonomy in an otherwise open workspace). Workspace managers always retain Manage; pick who else gets in.
- Watch for permission inflation: every record type share to a user without workspace access auto-creates a workspace View. Cumulative View grants add up to the 100-entity-per-object cap on the workspace.
