# AEM Workflow Debugging – Reference (6.5 LTS / AMS)

Quick pointers used by the workflow-debugging skill. Use the SKILL.md Step 1
symptom table for the symptom → first-action map; the entries below are for
quick access to JMX/config, diagnostic tools, log patterns, and external docs.

---

## Key JMX and config (AEM 6.5 / AMS)

| Item | Where |
|------|--------|
| Workflow parallelism | Apache Sling Job Queue Configuration → "Granite Workflow Queue" → `queue.maxparallel`. Note: the `cq.workflow.job.max.procs` property displayed under WorkflowSessionFactory has no runtime effect |
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
| Sling Jobs page | /system/console/slingevent | Queue depth, failed jobs, active jobs, topic statistics |
| Sling Thread Pools | /system/console/status-slingthreadpools | Per-pool active count, max size, block policy |
| Threads | /system/console/status-Threads | Live thread states with stacks |
| jstack thread dump | /system/console/status-jstack-threaddump | jstack-style snapshot |
| Sling Scheduler | /system/console/status-slingscheduler | Quartz-scheduled jobs and their ThreadPool |
| Inbox | /aem/inbox | Retry failed work items, complete tasks |

---

## Log patterns

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
