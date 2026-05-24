---
name: workflow-debugging
description: Debug AEM Workflow issues on AEM 6.5 LTS and AMS including stuck workflows, failed steps, missing Inbox tasks, launcher failures, stale instances, thread pool exhaustion, queue backlogs, purge failures, and permissions errors. Use when the user reports workflow problems on AEM 6.5 LTS or AMS, asks why a workflow is stuck or failed, needs step-by-step troubleshooting, or provides thread dumps, configuration status dumps, or Sling Job console output for analysis.
license: Apache-2.0
---

# AEM Workflow Debugging — 6.5 LTS / AMS

Production-grade debugging for AEM Granite Workflow engine, launcher, Inbox, Sling Jobs, thread pools, and purge on **AEM 6.5 LTS** and **Adobe Managed Services (AMS)**.

## Variant Scope

- This skill is **6.5-lts-only** (includes AMS).
- Full JMX access via Felix Console or JMX client.
- Config changes via Felix Console or OSGi config in repository.

---

## When to use this skill

- Workflow stuck, not progressing, failed, not starting, task not in Inbox, purge/repository bloat, permissions, queue backlog, thread pool exhaustion, auto-advancement not working.
- User provides thread dumps, configuration status ZIPs, Sling Job console output, or error.log excerpts.
- Environment: AEM 6.5 LTS / AMS (JMX available).

---

## Step 1: Map symptom to first action

| Symptom | symptom_id | First action |
|---------|------------|--------------|
| Workflow stuck (not advancing) | workflow_stuck_not_progressing | Open instance; note current step type. No work item → stale. |
| Task not in Inbox | task_not_in_inbox | Confirm Participant step; assignee = logged-in user; Inbox filters. |
| Workflow not starting (launcher) | workflow_not_starting_launcher | Launcher enabled; path/event match payload. |
| Workflow fails or shows error | workflow_fails_or_shows_error | Instance history; error.log for instance ID; payload and process. |
| Step failed, retries exhausted | step_failed_retries_exhausted | Logs → process.label → JMX `retryFailedWorkItems` or Inbox retry. |
| Stale (no current work item) | stale_workflow_no_work_item | JMX `countStaleWorkflows` → `restartStaleWorkflows(dryRun=true)`. |
| Repository bloat / too many instances | repository_bloat_too_many_instances | JMX `purgeCompleted(dryRun=true)` or Purge Scheduler. |
| User cannot see or complete item | user_cannot_see_or_complete_item | Assignee/initiator/superuser; enforce flags. |
| Cannot delete model | cannot_delete_model | JMX `countRunningWorkflows` → terminate → delete. |
| Slow throughput / queue backlog | slow_throughput_queue_backlog | JMX `returnSystemJobInfo`; `queue.maxparallel` on Granite Workflow Queue; Sling thread pool. |
| Auto-advancement not working | workflow_auto_advance_failure | Check `default` thread pool saturation; Sling Scheduler; timeout jobs. |
| New workflow not working | workflow_setup_validation | Model sync, launcher, process registration, permissions. |

---

## Step 2: Decision tree (workflow stuck)

1. **No current work item?** → Stale. JMX: `countStaleWorkflows` → `restartStaleWorkflows(dryRun=true)`.
2. **Participant step** → Assignee exists? Inbox visible? Payload accessible? Dynamic participant resolver returning correct user?
3. **Process step** → Search error.log for instance ID. Check: `process.label` registered, payload path exists, bundle active, no exception in `execute()`.
4. **OR/AND Split** → Condition evaluates correctly? Routes exist? No dead-end branches? Model synced?

---

## Step 3: Thread dump & thread pool analysis

Thread dumps on 6.5 / AMS are obtained via **jstack** or by requesting from AMS support. Configuration status ZIPs from **Felix Console → Status → Configuration Status**.

### 3a. Sling `default` thread pool (critical path)

