# Runbook: Job throughput and concurrency — Cloud Service

**symptom_id:** `slow_throughput_queue_backlog` / `workflow_auto_advance_failure`

> **Variant:** AEM as a Cloud Service. No JMX. The JMX `returnSystemJobInfo` /
> `returnWorkflowQueueInfo` operations used on 6.5 LTS / AMS are **not
> reachable** — use Developer Console → Sling Jobs (`/system/console/slingjobs`)
> on lower envs, or Cloud Manager / Splunk metrics on prod.

---

## Symptom

Workflow jobs sit in the queue for long periods; throughput drops; `error.log` shows `jobhandler: refreshing the session since we had to wait for a lock`; auto-advancement stops firing; timeout jobs don't execute.

---

## Root cause categories

- `parallelism_too_low` — `queue.maxparallel` on the Granite Workflow Queue is at the OOB default (`1`) for a workload that needs more.
- `parallelism_too_high` — raised too aggressively; now `/var/workflow` lock contention dominates.
- `default_threadpool_saturated` — Sling `default` thread pool exhausted; workflow timeout jobs rejected; auto-advance breaks.
- `queue_override_not_winning` — customer deployed a `QueueConfiguration` override but `service.ranking` lost the tiebreak against the platform-provided queue.
- `stale_or_failed_jobs_blocking` — stuck instances consume queue slots.

---

## Decision tree

- **IF** Queued > 0 **AND** Active = 0 → jobs are not being picked up. Check **parallelism** (Checklist 1) and **queue override correctness** (Checklist 4).
- **IF** Queued > 0 **AND** Active = maxparallel → parallelism cap reached; raise it if no lock messages, else address contention.
- **IF** auto-advancement is broken (timeout jobs never fire) → Sling `default` thread pool saturation; Checklist 3.
- **IF** `refreshing the session since we had to wait for a lock` appears after raising parallelism → **lower** `queue.maxparallel` or stagger launchers. Raising further makes it worse.

---

## Checklist

1. **Confirm current `queue.maxparallel` for the Granite Workflow Queue**
   - **Lower envs (dev, stage):** Developer Console → `/system/console/slingjobs` → find **Granite Workflow Queue** (topic prefix `com/adobe/granite/workflow/job/`) → read `Max Parallel`.
   - **Prod:** request a Developer Console link for the environment, or attach a Support ticket with the metric.
   - Confirm against the customer's override in Git: `ui.config/.../org.apache.sling.event.jobs.QueueConfiguration-*.cfg.json` → `queue.maxparallel:Integer`.
   - If the Developer Console value doesn't match the committed override, go to Checklist 4.

2. **Check queue depth and failure rate**
   On `/system/console/slingjobs`, for the Granite Workflow Queue:

   | Field | Healthy | Problem |
   |-------|---------|---------|
   | Queued Jobs | 0 | > 0 and growing |
   | Active Jobs | up to `queue.maxparallel` | `0` with Queued > 0 → queue not processing |
   | Failed Jobs | 0 | > 0 → step failures; cross-check topic statistics |

   For a specific workflow model, topic is `com/adobe/granite/workflow/job/var/workflow/models/<modelName>`. High `Failed Jobs / Finished Jobs` ratio points to a broken process step — follow [`runbook-workflow-fails-or-shows-error.md`](runbook-workflow-fails-or-shows-error.md).

3. **Check the Sling `default` thread pool (critical for auto-advance)**
   The Sling Scheduler fires workflow timeout jobs (`com/adobe/granite/workflow/timeout/job`) from the `default` thread pool. If this pool is saturated with `blockPolicy=ABORT`, timeout jobs are silently rejected and auto-advancement stops.

   Developer Console → **Status → Threads** → locate the `default` pool row:

   | Field | Healthy | Problem |
   |-------|---------|---------|
   | active count | < max pool size | = max pool size (saturated) |
   | block policy | `RUN` | `ABORT` (rejects when full) |
   | max pool size | ≥ 20 | < 20 starves schedulers |

   If saturated, look at the thread dump (Developer Console → Status → Thread Dump) — `sling-default-*` threads all stuck on the same stack (external HTTP call, DB, etc.) is the usual culprit.

   Bundled config example with safe defaults: [`../examples/org.apache.sling.commons.threads.impl.DefaultThreadPool.config.json`](../examples/org.apache.sling.commons.threads.impl.DefaultThreadPool.config.json).

   > **AEMaaCS caveat:** the `DefaultThreadPool` config *may* be platform-reserved on some environments. Always verify on the Status → Threads page *after* deploy — if your values don't apply, the PID is Adobe-managed and you need a Support ticket to change it.

