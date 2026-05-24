---
name: workflow-debugging
description: Debug AEM Workflow issues on AEM as a Cloud Service — stuck workflows, failed steps, missing Inbox tasks, launcher failures, stale instances, thread pool exhaustion, queue backlogs, purge failures, and permissions errors. Use when the user reports workflow problems on Cloud Service, asks why a workflow is stuck or failed, needs step-by-step troubleshooting, or provides thread dumps, configuration status output, or Sling Job console output for analysis.
license: Apache-2.0
---

# AEM Workflow Debugging — Cloud Service

Production-grade debugging for the AEM Granite Workflow engine, launcher, Inbox, Sling Jobs, thread pools, and purge on **AEM as a Cloud Service (AEMaaCS)**.

## Audience

AEMaaCS developers and operators (and the IDE LLM acting on their behalf) diagnosing stuck or failed workflows on a local AEMaaCS SDK or a cloud environment — Developer Console, Sling Job Console, and Cloud Manager Logs available; no production Felix Console JMX or filesystem access.

## Variant Scope

- AEM as a Cloud Service only.
- **Not for AEM 6.5 LTS / AMS.** If the target is 6.5 LTS, stop and load the 6.5-lts variant of this skill — JMX-based remediation, Felix Console runtime config, AMS log filesystem access, and `jstack` thread dumps documented there do not apply on AEMaaCS.
- **No JMX access on AEMaaCS production.** Diagnosis is read-only via Developer Console, Sling Job Console, and Cloud Manager Logs. **Never recommend JMX-based remediation** (`restartStaleWorkflows`, `purgeCompleted`, `terminate`, `retryFailedWorkItems`) — those are 6.5-LTS-only mechanisms. Use Inbox Retry, Purge Scheduler (OSGi config in Git), custom servlets like `StaleWorkflowServlet`, and Cloud Manager pipeline-driven config changes instead.
- **All remediation lands via Git + Cloud Manager pipeline:** OSGi configs in `ui.config`, custom servlets in `core`, ACLs in `ui.apps/.../repoinit`. There is no Felix Console write access on cloud environments.
- See [reference.md](reference.md) for runbook locations and diagnostic tool pointers.

## Dependencies

This skill is largely self-contained but routes back into the dev skills when the root cause is a code or model defect:

- `workflow-development` — when the diagnosis is "process step throws / not registered / leaks resources"
- `workflow-model-design` — when the diagnosis is "model has wrong split rule / missing transition / wrong step type"
- `workflow-launchers` — when the diagnosis is "launcher not firing / re-trigger loop"
- `workflow-triaging` — load instead of this skill if the user is mining Cloud Manager Logs across multiple environments rather than diagnosing one

---

## When to use this skill

- Workflow stuck, not progressing, failed, not starting, task not in Inbox, purge/repository bloat, permissions, queue backlog, thread pool exhaustion, auto-advancement not working.
- User provides thread dumps, Sling Job console output, or error.log excerpts from Cloud Manager.
- Environment: AEM as a Cloud Service (no JMX; use Developer Console, Cloud Manager logs).

---

## Step 1: Map symptom to first action

