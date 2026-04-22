# Runbook: Job throughput and concurrency

**Symptom:** Workflow jobs queued for a long time; slow throughput; log message “waiting for lock” or similar.

---

## 1. Verify the issue

1. **Parallelism** – Granite Workflow Queue (Sling Job Queue for topics `com/adobe/granite/workflow/job/*`). Check `queue.maxparallel` in the Sling Job Queue configuration — **not** `cq.workflow.job.max.procs` (that is a folklore property; it does not exist on `WorkflowSessionFactory`).
2. **Logs** – `jobhandler: refreshing the session since we had to wait for a lock` indicates instance lock contention on `/var/workflow`.
3. **Sling job queue** – JMX → **returnSystemJobInfo** / **returnWorkflowQueueInfo** to see queue depth and topic.

**Reference:** [Configurations](../docs/configurations.md), [MBeans](../docs/mbeans.md).

---

## 2. Remediation

| Action | How |
|--------|-----|
| **Increase parallel processes** | Raise `queue.maxparallel` on the Granite Workflow Queue (`org.apache.sling.event.jobs.QueueConfiguration` factory; topics `com/adobe/granite/workflow/job/*`). Raise cautiously — see "reduce contention" if lock messages appear after raising. |
| **Reduce contention** | Fewer workflows per payload path; stagger heavy workflows; if `refreshing the session since we had to wait for a lock` appears after raising parallelism, **lower** `queue.maxparallel`. |
| **Stale jobs** | Restart stale workflows (see [runbook-stale-workflows.md](runbook-stale-workflows.md)); terminate failed instances if they block the queue. |

---

## 3. Lock / unlock (Oak)

If LockProcess/UnlockProcess are not working or not desired:

- Workflow Config → `cq.workflow.config.allow.locking` (default false on Oak). Set to true only if you need lock/unlock (backwards compatibility; Oak may not support strict locking). Otherwise leave disabled; lock/unlock steps are no-ops.

**Reference:** [Configurations – Workflow Config](../docs/configurations.md).
