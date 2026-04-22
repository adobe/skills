# AEM Workflow Debugging – Reference (6.5 LTS / AMS)

Quick pointers used by the workflow-debugging skill. All runbooks and supplementary
docs are bundled under `references/` so the skill is self-contained.

---

## Bundled runbooks (relative to this skill)

| Runbook | Path |
|---------|------|
| Decision guide (symptom → runbook) | `references/runbooks/runbook-decision-guide.md` |
| Workflow stuck | `references/runbooks/runbook-workflow-stuck.md` |
| Task not in Inbox | `references/runbooks/runbook-task-not-in-inbox.md` |
| Launcher not starting | `references/runbooks/runbook-launcher-not-starting.md` |
| Workflow fails / error | `references/runbooks/runbook-workflow-fails-or-shows-error.md` |
| Failed work items | `references/runbooks/runbook-failed-work-items.md` |
| Stale workflows | `references/runbooks/runbook-stale-workflows.md` |
| Purge and cleanup | `references/runbooks/runbook-purge-and-cleanup.md` |
| Inbox and permissions | `references/runbooks/runbook-inbox-and-permissions.md` |
| Model delete/update | `references/runbooks/runbook-model-delete-and-update.md` |
| Job throughput / concurrency | `references/runbooks/runbook-job-throughput-and-concurrency.md` |
| Validate workflow setup | `references/runbooks/runbook-validate-workflow-setup.md` |

---

## Bundled supplementary docs

| Doc | Path | Purpose |
|-----|------|---------|
| Debugging index (machine-readable map) | `references/docs/debugging-index.md` | symptom_id → runbook / logs / JMX |
| Error patterns | `references/docs/error-patterns.md` | Full log-pattern catalog (SKILL.md Step 4 is a subset) |
| MBeans | `references/docs/mbeans.md` | JMX MBean reference for Maintenance / Repository operations |

---

## Key JMX and config (AEM 6.5 LTS / AMS)

| Item | Where |
|------|--------|
| Workflow parallelism | Granite Workflow Queue → `org.apache.sling.event.jobs.QueueConfiguration` → `queue.maxparallel`. (The oft-cited `cq.workflow.job.max.procs` on `WorkflowSessionFactory` is a myth — not a real property.) |
| Retry | WorkflowSessionFactory → `cq.workflow.job.retry` |
| Purge | WorkflowOperationsMBean (`com.adobe.granite.workflow:type=Maintenance`) or Purge Scheduler |
| Stale restart | JMX: `countStaleWorkflows`, `restartStaleWorkflows(dryRun=true)` then execute |
| Queue info | JMX: `returnSystemJobInfo`, `returnWorkflowQueueInfo` |
| Sling default thread pool | `org.apache.sling.commons.threads` DefaultThreadPool; block policy `ABORT` can reject workflow timeout jobs when pool is full |

---

## 6.5 LTS / AMS diagnostic tools

| Tool | Where | Purpose |
|------|-------|---------|
| Felix Console | `/system/console` | OSGi bundles, configs, components |
| JMX Console | `/system/console/jmx` | Workflow MBeans, Sling Job MBeans |
| Config Status ZIP | Felix Console → Status → Configuration Status | Full config dump, thread pools, Sling Jobs, schedulers |
| Thread dump | `jstack` or AMS support request | Thread analysis |
| Workflow Console | `/libs/cq/workflow/admin/console/content/instances.html` | Instance status, work items, history |
| Sling Job Console | `/system/console/slingjobs` | Queue depth, failed jobs, active jobs |
| Inbox | `/aem/inbox` | Retry failed work items, complete tasks |

---

## Log patterns (see `references/docs/error-patterns.md` for the full catalog)

- `Error executing workflow step` – process/step exception
- `getProcess for '<name>' failed` – process not registered
- `Cannot archive workitem` – stale risk
- `refreshing the session since we had to wait for a lock` – contention
- `Terminate failed` / `Resume failed` / `Suspend failed` – permissions
- `PathNotFoundException` (workflow/payload) – payload or launcher path

---

## External docs (Experience League)

- [Workflows (AEM 6.5)](https://experienceleague.adobe.com/en/docs/experience-manager-65/content/sites/authoring/workflows/workflows)
- [Workflow API (6.5 Javadoc)](https://developer.adobe.com/experience-manager/reference-materials/6-5/javadoc/com/adobe/granite/workflow/exec/Workflow.html)