| Symptom | symptom_id | First action |
|---------|------------|--------------|
| Workflow stuck (not advancing) | workflow_stuck_not_progressing | Open instance; note current step type. No work item → stale. |
| Task not in Inbox | task_not_in_inbox | Confirm Participant step; assignee = logged-in user; Inbox filters. |
| Workflow not starting (launcher) | workflow_not_starting_launcher | Launcher enabled; path/event match payload. |
| Workflow fails or shows error | workflow_fails_or_shows_error | Instance history; error.log for instance ID; payload and process. |
| Step failed, retries exhausted | step_failed_retries_exhausted | Logs → `process.label` → Inbox Retry, or bulk via custom servlet (see Step 6). |
| Stale (no current work item) | stale_workflow_no_work_item | Deploy a custom `StaleWorkflowServlet` to your `core` bundle; invoke with `?dryRun=true`. |
| Repository bloat / too many instances | repository_bloat_too_many_instances | Purge Scheduler OSGi config in Git (PID: `com.adobe.granite.workflow.purge.Scheduler`). |
| User cannot see or complete item | user_cannot_see_or_complete_item | Assignee / initiator / superuser group; `enforce*Permissions` flags. |
| Cannot delete model | cannot_delete_model | Count RUNNING instances via Workflow Console → terminate → delete model. |
| Slow throughput / queue backlog | slow_throughput_queue_backlog | Sling Job statistics; Granite Workflow Queue `queue.maxparallel`; Sling thread pool. |
| Auto-advancement not working | workflow_auto_advance_failure | Check `default` thread pool saturation; Sling Scheduler; timeout jobs. |
| New workflow not working | workflow_setup_validation | Model sync, launcher, process registration, permissions. |

---

## Step 2: Decision tree (workflow stuck)

1. **No current work item?** → Stale. Deploy a custom `StaleWorkflowServlet` to your `core` bundle; call `GET /bin/support/workflow/stale?dryRun=true` to enumerate, then `POST ...?dryRun=false` to restart.
2. **Participant step** → Assignee exists? Inbox visible? Payload accessible? Dynamic participant resolver returning correct user?
3. **Process step** → Search error.log for instance ID. Check: `process.label` registered, payload path exists, bundle active, no exception in `execute()`.
4. **OR/AND Split** → Condition evaluates correctly? Routes exist? No dead-end branches? Model synced?

---

## Step 3: Thread dump & thread pool analysis

Thread dumps and status-producer output on AEMaaCS are obtained via **Developer Console → Status → Thread Dump / OSGi / Sling Jobs / Sling Scheduler**. For anything not exposed in Developer Console, open an Adobe Support ticket — **never** attempt to SSH into an AEMaaCS pod.

### 3a. Sling `default` thread pool (critical path)

The Sling Scheduler `ApacheSlingdefault` uses `ThreadPool: default`. This pool runs:
- Oak observation events
- All Quartz-scheduled jobs — including the workflow timeout-detection scheduler that emits `com/adobe/granite/workflow/timeout/job` events to the Sling Job system (the job itself then runs on the Granite Workflow Queue, see Step 3c)

**Check in thread pool output (Developer Console → Status → Sling Thread Pools, `/system/console/status-slingthreadpools`):**

| Field | Healthy | Problem |
|-------|---------|---------|
| active count | < max pool size | **= max pool size** (saturated) |
| block policy | RUN | **ABORT** (rejects tasks when full) |
| max pool size | sized for workload | OOTB on the AEMaaCS SDK is **10/10**; production environments may differ. Bump in OSGi config when many custom periodic schedulers compete with workflow timeout detection. |

**If active count = max pool size AND block policy = ABORT:**
- New scheduled tasks (including workflow timeout/auto-advance jobs) are **silently rejected**
- This is the #1 cause of auto-advancement failure

**Check in thread dump:**
- Search for `sling-default-` threads
- If all threads show same stack (e.g. stuck on HTTP call, database, or external service), that's the blocking culprit
- Note `elapsed` time — threads stuck for hours indicate a hung external call without timeout

### 3b. Sling Job thread pool

**Check `Apache Sling Job Thread Pool`:**
- active count vs max pool size
- If saturated, Sling Jobs cannot execute (workflow jobs stall)

### 3c. Granite Workflow Queue

**Check the Sling Jobs page (`/system/console/slingevent`):**

| Field | Healthy | Problem |
|-------|---------|---------|
| Queued Jobs (overall) | 0 | > 0 (jobs waiting) |
| Failed Jobs | 0 | > 0 (step failures) |
| Active Jobs | 0-N | 0 when Queued > 0 (jobs not picked up) |

