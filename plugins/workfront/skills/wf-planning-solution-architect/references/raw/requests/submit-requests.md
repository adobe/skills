# Submit Workfront Planning requests to create records

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-requests/submit-requests
Last update: Fri Jan 30 2026

## Three submission paths
- Workfront Requests area (Workfront users only)
- Shared link to request form (Workfront users + external users)
- Record type page → "Request record" button (View permission path)

## Access requirements
- Any Workfront license (incl. external users for link-based submission)
- View+ on workspace + record type (for internal users)

## Prerequisites
- Workspace, record type, request form must exist
- Form must be shared with you (internal) OR via valid (non-expired) public link

## Critical behavior

### Cannot edit a submitted request
- Once submitted, no edits possible. Plan carefully.

### Request ↔ Record relationship
- Each submission creates a request AND a record (unless gated by approval).
- The request-to-record connection is **PERMANENT** — cannot be severed.
- Records created via request form are identical to records created any other way.

### Visibility/notifications
- New request experience required (legacy doesn't show Planning requests).
- Request visible to: owner, approvers, anyone with View+ on workspace. Admins see all.
- Submitter receives in-app + email notification.
- Approvers receive in-app + email approval request.
- Email and in-app notifications require Adobe Unified Experience onboarding.

### Approval flow
- If no approval: record created immediately.
- If approval present: status = "Pending review"; record created only after all approvers approve.
- Any approver rejects → request rejected, record NOT created.
- If "Only one decision is required" enabled → first decision determines outcome.

## Requests list (Workfront Requests area) fields
- **Subject**: original request name (cannot hide/remove)
- **Created object**: name of resulting WFP record
- **Object type**: workspace + record type
- **Status**: request status
- **Request form**: source form name
- **Entry date**, **Entered by**, **Created object status**

## Filters available
- Workspace, Record type, Entry date, Request form, Status, Entered by, Created object status
- Multiple conditions with AND/OR

## "Untitled" record naming
- If primary field not updated in request form → record displays as "Untitled" in Created object column.
- If Subject field used but no Name → record gets the Subject as its name.

## Copy & draft
- Copy existing request → edit → submit as new (new requesting experience only)
- Save as draft → submit later (new requesting experience only)

## SA notes
- The "cannot edit after submit" rule is a frequent surprise — coach users to use the Preview button before submitting.
- The permanent request-to-record link is useful for audit ("where did this record come from?") via the Original request connection field.
- For external intake (e.g., agency partners), public links + Unified Experience onboarding is the supported pattern.
- Approval rejections leave the request visible but without a record — clean up rejected requests periodically OR build a filter view for "pending review > N days".
- The Subject field is non-removable from the Requests list view — this is structural in Workfront.
