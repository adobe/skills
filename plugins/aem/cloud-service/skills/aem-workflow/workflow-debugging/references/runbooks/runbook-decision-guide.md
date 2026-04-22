# Runbook: Decision guide (symptom → runbook) — Cloud Service

**Purpose:** Route to the correct runbook and first action on **AEM as a Cloud Service**. No JMX. Full machine-readable index: [`../docs/debugging-index.md`](../docs/debugging-index.md).

> **Variant:** Cloud Service. For the 6.5 LTS / AMS decision guide, use the 6.5-lts variant of this skill — JMX-based first actions there are replaced below with servlet / OSGi-config / Developer Console equivalents.

---

## symptom_id → Runbook → First step (Cloud Service)

| symptom_id | Runbook | First step on AEMaaCS |
|------------|---------|----------------------|
| `workflow_stuck_not_progressing` | [runbook-workflow-stuck.md](runbook-workflow-stuck.md) | Open instance in Workflow Console; note current step type. No work item → [runbook-stale-workflows.md](runbook-stale-workflows.md). Else follow decision tree. |
| `task_not_in_inbox` | [runbook-task-not-in-inbox.md](runbook-task-not-in-inbox.md) | Instance at Participant step? Assignee = logged-in user? Clear Inbox filters. |
| `workflow_not_starting_launcher` | [runbook-launcher-not-starting.md](runbook-launcher-not-starting.md) | Launcher config exists under `/conf/global/settings/workflow/launcher/config`, enabled; path and event type match. |
| `workflow_fails_or_shows_error` | [runbook-workflow-fails-or-shows-error.md](runbook-workflow-fails-or-shows-error.md) | Instance History for error; Cloud Manager logs for instance ID / step; payload and process registration. |
| `step_failed_retries_exhausted` | [runbook-failed-work-items.md](runbook-failed-work-items.md) | Cloud Manager logs → `process.label` → `/aem/inbox` Retry (preferred) or bulk replay servlet (audit-trail caveats). |
| `stale_workflow_no_work_item` | [runbook-stale-workflows.md](runbook-stale-workflows.md) | Deploy [`../examples/StaleWorkflowServlet.java`](../examples/StaleWorkflowServlet.java); `GET /bin/support/workflow/stale?dryRun=true` to enumerate, then `POST ...?dryRun=false`. |
| `repository_bloat_too_many_instances` | [runbook-purge-and-cleanup.md](runbook-purge-and-cleanup.md) | Deploy Purge Scheduler OSGi factory config; ensure Granite Maintenance Task window is active. No ad-hoc JMX purge on AEMaaCS. |
| `user_cannot_see_or_complete_item` | [runbook-inbox-and-permissions.md](runbook-inbox-and-permissions.md) | Check `enforceWorkitemAssigneePermissions` / `enforceWorkflowInitiatorPermissions` / `cq.workflow.superuser` in `WorkflowSessionFactory.cfg.json`. |
| `cannot_delete_model` | [runbook-model-delete-and-update.md](runbook-model-delete-and-update.md) | Workflow Console → filter by model → terminate RUNNING instances → delete model. |
| `slow_throughput_queue_backlog` | [runbook-job-throughput-and-concurrency.md](runbook-job-throughput-and-concurrency.md) | Developer Console → `/system/console/slingjobs` → Granite Workflow Queue; `queue.maxparallel` on `QueueConfiguration` factory. |
| `workflow_auto_advance_failure` | [runbook-job-throughput-and-concurrency.md](runbook-job-throughput-and-concurrency.md) | Same queue check; plus Developer Console → Status → Threads for `default` pool saturation. |
| `workflow_setup_validation` | [runbook-validate-workflow-setup.md](runbook-validate-workflow-setup.md) | Run Checklist (model sync, launcher, process registration, permissions). |

---

## How first-actions differ from 6.5 LTS / AMS

| 6.5 LTS / AMS first action | Cloud Service replacement |
|----------------------------|---------------------------|
| JMX `countStaleWorkflows` / `restartStaleWorkflows(dryRun)` | `StaleWorkflowServlet` at `/bin/support/workflow/stale` (bundled example) |
| JMX `retryFailedWorkItems` | `/aem/inbox` Retry per item, or bulk replay servlet (audit caveats) |
| JMX `purgeCompleted(dryRun)` / `purgeActive(dryRun)` | Purge Scheduler OSGi factory config + Granite Maintenance Task window (no ad-hoc purge) |
| JMX `countRunningWorkflows` | Workflow Console filter by model + RUNNING state, or a superuser-gated read-only servlet |
| JMX `returnSystemJobInfo` / `returnWorkflowQueueInfo` | Developer Console → `/system/console/slingjobs` on lower envs; Support ticket on prod |
| Felix Console → runtime OSGi config change | Git commit → Cloud Manager pipeline deploy |
| `error.log` on disk | Cloud Manager → Environments → Logs (download or streaming) |
| Felix Console → Configuration Status ZIP | Request from Adobe Support (ticket with timestamp range and environment ID) |

---

## References

- Machine-readable symptom index: [`../docs/debugging-index.md`](../docs/debugging-index.md)
- Error-pattern catalog: [`../docs/error-patterns.md`](../docs/error-patterns.md)
- What the JMX MBeans did (and the Cloud Service equivalents): [`../docs/mbeans.md`](../docs/mbeans.md)