**Check topic statistics for workflow model:**
- Topic: `com/adobe/granite/workflow/job/var/workflow/models/<modelName>`
- High `Failed Jobs` / low `Finished Jobs` ratio → process step throwing exceptions

**Check Granite Workflow Queue configuration:**
- Type: Topic Round Robin
- Max Parallel: **`0.5` OOTB on the AEMaaCS SDK** (50% of available CPU cores). Adobe's *Workflows Best Practices* recommends **between half and three-quarters of processor cores**. Verify the running value at Developer Console → `/system/console/slingevent` before assuming. Override via `org.apache.sling.event.jobs.QueueConfiguration-<alias>.cfg.json` in Git if you need to raise it.
- Max Retries: 10

### 3d. Sling Scheduler

**Check the Sling Scheduler page (Developer Console → Status → Sling Scheduler, `/system/console/status-slingscheduler`):**
- This page lists Quartz-style schedulers, not Sling Job topics. The workflow-related entry visible here is the periodic `WorkflowStatsMBean` collector (used by the Statistics MBean). `nextFireTime: null` means the trigger was deregistered.
- The `com/adobe/granite/workflow/timeout/job` topic itself is a **Sling Job**, not a Quartz job — check it on the Sling Jobs page (`/system/console/slingevent`), not here.
- Confirm `ApacheSlingdefault` uses `ThreadPool: default` — that's how the periodic timeout-detection scheduler reaches the workflow engine.

---

## Step 4: Error log patterns

Download error.log from **Cloud Manager** → Environments → Logs, or use log streaming.

| Pattern | Cause | Action |
|---------|-------|--------|
| `Error executing workflow step` | Process step exception | Check stack; fix process code or payload |
| `getProcess for '<name>' failed` | No WorkflowProcess registered | Deploy bundle; match `process.label` |
| `Cannot archive workitem` | Archive failure → stale risk | Detect and restart stale workflows |
| `refreshing the session since we had to wait for a lock` | Lock contention on `/var/workflow` | **Reduce** (not raise) parallelism — lower `queue.maxparallel` on the Granite Workflow Queue, or stagger launchers. Raising parallelism makes this worse. |
| `Terminate failed` / `Resume failed` / `Suspend failed` | Permissions (not initiator/superuser) | Check `enforceWorkflowInitiatorPermissions`; add to superusers |
| `PathNotFoundException` (workflow/payload) | Payload/launcher path missing | Verify payload exists; check launcher config path |
| `Error adding launcher config` | Launcher config path not created | Create `/conf/global/settings/workflow/launcher/config` |
| `retrys exceeded - remove isTransient` | Transient workflow failed after retries | Fix process code; instance persisted for admin handling |
| `RejectedExecutionException` | Thread pool full with ABORT policy | Increase pool size or change policy to RUN via config; fix stuck threads |
| `Workflow is already finished` | Terminate on completed/aborted instance | Check logic calling terminate |
| `Workflow purge '<name>' : repository exception` | Purge JCR error | Check permissions; repo health |

---

## Step 5: Configuration checklist (Cloud Service — all via Git + pipeline)

Every config below is an OSGi JSON file under
`ui.config/src/main/content/jcr_root/apps/<project>/osgiconfig/config.author/`
(or `config.author.prod/` / `config.author.stage/` for run-mode scoping).

