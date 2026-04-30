# Runbook: Task not appearing in Inbox

**symptom_id:** `task_not_in_inbox`

---

## Symptom

User expects a work item to appear in Inbox but it does not appear.

---

## Root cause categories

- workflow_not_reached_participant_step
- participant_user_or_group_mismatch
- inbox_filter_or_scope_hiding_task
- repository_permission_insufficient
- dynamic_participant_resolution_excluded_user

---

## Decision tree

- **IF** workflow instance has not yet reached the Participant step **THEN** → Execute Checklist item 1; confirm instance is at the step that creates the task.
- **IF** instance is at Participant step **THEN** → Execute Checklist items 2–6 (participant config, logged-in user, filters, permissions, dynamic participant).

---

## Checklist

1. **Workflow console → Instances** – Open the instance; confirm **current step** is the Participant step that produces the work item. If current step is earlier (e.g. Process), workflow has not yet created the task.
2. **Participant step configuration** – In Workflow Model Editor, open the Participant step; note **User/Group** (user ID or group ID). Confirm the user who expects the task is that user or a member of that group.
3. **Logged-in user** – Confirm the user checking Inbox is logged in as the assignee (or as a member of the assignee group). Different browser/profile = different user.
4. **Inbox filters** – In Inbox UI, check active filters (project, workflow model, status, date range, "Where I am"). Remove or adjust filters that could hide the task.
5. **Repository permissions** – Confirm the assignee has read access to the workflow payload path (e.g. page or asset). Check ACLs for that path.
6. **Dynamic Participant** – If the step is Dynamic Participant, confirm the script or service that resolves the assignee returns the expected user/group for this payload and context. Check logs for resolution output if available.

---

## Remediation

| Action | How |
|--------|-----|
| Workflow not at Participant step | Wait for prior steps to complete, or fix the step that is stuck (see [runbook-workflow-stuck.md](runbook-workflow-stuck.md)). |
| Wrong user/group in step | Edit model: set correct user or group in Participant step; Sync. New instances will use new config; existing instance keeps old assignee. |
| Inbox filter hiding task | Instruct user to clear or change Inbox filters. |
| Permission denied | Grant assignee (or group) read access to payload path. |
| Dynamic participant wrong | Fix script or service that resolves assignee; redeploy. For existing instance, reassign from admin if possible or restart workflow. |

---

## References

[runbook-inbox-and-permissions.md](runbook-inbox-and-permissions.md) | [runbook-workflow-stuck.md](runbook-workflow-stuck.md)

WorkflowSessionFactory enforce flags and superuser list: SKILL.md Step 5.