The Sling Scheduler `ApacheSlingdefault` uses `ThreadPool: default`. This pool runs:
- Oak observation events
- All Quartz-scheduled jobs — including the workflow timeout-detection scheduler that emits `com/adobe/granite/workflow/timeout/job` events to the Sling Job system (the job itself then runs on the Granite Workflow Queue, see Step 3c)

**Check the Sling Thread Pools status page (`/system/console/status-slingthreadpools`):**

| Field | Healthy | Problem |
|-------|---------|---------|
| active count | < max pool size | **= max pool size** (saturated) |
| block policy | RUN | **ABORT** (rejects tasks when full) |
| max pool size | sized for workload | OOTB on AEM 6.5 LTS is **5/5** (Apache Sling default). Bump to 20+ in OSGi config for environments with many custom periodic schedulers, otherwise schedulers can starve. |

**If active count = max pool size AND block policy = ABORT:**
- New scheduled tasks (including workflow timeout/auto-advance jobs) are **silently rejected**
- This is the #1 cause of auto-advancement failure

**Check the Threads status page (`/system/console/status-Threads`) or the jstack thread dump (`/system/console/status-jstack-threaddump`):**
- Search for `sling-default-` threads
- If all threads show same stack (e.g. stuck on HTTP call, database, or external service), that's the blocking culprit
- Note `elapsed` time — threads stuck for hours indicate a hung external call without timeout

### 3b. Sling Job thread pool

**Check `Apache Sling Job Thread Pool`** in the Sling Thread Pools status page:
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
- Max Parallel: 0.5 OOTB on AEM 6.5 LTS (50% of available CPU cores). Increase for throughput on bursty workloads. Verify the running value at `/system/console/configMgr/org.apache.sling.event.jobs.QueueConfiguration~workflow` before assuming.
- Max Retries: 10

### 3d. Sling Scheduler

**Check the Sling Scheduler status page (`/system/console/status-slingscheduler`):**
- This page lists Quartz-style schedulers, not Sling Job topics. On OOTB AEM 6.5 LTS the workflow-related entry visible here is the periodic `WorkflowStatsMBean` collector (used by the Statistics MBean) — its `nextFireTime` should be in the near future; `nextFireTime: null` means the trigger was deregistered.
- The `com/adobe/granite/workflow/timeout/job` topic itself is a **Sling Job**, not a Quartz job — check it on the Sling Jobs page (`/system/console/slingevent`), not here.
- Confirm `ApacheSlingdefault` uses `ThreadPool: default` — that's how the periodic timeout-detection scheduler reaches the workflow engine.

---

## Step 4: Error log patterns

| Pattern | Cause | Action |
|---------|-------|--------|
| `Error executing workflow step` | Process step exception | Check stack; fix process code or payload |
| `getProcess for '<name>' failed` | No WorkflowProcess registered | Deploy bundle; match `process.label` |
| `Cannot archive workitem` | Archive failure → stale risk | JMX `restartStaleWorkflows` |
| `refreshing the session since we had to wait for a lock` | Lock contention | Tune `queue.maxparallel` on the Granite Workflow Queue (Apache Sling Job Queue Configuration); reduce concurrent writes to the same path |
| `Terminate failed` / `Resume failed` / `Suspend failed` | Permissions (not initiator/superuser) | Check `enforceWorkflowInitiatorPermissions`; add to superusers |
| `PathNotFoundException` (workflow/payload) | Payload/launcher path missing | Verify payload exists; check launcher config path |
| `Error adding launcher config` | Launcher config path not created | Create `/conf/global/settings/workflow/launcher/config` |
| `retrys exceeded - remove isTransient` | Transient workflow failed after retries | Fix process code; instance persisted for admin handling |
| `RejectedExecutionException` | Thread pool full with ABORT policy | Increase pool size or change policy to RUN; fix stuck threads |
| `Workflow is already finished` | Terminate on completed/aborted instance | Check logic calling terminate |
| `Workflow purge '<name>' : repository exception` | Purge JCR error | Check permissions; repo health |

