# Add an approval to a request form in Adobe Workfront Planning

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-requests/add-approval-to-request-form
Last update: April 1, 2026

## Access requirements
- Any Workfront/Planning or Workflow/Planning package.
- Workfront license: Standard.
- Object permissions: Manage on workspace AND record type. Sysadmins have implicit Manage.

## What it does
Inserts an approval gate between request submission and record creation. Without approval, a record is created immediately on submit.

## Approval mechanics

### Default rule
- Optional baseline rule applied to all submissions when no custom rule matches.
- Approvers: one or more users and/or teams.
- "Only one decision is required" toggle: if ON, any single approver's decision finalizes the request. If OFF, ALL named approvers must decide.

### Custom rules (conditional)
- Triggered by request-form field values + operators (operator set varies by field type).
- Can compose multiple conditions per rule with AND/OR.
- Per rule: assign approvers (users and/or teams), "Only one decision is required" toggle.

### Rule resolution order
1. If a custom rule matches → that rule fires. Default does NOT apply.
2. If multiple custom rules match → FIRST in order wins (single rule, not all matches).
3. If no custom rule matches → default rule applies (if defined).
4. If no custom matches AND no default → no approval; record created immediately.

### Team-as-approver semantics
- A team approver = only one decision needed from one team member, regardless of the "Only one decision is required" toggle.

## Multi-approver outcomes
- All approve → record created.
- At least one rejects (and others approve) → NO record created. A request remains in the Workfront Requests area (so the submitter and admins can see it).
- All reject → rejected. No record.

## Captured fields on resulting record
- Approved by (system field): the approver(s).
- Approved date (system field): timestamp.
- Both must be added explicitly to record type as fields to display.

## SA notes
- **First-match (not all-match) on custom rules.** This is the trap. Customers who layer overlapping rules expecting all of them to apply will be surprised. Order the rule list intentionally and test.
- **Default rule is bypassed by ANY custom-rule match**, including non-overlapping cases. If you want the default to ALWAYS run, build a custom rule that matches everything as the LAST rule — or accept that default-only is the right pattern.
- **Team approvers short-circuit to one decision** regardless of toggle. This is useful for "any campaign manager can approve" patterns but breaks "all VPs must sign off" patterns — for the latter, name them as individuals.
- The reject behavior — request created in Workfront Requests area but no record — is the documented audit trail. Don't let customers assume rejected requests just disappear; show them where to find them.
- This is the closest WFP comes to a workflow engine. For more complex flows (sequential approvers, escalations, time-bound auto-approve) you need Fusion + custom logic, NOT this feature.
- Approval is a per-record-type construct, attached to the request form. If a record type has BOTH a request form and direct-create entry (button, AI Assistant, API), only the request-form path is gated. Direct creates bypass approvals. Customers wanting a hard "no record without approval" policy must turn off direct create paths via sharing permissions.
- "Approved by" and "Approved date" fields don't exist by default — they have to be added as fields on the record type. New customers consistently miss this.
