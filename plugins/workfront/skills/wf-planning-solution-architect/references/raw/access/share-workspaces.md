# Share workspaces

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-access/share-workspaces
Last update: Mon Mar 02 2026

## Access requirements
- Standard license
- Manage permission on workspace (sysadmins on all)

## Key facts
- Sharing a workspace shares all its record types, records, and fields. Views are NOT shared.
- Cannot share outside the organization.
- Target must be in Adobe Admin Console (IMS), except groups/teams/companies/job roles.
- Workspace permissions display as "Inherited permissions" on record types.

## Share modes (depending on access level)

### System Administrator options
- "Only invited people can access" (default)
- "Everyone in the system can view" — all Planning users see workspace in their Workspaces area

### Standard workspace manager
- Can see which global mode is set, but cannot CHANGE it.
- Must ask sysadmin to change global mode.

## Sharing flow
1. Open workspace → Share button (top-right)
2. Pick entity (user/group/team/company/job role)
3. Choose permission level: View / Contribute / Manage
4. Optional: Copy link (recipients must be active Workfront users and login)
5. Save → recipients get in-app + email notification

## Permission request approval
- Workspace managers receive in-app + email notification of pending requests.
- "Pending access requests" box shows list with per-user permission picker.
- Approve all / Deny all → approved users added; requesters get email confirmation.

## Removing permissions
- Remove via Share box drop-down.
- **NO notification** to removed users.

## SA notes
- Make sysadmin global mode "Everyone in the system can view" sparingly — applies to ALL records in the workspace.
- The "no removal notification" pattern is consistent across all WFP shares — design offboarding ceremonies separately.
- For enterprise: prefer sharing with teams/groups, not individuals, to keep the 100-entity cap healthy and to align WFP perms with HR-managed groups.