---

## Step 5: Configuration checklist

**In Felix Console → OSGi → Configuration (`/system/console/configMgr`):**

| Config | Property | Check |
|--------|----------|-------|
| WorkflowSessionFactory | `cq.workflow.job.retry` | Default 3; increase for flaky steps |
| WorkflowSessionFactory | `cq.workflow.superuser` | Must include admin users/groups (OOTB list includes `admin`, `administrators`, `workflow-process-service`, `workflow-service`, `workflow-administrators`, `wcm-workflow-service`) |
| WorkflowSessionFactory | `granite.workflow.enforceWorkitemAssigneePermissions` | true (OOTB) = only assignee sees items |
| WorkflowSessionFactory | `granite.workflow.enforceWorkflowInitiatorPermissions` | true (OOTB) = only initiator (or superuser) can terminate/suspend/resume |
| WorkflowSessionFactory | `granite.workflow.inboxQuerySize` | Max work items returned per Inbox query. OOTB 2000; raise if heavy users hit the cap |
| WorkflowSessionFactory | `granite.workflow.maxPurgeSaveThreshold` | OOTB 20 — commit after this many purged instances. Raise carefully to reduce JCR overhead during large purges |
| WorkflowSessionFactory | `granite.workflow.maxPurgeQueryCount` | OOTB 1000 — JCR query batch size during purge. Tune with above |
| Granite Workflow Queue (`org.apache.sling.event.jobs.QueueConfiguration~workflow`) | `queue.maxparallel` | **Real parallelism knob.** OOTB on AEM 6.5 LTS is `0.5` (50% of CPU cores). Adobe's *Workflows Best Practices* recommends **between half and three-quarters of processor cores**. `cq.workflow.job.max.procs` displayed in Felix Config Manager is an **orphaned metatype label** with no code path that reads it (verified against source on `release/660` and `prod/cq660`) — do not rely on it. Verify the running value at `/system/console/configMgr/org.apache.sling.event.jobs.QueueConfiguration~workflow` |
| DefaultThreadPool (`name=default`) | `block policy` | OOTB `RUN`. `ABORT` would silently drop workflow timeout jobs — keep `RUN` unless you have a specific reason |
| DefaultThreadPool (`name=default`) | `max pool size` | **OOTB on AEM 6.5 LTS is 5** (Apache Sling default). Bump to 20+ for environments with many custom periodic schedulers; otherwise the pool can starve under load |
| Purge Scheduler (`com.adobe.granite.workflow.purge.Scheduler`) | `scheduledpurge.daysold` | 30 default; tune per environment. Factory PID — deploy one config per schedule |
| Purge Scheduler | `scheduledpurge.workflowStatus` | Array-typed; e.g. `["COMPLETED"]` |

---

## Step 6: Remediation quick reference

| Action | 6.5 LTS / AMS approach |
|--------|----------------------|
| Retry failed work item | JMX `retryFailedWorkItems` or Inbox Retry |
| Restart stale workflows | JMX `restartStaleWorkflows(dryRun=true)` then execute |
| Purge completed | JMX `purgeCompleted(dryRun=true)` or Purge Scheduler |
| Increase parallelism | Felix Console: `queue.maxparallel` on the Granite Workflow Queue (Apache Sling Job Queue Configuration); or OSGi config in repo |
| Fix thread pool exhaustion | Restart instance (immediate); fix stuck scheduler code; change block policy to RUN |
| Fix process not found | Deploy bundle; `process.label` must match; Sync model |
| Fix auto-advancement | Verify `default` pool not saturated; timeout jobs scheduled; block policy = RUN |

---

## Step 7: Key JMX MBeans

All workflow maintenance and diagnostic operations live on a single MBean: `com.adobe.granite.workflow:type=Maintenance`. A separate MBean — `com.adobe.granite.workflow:type=Statistics` — exposes time-series workflow execution metrics for trend analysis.

