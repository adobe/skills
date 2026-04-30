# Runbooks — Cloud Service variant

These 12 runbooks are the **diagnosis and remediation playbooks** for production workflow incidents on AEM as a Cloud Service. Each one is keyed by a stable `symptom_id` and designed to be read top-to-bottom under incident pressure: read the header banner, walk the Decision Tree, execute the Checklist, apply the Remediation row that matches, and escalate if you hit the escalation criteria.

They are written for AEMaaCS. No JMX. All remediation lands via Git + Cloud Manager pipeline, `/aem/inbox`, or the bundled `StaleWorkflowServlet`. Where a customer might reach for a JMX operation by habit, each runbook's header banner names the operation and points at the Cloud Service equivalent.

## Pick a runbook by symptom

| symptom_id | Runbook |
|------------|---------|
| `workflow_stuck_not_progressing` | [runbook-workflow-stuck.md](runbook-workflow-stuck.md) |
| `task_not_in_inbox` | [runbook-task-not-in-inbox.md](runbook-task-not-in-inbox.md) |
| `workflow_not_starting_launcher` | [runbook-launcher-not-starting.md](runbook-launcher-not-starting.md) |
| `workflow_fails_or_shows_error` | [runbook-workflow-fails-or-shows-error.md](runbook-workflow-fails-or-shows-error.md) |
| `step_failed_retries_exhausted` | [runbook-failed-work-items.md](runbook-failed-work-items.md) |
| `stale_workflow_no_work_item` | [runbook-stale-workflows.md](runbook-stale-workflows.md) |
| `repository_bloat_too_many_instances` | [runbook-purge-and-cleanup.md](runbook-purge-and-cleanup.md) |
| `user_cannot_see_or_complete_item` | [runbook-inbox-and-permissions.md](runbook-inbox-and-permissions.md) |
| `cannot_delete_model` | [runbook-model-delete-and-update.md](runbook-model-delete-and-update.md) |
| `slow_throughput_queue_backlog` / `workflow_auto_advance_failure` | [runbook-job-throughput-and-concurrency.md](runbook-job-throughput-and-concurrency.md) |
| `workflow_setup_validation` | [runbook-validate-workflow-setup.md](runbook-validate-workflow-setup.md) |
| (router) | [runbook-decision-guide.md](runbook-decision-guide.md) |

Not sure which one? → [runbook-decision-guide.md](runbook-decision-guide.md) has the symptom → runbook → first-action table.

## If you see a JMX operation in a ticket or blog

- `countStaleWorkflows` / `restartStaleWorkflows(dryRun)` → [runbook-stale-workflows.md](runbook-stale-workflows.md) uses the bundled [`../examples/StaleWorkflowServlet.java`](../examples/StaleWorkflowServlet.java).
- `retryFailedWorkItems` → [runbook-failed-work-items.md](runbook-failed-work-items.md) uses `/aem/inbox` (preferred) or a bulk-replay servlet with audit-trail caveats.
- `purgeCompleted(dryRun)` / `purgeActive(dryRun)` → [runbook-purge-and-cleanup.md](runbook-purge-and-cleanup.md) uses Purge Scheduler OSGi config + the Granite Maintenance Task window.
- `returnSystemJobInfo` / `returnWorkflowQueueInfo` → [runbook-job-throughput-and-concurrency.md](runbook-job-throughput-and-concurrency.md) uses Developer Console → `/system/console/slingjobs`.
- `countRunningWorkflows` → [runbook-model-delete-and-update.md](runbook-model-delete-and-update.md) uses the Workflow Console filter or a superuser-gated read-only servlet.

Full JMX → Cloud Service translation table: [`../docs/mbeans.md`](../docs/mbeans.md).

## `cq.workflow.job.max.procs` is a myth

The property is not real on any AEM version (verified against `com.adobe.granite.workflow.core.WorkflowSessionFactory` source). The actual parallelism knob is `queue.maxparallel` on the `org.apache.sling.event.jobs.QueueConfiguration` factory entry for the Granite Workflow Queue — see [`../examples/org.apache.sling.event.jobs.QueueConfiguration-granitewfe.cfg.json`](../examples/org.apache.sling.event.jobs.QueueConfiguration-granitewfe.cfg.json).

## Bundled artifacts

- [`../examples/StaleWorkflowServlet.java`](../examples/StaleWorkflowServlet.java) — deployable servlet that replaces the JMX stale-workflow verbs. Gates on `WorkflowSession.isSuperuser()`; 403s non-superusers instead of returning silently partial data.
- [`../examples/com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json`](../examples/com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json) — retry, enforce flags, superuser group.
- [`../examples/com.adobe.granite.workflow.purge.Scheduler-completed.cfg.json`](../examples/com.adobe.granite.workflow.purge.Scheduler-completed.cfg.json) — Purge Scheduler factory config template.
- [`../examples/org.apache.sling.event.jobs.QueueConfiguration-granitewfe.cfg.json`](../examples/org.apache.sling.event.jobs.QueueConfiguration-granitewfe.cfg.json) — Granite Workflow Queue override with `queue.maxparallel` and `service.ranking` guidance.
- [`../examples/org.apache.sling.commons.threads.impl.DefaultThreadPool.config.json`](../examples/org.apache.sling.commons.threads.impl.DefaultThreadPool.config.json) — `maxPoolSize`, `blockPolicy` for the `default` thread pool (may be platform-reserved on some envs).

## See also

- [`../docs/debugging-index.md`](../docs/debugging-index.md) — machine-readable symptom → runbook index.
- [`../docs/error-patterns.md`](../docs/error-patterns.md) — log signatures catalog.
- [`../docs/mbeans.md`](../docs/mbeans.md) — JMX → Cloud Service operation translation.
- Parent skill entry point: [`../../SKILL.md`](../../SKILL.md) (incl. Step 5 OSGi property matrix and Step 6 remediation table).