4. **Verify your `QueueConfiguration` override is actually winning**
   If you deployed `ui.config/.../org.apache.sling.event.jobs.QueueConfiguration-granitewfe.cfg.json` (factory PID) expecting to override the OOB Granite Workflow Queue, confirm Developer Console → `/system/console/slingjobs` shows *your* `queue.maxparallel`, not the OOB value.

   If it still shows OOB (typically `1`):
   - Your `service.ranking` lost the tiebreak. Raise it in the override (e.g. from `100` to `1000`), commit, redeploy, re-verify.
   - **Do not** set `service.ranking` equal to any other registered ranking — equal rankings can cause Sling to register both queues against the same topic, producing occasional duplicate-step execution (`Workflow step executed twice` in `error.log`).

   Bundled example: [`../examples/org.apache.sling.event.jobs.QueueConfiguration-granitewfe.cfg.json`](../examples/org.apache.sling.event.jobs.QueueConfiguration-granitewfe.cfg.json).

5. **Rule out stale / failed instances blocking the queue**
   A few stuck instances can consume queue slots indefinitely. Cross-check:
   - [`runbook-stale-workflows.md`](runbook-stale-workflows.md) — enumerate via the bundled `StaleWorkflowServlet`.
   - [`runbook-failed-work-items.md`](runbook-failed-work-items.md) — failure items in `/aem/inbox`.

---

## Remediation

| Action | How |
|--------|-----|
| **Raise `queue.maxparallel` (if lock messages are absent)** | Edit `ui.config/.../org.apache.sling.event.jobs.QueueConfiguration-granitewfe.cfg.json` → bump `queue.maxparallel:Integer`. Commit → Cloud Manager pipeline → deploy. Verify on `/system/console/slingjobs` that the new value is showing. |
| **Raise `service.ranking` (if override is losing)** | Same file, raise `service.ranking:Integer` (e.g. `100` → `1000`). Never set equal to a known existing ranking. |
| **Lower `queue.maxparallel` (if lock messages appear)** | Lock contention on `/var/workflow` *worsens* with more parallel writers. Cut parallelism in half and re-measure. |
| **Stagger launcher fan-out** | If one content-change event fires dozens of workflows in the same second, use a debounce/batch pattern in the launcher condition, or split workload across multiple models. |
| **Fix Sling `default` thread pool** | Commit `DefaultThreadPool.config.json` with `blockPolicy: "RUN"` and `maxPoolSize: 50` — see bundled example. Verify on Status → Threads after deploy; if no change, PID is platform-reserved (Support ticket). |
| **Restart a hung pod (emergency)** | Open an Adobe Support ticket requesting a pod restart. Cloud Manager does **not** expose a customer-facing restart. Treat as last-resort mitigation, not a fix — always pair with a long-term code/config change in the same conversation. |
| **Fix a stuck scheduler** | Custom schedulers without HTTP timeouts + `scheduler.concurrent=true` are the #1 cause of `default` pool saturation. Add a bounded HTTP timeout and `@Component property={"scheduler.concurrent:Boolean=false"}`. Deploy via Cloud Manager pipeline. |

---

## Gotchas specific to AEMaaCS

- **`cq.workflow.job.max.procs` is a myth.** It is not a real property on `WorkflowSessionFactory` — verified against source. The real parallelism knob is `queue.maxparallel` on the `org.apache.sling.event.jobs.QueueConfiguration` factory for the Granite Workflow Queue. Do not spend a pipeline run setting `max.procs`.
- **Raising parallelism is not free.** Past a certain point, `/var/workflow` lock contention dominates and throughput actually *drops*. Watch for `refreshing the session since we had to wait for a lock` after every change.
- **Felix Console is read-only on prod.** All configuration lands via Git + Cloud Manager pipeline. Developer Console is for diagnosis, not remediation.
- **Thread-pool configs may be platform-reserved.** Always verify on Status → Threads after deploy. If numbers don't change, open a Support ticket — **do not** try to work around it.
- **Pod restart requires Adobe Support.** There is no customer-facing restart button.

---

## Escalation

- `Max Parallel` on `/system/console/slingjobs` does not change after a clean deploy + verified override + raised `service.ranking` → Support ticket. The platform may be pinning the queue.
- `DefaultThreadPool` config doesn't apply (verified on Status → Threads) → Support ticket. PID is Adobe-managed on that environment.
- Throughput remains poor at safe parallelism, no lock contention, no stale instances → open Support with: current `queue.maxparallel`, `/system/console/slingjobs` output, thread dump, a 1-hour window of `error.log`.

---

## References

- Bundled QueueConfiguration example: [`../examples/org.apache.sling.event.jobs.QueueConfiguration-granitewfe.cfg.json`](../examples/org.apache.sling.event.jobs.QueueConfiguration-granitewfe.cfg.json)
- Bundled DefaultThreadPool example: [`../examples/org.apache.sling.commons.threads.impl.DefaultThreadPool.config.json`](../examples/org.apache.sling.commons.threads.impl.DefaultThreadPool.config.json)
- Debugging index: [`../docs/debugging-index.md`](../docs/debugging-index.md)
- Error patterns (for the lock-contention log line): [`../docs/error-patterns.md`](../docs/error-patterns.md)
- Related: [`runbook-stale-workflows.md`](runbook-stale-workflows.md), [`runbook-failed-work-items.md`](runbook-failed-work-items.md), [`runbook-workflow-fails-or-shows-error.md`](runbook-workflow-fails-or-shows-error.md)
