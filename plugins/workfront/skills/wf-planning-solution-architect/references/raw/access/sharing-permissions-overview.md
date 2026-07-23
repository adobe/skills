# Overview of sharing permissions in Adobe Workfront Planning

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-access/sharing-permissions-overview
Last update: Wed Jan 07 2026

## What can be shared manually
- **Workspaces**: sharing also shares all record types, records, fields. Views are NOT included.
- **Record types**: inherit workspace permissions. Can be granted lower than workspace, NOT higher.
- **Views**: shared separately. Sharing includes filters, grouping, sort, settings. Does NOT share the records.
  - Public link: external users without a Workfront account can view all records and fields, including connected ones.

## What inherits automatically (no manual sharing)
- Records: from record type
- Fields: from record type

## Critical constraint: Adobe Admin Console
- If org is on Adobe Unified Experience, target user must be in Adobe Admin Console.
- Workfront-only users not in Adobe Admin Console cannot receive Planning shares.

## Internal sharing entities
- Users, groups, teams, companies, job roles
- **Limit: 100 entities per Planning object.**

## Sharing links
- Internal: must be active Workfront users; login required.
- Public (views only): no Workfront account needed.

## Permission matrix

### Workspace
| Action | Manage | Contribute | View |
|---|---|---|---|
| Edit | ✓ | | |
| Share | ✓ | | |
| Delete | ✓ | | |
| View | ✓ | ✓ | ✓ |

### Record type (inherited from workspace, can be reduced)
| Workspace perm | Auto-inherited record type | Possible reduced perms |
|---|---|---|
| Manage | Manage | Manage, Remove permissions |
| Contribute | Contribute | Contribute, View, Remove permissions |
| View | View | View, Remove permissions |

Rules:
- Cannot grant higher record type permission than workspace permission.
- Cannot reduce workspace managers' record type permission.
- Removing record type permission does NOT remove View on workspace/types — users retain workspace view.

### Records (inherited from record type)
| Action | Manage | Contribute | View |
|---|---|---|---|
| Create | ✓ | ✓ | |
| Delete | ✓ | ✓ | |
| Edit | ✓ | ✓ | |
| View | ✓ | ✓ | ✓ |

### Record fields (inherited from record type)
Field-level perms refer to FIELD structure, NOT values. Edit values needs record edit.

| Action | Manage | Contribute | View |
|---|---|---|---|
| Create | ✓ | | |
| Delete | ✓ | | |
| Edit | ✓ | | |
| View | ✓ | ✓ | ✓ |

### Views

#### Internal sharing
| Action | Manage (invited) | View (invited) | Everyone in workspace can view* |
|---|---|---|---|
| Edit | ✓ | | |
| Delete | ✓ | | |
| Share | ✓ | | |
| View | ✓ | ✓ | ✓ |
| Apply | ✓ | ✓ | ✓ |

(*) Users still need View+ on workspace.

#### Public sharing
| Action | View |
|---|---|
| View | ✓ |
| Apply | ✓ |

## License interaction
- Only Standard (or Plan) license users can have Contribute or Manage on workspaces, or Manage on views.
- All other license types are capped at View.

## SA notes
- Sharing limit of 100 entities is per object. For workspaces serving many teams, use groups/teams aggressively, not individual users.
- The IMS / Admin Console requirement is a hard gate. Migration planning for legacy Workfront-only users is required.
- Views are the one piece that escapes via public sharing. Educate teams on what is exposed in a view before they make a public link.
- Connection lookup fields expose source-system data — this article reinforces that lookup field values are visible to anyone with View on the workspace regardless of source system access.
