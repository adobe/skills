---
name: workflow-triaging
description: Triage AEM Workflow issues on AEM 6.5 LTS and AMS by classifying symptoms, gathering the right logs and metrics, and mapping to runbooks or Splunk searches. Use when the user asks for workflow activity/errors on a 6.5 host, needs to classify a Jira ticket, or wants to know what to collect for workflow debugging.
license: Apache-2.0
---

# AEM Workflow Triaging — 6.5 LTS / AMS

Classify workflow issues, determine what logs and data to gather, and map to the correct runbook or log search. Optimized for **production support** on **AEM 6.5 LTS** and **Adobe Managed Services (AMS)**.

## Variant Scope

- This skill is **6.5-lts-only** (includes AMS).
- Log access via direct filesystem, AMS log access, or Splunk.
- JMX available for workflow counts, queue metrics, and remediation.

---

## When to use this skill

- User asks: "Workflow errors on &lt;host&gt; for the past X hours", "Workflow activity on &lt;host&gt;", "Why did workflow X fail?", "What should I collect to debug this workflow ticket?"
- User needs: Symptom classification, log patterns to search, Splunk queries, or required inputs for a runbook.
- Context: AEM 6.5 LTS / AMS (author/publish hostname format).

---

## Step 1: Classify symptom (symptom_id)

Map the user's description to a **symptom_id** and runbook.

| User says / observes | symptom_id | Runbook |
|----------------------|------------|---------|
| Workflow not moving to next step; stuck in Running | workflow_stuck_not_progressing | runbook-workflow-stuck.md |
| Task should be in Inbox but is not visible | task_not_in_inbox | runbook-task-not-in-inbox.md |
| Workflow should start automatically but no instance created | workflow_not_starting_launcher | runbook-launcher-not-starting.md |
| Workflow in Failed state or step shows error | workflow_fails_or_shows_error | runbook-workflow-fails-or-shows-error.md |
| Step failed after retries; failure item in Inbox | step_failed_retries_exhausted | runbook-failed-work-items.md |
| Instance Running but no current work item (inconsistent) | stale_workflow_no_work_item | runbook-stale-workflows.md |
| Too many instances; slow queries; disk/repo bloat | repository_bloat_too_many_instances | runbook-purge-and-cleanup.md |
| User cannot see work item or complete/delegate/return | user_cannot_see_or_complete_item | runbook-inbox-and-permissions.md |
| Cannot delete workflow model (running instances) | cannot_delete_model | runbook-model-delete-and-update.md |
| Jobs queued a long time; slow completion; queue depth high | slow_throughput_queue_backlog | runbook-job-throughput-and-concurrency.md |
| New or changed workflow not starting or step not executing | workflow_setup_validation | runbook-validate-workflow-setup.md |

---

## Step 2: Required inputs for triage

Before suggesting a runbook or Splunk search, try to obtain:

| Input | Purpose |
|-------|---------|
| **Host / instance** | Author/publish hostname (e.g. author-p12345.adobeaemcloud.com for AMS, or on-prem hostname). |
| **Time range** | e.g. "past 4 hours", "past 10 hours" – for log/Splunk scope. |
| **Workflow model or step name** | e.g. "Dynamic Media Reupload", "DAM Update Asset", "testmodel". |
| **Instance ID** (if known) | From Workflow console URL or payload; ties logs to one instance. |
| **Payload path** (if known) | e.g. /content/dam/...; for path-related errors. |
| **Log source** | Splunk index/sourcetype, direct filesystem error.log, or AMS log request. |

If the user only provides host + time, respond with the **generic** workflow error searches and note that narrowing by model/instance ID will improve accuracy.

---

## Step 3: Log patterns and Splunk (what to search)

Logs on 6.5 / AMS are accessible via **direct filesystem** (`crx-quickstart/logs/error.log`), AMS log access, or **Splunk** (if indexed).

| Scenario | Primary log pattern(s) | Splunk hint |
|----------|------------------------|-------------|
| Step failed | `Error executing workflow step` | Add instance ID or model name to narrow. |
| Process not found | `getProcess for '*' failed` | Extract process name for OSGi check in Felix Console. |
| Stuck at Process step | Same as step failed + `getProcess` | Combine with payload path. |
| Stale workflow | `Cannot archive workitem` | Correlate time with instance. |
| Lock / throughput | `wait for a lock` or `refreshing the session since we had to wait` | Timechart by host. |
| Permission | `Terminate failed` / `Resume failed` / `Suspend failed` + verifyAccess | Or `AccessControlException`. |
| Payload path | `PathNotFoundException` + workflow/payload | Launcher: "launcher config". |
| Launcher not starting | `Error adding launcher config` / `Error retrieving launcher config entries` | Path: `/conf/global/settings/workflow/launcher/config`. |
| Purge failure | `Workflow purge '*' :` | Filter by repository exception / invalid state. |

