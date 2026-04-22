# Runbook: Purge and cleanup (repository bloat)

**symptom_id:** `repository_bloat_too_many_instances`

---

## Symptom

Large `/var/workflow/instances`; slow queries; high disk usage from old workflow data.

---

## Root cause categories

- purge_not_configured_or_infrequent
- purge_query_or_save_threshold_insufficient

---

## Decision tree

- **IF** one-off cleanup needed **THEN** → Execute Checklist 1–2; Remediation: purgeCompleted (dryRun then execute).
- **IF** recurring cleanup needed **THEN** → Checklist 2; Remediation: add/edit Purge Scheduler config.
- **IF** purge is slow **THEN** → Checklist 3; Remediation: tune maxPurgeQueryCount / maxPurgeSaveThreshold.

---

## Checklist

1. **JMX: countCompletedWorkflows(model)** – Invoke on `com.adobe.granite.workflow:type=Maintenance`. Confirm count or use **listCompletedWorkflowsPerModel** to see per-model breakdown.
2. **Purge Scheduler / Workflow Session Factory** – In OSGi, check for Purge Scheduler factory configs (scheduledpurge.*). Check Workflow Session Factory: `granite.workflow.maxPurgeSaveThreshold`, `granite.workflow.maxPurgeQueryCount`.
3. **Purge run duration** – If purge job runs but is slow, note current maxPurgeQueryCount and maxPurgeSaveThreshold for tuning.

---

## Remediation

| Action | How |
|--------|-----|
| **Purge completed workflows** | JMX → **purgeCompleted**(model, numberOfDays, dryRun). Use dryRun=true to preview, then dryRun=false to apply. |
| **Purge active (running) workflows** | JMX → **purgeActive**(model, numberOfDays, dryRun). Use with care; only for old running instances you intend to remove. |

---

| **Scheduled purge** | Add/edit Purge Scheduler factory config: scheduledpurge.workflowStatus (e.g. COMPLETED, ABORTED), scheduledpurge.daysold, scheduledpurge.modelIds (optional). Optionally scheduledpurge.purgePackagePayload. |
| **Tune purge** | Increase granite.workflow.maxPurgeQueryCount (Workflow Session Factory); balance with granite.workflow.maxPurgeSaveThreshold. |

---

## References

[mbeans.md](../docs/mbeans.md) | [configurations.md](../docs/configurations.md) | [example-jmx-purge-and-restart.md](../examples/example-jmx-purge-and-restart.md)
