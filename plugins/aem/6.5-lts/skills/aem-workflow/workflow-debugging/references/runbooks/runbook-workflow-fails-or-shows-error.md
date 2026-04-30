# Runbook: Workflow fails or shows error

**symptom_id:** `workflow_fails_or_shows_error`

---

## Symptom

Workflow instance is in Failed state, or a step displays an error in history or logs.

---

## Root cause categories

- process_step_exception
- payload_missing_or_invalid
- process_script_or_java_bug
- timeout_or_transient_failure

---

## Decision tree

- **IF** instance in Failed state **THEN** → Execute Checklist items 1–5 (console error, logs, payload, process, retry/timeout).
- **IF** step not yet failed but error in logs **THEN** → Execute Checklist items 2–5 for that step.

---

## Checklist

1. **Workflow console → Instances (or Failures)** – Open the instance; open **History** or failed step. Note **exact error message** and **failing step name**.
2. **error.log** – Search for instance ID, workflow model name, or failing step name. Capture **full exception type and message** and **stack trace**. Key classes: `JobHandler`, `WorkflowSessionImpl`, and the Process class name from the step.
3. **Payload** – From instance, get payload path (e.g. JCR_PATH). In repository, confirm path **exists** and **required properties or nodes** exist. Confirm workflow service user has **read/write** where the process writes.
4. **Process implementation** – For the failing Process step, open the Java class or script. Check for null dereference, invalid API usage, missing null check on payload, and repository permission assumptions.
5. **Retry / timeout** – Check whether failure is transient (e.g. external service down). If step supports retry, confirm `cq.workflow.job.retry` (Workflow Session Factory). If timeout, check for long-running logic or external call; increase timeout if supported or optimize step.

---

## Remediation

| Action | How |
|--------|-----|
| Retry failed work item | JMX → `com.adobe.granite.workflow:type=Maintenance` → **retryFailedWorkItems**(dryRun=false, model=optional). Or from Inbox if failure item exists: user action Retry. |
| Terminate and optionally restart | JMX → **terminateFailedInstances**(restartInstance, dryRun, model). Use dryRun=true first. |
| Fix process and retry | Fix code/script; deploy; then **retryFailedWorkItems** or user Retry from Inbox. See [runbook-failed-work-items.md](runbook-failed-work-items.md). |
| Fix payload and restart | Correct or restore payload; terminate instance; start new instance with valid payload. |
| Transient failure | After root cause resolved (e.g. service restored), run **retryFailedWorkItems** for affected model. |

---

## References

[error-patterns.md](../docs/error-patterns.md) | [runbook-failed-work-items.md](runbook-failed-work-items.md) | [mbeans.md](../docs/mbeans.md)

Retry / timeout / superuser properties on WorkflowSessionFactory: SKILL.md Step 5.
