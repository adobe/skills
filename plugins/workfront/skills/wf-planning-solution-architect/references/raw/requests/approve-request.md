# Approve a request in Adobe Workfront Planning

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-requests/approve-request
Last update: April 1, 2026

## Access requirements
- Any Workfront/Planning or Workflow/Planning package.
- Workfront license: ANY (an approver doesn't need Standard — only the form creator does).
- Object permissions: Manage on workspace AND record type to receive/access approvals via the Requests area. Email/in-app notifications work even for users without workspace access.

## Request status state machine
- **Pending review**: No approver has opened the request yet.
- **In review**: At least one approver opened the request; not all decisions made.
- **Approved** (per-approver): An individual approver approved, but overall request stays in review until all decisions in.
- **Completed**: All approvers approved → record is created. Also used for requests that didn't require approval.
- **Rejected**: At least one approver rejected → no record, request remains visible in Requests area, NEW request required to retry.

## Approval entry points
1. **In-app notification** (Notifications icon, upper-right).
2. **Email notification** with "Open request" deeplink.
3. **Requests area** in Main Menu → "Use new experience" → click pending request.
4. **My Approvals widget in Home** — bulk-style with approve/reject + comment inline.

## Important UX gates
- Cannot access Planning requests from the LEGACY requests experience. Approvers must use the new experience or notifications.
- If an approver has no Planning workspace access at all, they can ONLY approve via email/in-app notification (not via Requests area).
- Email and in-app notifications require Adobe Unified Experience onboarding.

## Reject = single veto
Any single rejection terminates the request, regardless of other approvers' decisions. Submitter is notified.

## SA notes
- **The "license: Any" rule for approvers is a feature, not a bug.** It enables business stakeholders (VP, finance, legal) who don't have Standard licenses to participate in approval workflows via email-only access. Don't undersell this — it's a key argument when customers worry that adding approvers will balloon their license costs.
- **Reject is a hard stop**, not a "send back for edits." Customers who want iteration loops (approver → submitter revises → resubmits same request) need to either use comments to coach the submitter who then creates a NEW request, OR build a Fusion-based flow with status field manipulation.
- **The "Pending review" → "In review" status transition is just "an approver opened it"** — not "an approver took action." This can mislead customers who think In review means progress is being made.
- The My Approvals widget supports adding a comment inline with approve/reject. This is the most ergonomic approval path for high-volume approvers; train approvers on it instead of the per-request page.
- **Email-only approval works without Planning workspace access** — useful for cross-functional approvers (finance, legal). Confirm Adobe Unified Experience is enabled or this doesn't work.
- For customers wanting more nuanced workflows (delegation, time-bound auto-approve, escalation), this approval engine doesn't support it. Recommend Fusion + status field manipulation, or wait for the broader Workfront workflow features.
