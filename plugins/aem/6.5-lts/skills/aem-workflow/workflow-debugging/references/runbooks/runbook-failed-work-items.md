# Runbook: Failed work items (retries exhausted)

**symptom_id:** `step_failed_retries_exhausted`

---

## Symptom

Workflow step failed after all retries; a failure work item was created and may appear in Inbox.

---

## Root cause categories

- process_not_registered_or_label_mismatch
- exception_in_process_execute
- payload_or_repository_error

---

## Decision tree

- **IF** failure item exists in Inbox or instance in Failed **THEN** → Execute Checklist; then apply Remediation (retry or terminate/restart).
- **IF** step fails on first run (no retries yet) **THEN** → Use [runbook-workflow-fails-or-shows-error.md](runbook-workflow-fails-or-shows-error.md) for diagnosis; same Remediation may apply.

---

## Checklist

1. **error.log** – Search for `Error executing workflow step`. Note **exception type**, **message**, and **stack trace**. Identify Process class or script name from stack.
2. **Retry configuration** – Confirm `cq.workflow.job.retry` (Workflow Session Factory). Default 3. Per-model/per-instance: `noRetryOnException` (model metadata) or `noretry` (instance metadata) disables retries.
3. **Process registration** – Confirm the Process step’s **Process** field matches an OSGi-registered `WorkflowProcess` with that exact `process.label`. In OSGi console, search for WorkflowProcess services; verify bundle active and label matches.
4. **Payload** – From instance, get payload path. Confirm path exists in repository and is readable by workflow service user. Confirm no repository exception in logs (e.g. PathNotFoundException, AccessDeniedException).

---

## Remediation

| Action | How |
|--------|-----|
| Retry failed work items | JMX → `com.adobe.granite.workflow:type=Maintenance` → **retryFailedWorkItems**(dryRun=false, model=optional). Run dryRun=true first to preview. |
| Terminate and optionally restart | JMX → **terminateFailedInstances**(restartInstance, dryRun, model). dryRun=true first; then dryRun=false. Set restartInstance=true to restart after terminate. |
| Fix process and retry | Fix code/config; deploy; then **retryFailedWorkItems** or user Retry from Inbox. |
| Disable retries for step | Set model-level or instance-level no-retry (e.g. `noretry` in metadata) only if immediate failure without retries is desired. |

---

## References

[error-patterns.md](../docs/error-patterns.md) | [mbeans.md](../docs/mbeans.md) | [runbook-workflow-fails-or-shows-error.md](runbook-workflow-fails-or-shows-error.md)

OSGi property reference (WorkflowSessionFactory, retry, permissions): SKILL.md Step 5.
