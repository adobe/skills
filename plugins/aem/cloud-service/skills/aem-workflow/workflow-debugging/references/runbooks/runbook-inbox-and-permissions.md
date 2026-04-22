# Runbook: Inbox and permissions

**symptom_id:** `user_cannot_see_or_complete_item`

---

## Symptom

User does not see work items; “Terminate failed”, “Resume failed”, “Suspend failed”; access denied on delegate/return.

---

## Root cause categories

- not_assignee_and_enforce_assignee_true
- not_initiator_and_enforce_initiator_true
- not_in_superuser_list
- repository_acl_insufficient

---

## Decision tree

- **IF** user cannot see work item **THEN** → Checklist 1–3.
- **IF** user cannot terminate/resume/suspend **THEN** → Checklist 2–3 (initiator, superuser).
- **IF** user cannot delegate or return **THEN** → Checklist 1–4.

---

## Checklist

1. **Workflow Session Factory (OSGi)** – Read `granite.workflow.enforceWorkitemAssigneePermissions`, `granite.workflow.enforceWorkflowInitiatorPermissions`, `cq.workflow.superuser`. If true, only assignee (or shared) and initiator/superuser can see/complete or control workflow.
2. **Assignee / initiator** – For the affected instance, confirm user is assignee (or has inbox sharing) for see/complete; confirm user is initiator or in superuser list for terminate/resume/suspend.
3. **cq.workflow.superuser** – In Workflow Session Factory config, confirm list includes expected admin IDs/groups.
4. **Repository ACL** – Confirm user has read/write access to payload path as required.

---

## Remediation

| Action | How |
|--------|-----|
| **Allow initiator to terminate/resume** | User must be workflow initiator or in superuser list. |
| **Show item to more users** | Use inbox sharing, or add user to superuser list for admin operations. |
| **Relax enforcement (dev only)** | Set enforce flags to false (not recommended in production). |
| **Fix ACL** | Grant user read/write on payload path as required. |

---

## References

[configurations.md](../docs/configurations.md) | [error-patterns.md](../docs/error-patterns.md)
