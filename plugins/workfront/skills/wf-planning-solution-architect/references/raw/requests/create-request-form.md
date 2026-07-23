# Create and manage a request form

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-requests/create-request-form
Last update: Fri Jan 30 2026

## What request forms do
- Associated with a record type.
- Submitting the form CREATES a record of that type.
- Can be shared internally or publicly (link-based).
- Optional approval gate before record creation.

## Access requirements
- Standard license
- Manage on workspace or record type

## Field type limitations on request forms

### Cannot be added to forms
- Created by, Last modified by, Approved by
- Created date, Last modified date, Approved date
- Workfront object lookup fields
- WFP connected record lookup fields

### Field display differences in form builder vs after submission

| Field type | Form builder display | Result/submitted display |
|---|---|---|
| Currency, Number, Percentage | Single-line text input | Formatted correctly (BUT decimal precision is NOT preserved) |
| People | — | Displays as IDs (not names) on the request details page |
| Paragraph | "N/A" on form display | HTML tags shown on request details, not formatted text |
| Formula (non-referencing) | — | "N/A" displayed |
| Formula referencing Currency | — | Values shown WITHOUT exchange rate adjustment |

## Building a form

### Default form contents
- All record-type fields available (in the table view)
- "Default section" wrapper (can be removed if you add other sections first)
- Subject field — identifies the request in Workfront

### Subject field behavior
- Required if visible on form.
- Can be removed from the form.
- If Subject missing AND Name field present: request named same as record.
- If both missing: request named `<Form name> <Entry date>`; record named "Untitled".
- To see Subject in WFP, add the "Original request" connection field to the record type.

### Field configuration in form
- **Label** — display name on form (doesn't change underlying record field)
- **Instructions** — additional info
- **Make a required field** toggle
- **Add logic** — conditional show/hide based on other field values

### Content elements
- Descriptive text
- Section break

### Preview
- Preview button shows submitter's view.

## Approval configuration

### Production environment (Configuration tab)
- Single approval setup.
- Add users/teams as Approvers.
- "Only one decision is required" — first decision wins. Otherwise all must approve.
- Any single rejection → entire request rejected.
- Team approver = one decision from team.

### Preview environment (Settings tab — coming to Production)
- **Approval rules** with conditional routing.
- Rules prioritized in order; first matching wins.
- Default rule applied if no conditions met.
- Per-rule: select field, operator, value(s), AND/OR conditions.
- Each rule has its own approvers and "Only one decision is required" toggle.
- Drag-drop reorder; default rule cannot be moved.

## Request completion options
- Mark complete when:
  - Object is CREATED, OR
  - Object is COMPLETED (specify completion field + value, e.g., Status = Complete)

## Publishing
- Click Publish → form becomes accessible via link AND in Workfront Requests area.
- Adds Unpublish and Share buttons.

## Sharing

### Internal sharing
- Share with users (Admin Console users only — NO Workfront-only users), teams, job roles, groups, companies.
- Default permission: Submit.
- Submission scope options:
  - Only invited people can access
  - Anyone with View+ on workspace
  - Anyone with Contribute+ on workspace

### Public sharing
- Create public link toggle.
- Link expiration: up to 180 days in future.
- **WARNING**: anyone with the public link can submit, including external users.
- **Cannot create public link** for forms containing:
  - Workfront or AEM Assets Connection fields
  - People fields

## Managing existing forms
- Record type → More → "Manage request forms" → table view of all forms.
- Per-form actions: Edit form, Unpublish, Share, Copy link, Delete.
- Deleting a form does NOT delete submitted requests or created records.
- Form deletion is permanent (not recoverable).

## SA notes
- Request forms are the primary path for View-permission users to create records — without a form, they're shut out of creation entirely.
- The People-displays-as-IDs limitation is a frequent surprise — explain to users that the submitted form's "look at this request" view shows raw IDs, not names. The record itself shows names correctly.
- Public link expiration (180 days max) forces periodic refresh cycles for intake forms. Add a recurring task to renew them.
- The "no People or Workfront/AEM connection fields" rule for public forms is the most common gating issue when teams want external intake — design around it (use single-line text + manual reconcile, or hide People fields from public form variants).
- The approval rules in Preview are a major upgrade — conditional routing replaces fixed approver lists. Worth previewing before bringing into production planning.
- "Original request" connection field is hidden by default but useful for traceability — expose it for intake-heavy record types.
- Forms can be deleted but records/requests submitted from them persist — good for cleanup without losing data.
