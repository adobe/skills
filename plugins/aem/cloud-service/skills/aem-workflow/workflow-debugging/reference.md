# AEM Workflow Debugging – Reference (Cloud Service)

Quick pointers used by the workflow-debugging skill. Use the SKILL.md Step 1
symptom table for the symptom → first-action map; the entries below are for
quick access to diagnostic tools, log patterns, and external documentation.

---

## Cloud Service diagnostic tools

| Tool | Where | Purpose |
|------|-------|---------|
| Developer Console | AEM Cloud Service → Developer Console | Thread dumps, OSGi bundles, config, status producers |
| Cloud Manager Logs | Cloud Manager → Environments → Logs | `error.log`, `access.log`, `request.log` download/streaming |
| Workflow Console | `/libs/cq/workflow/admin/console/content/instances.html` | Instance status, work items, history |
| Sling Jobs page | `/system/console/slingevent` | Queue depth, failed jobs, active jobs (read-only) |
| Sling Thread Pools page | `/system/console/status-slingthreadpools` | Per-pool active count, max size, block policy |
| Threads page | `/system/console/status-Threads` | Live thread states; full stacks |
| Thread dump | `/system/console/status-jstack-threaddump` | jstack-style snapshot |
| Sling Scheduler page | `/system/console/status-slingscheduler` | Scheduled jobs and their ThreadPool |
| OSGi Configuration | `/system/console/configMgr` | Read and (on lower envs) edit OSGi configs |
| Inbox | `/aem/inbox` | Retry failed work items, complete tasks |

Note: `/system/console/jmx` is **not** available on AEMaaCS production. The same
MBeans exist on the local AEMaaCS SDK, but production diagnosis must use the
status producers above plus Cloud Manager logs.

---

## Log patterns

- `Error executing workflow step` – process/step exception
- `getProcess for '<name>' failed` – process not registered (`process.label` mismatch)
- `Cannot archive workitem` – stale risk; archive failed during step transition
- `refreshing the session since we had to wait for a lock` – contention; **reduce** `queue.maxparallel`, do not raise it
- `Terminate failed` / `Resume failed` / `Suspend failed` – permissions (not initiator or superuser)
- `PathNotFoundException` (workflow/payload) – payload deleted, or launcher config path missing
- `RejectedExecutionException` – thread pool full with `blockPolicy=ABORT`; timeout jobs dropped
- `retrys exceeded - remove isTransient` – transient workflow failed after `cq.workflow.job.retry` exhausted

---

## External docs

- [Working with Workflows (Cloud Service)](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/sites/authoring/workflows/overview)
- [Workflow API (AEMaaCS Javadoc)](https://developer.adobe.com/experience-manager/reference-materials/cloud-service/javadoc/com/adobe/granite/workflow/exec/Workflow.html)
- [Configuring OSGi for AEM Cloud Service](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/deploying/configuring-osgi)
- [AEMaaCS repoinit (Deploying overview → Repoinit)](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/deploying/overview#repoinit)
