---
name: workflow-triaging
description: Triage AEM Workflow issues on AEM as a Cloud Service by classifying symptoms, gathering the right logs and metrics, and mapping to runbooks or Splunk searches. Use when the user asks for workflow activity/errors on a Cloud Service host, needs to classify a Jira ticket, or wants to know what to collect for workflow debugging.
license: Apache-2.0
---

# AEM Workflow Triaging — Cloud Service

Classify workflow issues, determine what logs and data to gather, and map to the correct runbook or log search. Optimized for **production support** on **AEM as a Cloud Service (AEMaaCS)**.

## Audience

AEMaaCS developers and operators (and the IDE LLM acting on their behalf) classifying workflow incidents across one or more environments — using environment ID + time-range + Cloud Manager Logs (or a log aggregator such as Splunk, if you forward AEMaaCS logs there), before drilling into one instance. Use this skill for cross-environment log mining and symptom classification; switch to `workflow-debugging` once the instance and root cause are identified.

## Variant Scope

- AEM as a Cloud Service only.
- **Not for AEM 6.5 LTS / AMS.** If the target is 6.5 LTS, stop and use the 6.5-lts variant of this skill — Splunk index/sourcetype paths, the JMX surface, and several log signatures there do not apply as written on AEMaaCS.
- Log access via **Cloud Manager** → Environments → Logs (download or streaming), or Splunk if logs are indexed there.
- **No JMX on AEMaaCS production.** Workflow counts and queue metrics come from logs, Developer Console status producers, and the Sling Job Console. JMX MBeans exist on the local AEMaaCS SDK (`localhost:4502`) but must not be assumed available on cloud environments.
- **All remediation lands via Git + Cloud Manager pipeline.** There is no Felix Console write access or Package Manager on production AEMaaCS environments.

## Dependencies

- `workflow-debugging` — once a symptom is classified and an environment/instance is identified, route here for the step-by-step runbook and remediation.
- `workflow-debugging/reference.md` — canonical diagnostic tool pointers, log patterns, and external doc links for AEMaaCS.

---

## When to use this skill

- User asks: "Workflow errors on `<env-id>` for the past X hours", "Workflow activity on `<env-id>`", "Why did workflow X fail?", "What should I collect to debug this workflow ticket?"
- User needs: Symptom classification, log patterns to search, Splunk queries, or required inputs for a runbook.
- Context: AEM Cloud Service (environment ID format: `cm-p<programId>-e<environmentId>`).

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
| Auto-advance / timeout jobs not firing; participant step stuck past its configured timeout | workflow_auto_advance_failure | runbook-job-throughput-and-concurrency.md |
| New or changed workflow not starting or step not executing | workflow_setup_validation | runbook-validate-workflow-setup.md |

> **WorkItem vs. TaskManager task — do not confuse these.** Most workflow Inbox items are workflow work items (`WorkItem`), created by Participant steps and managed by the workflow engine; they are stored under `/var/workflow/instances`, not in TaskManager. TaskManager (`/var/taskmanagement/tasks`) only holds tasks created explicitly via the Task API — used by Projects, Assets tasks, and custom integrations. For `task_not_in_inbox` and `user_cannot_see_or_complete_item` symptoms on a workflow: investigate the Participant step assignee configuration, Inbox filters, and workflow permissions — not TaskManager storage. Diagnosing the wrong backend wastes significant time.

---

## Step 2: Required inputs for triage

Before suggesting a runbook or Splunk search, try to obtain:

| Input | Purpose |
|-------|---------|
| **Environment ID** | AEMaaCS format: `cm-p<programId>-e<environmentId>` (e.g. `cm-p163724-e1759416`). |
| **Time range** | e.g. "past 4 hours", "past 10 hours" – for log/Splunk scope. |
| **Workflow model or step name** | e.g. "Dynamic Media Reupload", "DAM Update Asset", "testmodel". |
| **Instance ID** (if known) | From Workflow Console URL or payload; ties logs to one instance. |
| **Payload path** (if known) | e.g. `/content/dam/...`; for path-related errors. |
| **Log source** | Cloud Manager log download, log streaming, or Splunk index/sourcetype. |

If the user only provides environment ID + time, respond with the **generic** workflow error searches and note that narrowing by model or instance ID will improve accuracy.

---

## Step 3: Log patterns and Splunk (what to search)

Logs on AEMaaCS are accessed via **Cloud Manager** → Environments → Logs (download or streaming). The primary file is `error.log`. When logs are indexed in **Splunk** (or any log aggregator), use these patterns.

