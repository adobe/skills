# Request permissions to a view or a workspace

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-access/request-permissions
Last update: April 1, 2026

When clicking a shared link without access, user gets "You have no access" page with two paths:
- "Open with existing view" — if user has workspace access but not this view, opens record type page in default view.
- "Request access" — sends in-app + email notification to all Manage-permission holders of the view/workspace.

## Permissions that can be granted via request
- Views: View or Manage
- Workspaces: View, Contribute, or Manage
- Public view sharing: only by Manage permission holders.

## Layout template prerequisite
- Light/Contributor users still need a layout template that includes Planning to receive shared links — share alone isn't enough.

## SA notes
- Use this flow as a guided "ask the owner" — much safer than over-granting in advance.
- Notifications go to all Manage holders, not just the workspace owner. In federated workspaces, this can fan out widely; consider designating a single share-approver in your governance docs.
