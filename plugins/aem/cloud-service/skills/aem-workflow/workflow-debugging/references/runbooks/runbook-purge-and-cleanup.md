# Runbook: Purge and cleanup (repository bloat) — Cloud Service

**symptom_id:** `repository_bloat_too_many_instances`

> **Variant:** AEM as a Cloud Service. No JMX. The JMX `purgeCompleted(dryRun)` /
> `purgeActive(dryRun)` / `countCompletedWorkflows` operations used on 6.5 LTS /
> AMS are **not reachable** on AEMaaCS — purge on AEMaaCS is entirely driven by
> the Purge Scheduler OSGi factory config plus the Granite Maintenance Task
> window. There is no customer-triggered one-shot purge.

---

## Symptom

Large `/var/workflow/instances`; slow Workflow Console queries; elevated JCR storage as reported by Cloud Manager environment metrics; workflow model queries timing out.

---

## Root cause categories

- `purge_not_configured` — no `com.adobe.granite.workflow.purge.Scheduler-*` OSGi config deployed.
- `purge_window_never_fires` — Granite Maintenance Task window misconfigured or never hits its scheduled time.
- `purge_status_misconfigured` — `scheduledpurge.workflowStatus` not an array, wrong state values, or `scheduledpurge.daysold` too high.
- `purge_too_slow` — purge runs but cannot keep up with instance creation rate.

---

## Decision tree

- **IF** no Purge Scheduler config exists in `ui.config` → Remediation: **Add recurring purge** (Checklist 1–3).
- **IF** Purge Scheduler config exists but `/var/workflow/instances` still grows → Remediation: **Verify window fires** (Checklist 4) and **tune purge**.
- **IF** you need a one-off cleanup *today* → you cannot trigger an ad-hoc purge on AEMaaCS. Deploy a short-daysold Purge Scheduler config, let the Maintenance window run, then raise `daysold` back once the backlog clears. Open a Support ticket in parallel if the customer can't wait for the next window.

---

## Checklist

