# AEM Workflow Debugging – Reference (6.5 LTS / AMS)

Quick pointers used by the workflow-debugging skill. For full runbooks and procedures, use the paths below inside this repo.

---

## Runbook locations (relative to repo root)

| Runbook | Path |
|---------|------|
| Decision guide (symptom → runbook) | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-decision-guide.md` |
| Debugging index (machine-readable) | `aem-agent-marketplace-workflow-knowledge-base/docs/debugging-index.md` |
| Workflow stuck | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-workflow-stuck.md` |
| Task not in Inbox | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-task-not-in-inbox.md` |
| Launcher not starting | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-launcher-not-starting.md` |
| Workflow fails / error | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-workflow-fails-or-shows-error.md` |
| Failed work items | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-failed-work-items.md` |
| Stale workflows | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-stale-workflows.md` |
| Purge and cleanup | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-purge-and-cleanup.md` |
| Inbox and permissions | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-inbox-and-permissions.md` |
| Model delete/update | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-model-delete-and-update.md` |
| Job throughput / concurrency | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-job-throughput-and-concurrency.md` |
| Validate workflow setup | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-validate-workflow-setup.md` |

---

## Key JMX and config (AEM 6.5 / AMS)

| Item | Where |
|------|--------|
| Workflow parallelism | WorkflowSessionFactory → `cq.workflow.job.max.procs` |
| Retry | WorkflowSessionFactory → `cq.workflow.job.retry` |
| Purge | WorkflowOperationsMBean (`com.adobe.granite.workflow:type=Maintenance`) or Purge Scheduler |
| Stale restart | JMX: `countStaleWorkflows`, `restartStaleWorkflows(dryRun` then execute) |
| Queue info | JMX: `returnSystemJobInfo`, `returnWorkflowQueueInfo` |
| Sling default thread pool | `org.apache.sling.commons.threads` DefaultThreadPool; block policy ABORT can reject workflow timeout jobs when pool is full |

---

## 6.5 LTS / AMS diagnostic tools

| Tool | Where | Purpose |
|------|-------|---------|
| Felix Console | /system/console | OSGi bundles, configs, components |
| JMX Console | /system/console/jmx | Workflow MBeans, Sling Job MBeans |
| Config Status ZIP | Felix Console → Status → Configuration Status | Full config dump, thread pools, Sling Jobs, schedulers |
| Thread dump | jstack or AMS support request | Thread analysis |
| Workflow Console | /libs/cq/workflow/admin/console/content/instances.html | Instance status, work items, history |
| Sling Job Console | /system/console/slingjobs | Queue depth, failed jobs, active jobs |
| Inbox | /aem/inbox | Retry failed work items, complete tasks |

---

## Log patterns (see also docs/error-patterns.md)

- `Error executing workflow step` – Process/step exception
- `getProcess for '<name>' failed` – Process not registered
- `Cannot archive workitem` – Stale risk
- `refreshing the session since we had to wait for a lock` – Contention
- `Terminate failed` / `Resume failed` / `Suspend failed` – Permissions
- `PathNotFoundException` (workflow/payload) – Payload or launcher path

---

## External docs (Experience League)

- [Workflows (6.5)](https://experienceleague.adobe.com/en/docs/experience-manager-65/content/sites/authoring/workflows/workflows)
- [Workflow API (6.5 Javadoc)](https://developer.adobe.com/experience-manager/reference-materials/6-5/javadoc/com/adobe/granite/workflow/exec/Workflow.html)
