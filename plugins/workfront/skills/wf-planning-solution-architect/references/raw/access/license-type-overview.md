# License type overview when using Adobe Workfront Planning

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-access/license-type-overview
Last update: Fri Dec 12 2025

License type sets the CEILING of permissions a user can be granted.

## Standard license
- Can manage workspaces, record types, and views.
- Can create, edit, delete workspaces, record types, records, fields, and views.
- System Administrators get Manage on all workspaces, including ones they didn't create.

## Light or Contributor license
- Can VIEW workspaces shared with them and their record types, records, fields.
- Can VIEW views shared with them. Cannot create their own.
- Cannot create, edit, or delete any Planning objects.
- Can apply temporary filters/sorts/groupings to views they can access.

## Workspace & record type permission ceilings
- Standard: View, Contribute, Manage
- Light/Contributor: View only (Contribute/Manage are visibly dimmed in the sharing UI)
- System Admins: View on all (don't need explicit share)

## Views permission ceilings
- Standard: View, Manage
- Light/Contributor: View only
- System Admins cannot access views they didn't create unless shared.

## Record type permission inheritance rules
- Inherited from workspace by default.
- Manage workspace → cannot be reduced on record type below Manage.
- Cannot grant higher record type permission than workspace permission.
- Removing record type permission does NOT remove workspace View.

## SA notes
- Plan license footprint: Standard count drives how many users can actually CREATE structure.
- Light/Contributor is the "consumer" tier — fine for read-only campaign visibility, but they can't even author personal views.
- Sysadmin paradox: sysadmins have full workspace access but zero view access by default — for org-wide reporting, views must be explicitly shared with sysadmins.