| Config file (PID) | Property | Guidance |
|-------------------|----------|----------|
| `com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json` | `cq.workflow.job.retry` | Default `3`; raise for flaky external calls. |
| `org.apache.sling.event.jobs.QueueConfiguration-<alias>.cfg.json` | `queue.maxparallel` | **Real parallelism knob** for workflow jobs (factory PID targeting topics `com/adobe/granite/workflow/job/*`). OOTB on the AEMaaCS SDK is `0.5` (50% of CPU cores); Adobe's *Workflows Best Practices* recommends **between half and three-quarters of processor cores**. `cq.workflow.job.max.procs` displayed in Felix Config Manager is an **orphaned metatype label** with no Java code path that reads it (verified against AEM source on `master`) — do not rely on it. |
| `com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json` | `granite.workflow.enforceWorkitemAssigneePermissions` | `true` = only the assignee can see / complete a work item. |
| `com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json` | `granite.workflow.enforceWorkflowInitiatorPermissions` | `true` = only the initiator (or superuser) can terminate / suspend / resume. |
| `com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json` | `cq.workflow.superuser` | **AEMaaCS specific:** point this at a **group** provisioned via `repoinit` (e.g. `workflow-administrators`), **not** hard-coded user IDs. Users are federated from IMS and rotate; groups are stable. Service-user mappings go in `org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-*.cfg.json`. |
| `com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json` | `granite.workflow.inboxQuerySize` | Max work items returned per Inbox query. OOTB `2000`; raise if heavy users hit the cap. |
| `com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json` | `granite.workflow.maxPurgeSaveThreshold` | OOTB `20` — commit after this many purged instances. Raise carefully to reduce JCR overhead during large purges. |
| `com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json` | `granite.workflow.maxPurgeQueryCount` | OOTB `1000` — JCR query batch size during purge. Tune with `maxPurgeSaveThreshold` above. |
| `org.apache.sling.commons.threads.impl.DefaultThreadPool-default.cfg.json` | `blockPolicy` | `ABORT` silently drops workflow timeout jobs — prefer `RUN`. *See AEMaaCS caveat below this table.* |
| `org.apache.sling.commons.threads.impl.DefaultThreadPool-default.cfg.json` | `maxPoolSize` | **OOTB on the AEMaaCS SDK is `10`** (factory entry for the `default` pool); production environments may differ. Raise to `50` if many custom schedulers compete with workflow timeout detection. *See AEMaaCS caveat below this table.* |
| `com.adobe.granite.workflow.purge.Scheduler-<alias>.cfg.json` | `scheduledpurge.workflowStatus` | **Array-typed.** Must be `["COMPLETED"]`, not `"COMPLETED"`. Also: this PID has **no** `scheduledpurge.cron` — scheduling is driven by the Granite Maintenance Task window; any `cron` property is silently ignored. |
| `com.adobe.granite.workflow.purge.Scheduler-<alias>.cfg.json` | `scheduledpurge.daysold` | `30` default; tune per environment. Factory PID — deploy one file per purge schedule. |

### AEMaaCS caveat — Sling DefaultThreadPool config may be platform-reserved

Some Sling core configs are filtered or overridden by the AEMaaCS platform layer. The `DefaultThreadPool` config *may* land via pipeline and be silently ignored. **Always verify** after deploy:

- Open `/system/console/status-Threads` (Developer Console → Status → Threads).
- Find the `default` pool row.
- Confirm `maxPoolSize` and block policy reflect your config values.

If the numbers don't change, the PID is Adobe-managed on your environment — **do not** try to work around it. Open an Adobe Support ticket, attach a thread dump and the thread-pool status, and request Engineering lift the pool size or change block policy for that environment.

### Permission and identity gotchas specific to AEMaaCS

- **Never** list IMS user IDs in `cq.workflow.superuser`. IMS principals change on re-invite. Reference a JCR group that `repoinit` creates. Correct repoinit syntax:
  ```
  create group workflow-administrators
  add admin to group workflow-administrators
  ```
  The `group` keyword after `to` is **required** — without it the repoinit parser fails and the entire script aborts on startup.
- Custom process steps that need elevated access must use a **service user** + `ServiceUserMapperImpl.amended-*.cfg.json`, not `resolver.adaptTo(Session.class)` + admin.
- `enforceWorkflowInitiatorPermissions=true` + an initiator who is a rotated IMS user leaves workflows unterminable except by superuser. On Cloud Service, prefer superuser-group membership for anyone expected to recover workflows.