| Scenario | Primary log pattern(s) | Note |
|----------|------------------------|------|
| Step failed | `Error executing workflow step` | Add instance ID or model name to narrow. |
| Process not found | `getProcess for '*' failed` | Extract process name; check OSGi Components for `process.label` mismatch. |
| Stuck at Process step | Same as step failed + `getProcess` | Combine with payload path. |
| Stale workflow | `Cannot archive workitem` | Correlate time with instance ID. |
| Lock / throughput | `refreshing the session since we had to wait for a lock` | Reduce effective concurrency — on AEMaaCS, job queue settings are not directly tunable at runtime; address via code changes: split workflows, offload heavy steps asynchronously, or externalize processing. Raising concurrency makes lock contention worse. |
| Permission | `Terminate failed` / `Resume failed` / `Suspend failed` + verifyAccess | Or `AccessControlException`. Check `enforceWorkflowInitiatorPermissions`. |
| Payload path | `PathNotFoundException` (workflow/payload) | Payload deleted, or launcher config path missing. |
| Launcher not starting | `Error adding launcher config` / `Error retrieving launcher config entries` | Path: `/conf/global/settings/workflow/launcher/config`. |
| Purge failure | `Workflow purge '*' :` | Filter by repository exception / invalid state. |
| Transient workflow retries exhausted | `retrys exceeded - remove isTransient` | Process step kept throwing after `cq.workflow.job.retry` retries. Fix step code; instance persisted for admin handling. |
| Thread pool full | `RejectedExecutionException` | `default` pool saturated with `blockPolicy=ABORT`; timeout/auto-advance jobs dropped. |
| Operation on finished instance | `Workflow is already finished` | Check logic that calls terminate/resume on a completed or aborted instance. |

**Example Splunk searches (replace index/sourcetype/field names for your environment):**

- All workflow step errors (last 24h):
  `index=aem sourcetype=aem:error "Error executing workflow step" | table _time host message | sort - _time`
- Process not registered:
  `index=aem "getProcess for" "failed" | table _time host message`
- By workflow model or instance:
  `index=aem ("Error executing workflow step" OR WorkflowException) (message=*<modelName>* OR message=*<instanceId>*) | sort - _time`
- Lock contention:
  `index=aem "refreshing the session since we had to wait for a lock" | table _time host message`
- Thread pool exhaustion (auto-advance impact):
  `index=aem "RejectedExecutionException" | table _time host message`

> **Note:** Indexes and sourcetypes vary by organization; adapt queries accordingly.

---

## Step 4: Developer Console and Sling Job diagnostics

On AEMaaCS production, use the **Developer Console** status producers and the **Sling Jobs page** for metrics not available from logs alone. JMX is not available on production AEMaaCS; these are the equivalents.

| What to check | Tool / URL | Purpose |
|---------------|-----------|---------|
| Workflow queue depth and failed jobs | Sling Jobs page: `/system/console/slingevent` | `Queued Jobs > 0` with `Active Jobs = 0` → jobs not being picked up. `Failed Jobs` count per topic. |
| Workflow job topic statistics | Sling Jobs page: topic `com/adobe/granite/workflow/job/var/workflow/models/<modelName>` | High `Failed Jobs` / low `Finished Jobs` → process step throwing exceptions. |
| Sling `default` thread pool saturation | Thread Pools page: `/system/console/status-slingthreadpools` | `active count = max pool size` AND `blockPolicy = ABORT` → new scheduled tasks (including workflow timeout detection) are silently rejected. |
| Thread stack trace | Thread Dump: `/system/console/status-jstack-threaddump` | All `sling-default-*` threads stuck on same stack → blocking culprit for auto-advance failure. |
| Sling Scheduler status | Scheduler page: `/system/console/status-slingscheduler` | Confirm `ApacheSlingdefault` uses `ThreadPool: default`. Note: `com/adobe/granite/workflow/timeout/job` is a Sling Job topic, not visible here — check the Sling Jobs page instead. |
| OSGi bundle / process registration | OSGi Components: `/system/console/components` | Confirm WorkflowProcess component with matching `process.label` is Active. |
| Instance state | Workflow Console: `/libs/cq/workflow/admin/console/content/instances.html` | Instance status, current work item, history. |

**Developer Console access:** AEM Cloud Service → Developer Console. Status producers (thread dumps, Sling Jobs, thread pools) are read-only on all tiers. On the local AEMaaCS SDK (`localhost:4502/system/console/jmx`) JMX MBeans are also available — use them for local development only; do not document JMX steps for production.

**Safety:** Never recommend remediation operations that bypass Git + Cloud Manager pipeline (e.g. Felix Console config changes) on cloud environments. All config changes go in `ui.config` and deploy via pipeline.

---

## Step 5: Example triage prompts and responses

