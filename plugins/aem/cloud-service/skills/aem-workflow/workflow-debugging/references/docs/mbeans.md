# AEM Workflow MBeans — and why they are not reachable on Cloud Service

> **Variant:** AEM as a Cloud Service. This file exists primarily as a **translation table**: if you see a runbook, ticket, or blog post referencing a JMX MBean operation, this document tells you what to use instead on AEMaaCS. For the canonical MBean reference (operations, parameters, return types), use the **6.5 LTS / AMS** variant of this skill.

---

## Why there is no JMX on Cloud Service

The Granite Workflow engine on Cloud Service is the same engine as on 6.5, and it *internally* exposes the same MBeans — but AEMaaCS does not expose a customer-facing JMX endpoint. The Felix Console JMX page (`/system/console/jmx`) is not reachable in production, external JMX connectors are not opened, and Configuration Status ZIPs are obtained only through Adobe Support. Any runbook that instructs "invoke `restartStaleWorkflows` via JMX" will not work on AEMaaCS — the operation exists in the code, but the channel to reach it doesn't.

The operational pattern that replaces JMX on AEMaaCS is:

1. **Diagnosis** — Developer Console (Sling Jobs, Threads, OSGi), Workflow Console (instance state), and Cloud Manager logs (exception detail, log streaming).
2. **Remediation** — Git + Cloud Manager pipeline deploy of OSGi JSON configs, custom superuser-gated servlets for operations that need a verb, `/aem/inbox` UI for single-item retry, and Adobe Support tickets for platform-side operations.

---

## Operation translation table

### Maintenance MBean (`com.adobe.granite.workflow:type=Maintenance`)

| JMX operation (6.5 / AMS) | Cloud Service equivalent |
|---------------------------|--------------------------|
| `purgeCompleted(model, days, dryRun)` | **No ad-hoc purge.** Deploy `com.adobe.granite.workflow.purge.Scheduler-<alias>.cfg.json` with `scheduledpurge.workflowStatus=["COMPLETED"]` + `scheduledpurge.daysold=<N>`; purge runs inside the Granite Maintenance Task window. For a one-off, deploy a short-`daysold` config, let the window run, then raise it back. See [`../runbooks/runbook-purge-and-cleanup.md`](../runbooks/runbook-purge-and-cleanup.md) and bundled [`../examples/com.adobe.granite.workflow.purge.Scheduler-completed.cfg.json`](../examples/com.adobe.granite.workflow.purge.Scheduler-completed.cfg.json). |
| `purgeActive(model, days, dryRun)` | Same approach: Purge Scheduler config with `scheduledpurge.workflowStatus=["RUNNING"]`. Rarely the right action — prefer targeted termination via Workflow Console or a superuser-gated servlet. |
| `countStaleWorkflows(model)` | `GET /bin/support/workflow/stale?dryRun=true[&model=<id>]` on the bundled [`../examples/StaleWorkflowServlet.java`](../examples/StaleWorkflowServlet.java) — returns `staleCount` in the JSON response. |
| `restartStaleWorkflows(model, dryRun)` | `POST /bin/support/workflow/stale?dryRun=false[&model=<id>]` on the same servlet. Always `GET ...?dryRun=true` first. |
| `fetchModelList()` | Workflow Console → **Models**. For scripted access, read `/var/workflow/models/` via a superuser-gated read-only servlet. |
| `countRunningWorkflows(model)` | Workflow Console → filter by Model + State=`Running`. For scripted access, a superuser-gated servlet calling `getWorkflows(new String[]{"RUNNING"}, 0, -1)` filtered by model ID. |
| `countCompletedWorkflows(model)` | Same pattern, state = `["COMPLETED"]`. No direct UI count — use a servlet or Cloud Manager repo-size trend as a proxy. |
| `listRunningWorkflowsPerModel()` / `listCompletedWorkflowsPerModel()` | Custom read-only servlet iterating `getWorkflows(...)` and grouping by `wf.getWorkflowModel().getId()`. |
| `returnWorkflowQueueInfo()` | Developer Console → `/system/console/slingjobs` → **Granite Workflow Queue**. Shows `Max Parallel`, Queued, Active, Failed counts. |
| `returnWorkflowJobTopicInfo()` | Same page, topic statistics: `com/adobe/granite/workflow/job/var/workflow/models/<modelName>`. |
| `returnSystemJobInfo()` | Same page at the system level. On prod where Developer Console isn't available, request the data via Adobe Support with a timestamp range. |
| `returnFailedWorkflowCount(model)` / `returnFailedWorkflowCountPerModel()` | Same servlet pattern as running/completed, state = `["FAILED"]`. Or count failure items in `/aem/inbox` filtered by model. |
| `terminateFailedInstances(restart, dryRun, model)` | **No AEMaaCS primitive for bulk terminate.** Per-instance: Workflow Console → Terminate. Bulk: either iterate the UI, build a superuser-gated servlet (audit-trail caveats), or open an Adobe Support ticket. See [`../runbooks/runbook-failed-work-items.md`](../runbooks/runbook-failed-work-items.md). |
| `retryFailedWorkItems(dryRun, model)` | **No AEMaaCS primitive for bulk retry.** Per-instance: `/aem/inbox` → **Retry**. Bulk: iterate Inbox, custom servlet with audit caveats, or Support ticket. See [`../runbooks/runbook-failed-work-items.md`](../runbooks/runbook-failed-work-items.md). |

