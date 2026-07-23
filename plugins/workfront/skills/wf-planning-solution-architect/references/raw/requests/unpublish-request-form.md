# Unpublish a request form in Adobe Workfront Planning

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-requests/unpublish-request-form
Last update: April 1, 2026

## Access requirements
- Workfront/Planning or Workflow/Planning package.
- Workfront license: Standard.
- Object permissions: Manage on workspace AND record type.

## Two operations covered

### Change form sharing (narrow access without unpublishing)
Sharing levels:
- Anyone with view or higher access to the workspace.
- Anyone with contribute or higher access to the workspace.
- Anyone with the link (essentially public — including external users if link is leaked).

### Unpublish (revoke all access)
- Form remains in "Manage request forms" but is no longer reachable by submitters.
- Existing records created by the form REMAIN.
- Existing requests in the Requests area REMAIN.
- Unpublish button toggles to Publish — fully reversible.

## SA notes
- **"Anyone with the link" is effectively public.** Treat any link share as a leak risk — if the URL is forwarded outside the org, it CAN be submitted by external users. For sensitive request types (HR, legal, finance), only use "view+ access to workspace" or tighter.
- **Unpublish is the soft-delete pattern for request forms.** Use this instead of deleting if there's any chance you'll want to bring the form back. Preserves history, audit trail, and historical records intact.
- **Records created BEFORE unpublishing are not affected** — this is sensible but customers sometimes worry that unpublishing "breaks" past records. It doesn't.
- For governance: schedule periodic "request form audits" to unpublish stale forms. They're often forgotten and accumulate as the workspace ages.
