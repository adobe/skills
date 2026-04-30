# Runbook: Workflow stuck (not progressing)

**symptom_id:** `workflow_stuck_not_progressing`

---

## Symptom

Workflow instance remains in state Running and does not advance to the next step.

---

## Root cause categories

- participant_step_assignee_missing_or_no_access
- process_step_exception_or_timeout
- process_step_invalid_payload
- or_and_split_condition_or_route_invalid
- stale_instance_no_current_work_item

---

## Decision tree

- **IF** instance has no current work item (open instance → no active work item) **THEN** → Treat as stale. Use [runbook-stale-workflows.md](runbook-stale-workflows.md). **STOP**.
- **IF** current step type = Participant **THEN** → Execute Checklist items 2–5 (assignee, Inbox, group membership).
- **IF** current step type = Process **THEN** → Execute Checklist items 6–9 (logs, payload, timeout, process registration).
- **IF** current step is OR Split or AND Split **THEN** → Execute Checklist items 10–11 (condition, routes).

---

## Checklist

1. **Workflow console → Instances** – Filter by Running; open the instance; note **current step** (Participant, Process, OR/AND Split, or other) and **instance ID**.
2. **Current step = Participant: Assignee** – In step configuration or instance details, note assignee (user or group). Confirm that user exists in User Management or group has at least one member.
3. **Current step = Participant: Inbox** – Log in as assignee (or a member of assignee group). Open Inbox; confirm whether the work item appears. If it does not, see [runbook-task-not-in-inbox.md](runbook-task-not-in-inbox.md).
4. **Current step = Participant: Access** – Confirm assignee (or group members) has read access to the payload path in repository.
5. **Current step = Participant: Multiple assignees** – If Dynamic Participant, confirm resolution logic and that the intended user is included.
6. **Current step = Process: Logs** – In `error.log`, search for instance ID, workflow model name, or payload path. Look for exception stack trace; note exception type and message.
7. **Current step = Process: Payload** – Resolve payload path from instance (e.g. JCR_PATH). In CRX/JCR or Repository browser, confirm path exists and is readable by the workflow service user.
8. **Current step = Process: Timeout** – If logs indicate timeout or step runs long, check for long-running logic, external calls, or locks. Consider timeout configuration for the step if applicable.
9. **Current step = Process: Registration** – Confirm the Process step references a process name that matches an OSGi-registered `WorkflowProcess` with that `process.label`. In Felix Console → OSGi → Components, search for WorkflowProcess services; verify bundle Active and label matches (case-sensitive).
10. **Current step = OR/AND Split: Condition** – Confirm the split condition (rule or user choice) is defined and that the chosen branch has a valid next step.
11. **Current step = OR/AND Split: Routes** – Confirm every branch of the split has a transition to a step (no missing or dead-end routes). In editor, Sync must succeed; fix any invalid branch.

---

## Remediation

| Action | How |
|--------|-----|
| Stale instance (no work item) | Use [runbook-stale-workflows.md](runbook-stale-workflows.md): JMX **countStaleWorkflows** → **restartStaleWorkflows**(dryRun then execute). |
| Participant: assignee wrong or missing | Edit workflow model: correct Participant step user/group; Sync. Reassign or start new instance if needed. |
| Process: exception in code | Fix process implementation; deploy; retry work item via JMX **retryFailedWorkItems** or from Inbox if failure item exists. See [runbook-failed-work-items.md](runbook-failed-work-items.md). |
| Process: payload invalid | Fix or replace payload; terminate instance and restart with valid payload, or fix process to handle missing path. |
| Process: not registered | Deploy bundle with WorkflowProcess; ensure `process.label` matches step; Sync model. |
| OR/AND Split: invalid route | In Workflow Model Editor, add step (e.g. No Operation) to any empty branch; Sync. |

---

## References

[error-patterns.md](../docs/error-patterns.md) | [mbeans.md](../docs/mbeans.md) | [runbook-stale-workflows.md](runbook-stale-workflows.md) | [runbook-failed-work-items.md](runbook-failed-work-items.md)