| MBean | Operations | Purpose |
|-------|------------|---------|
| `com.adobe.granite.workflow:type=Maintenance` | `purgeCompleted(model [optional], days, dryRun)`, `purgeActive(model [optional], days, dryRun)`, `countRunningWorkflows(model [optional])`, `countCompletedWorkflows(model [optional])`, `countStaleWorkflows(model [optional])`, `restartStaleWorkflows(model [optional], dryRun)`, `retryFailedWorkItems(dryRun, model [optional])`, `terminateFailedInstances(restart, dryRun, model [optional])`, `returnSystemJobInfo()`, `returnWorkflowQueueInfo()`, `returnWorkflowJobTopicInfo()`, `returnFailedWorkflowCount(model [optional])`, `returnFailedWorkflowCountPerModel()`, `listRunningWorkflowsPerModel()`, `listCompletedWorkflowsPerModel()`, `fetchModelList()` | Purge, stale detection/restart, retry failed items, bulk terminate, queue/job diagnostics, per-model counts and enumeration |
| `com.adobe.granite.workflow:type=Statistics` | `getResults`, `clearRecords`; plus `get`/`set` accessors for `DataLifeTime`, `DataFidelityTime`, `DataProcessRate`, `DataRate` | Time-series workflow execution statistics |

**Always use `dryRun=true` first before executing destructive purge or retry operations.**

---

## Step 8: Common root cause patterns (from real incidents)

### Pattern A: Thread pool starvation → auto-advance failure

**Symptom:** Workflow auto-advancement stops; timeout jobs not firing; workflows stuck at participant step despite timeout configured.

**Root cause chain:**
1. Custom scheduler (e.g. `AccessTokenScheduler`) makes blocking HTTP call without timeout
2. `concurrent = true` allows overlapping executions on each cron trigger
3. Each stuck execution consumes a `default` pool thread indefinitely
4. All pool threads consumed (OOTB on AEM 6.5 LTS that's only **5**; environments hardened for throughput typically run with 20+) → pool saturated
5. If block policy has been changed to `ABORT` (OOTB is `RUN`), new Quartz triggers are rejected silently; on `RUN` they instead pile up on the caller thread and back-pressure the dispatch
6. The workflow timeout-detection scheduler cannot dispatch new `com/adobe/granite/workflow/timeout/job` events
7. Auto-advancement never happens

**Diagnosis checklist:**
- [ ] Sling Thread Pools page (`/system/console/status-slingthreadpools`): Pool `default` → active count = max pool size?
- [ ] Sling Thread Pools page: Pool `default` → block policy = ABORT?
- [ ] Threads page (`/system/console/status-Threads`) or jstack: All `sling-default-*` threads stuck on same stack?
- [ ] Sling Jobs page (`/system/console/slingevent`): Workflow job topic has high Failed Jobs?
- [ ] Sling Scheduler page (`/system/console/status-slingscheduler`): ThreadPool = `default` for `ApacheSlingdefault`?

**Fix:** Restart instance (immediate); fix scheduler code (add HTTP timeout, set `concurrent=false`); change pool policy to RUN; increase pool size.

### Pattern B: High workflow job failure rate

**Symptom:** `numberOfFailedJobs` >> `numberOfFinishedJobs` for a workflow topic.

**Root cause:** Process step exception, payload deleted, or process not registered.

**Diagnosis:** Search error.log for `Error executing workflow step` + model name. Check `process.label` in Felix Console → OSGi Components.

### Pattern C: Stale workflows accumulating

**Symptom:** Workflows in RUNNING state but no work items; Inbox empty despite running instances.

**Root cause:** `Cannot archive workitem` during transition; JCR session crash during step completion.

**Diagnosis:** Search for `Cannot archive workitem`; JMX `countStaleWorkflows`; `restartStaleWorkflows(dryRun=true)`.

---

## References

- For runbook locations: see [reference.md](reference.md)
