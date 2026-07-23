# Share views

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-access/share-views
Last update: Wed Jan 21 2026

## Key constraints
- Granting workspace permissions does NOT grant view permissions.
- Granting view permissions does NOT change view access to records (records inherit from workspace).
- Sharing a view shares ALL its elements (filters, grouping, sort, settings).
- Manage permission on a workspace is required to share views publicly.
- Public sharing is BLOCKED for views on global record types in their secondary workspace.

## Share modes
1. **Internal** — Workfront users, groups, teams, companies, job roles
2. **Public** — anyone with the link, no Workfront account needed, time-limited
3. **Copy link** — copy a URL to share via comment/email/etc. (recipient still needs explicit perms)
4. **Export** — table view can export to Excel or CSV

## Internal sharing details

### Who has access modes
- "Only invited people can access" (default)
- "Everyone in the workspace can view" — anyone with View+ on the workspace can use this view

### IMS requirement
- Only users in Adobe Admin Console can be added.
- Workfront-only users cannot receive shares.

### System Administrators on views
- Cannot view/share views they didn't create unless shared with them.
- Can only have Manage permission on shared views (always Manage when shared with them).

### Permissions levels
- View
- Manage (modify settings, share, duplicate, delete)

### Notifications
- Recipients get in-app + email when shared.

## Public sharing details
- Toggle "Create public link" → URL becomes shareable
- Set expiration date (required field)
- After expiration, link no longer works
- External users see records and fields including connected/lookup fields
- External users CANNOT create other views, edit, or modify records

### Public sharing restriction
- Public sharing tab is hidden for views on global record types in secondary workspaces.

## Permission request approval flow
- View manager gets in-app + email notification
- Manager opens "Pending access requests" box
- Per-user: pick View or Manage, then Approve all / Deny all
- Approved users added to sharing list; they get email confirmation

## Removing permissions
- Internal: remove user/entity from sharing list. NO notification sent to removed users.
- Public: deselect "Create public link". Link stops working.

## SA notes
- The "no notification on removal" behavior is important for offboarding workflows — security review should not assume users will know access was revoked.
- Public links are the only path for sharing WFP data with no-account external stakeholders (agencies, consultants, board reviewers). Educate teams that this exposes ALL connected lookup fields, including Workfront/AEM/GenStudio data that the workspace pulls in.
- Views are an under-shared object compared to workspaces — common support issue is "I can see records but not the view someone showed me."
