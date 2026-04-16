---
name: workflow-purge
description: Configure, run, and troubleshoot workflow instance purge on AEM as a Cloud Service. Use when the user reports repository bloat from workflow instances, needs to configure the Purge Scheduler, wants to understand retention policies, or is seeing purge failures in Cloud Manager logs.
license: Apache-2.0
---

# Workflow Purge — AEM as a Cloud Service

Operational guide for purging completed, failed, and stale workflow instances to prevent repository bloat on **AEM as a Cloud Service**.

## Variant Scope

- This skill is **cloud-service-only**.
- No JMX `purgeCompleted` operation — use Purge Scheduler (OSGi config in Git) or Workflow Maintenance UI.
- All config changes require code in Git deployed via Cloud Manager pipeline.

---

## When to Use This Skill

- `/var/workflow/instances/` is growing without bound (repository bloat)
- Purge Scheduler is configured but old instances still accumulate
- Purge job is throwing errors in Cloud Manager logs
- User asks how to clean up completed, failed, or stale workflow instances
- Performance degradation suspected due to large volume of workflow instances
- User needs to set a retention policy for workflow audit history

---

## Core Concept: What Gets Purged?

The Granite Workflow Purge Scheduler removes workflow instances from `/var/workflow/instances/` based on age and status.

| Status | Purged by default? | Notes |
|--------|--------------------|-------|
| `COMPLETED` | Yes | After `scheduledpurge.daysold` days |
| `ABORTED` | Yes | After `scheduledpurge.daysold` days |
| `FAILED` | Configurable | Requires `scheduledpurge.workflowStatus=FAILED` or `ALL` |
| `RUNNING` | **Never** | Must be terminated first via Workflow Console or REST API |
| `SUSPENDED` | **Never** | Must be resumed or terminated before purge can act |

**What is NOT removed by purge:**
- Any instance newer than `scheduledpurge.daysold`
- RUNNING or SUSPENDED instances regardless of age
- Workflow models or launcher configs — purge only touches `/var/workflow/instances/`

---

## Step 1: Configure the Purge Scheduler (OSGi)

### OSGi factory PID

```
com.adobe.granite.workflow.purge.Scheduler
```

### Configuration Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `scheduledpurge.name` | String | (required) | Unique name for this purge job — used in log output |
| `scheduledpurge.workflowStatus` | String | `COMPLETED` | Status to purge: `COMPLETED`, `ABORTED`, `FAILED`, or `ALL` |
| `scheduledpurge.daysold` | Long | `30` | Minimum age in days; instances newer than this are retained |
| `scheduledpurge.modelIds` | String[] | `[]` (all) | Restrict purge to specific model runtime paths; empty = all models |
| `scheduledpurge.maxProcessed` | Long | `-1` (unlimited) | Max instances purged per run; use to batch large cleanups |
| `scheduledpurge.scheduler.expression` | String | `0 0 1 * * ?` | Cron expression (default: 1 AM daily) |

> **Note:** `scheduledpurge.includefailed` is a legacy alias; prefer `scheduledpurge.workflowStatus=FAILED` or `ALL` for clarity.

### Example OSGi Config File

Place in the Maven `ui.apps` module under `config.author` to restrict purge to the Author tier:

```
ui.apps/src/main/content/jcr_root/apps/my-project/config.author/
    com.adobe.granite.workflow.purge.Scheduler-daily.xml
```

Content:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root
    xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
    xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="sling:OsgiConfig"
    scheduledpurge.name="daily-completed"
    scheduledpurge.workflowStatus="COMPLETED"
    scheduledpurge.daysold="{Long}30"
    scheduledpurge.modelIds="[]"
    scheduledpurge.maxProcessed="{Long}-1"
    scheduledpurge.scheduler.expression="0 0 1 * * ?"/>
