# AEM Workflow Debugging – Reference (Cloud Service)

Quick pointers used by the workflow-debugging skill. All runbooks and supplementary
docs are bundled under `references/` so the skill is self-contained.

> **Cloud Service note:** the bundled runbooks were originally authored against
> AEM 6.5 and still reference JMX MBeans. On AEMaaCS there is **no JMX access**.
> Use the JMX → Cloud Service translation table below when a runbook tells you
> to invoke a JMX operation. The diagnosis checklists in the runbooks still apply;
> only the remediation mechanism changes.

---

## JMX → Cloud Service remediation translation

| Runbook says (JMX) | Cloud Service equivalent |
|--------------------|--------------------------|
| `restartStaleWorkflows(dryRun)` | Deploy custom servlet (see `references/examples/StaleWorkflowServlet.java`) invoked via Developer Console / `curl` |
| `countStaleWorkflows(model)` | Same custom servlet, `?dryRun=true&count=true` — or a Sling query against `/var/workflow/instances` joined with `status=RUNNING` and absent `cq:currentWorkitem` |
| `retryFailedWorkItems` | Inbox → Retry (per item); or custom servlet using `WorkflowSession.terminateWorkflow` + `startWorkflow` with the same payload for bulk |
| `purgeCompleted(dryRun)` | Purge Scheduler config in Git → deploy via Cloud Manager pipeline (see `references/examples/com.adobe.granite.workflow.purge.Scheduler-*.cfg.json`) |
| `returnSystemJobInfo` | Sling Job Console at `/system/console/slingjobs` (read-only) |
| `returnWorkflowQueueInfo` | Sling Job Console → Granite Workflow Queue section |
| JMX-based config tweaks (retry, superuser, assignee/initiator enforcement) | OSGi config JSON in Git under `ui.config/src/main/content/jcr_root/apps/.../osgiconfig/config(.author)/` deployed via pipeline — see `references/examples/com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json`. |
| Workflow parallelism (mis-cited as JMX or `max.procs` elsewhere) | Granite Workflow Queue via `org.apache.sling.event.jobs.QueueConfiguration-granitewfe.cfg.json` → `queue.maxparallel`. The `cq.workflow.job.max.procs` property does not exist. |

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

## Bundled supplementary docs and examples

| Doc / example | Path | Purpose |
|---------------|------|---------|
| Debugging index | `references/docs/debugging-index.md` | symptom_id → runbook / logs |
| Error patterns | `references/docs/error-patterns.md` | Full log-pattern catalog |
| MBeans (reference only) | `references/docs/mbeans.md` | Historical JMX reference; translate via table above |
| Stale workflow servlet (stub) | `references/examples/StaleWorkflowServlet.java` | Custom replacement for JMX `restartStaleWorkflows` |
| Workflow session factory config | `references/examples/com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json` | OSGi config example for retry / superuser / assignee + initiator enforcement. Does **not** include `cq.workflow.job.max.procs` — that property does not exist on this PID. |
| Granite Workflow Queue config | `references/examples/org.apache.sling.event.jobs.QueueConfiguration-granitewfe.cfg.json` | Actual workflow parallelism knob (`queue.maxparallel`). Required override if you need to raise parallelism on AEMaaCS. |
| Default thread pool config | `references/examples/org.apache.sling.commons.threads.impl.DefaultThreadPool.config.json` | OSGi config example for block policy and max pool size |

---

## Cloud Service diagnostic tools

| Tool | Where | Purpose |
|------|-------|---------|
| Developer Console | AEM Cloud Service → Developer Console | Thread dumps, OSGi bundles, config, status producers |
| Cloud Manager Logs | Cloud Manager → Environments → Logs | `error.log`, `access.log`, `request.log` download/streaming |
| Workflow Console | `/libs/cq/workflow/admin/console/content/instances.html` | Instance status, work items, history |
| Sling Job Console | `/system/console/slingjobs` | Queue depth, failed jobs, active jobs (read-only) |
| Inbox | `/aem/inbox` | Retry failed work items, complete tasks |

Note: `/system/console/jmx` is **not** available on AEMaaCS.

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

- [Workflows overview (Cloud Service)](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/sites/authoring/workflows/overview)
- [Workflow API (6.5 Javadoc — API is shared with AEMaaCS)](https://developer.adobe.com/experience-manager/reference-materials/6-5/javadoc/com/adobe/granite/workflow/exec/Workflow.html)
- [AEMaaCS OSGi configuration](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/deploying/configuring-osgi)
- [AEMaaCS repoinit](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/deploying/overview-repoinit)