---

## Step 6: Remediation quick reference (Cloud Service)

| Action | Cloud Service approach |
|--------|------------------------|
| Retry failed work item (single) | `/aem/inbox` → select failure → **Retry**. History and audit trail preserved. |
| Retry failed work items (bulk) | **Preferred:** iterate `/aem/inbox` UI — single-item Retry preserves the original instance, its history, and its audit trail. **Not recommended:** a "bulk" servlet using `terminateWorkflow(wf)` + `startWorkflow(model, data)` — this creates a **new** instance and **loses** the original history, step durations, and comments. Only use the replay approach with explicit customer approval and *never* for audit-regulated workflows (pharma, finance, legal). |
| Restart stale workflows | Deploy a custom `StaleWorkflowServlet` to your `core` bundle. Always invoke `GET /bin/support/workflow/stale?dryRun=true` first; confirm scope; then `POST ...?dryRun=false`. Scope with `&model=<modelId>` if you only want one model. |
| Purge completed | Deploy `com.adobe.granite.workflow.purge.Scheduler-<alias>.cfg.json` with `scheduledpurge.workflowStatus=["COMPLETED"]` (array-typed) and `scheduledpurge.daysold=<N>`. Triggered by the **Granite Maintenance Task window** — this PID has **no** `scheduledpurge.cron`; any cron property is silently ignored. **Do not** reference `/libs/granite/operations/config/maintenance` — on AEMaaCS `/libs` is the read-only code layer. One purge config file per schedule. Deploy via pipeline. |
| Increase parallelism | `queue.maxparallel` on `org.apache.sling.event.jobs.QueueConfiguration-<alias>.cfg.json` (topics: `com/adobe/granite/workflow/job/*`). Adobe's *Workflows Best Practices* recommends staying between half and three-quarters of available CPU cores. The commonly cited `cq.workflow.job.max.procs` is an **orphaned metatype label** with no Java code path that reads it (verified against AEM source on `master`) — do not waste a deployment on it. **Verify after deploy:** Developer Console → `/system/console/slingevent` → find the **Granite Workflow Queue** row and confirm `queue.maxparallel` shows your value. If it still shows the OOTB value (`0.5` on the AEMaaCS SDK), your override lost the `service.ranking` tiebreak — raise `service.ranking` in your override (e.g. from `100` to `1000`) and redeploy. If your ranking *matches* Adobe's OOB ranking exactly, Sling can register both queues against the same topic and occasionally execute a workflow step twice — always set a higher, non-equal ranking. Watch for `refreshing the session since we had to wait for a lock` after raising; if it appears, lower parallelism or stagger launchers. |
| Fix thread pool exhaustion | Short-term: **open an Adobe Support ticket** requesting a pod restart for the affected environment — AEMaaCS does **not** expose a customer-facing restart action in Cloud Manager. Long-term, all via Git + pipeline: (1) fix the stuck scheduler (add HTTP timeouts; `@Component scheduler.concurrent=false`); (2) set `blockPolicy=RUN` in `org.apache.sling.commons.threads.impl.DefaultThreadPool-default.cfg.json`; (3) raise `maxPoolSize` to 50. Verify the thread-pool config actually applied — see the AEMaaCS caveat in Step 5. |
| Fix process not found | Redeploy the `core` bundle; the `@Component process.label` must exactly match the model's Process step. Re-sync the workflow model from `/libs/cq/workflow/admin` after deploy. |
| Fix auto-advancement | Verify `sling-default-*` pool not saturated in thread dump; `com/adobe/granite/workflow/timeout/job` topic active on the Sling Jobs page (`/system/console/slingevent`) — it is a Sling Job topic, not a Sling Scheduler entry; `blockPolicy=RUN` on the `default` pool. |