1. **Confirm purge config presence (Git)**
   Search the `ui.config` module of your customer repo for files matching `com.adobe.granite.workflow.purge.Scheduler-*.cfg.json` under `config.author/` (and any run-mode variants). Each file = one purge schedule (it's a factory PID).

2. **Confirm purge config *correctness***
   Validate each purge config:

   | Property | Expected | Common mistake |
   |----------|----------|----------------|
   | `scheduledpurge.workflowStatus` | **Array** of strings, e.g. `["COMPLETED"]` or `["COMPLETED", "ABORTED"]`. | Set as a plain string — the config loads but matches nothing. |
   | `scheduledpurge.daysold:Integer` | Integer (`30`, `90`, etc.). | Set as string (`"30"`) — loads but is treated as `0`. |
   | `scheduledpurge.modelIds` | **Array** of model IDs. Empty array = all models. | Set as string; same silent failure. |
   | `scheduledpurge.cron` | **Does not exist on this PID.** | Setting this has no effect — scheduling is driven by the Granite Maintenance Task window, not a cron on the purge config. |

   Canonical reference: [`../examples/com.adobe.granite.workflow.purge.Scheduler-completed.cfg.json`](../examples/com.adobe.granite.workflow.purge.Scheduler-completed.cfg.json).

3. **Confirm Maintenance Task window**
   On AEMaaCS, Purge Scheduler configs are *invoked by* the Granite Maintenance Task framework, not by their own cron. Configure the window:
   - **Operations Dashboard UI** → `/libs/granite/operations/content/maintenance.html` — *UI only; the actual content lives in `/conf/global/settings/granite/operations/maintenance`.*
   - Or deploy `sling:osgiConfig` for `com.adobe.granite.maintenance.impl.TaskScheduler` via `ui.config`.

   **Do not** commit changes under `/libs/granite/operations/config/maintenance` — `/libs` is the read-only code layer on AEMaaCS and your deploy will fail or be silently ignored.

4. **Confirm the window actually fires**
   Cloud Manager → **Environments → Logs**. Grep for:
   - `WorkflowPurgeTask` — log tag for the purge task lifecycle (start, item counts, finish).
   - `Workflow purge '<name>' : repository exception` — indicates a purge started but hit a JCR error (often ACL or missing node).
   - Last-run timestamp per scheduled purge should be within one Maintenance window of today.

5. **Measure backlog (best-effort on AEMaaCS)**
   There is no `countCompletedWorkflows` JMX. Alternatives:
   - **Workflow Console** → filter by `Completed` → count by model. Tedious but accurate.
   - **Cloud Manager repo-size metric** → trend, not absolute.
   - **Custom read-only servlet** (similar pattern to [`../examples/StaleWorkflowServlet.java`](../examples/StaleWorkflowServlet.java), gated by superuser, filtering on `["COMPLETED"]`). Build once per customer codebase; reuse thereafter.

---

## Remediation

### Add a recurring purge (the main lever on AEMaaCS)

| Step | How |
|------|-----|
| 1. Copy the bundled example | [`../examples/com.adobe.granite.workflow.purge.Scheduler-completed.cfg.json`](../examples/com.adobe.granite.workflow.purge.Scheduler-completed.cfg.json) → your `ui.config/src/main/content/jcr_root/apps/<project>/osgiconfig/config.author/` folder. Rename the `-completed` suffix to identify the schedule (e.g. `-completed-30d`, `-aborted-90d`). |
| 2. Tune properties | `scheduledpurge.workflowStatus: ["COMPLETED"]` (array!); `scheduledpurge.daysold: 30`; `scheduledpurge.modelIds: []` for all models or a specific list. |
| 3. Ensure the Maintenance window exists | Operations Dashboard → verify a Daily or Weekly Maintenance window is enabled and includes the `WorkflowPurgeTask` task. |
| 4. Deploy via Cloud Manager pipeline | Commit, open PR, merge, run pipeline. Verify file lands under `/apps/<project>/osgiconfig/config.author/` via Developer Console → OSGi → Configuration. |
| 5. Verify first run | After the next Maintenance window, check Cloud Manager logs for `WorkflowPurgeTask` start + finish and non-zero counts. |

### One-off cleanup (no direct primitive)

There is no AEMaaCS equivalent of a manual `purgeCompleted(dryRun)` JMX call. Workarounds:

| Approach | Trade-off |
|----------|-----------|
| **Deploy an aggressive short-`daysold` config, let the Maintenance window run, then raise `daysold` back** | Works; takes one Maintenance window cycle (often same-day). Lowest-risk customer-self-service path. |
| **Open Adobe Support ticket requesting platform-side purge** | Correct for urgent / audit-regulated situations. Attach backlog estimate and expected retention policy. |
| **Custom purge servlet** | Not recommended. Granite's own `WorkflowPurge` internals are not public API; replicating them risks leaving orphaned nodes in `/var/workflow`. |

### Purge is running but too slow

AEMaaCS does not expose the 6.5 tuning properties `granite.workflow.maxPurgeQueryCount` or `granite.workflow.maxPurgeSaveThreshold` as customer-writable. If purge is keeping up but slowly:

- Split by model — multiple Purge Scheduler configs, one per high-volume model.
- Lower `daysold` gradually to shrink the working set per run.
- If purge still can't keep up, the underlying problem is instance-creation rate, not purge throughput — look at `runbook-job-throughput-and-concurrency.md` and whether a workflow is creating more instances than retention can absorb.

---

## Gotchas specific to AEMaaCS

- **No ad-hoc one-shot purge.** Everything is window-driven.
- **`/libs/granite/operations/config/maintenance` is read-only.** Use `/conf/global/settings/granite/operations/maintenance` (via the UI) or `sling:osgiConfig` for `com.adobe.granite.maintenance.impl.TaskScheduler` via `ui.config`.
- **`scheduledpurge.cron` does nothing on this PID.** If you find it in a customer's config, it's a copy-paste artifact — remove it and route through the Maintenance window instead.
- **Array-typed properties.** `scheduledpurge.workflowStatus` and `scheduledpurge.modelIds` are arrays. String values load without error but purge nothing.

---

## Escalation

- Purge task runs but throws `Workflow purge '<name>' : repository exception` → grab the stack, open Support. Usually ACL or corrupt `/var/workflow` node.
- `/var/workflow/instances` grows faster than purge can clear even at `daysold: 7` → instance-creation rate is the real problem; use `runbook-job-throughput-and-concurrency.md` and consider whether a launcher or model is misfiring.
- Customer can't wait for the next Maintenance window → Support ticket for one-off platform purge.

---

## References

- Bundled purge config example: [`../examples/com.adobe.granite.workflow.purge.Scheduler-completed.cfg.json`](../examples/com.adobe.granite.workflow.purge.Scheduler-completed.cfg.json)
- Superuser-gated servlet pattern (for a read-only count servlet): [`../examples/StaleWorkflowServlet.java`](../examples/StaleWorkflowServlet.java)
- Debugging index: [`../docs/debugging-index.md`](../docs/debugging-index.md)
- Related: [`runbook-job-throughput-and-concurrency.md`](runbook-job-throughput-and-concurrency.md), [`runbook-stale-workflows.md`](runbook-stale-workflows.md)
