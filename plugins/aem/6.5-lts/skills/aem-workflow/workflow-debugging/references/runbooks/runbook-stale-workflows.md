# Runbook: Stale workflows

**symptom_id:** `stale_workflow_no_work_item`

---

## Symptom

Workflow instance is in state Running but has no current work item (inconsistent state; e.g. job crashed during transition).

---

## Root cause categories

- job_crashed_during_transition
- node_left_inconsistent

---

## Decision tree

- **IF** instance shows Running and opening it shows no active work item **THEN** → Execute full Checklist; Remediation: restart stale.
- **IF** instance has an active work item **THEN** → Not stale; use [runbook-workflow-stuck.md](runbook-workflow-stuck.md) or [runbook-workflow-fails-or-shows-error.md](runbook-workflow-fails-or-shows-error.md).

---

## Checklist

1. **Workflow console → Instances** – Filter by Running; open the instance. Confirm there is **no current work item** (no task in progress). If a work item is shown, the instance is not stale.
2. **Logs** – Search `error.log` for instance ID or workflow model; look for `restartStaleWorkflows` or errors during archive/transition (e.g. archive work item failure).
3. **JMX: countStaleWorkflows** – Invoke **countStaleWorkflows**(model) on `com.adobe.granite.workflow:type=Maintenance`. If count > 0, stale instances exist for that model (or all models if model omitted).
4. **JMX: listRunningWorkflowsPerModel** – Invoke to see which models have running instances; cross-check with countStaleWorkflows to identify affected models.

---

## Remediation

| Action | How |
|--------|-----|
| Restart stale workflows | JMX → **restartStaleWorkflows**(model, dryRun). Run with dryRun=true first to preview; then dryRun=false to apply. Model optional (empty = all). |
| Inspect before restart | Use **countStaleWorkflows**(model) and **listRunningWorkflowsPerModel**() to confirm scope. |

---

## References

[mbeans.md](../docs/mbeans.md) | [runbook-workflow-stuck.md](runbook-workflow-stuck.md)