> **Pod-restart reality on AEMaaCS:** Cloud Manager does **not** expose a customer-facing pod-restart or env-restart action. The only way a customer can trigger a restart is an Adobe Support ticket. A restart bounces the running author/publish node — in-flight authoring sessions are lost, active jobs are requeued, there is no hot-swap. Treat it as last-resort mitigation, not a fix, and always file the long-term code/config fix in the same support conversation.

---

## Step 7: Common root cause patterns (from real incidents)

### Pattern A: Thread pool starvation → auto-advance failure

**Symptom:** Workflow auto-advancement stops; timeout jobs not firing; workflows stuck at participant step despite timeout configured.

**Root cause chain:**
1. Custom scheduler makes blocking HTTP call without timeout
2. `concurrent = true` allows overlapping executions on each cron trigger
3. Each stuck execution consumes a `default` pool thread indefinitely
4. All pool threads consumed (OOTB on the AEMaaCS SDK that's `10`; production environments may differ) → pool saturated
5. If block policy has been changed to `ABORT` (OOTB is `RUN`), new Quartz triggers are rejected silently; on `RUN` they instead pile up on the caller thread and back-pressure the dispatch
6. The workflow timeout-detection scheduler cannot dispatch new `com/adobe/granite/workflow/timeout/job` events
7. Auto-advancement never happens

**Diagnosis checklist:**
- [ ] Thread pool output: Pool `default` → active count = max pool size?
- [ ] Thread pool output: Pool `default` → block policy = ABORT?
- [ ] Thread dump: All `sling-default-*` threads stuck on same stack?
- [ ] Sling Jobs output: Workflow job topic has high Failed Jobs?
- [ ] Sling Scheduler output: ThreadPool = `default` for `ApacheSlingdefault`?

**Fix:** Request pod restart (immediate mitigation, coordinate with customer — see Step 6 caveat); commit scheduler fix (HTTP timeout, `scheduler.concurrent=false`) to Git; land `org.apache.sling.commons.threads.impl.DefaultThreadPool-default.cfg.json` with `blockPolicy=RUN` and `maxPoolSize=50`; deploy via Cloud Manager pipeline.

### Pattern B: High workflow job failure rate

**Symptom:** `numberOfFailedJobs` >> `numberOfFinishedJobs` for a workflow topic.

**Root cause:** Process step exception, payload deleted, or process not registered.

**Diagnosis:** Download or stream `error.log` from Cloud Manager → Environments → Logs; grep for `Error executing workflow step` + model name. Cross-check the `process.label` in Developer Console → OSGi → Components against the model's Process step.

### Pattern C: Stale workflows accumulating

**Symptom:** Workflows in RUNNING state but no work items; Inbox empty despite running instances.

**Root cause:** `Cannot archive workitem` during transition; JCR session crash during step completion.

**Diagnosis:** grep Cloud Manager logs for `Cannot archive workitem`. For live count, deploy a custom `StaleWorkflowServlet` and invoke `GET /bin/support/workflow/stale?dryRun=true` — it returns a JSON report without side effects.

---

## Routing back to dev skills

Once diagnosis identifies a code or model defect (not an operational issue on a healthy implementation), route back into the development skills:

| Diagnosis | Route to |
|---|---|
| Process step throws an exception, leaks resources, or is not registered | [workflow-development](../workflow-development/SKILL.md) |
| Model has wrong OR-split rule, missing transition, wrong step type, or fails to deploy | [workflow-model-design](../workflow-model-design/SKILL.md) |
| Launcher not firing, firing on wrong path, or causing a re-trigger loop | [workflow-launchers](../workflow-launchers/SKILL.md) |
| Workflow not started by code/HTTP API, or starts on wrong payload type | [workflow-triggering](../workflow-triggering/SKILL.md) |
| Diagnosis spans multiple environments or requires Cloud Manager Logs / log-mining across envs | [workflow-triaging](../workflow-triaging/SKILL.md) |

---

## References

- For runbook locations and diagnostic tool pointers: see [reference.md](reference.md)