**Example Splunk searches (replace index/sourcetype/field names as needed):**

- All workflow step errors (last 24h):
  `index=aem sourcetype=aem:error "Error executing workflow step" | table _time host message | sort - _time`
- Process not registered:
  `index=aem "getProcess for" "failed" | table _time host message`
- By workflow model or instance:
  `index=aem ("Error executing workflow step" OR WorkflowException) (message=*<modelName>* OR message=*<instanceId>*) | sort - _time`
- Lock contention:
  `index=aem "wait for a lock" OR "refreshing the session since we had to wait" | table _time host message`

---

## Step 4: JMX-based diagnostics

On 6.5 / AMS, use JMX for metrics that are not available from logs alone.

| What to check | JMX MBean / Operation | Purpose |
|---------------|-----------------------|---------|
| Stale workflow count | `countStaleWorkflows` | Detect stale instances without current work item |
| Running workflow count | `countRunningWorkflows(model)` | Count active instances for a model |
| Queue depth | `returnWorkflowQueueInfo` | Check Granite Workflow Queue backlog |
| Job statistics | `returnSystemJobInfo` | Sling Job overall stats |
| Failed work item retry | `retryFailedWorkItems` | Retry all failed items (use after root cause fixed) |
| Purge completed (dryRun) | `purgeCompleted(dryRun=true)` | Count purgeable instances before executing |

**Always use `dryRun=true` first before executing destructive operations.**

---

## Step 5: Example triage prompts and responses

| User prompt | Triage response |
|-------------|------------------|
| "Workflow errors on &lt;host&gt; for the past X hours" | Classify as workflow_fails_or_shows_error / step_failed_retries_exhausted. Search error.log or Splunk for "Error executing workflow step", "Error processing workflow job", "getProcess for … failed". Also check JMX `returnSystemJobInfo` for failed job count. Route to runbook-workflow-fails-or-shows-error. |
| "Workflow activity on &lt;host&gt; for the past X hours" | Clarify: "activity" = counts or errors? For counts, use JMX `countRunningWorkflows`, `returnSystemJobInfo`. For errors, use log searches. |
| "Why did &lt;workflow-or-step&gt; fail? Show failure details." | Need: host, time range, and if possible instance ID. Search error.log for "Error executing workflow step" + model/step name or instance ID. Also check Felix Console → OSGi Components for process.label. Route to runbook-workflow-fails-or-shows-error. |
| "Task not in Inbox" | symptom_id: task_not_in_inbox. Route to runbook-task-not-in-inbox. Gather: instance ID, assignee, check Inbox filters and enforceWorkitemAssigneePermissions in Felix Console. |
| "Workflow not starting" | symptom_id: workflow_not_starting_launcher. Route to runbook-launcher-not-starting. Search logs for launcher errors. Check launcher config in Felix Console. |
| "Workflow stuck / not progressing" | symptom_id: workflow_stuck_not_progressing. Route to runbook-workflow-stuck. Use JMX `countStaleWorkflows` to check for stale instances. If not stale, follow decision tree by step type. |

---

## Step 6: What logs and JMX can and cannot answer

**Can answer (logs + JMX on 6.5 / AMS):**

- Step failures: exception type, message, stack (by host, time, model, step).
- Process not registered: which `process.label` is missing (logs + Felix Console).
- Stuck: step errors, getProcess failures, lock wait, payload/path errors.
- Stale: JMX `countStaleWorkflows` + "Cannot archive workitem" in logs.
- Queue metrics: JMX `returnWorkflowQueueInfo`, `returnSystemJobInfo`.
- Running instance counts: JMX `countRunningWorkflows`.
- Throughput: lock wait, session refresh, JobHandler volume.
- Permission: Terminate/Resume/Suspend failed, AccessControlException.
- Payload/launcher: PathNotFoundException, launcher config errors.
- Purge: JMX `purgeCompleted(dryRun)` + "Workflow purge …" in logs.
- Thread pool state: Configuration status ZIP → `039_Sling_Thread_Pools.txt`.
- Config state: Felix Console or config status ZIP → `003_Configurations.txt`.

**Cannot answer directly:**

- Console state (e.g. "is there a current work item?"). Use Workflow Console UI.
- Runtime process step code behavior. Requires code review + log correlation.

Always pair log-based triage with JMX diagnostics and the appropriate runbook.

---

## References (in repo)

- **Machine-readable index:** `aem-agent-marketplace-workflow-knowledge-base/docs/debugging-index.md`
- **Decision guide:** `runbooks/runbook-decision-guide.md`
- **Splunk scenarios and queries:** `Workflow-docs/splunk-workflow-triaging.md`
- **Error patterns:** `docs/error-patterns.md`