### Statistics MBean (`com.adobe.granite.workflow:type=Statistics`)

| JMX attribute / operation | Cloud Service equivalent |
|---------------------------|--------------------------|
| `getResults` (tabular stats over time) | No customer-facing equivalent. Use **Cloud Manager metrics** and **log-aggregated dashboards** (Splunk, etc.). Adobe Support can pull Statistics MBean data on request. |
| `DataLifeTime` / `DataFidelityTime` / `DataRate` / `DataProcessRate` | Not customer-tunable on AEMaaCS. Request via Support if the defaults don't meet your observability needs. |
| `clearRecords()` | Not reachable. Not usually needed — restart cycles clear the accumulator. |

### Workflow Queue (`org.apache.sling.event.jobs.QueueConfiguration` factory, OOB alias "Granite Workflow Queue")

Not technically a JMX target, but frequently adjusted alongside the MBeans on 6.5.

| 6.5 / AMS approach | Cloud Service approach |
|--------------------|------------------------|
| Felix Console → Config Manager → raise `queue.maxparallel` at runtime | Git commit of `org.apache.sling.event.jobs.QueueConfiguration-granitewfe.cfg.json` in `ui.config` → Cloud Manager pipeline deploy. Verify via Developer Console → `/system/console/slingjobs`. If OOB config wins the `service.ranking` tiebreak, raise your override's ranking. Bundled: [`../examples/org.apache.sling.event.jobs.QueueConfiguration-granitewfe.cfg.json`](../examples/org.apache.sling.event.jobs.QueueConfiguration-granitewfe.cfg.json). |

---

## The `cq.workflow.job.max.procs` myth

You will see blog posts, old Experience League threads, and even internal wikis recommending `cq.workflow.job.max.procs` on `WorkflowSessionFactory` as the parallelism knob. **It is not a real property** (verified against `com.adobe.granite.workflow.core.WorkflowSessionFactory` source). Setting it changes nothing. The real knob is `queue.maxparallel` on the `org.apache.sling.event.jobs.QueueConfiguration` factory entry for the Granite Workflow Queue (topics `com/adobe/granite/workflow/job/*`). Do not waste a Cloud Manager pipeline run chasing `max.procs`.

---

## Channels for platform-side operations (Support tickets)

If your scenario requires an operation that has no customer-callable equivalent on AEMaaCS, Adobe Support is the correct channel. Ticket content that speeds resolution:

| You need | Attach |
|----------|--------|
| One-off workflow purge | Environment ID, target model or `ALL`, retention window (`daysold`), and why the Maintenance window approach isn't acceptable. |
| Thread dump from prod | Environment ID, timestamp range, symptom (e.g. "auto-advance stopped at 14:20 UTC"), and any customer-side correlation (stuck instance ID). |
| Configuration Status ZIP | Environment ID, timestamp, reason (typically: diagnosing a config issue that Developer Console doesn't expose). |
| Pod restart | Environment ID, reason, confirmation that in-flight authoring sessions being lost is acceptable. **This is mitigation, not a fix** — always pair with a long-term code/config change in the same ticket. |
| Statistics MBean snapshot | Environment ID, desired attributes, time window. |

---

## See also

- [`debugging-index.md`](debugging-index.md) — machine-readable symptom → runbook map.
- [`error-patterns.md`](error-patterns.md) — log-signature catalog (mostly portable between variants).
- [`../runbooks/runbook-decision-guide.md`](../runbooks/runbook-decision-guide.md) — per-symptom first-action table with CS-specific paths.
- [`../examples/`](../examples/) — bundled OSGi configs and the `StaleWorkflowServlet` that replaces the core MBean verbs.