| User prompt | Triage response |
|-------------|-----------------|
| "Workflow errors on `<env-id>` for the past X hours" | Classify as `workflow_fails_or_shows_error` / `step_failed_retries_exhausted`. Download or stream `error.log` from Cloud Manager; search for `Error executing workflow step`, `Error processing workflow job`, `getProcess for … failed`. Check Sling Jobs page for failed job count per topic. Route to `runbook-workflow-fails-or-shows-error`. |
| "Workflow activity on `<env-id>` for the past X hours" | Clarify: counts (started/completed/failed) or list of errors? For errors, use log searches above. For counts on AEMaaCS, use Cloud Manager log aggregation or the Sling Jobs page — no JMX. |
| "Why did `<workflow-or-step>` fail? Show failure details." | Need: environment ID, time range, instance ID if known. Search `error.log` for `Error executing workflow step` + model/step name or instance ID; return exception type, message, and stack. Route to `runbook-workflow-fails-or-shows-error`. |
| "Task not in Inbox" | `symptom_id: task_not_in_inbox`. Route to `runbook-task-not-in-inbox`. Gather: instance ID, assignee, whether user is initiator/assignee. Check Inbox filters and `enforceWorkitemAssigneePermissions` via Developer Console OSGi config view. |
| "Workflow not starting" | `symptom_id: workflow_not_starting_launcher`. Route to `runbook-launcher-not-starting`. Gather: model name, payload path, launcher config path; search logs for launcher errors. |
| "Workflow stuck / not progressing" | `symptom_id: workflow_stuck_not_progressing`. Route to `runbook-workflow-stuck`. First: does the instance have a current work item? If no → stale. If yes, follow decision tree by step type. |
| "Auto-advance / timeout jobs not firing" | `symptom_id: workflow_auto_advance_failure`. Route to `runbook-job-throughput-and-concurrency`. Check Developer Console thread dump for `sling-default-*` thread saturation; check Sling Jobs page for `com/adobe/granite/workflow/timeout/job` topic; search `error.log` for `RejectedExecutionException`. |

---

## Step 6: What logs and Developer Console can and cannot answer

**Can answer (with AEM workflow logs from Cloud Manager + Developer Console on AEMaaCS):**

- Step failures: exception type, message, stack (by environment, time, model, step).
- Process not registered: which `process.label` is missing (logs + Developer Console OSGi Components).
- Stuck: step errors, `getProcess` failures, lock wait, payload/path errors.
- Stale: `Cannot archive workitem` and transition errors in logs.
- Queue metrics: Sling Jobs page (`/system/console/slingevent`) → queued, active, failed per topic.
- Thread pool saturation: Thread Pools page (`/system/console/status-slingthreadpools`).
- Throughput: lock wait, session refresh, JobHandler volume in logs.
- Permission: Terminate/Resume/Suspend failed (`verifyAccess`), `AccessControlException` in logs.
- Payload/launcher: `PathNotFoundException`, launcher config errors in logs.
- Purge: `Workflow purge …` repository exception or invalid state in logs.

**Cannot answer directly (AEMaaCS limitations vs 6.5 LTS):**

| What is needed | AEMaaCS alternative |
|----------------|---------------------|
| JMX `countStaleWorkflows` | Deploy a custom `StaleWorkflowServlet` (see `workflow-debugging` Step 6); call with `?dryRun=true`. |
| JMX `countRunningWorkflows` | Workflow Console UI, or a custom count servlet. |
| JMX `retryFailedWorkItems` | Inbox UI → Retry (single); or a custom bulk-retry servlet (see `workflow-debugging` Step 6). |
| JMX `purgeCompleted` | `com.adobe.granite.workflow.purge.Scheduler-<alias>.cfg.json` deployed via pipeline. |
| JMX `restartStaleWorkflows` | Custom `StaleWorkflowServlet` with `POST ...?dryRun=false`. |
| Config status ZIP | Developer Console status producers; or request from Adobe Support. |
| Console state (current work item) | Workflow Console UI (`/libs/cq/workflow/admin/...`) or custom API. |
| Runtime process step code behavior | Requires code review + log correlation. |
| Pod restart | Adobe Support ticket — Cloud Manager does not expose a customer-facing restart action. |

> **Custom servlets are privileged — secure them before deploying.** The `StaleWorkflowServlet` and any bulk-retry/count servlet above restart, replay, or enumerate workflows. Treat them as admin-only: authorize the caller against an operations group, use a service user (never an admin session), default to `dryRun=true`, scope by model, and keep the endpoint off publish. Follow the secure-write/deploy checklist in `workflow-debugging` Step 6 before shipping one.

Always pair log-based triage with Developer Console diagnostics and the appropriate runbook for actions (Inbox Retry, Purge Scheduler config, Cloud Manager pipeline deploy).

---

## References (in repo)

- **Diagnostic tool pointers and log patterns:** [`../workflow-debugging/reference.md`](../workflow-debugging/reference.md)
- **Step-by-step runbook (per symptom):** [`../workflow-debugging/SKILL.md`](../workflow-debugging/SKILL.md)
- **Cloud Service guardrails (paths, service users, OSGi annotations):** [`../workflow-development/references/workflow-foundation/cloud-service-guardrails.md`](../workflow-development/references/workflow-foundation/cloud-service-guardrails.md)
