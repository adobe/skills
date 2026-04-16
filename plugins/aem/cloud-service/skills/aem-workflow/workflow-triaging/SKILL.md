---
name: workflow-triaging
description: Triage AEM Workflow issues on AEM as a Cloud Service by classifying symptoms, gathering the right logs and metrics, and mapping to runbooks or Splunk searches. Use when the user asks for workflow activity/errors on a Cloud Service host, needs to classify a Jira ticket, or wants to know what to collect for workflow debugging.
license: Apache-2.0
---

# AEM Workflow Triaging — Cloud Service

Classify workflow issues, determine what logs and data to gather, and map to the correct runbook or log search. Optimized for **production support** on **AEM as a Cloud Service**.

## Variant Scope

- This skill is **cloud-service-only**.
- Log access via Cloud Manager download or log streaming.
- No JMX — workflow counts and queue metrics come from logs, APIs, or Developer Console.

---

## When to use this skill

- User asks: "Workflow errors on &lt;host&gt; for the past X hours", "Workflow activity on &lt;host&gt;", "Why did workflow X fail?", "What should I collect to debug this workflow ticket?"
- User needs: Symptom classification, log patterns to search, Splunk queries, or required inputs for a runbook.
- Context: AEM Cloud Service (e.g. cm-p12345-e67890).

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
| **Host / instance** | e.g. cm-p163724-e1759416 (Cloud Service program-environment format). |
| **Time range** | e.g. "past 4 hours", "past 10 hours" – for log/Splunk scope. |
| **Workflow model or step name** | e.g. "Dynamic Media Reupload", "DAM Update Asset", "testmodel". |
| **Instance ID** (if known) | From Workflow console URL or payload; ties logs to one instance. |
| **Payload path** (if known) | e.g. /content/dam/...; for path-related errors. |
| **Log source** | Cloud Manager log download, log streaming, or Splunk index/sourcetype. |

If the user only provides host + time, respond with the **generic** workflow error searches and note that narrowing by model/instance ID will improve accuracy.

---

## Step 3: Log patterns and Splunk (what to search)

Logs on Cloud Service are accessed via **Cloud Manager** → Environments → Logs (download or streaming). When logs are in **Splunk** (or any log aggregator), use these patterns.

| Scenario | Primary log pattern(s) | Splunk hint |
|----------|------------------------|-------------|
| Step failed | `Error executing workflow step` | Add instance ID or model name to narrow. |
| Process not found | `getProcess for '*' failed` | Extract process name for OSGi check. |
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

## Step 4: Example triage prompts and responses

| User prompt | Triage response |
|-------------|------------------|
| "Workflow errors on &lt;host&gt; for the past X hours" | Classify as workflow_fails_or_shows_error / step_failed_retries_exhausted. Search Cloud Manager logs or Splunk for "Error executing workflow step", "Error processing workflow job", "getProcess for … failed" on that host. Route to runbook-workflow-fails-or-shows-error. |
| "Workflow activity on &lt;host&gt; for the past X hours" | Clarify: "activity" = counts (started/completed/failed) or list of errors? For errors, use same searches. For counts on Cloud Service, use log aggregation or custom reporting API — no JMX. |
| "Why did &lt;workflow-or-step&gt; fail? Show failure details." | Need: host, time range, and if possible instance ID. Search Cloud Manager logs for "Error executing workflow step" + model/step name or instance ID; return exception type, message, and stack. Route to runbook-workflow-fails-or-shows-error. |
| "Task not in Inbox" | symptom_id: task_not_in_inbox. Route to runbook-task-not-in-inbox. Gather: instance ID, assignee, whether user is initiator/assignee; check Inbox filters and enforceWorkitemAssigneePermissions. |
| "Workflow not starting" | symptom_id: workflow_not_starting_launcher. Route to runbook-launcher-not-starting. Gather: model name, payload path, launcher config path; search logs for launcher errors. |
| "Workflow stuck / not progressing" | symptom_id: workflow_stuck_not_progressing. Route to runbook-workflow-stuck. First: Does instance have a current work item? If no → stale. If yes, follow decision tree by step type. |

---

## Step 5: What logs can and cannot answer

**Can answer (with AEM workflow logs in Cloud Manager / Splunk):**

- Step failures: exception type, message, stack (by host, time, model, step).
- Process not registered: which `process.label` is missing.
- Stuck: step errors, getProcess failures, lock wait, payload/path errors.
- Stale: "Cannot archive workitem" and transition errors.
- Throughput: lock wait, session refresh, JobHandler volume.
- Permission: Terminate/Resume/Suspend failed (verifyAccess), AccessControlException.
- Payload/launcher: PathNotFoundException, launcher config errors.
- Purge: "Workflow purge …" repository exception or invalid state.

**Cannot answer directly (Cloud Service limitations):**

- Console state (e.g. "is there a current work item?"). Use Workflow Console UI or custom API.
- JMX counts (e.g. countStaleWorkflows, queue depth). No JMX on Cloud Service — use log aggregation, custom HTTP APIs, or Developer Console.
- Thread pool metrics. Request thread dump via Developer Console or support.
- Configuration status ZIP. Request from support.

Always pair log-based triage with the appropriate runbook for actions (retry via Inbox, Purge Scheduler config, pipeline deploy).

---

## References (in repo)

- **Machine-readable index:** `aem-agent-marketplace-workflow-knowledge-base/docs/debugging-index.md`
- **Decision guide:** `runbooks/runbook-decision-guide.md`
- **Splunk scenarios and queries:** `Workflow-docs/splunk-workflow-triaging.md`
- **Error patterns:** `docs/error-patterns.md`
