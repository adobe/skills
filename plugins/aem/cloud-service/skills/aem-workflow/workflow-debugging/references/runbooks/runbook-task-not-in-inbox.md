# Runbook: Task not appearing in Inbox — Cloud Service

**symptom_id:** `task_not_in_inbox`

> **Variant:** AEM as a Cloud Service. No JMX. User & group changes on AEMaaCS happen through IMS federation; on-prem-style direct User Management edits do not persist.

---

## Symptom

A user expects a work item to appear in `/aem/inbox` but does not see it. The instance exists in the Workflow Console and shows a Participant step, but the assignee reports an empty Inbox.

---

## Root cause categories

- `workflow_not_reached_participant_step` — instance is still on an earlier step.
- `participant_user_or_group_mismatch` — assignee is not who the user thinks it is.
- `inbox_filter_or_scope_hiding_task` — user is looking at a filtered view.
- `repository_permission_insufficient` — assignee lacks read on the payload.
- `dynamic_participant_resolution_excluded_user` — `ParticipantStepChooser` picked a different principal.
- `ims_principal_rotated` — the assignee was an IMS user who got rotated; the work item is orphaned.

---

## Decision tree

- **IF** the instance has not reached the Participant step → Checklist item 1 only; wait or debug the preceding step via [`runbook-workflow-stuck.md`](runbook-workflow-stuck.md).
- **IF** the instance *is* at the Participant step → Checklist items 2–7.
- **IF** the assignee was a specific IMS user (email-like) → Checklist item 7 (IMS rotation).

---

## Checklist

1. **Current step is the Participant step**
   Open the instance in the Workflow Console (`/libs/cq/workflow/admin/console/content/instances.html`). Confirm the current step is the one that produces the expected task. If it's still on an earlier Process or Split step, the task doesn't exist yet.

2. **Configured assignee vs expected user**
   Open the workflow model (`/conf/global/settings/workflow/models/<id>`) or the instance metadata. Read the Participant step's `PARTICIPANT` value (user ID) or group ID. Confirm the user reporting the missing task is that user, or a member of that group. Different browser / profile / IMS session = different principal.

3. **Logged-in identity**
   Ask the user to check their current identity at `/libs/granite/security/content/useradmin.html` (or the Developer Console user context). On AEMaaCS this is an IMS principal — not a local user — and the email display may differ from the JCR user ID.

4. **Inbox filters**
   `/aem/inbox` → clear all filters (project, workflow model, status, date range, "Where I am"). A default "assigned only" filter frequently hides shared items; "Last 30 days" hides older ones. Walk the user through resetting filters before drawing any conclusion about assignment.

5. **Payload ACL**
   The assignee must have **read** on the payload path. On AEMaaCS, ACLs land via `ui.apps/.../repoinit`. If the user was added to a group that should have access, confirm:
   - the group exists in the JCR (`/home/groups/...`);
   - the group has a repoinit `allow jcr:read` on the payload tree;
   - the user's IMS federation mapped them into that JCR group.

6. **Dynamic Participant resolver**
   If the Participant step is a Dynamic Participant (`ParticipantStepChooser`), the assignee is computed at runtime. Check:
   - Cloud Manager logs for the chooser's class name at the time the step opened.
   - Developer Console → OSGi → Components → confirm the `ParticipantStepChooser` service is `Active` and `chooser.label` matches the model field.
   - If the chooser returned a different principal than expected, the bug is in the chooser's logic, not in Inbox.

7. **IMS principal rotation**
   If the work item was assigned to a specific user (not a group) and that user was removed / re-invited / re-provisioned through IMS, the assignment now references a dangling principal. Symptoms: no user can see the item; even the superuser group doesn't show it in Inbox. **Fix:** terminate the instance and restart with a group assignment; or reassign via Workflow Console → Delegate (requires superuser).

---

## Remediation

| Action | How |
|--------|-----|
| Instance not yet at Participant step | Wait or debug the preceding step via [`runbook-workflow-stuck.md`](runbook-workflow-stuck.md). |
| Wrong user / group in model | Edit the model file under `/conf/global/settings/workflow/models/...`, commit, deploy via Cloud Manager pipeline. **Existing instances keep the old assignment** — model edits only take effect for new instances. |
| Filter hiding the task | Walk the user through clearing Inbox filters; default the filter to "All" while troubleshooting. |
| ACL insufficient | Add a `repoinit` entry granting `jcr:read` on the payload tree to the assignee group; commit to `ui.apps/.../repoinit`; deploy. |
| Dynamic Participant picked wrong user | Fix the `ParticipantStepChooser.getParticipant()` logic; deploy. For the *existing* stuck instance, delegate via Workflow Console (as superuser) or terminate + restart. |
| IMS principal orphaned | Delegate to a valid user as superuser; long-term fix the model to assign to a group, not an individual. |
| "Relax enforcement" on a dev env only | Set `granite.workflow.enforceWorkitemAssigneePermissions` to `false` in `com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json`. **Never** do this in prod. |

---

## AEMaaCS-specific gotchas

- **Assign to groups, not individuals.** IMS principals can rotate; JCR groups are stable. Assigning to a specific IMS user is a time bomb.
- **Model edits don't retrofit.** A running instance keeps the Participant assignment it had when it was created. To change behaviour on a live instance, delegate via Workflow Console.
- **`cq.workflow.superuser` must reference a group.** Putting individual IMS user IDs there has the same rotation problem as Participant assignments. Use a `repoinit`-provisioned group.
- **No on-prem-style User Management writes.** Creating users locally via `/libs/granite/security/content/useradmin.html` is either disabled or non-persistent. All identity lands via IMS + repoinit group mapping.

---

## Escalation

- IMS delegation is broken (the Workflow Console Delegate action 403s for a known superuser) → Adobe Support with the environment ID and user IDs involved.
- Group exists, ACL looks correct, user is in the group, but Inbox is still empty → enable assignee-permissions trace logging (see `error-patterns.md`), reproduce, attach 1 hour of logs + the instance ID to a Support ticket.

---

## References

- Bundled WorkflowSessionFactory config (enforce flags, superuser group): [`../examples/com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json`](../examples/com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json)
- Error patterns (permission / visibility): [`../docs/error-patterns.md`](../docs/error-patterns.md)
- Related runbooks: [`runbook-inbox-and-permissions.md`](runbook-inbox-and-permissions.md), [`runbook-workflow-stuck.md`](runbook-workflow-stuck.md)