```

> **Always deploy to `config.author`**: Workflow instances live on Author. Running purge on Publish is unnecessary and adds load.

---

## Step 2: Recommended Multi-Job Configuration

Use separate Scheduler factory instances for different retention windows and statuses. Each instance needs a unique OSGi factory suffix (e.g., `-daily`, `-weekly-failed`).

### Job 1 — Completed workflows (30-day retention)

```xml
scheduledpurge.name="purge-completed-30d"
scheduledpurge.workflowStatus="COMPLETED"
scheduledpurge.daysold="{Long}30"
scheduledpurge.scheduler.expression="0 0 1 * * ?"
```

### Job 2 — Failed workflows (90-day retention for audit)

```xml
scheduledpurge.name="purge-failed-90d"
scheduledpurge.workflowStatus="FAILED"
scheduledpurge.daysold="{Long}90"
scheduledpurge.scheduler.expression="0 30 1 * * ?"
```

### Job 3 — High-volume DAM workflows (7-day retention)

```xml
scheduledpurge.name="purge-dam-update-7d"
scheduledpurge.workflowStatus="COMPLETED"
scheduledpurge.daysold="{Long}7"
scheduledpurge.modelIds="[/var/workflow/models/dam/update_asset]"
scheduledpurge.scheduler.expression="0 0 2 * * ?"
```

---

## Step 3: Workflow Maintenance UI (Ad-hoc Purge)

For immediate, ad-hoc purge without deploying a new config:

**Tools → Operations → Maintenance → Weekly Maintenance Window → Workflow Purge**

This UI-based task uses the same Purge Scheduler mechanism. On Cloud Service, always back any retention settings here with an OSGi config in Git to ensure they persist across environment rebuilds.

---

## Step 4: Recovering from Severe Bloat

If the scheduler was never configured and `/var/workflow/instances/` contains millions of nodes:

1. **Deploy a short-retention config** with `scheduledpurge.daysold=7` and trigger it immediately via the Maintenance UI.
2. **Batch the purge**: Set `scheduledpurge.maxProcessed=5000` to avoid long-running JCR transactions that cause lock contention.
3. **Run multiple cycles** until the instance count is manageable. Each run processes at most `maxProcessed` instances.
4. **Restore the target retention** (e.g., 30 days) once the backlog is cleared.

> **Warning:** Purging millions of instances in a single transaction causes long GC pauses and JCR lock contention. Always batch via `maxProcessed` in high-volume environments.

---

## Step 5: Handling RUNNING and SUSPENDED Instances

The purge scheduler never removes RUNNING or SUSPENDED instances. Investigate before terminating:

| Situation | Action |
|-----------|--------|
| High count of RUNNING with no active work item (stale) | Terminate via Workflow Console or REST `DELETE /api/workflow/instances/{id}` |
| Legitimate RUNNING instances | Do not terminate; resolve the blocking step first |
| SUSPENDED instances | Resume or terminate via Workflow Console → **Suspend** tab |

**Terminate a single instance via REST:**
```
DELETE /api/workflow/instances/{id}
Authorization: Bearer <token>
```

**Bulk-terminate via Workflow Console:**
Tools → Workflow → Instances → filter by status RUNNING → select → Terminate

After termination, the next purge cycle will remove them once they exceed `scheduledpurge.daysold`.

---

## Step 6: Monitoring Purge Activity

Download `error.log` or `workflow.log` from **Cloud Manager → Environments → Logs**.

| Log Pattern | Meaning |
|-------------|---------|
| `Workflow purge '<name>': purged X instances` | Successful run; X instances removed |
| `Workflow purge '<name>': 0 instances purged` | No instances matched the criteria — check `daysold` and `workflowStatus` |
| `Workflow purge '<name>': repository exception` | Purge failed; check service user permissions on `/var/workflow/instances/` |
| `com.adobe.granite.workflow.purge.Scheduler ... started` | Scheduler triggered |
| `RejectedExecutionException` in Sling Jobs | Thread pool exhaustion; purge jobs queued but not executing |

---

## Step 7: Common Misconfiguration Patterns

| Misconfiguration | Symptom | Fix |
|-----------------|---------|-----|
| No purge job configured | Repository grows indefinitely | Add at least one `com.adobe.granite.workflow.purge.Scheduler` config |
| `scheduledpurge.daysold` too high (e.g., 365) | Old instances accumulate | Reduce to 30 days for completed, 90 for failed |
| Purge deployed to all run modes | Unnecessary load on Publish | Move config to `config.author` |
| Single purge run without `maxProcessed` | Long JCR transaction, lock contention in logs | Set `scheduledpurge.maxProcessed=5000` during backlog recovery |
| Purging `RUNNING` instances expected | Instances still present after purge run | Terminate RUNNING instances first; purge does not touch them |
| DAM Update Asset instances not purged | Model path mismatch in `modelIds` | Use runtime path `/var/workflow/models/dam/update_asset`, not design-time path |

---

## Cloud Service Constraints Summary

| Operation | Cloud Service Approach |
|-----------|-----------------------|
| Schedule purge | `com.adobe.granite.workflow.purge.Scheduler` OSGi config in Git → Cloud Manager pipeline |
| Run purge immediately | Tools → Operations → Maintenance → Workflow Purge |
| Check purge history | Cloud Manager logs → `error.log` |
| Terminate RUNNING instances | Workflow Console UI or `DELETE /api/workflow/instances/{id}` |
| JMX `purgeCompleted` | **Not available** — use Purge Scheduler |
| JMX `countInstances` | **Not available** — use Workflow Console or custom JCR query |

---

## References in This Skill

| Reference | What It Covers |
|-----------|---------------|
| `references/workflow-foundation/architecture-overview.md` | Granite Workflow Engine and `/var/workflow/instances/` JCR storage |
| `references/workflow-foundation/jcr-paths-reference.md` | Instance path structure and node types |
| `references/workflow-foundation/cloud-service-guardrails.md` | Cloud Service deployment and config constraints, purge config note |
