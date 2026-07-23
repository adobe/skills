---
name: workflow-triaging
description: Triage AEM Workflow issues on AEM 6.5 LTS and AMS by classifying symptoms, gathering the right logs and metrics, and mapping to runbooks or Splunk searches. Use when the user asks for workflow activity/errors on a 6.5 host, needs to classify a Jira ticket, or wants to know what to collect for workflow debugging.
license: Apache-2.0
---

# AEM Workflow Triaging — 6.5 LTS / AMS

Classify workflow issues, determine what logs and data to gather, and map to the correct runbook or log search. Optimized for **production support** on **AEM 6.5 LTS** and **Adobe Managed Services (AMS)**.

## Audience

AEM 6.5 LTS / AMS operators and developers (and the IDE LLM acting on their behalf) classifying workflow incidents across one or more hosts — using host + time-range + logs (direct filesystem, AMS log access, or Splunk) and read-only JMX metrics, before drilling into a single instance. Use this skill for cross-host log mining and symptom classification; switch to `workflow-debugging` once the instance and root cause are identified.

## Variant Scope

- This skill is **6.5-lts-only** (includes AMS).
- Log access via direct filesystem (`crx-quickstart/logs/error.log`), AMS log access, or Splunk (if indexed).
- JMX available via Felix Console (`/system/console/jmx`) or a JMX client for workflow counts, queue metrics, and remediation.
- **Not for AEM as a Cloud Service.** If the target is AEMaaCS, stop and use the cloud-service variant of this skill — JMX is not available on cloud production, logs are accessed via Cloud Manager (not the filesystem), and remediation lands through Git + pipeline rather than Felix Console. Several signatures and diagnostic surfaces here do not apply as written on AEMaaCS.

## Dependencies

- `workflow-debugging` — once a symptom is classified and a host/instance is identified, route here for the step-by-step runbook and remediation.
- `workflow-debugging/reference.md` — diagnostic tool pointers, JMX/config locations, log patterns, and external doc links for 6.5 LTS / AMS.

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
| Auto-advance / timeout jobs not firing; participant step stuck past its configured timeout | workflow_auto_advance_failure | runbook-job-throughput-and-concurrency.md |
| New or changed workflow not starting or step not executing | workflow_setup_validation | runbook-validate-workflow-setup.md |

> Each `runbook-*.md` above is a symptom section in the [`workflow-debugging`](../workflow-debugging/SKILL.md) skill, not a separate file to open. That skill's Step 1 maps every `symptom_id` to a first action, and its numbered steps are the runbook body. Classify here, then hand off there.

> **WorkItem vs. TaskManager task — do not confuse these.** Most workflow Inbox items are workflow work items (`WorkItem`), created by Participant steps and managed by the workflow engine; they are stored under `/var/workflow/instances`, not in TaskManager. TaskManager (`/var/taskmanagement/tasks`) only holds tasks created explicitly via the Task API — used by Projects, Assets tasks, and custom integrations. Both paths are browsable in CRXDE Lite. For `task_not_in_inbox` and `user_cannot_see_or_complete_item` symptoms on a workflow: investigate the Participant step assignee configuration, Inbox filters, and workflow permissions — not TaskManager storage. Diagnosing the wrong backend wastes significant time.

---

## Step 2: Required inputs for triage

Before suggesting a runbook or Splunk search, try to obtain:

| Input | Purpose |
|-------|---------|
| **Host / instance** | Author/publish hostname (e.g. an AMS `author`/`publish` host, or on-prem hostname). |
| **Time range** | e.g. "past 4 hours", "past 10 hours" – for log/Splunk scope. |
| **Workflow model or step name** | e.g. "Dynamic Media Reupload", "DAM Update Asset", "testmodel". |
| **Instance ID** (if known) | From Workflow Console URL or payload; ties logs to one instance. |
| **Payload path** (if known) | e.g. `/content/dam/...`; for path-related errors. |
| **Log source** | Splunk index/sourcetype, direct filesystem `error.log`, or AMS log request. |

If the user only provides host + time, respond with the **generic** workflow error searches and note that narrowing by model/instance ID will improve accuracy.

---

## Step 3: Log patterns and Splunk (what to search)

Logs on 6.5 / AMS are accessible via **direct filesystem** (`crx-quickstart/logs/error.log`), AMS log access, or **Splunk** (if indexed).

| Scenario | Primary log pattern(s) | Splunk hint |
|----------|------------------------|-------------|
| Step failed | `Error executing workflow step` | Add instance ID or model name to narrow. |
| Process not found | `getProcess for '*' failed` | Extract process name for OSGi check in Felix Console (`process.label`). |
| Stuck at Process step | Same as step failed + `getProcess` | Combine with payload path. |
| Stale workflow | `Cannot archive workitem` | Correlate time with instance ID. |
| Lock / throughput | `refreshing the session since we had to wait for a lock` | Timechart by host. Real lever on 6.5 is `queue.maxparallel` on the Granite Workflow Queue — see `workflow-debugging`; reduce concurrent writes to the same path. |
| Permission | `Terminate failed` / `Resume failed` / `Suspend failed` + verifyAccess | Or `AccessControlException`. Check `enforceWorkflowInitiatorPermissions`. |
| Payload path | `PathNotFoundException` + workflow/payload | Payload deleted, or launcher config path missing. |
| Launcher not starting | `Error adding launcher config` / `Error retrieving launcher config entries` | Path: `/conf/global/settings/workflow/launcher/config`. |
| Purge failure | `Workflow purge '*' :` | Filter by repository exception / invalid state. |
| Transient workflow retries exhausted | `retrys exceeded - remove isTransient` | Process step kept throwing after `cq.workflow.job.retry` retries; instance persisted for admin handling. |
| Thread pool full | `RejectedExecutionException` | `default` pool saturated with block policy `ABORT` → timeout/auto-advance jobs dropped. |
| Operation on finished instance | `Workflow is already finished` | Check logic that calls terminate/resume on a completed or aborted instance. |

**Example Splunk searches (replace index/sourcetype/field names as needed):**

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

> **Note:** Indexes and sourcetypes vary by organization; adapt queries accordingly. Narrow by host, time range, model, and instance ID — both for accuracy and to avoid over-broad data exposure.

---

## Step 4: JMX-based diagnostics

On 6.5 / AMS, JMX exposes metrics not available from logs alone, plus remediation operations. All workflow maintenance and diagnostic operations live on one MBean, `com.adobe.granite.workflow:type=Maintenance` (via `/system/console/jmx`); a second MBean, `com.adobe.granite.workflow:type=Statistics`, exposes time-series execution metrics for trend analysis.

**Triage is diagnostic-first — classify with read-only operations:**

| What to check | JMX operation (read-only) | Purpose |
|---------------|---------------------------|---------|
| Stale workflow count | `countStaleWorkflows(model)` | Detect stale instances without a current work item |
| Running workflow count | `countRunningWorkflows(model)` | Count active instances for a model |
| Failed workflow count | `returnFailedWorkflowCount(model)` | Count failed instances (overall or per model) |
| Queue depth | `returnWorkflowQueueInfo` | Check Granite Workflow Queue backlog |
| Job statistics | `returnSystemJobInfo` | Sling Job overall stats |
| Job topic info | `returnWorkflowJobTopicInfo` | Per-topic queued/failed/finished counts |
| Purge preview | `purgeCompleted(model, days, dryRun=true)` | Count purgeable instances **without deleting** |

**Destructive operations — do NOT run as part of triage.** The operations below change or delete production workflow data. They belong in a deliberate remediation step (see `workflow-debugging`), not in classification:

| Operation | Effect |
|-----------|--------|
| `retryFailedWorkItems(dryRun, model)` | Replays failed work items |
| `restartStaleWorkflows(model, dryRun)` | Restarts stale instances |
| `purgeCompleted` / `purgeActive(model, days, dryRun)` | Deletes completed/active instances |
| `terminateFailedInstances(restart, dryRun, model)` | Terminates (optionally restarts) failed instances |

**Always run `dryRun=true` first, confirm the count and scope, scope by model where possible, and only execute after the root cause is fixed and with change-control approval.**

---

## Step 5: Example triage prompts and responses

| User prompt | Triage response |
|-------------|------------------|
| "Workflow errors on &lt;host&gt; for the past X hours" | Classify as workflow_fails_or_shows_error / step_failed_retries_exhausted. Search error.log or Splunk for "Error executing workflow step", "Error processing workflow job", "getProcess for … failed". Also check JMX `returnSystemJobInfo` / `returnFailedWorkflowCount` for failed counts. Route to `workflow-debugging` (symptom: workflow_fails_or_shows_error). |
| "Workflow activity on &lt;host&gt; for the past X hours" | Clarify: "activity" = counts or errors? For counts, use JMX `countRunningWorkflows`, `returnSystemJobInfo` (read-only). For errors, use log searches. |
| "Why did &lt;workflow-or-step&gt; fail? Show failure details." | Need: host, time range, and if possible instance ID. Search error.log for "Error executing workflow step" + model/step name or instance ID. Also check Felix Console → OSGi Components for `process.label`. Route to `workflow-debugging` (workflow_fails_or_shows_error). |
| "Task not in Inbox" | symptom_id: task_not_in_inbox. Confirm it is a workflow work item (`/var/workflow/instances`), not a TaskManager task. Gather: instance ID, assignee; check Inbox filters and `granite.workflow.enforceWorkitemAssigneePermissions` in Felix Console. Route to `workflow-debugging`. |
| "Workflow not starting" | symptom_id: workflow_not_starting_launcher. Search logs for launcher errors; check launcher config under `/conf/global/settings/workflow/launcher/config`. Route to `workflow-debugging`. |
| "Workflow stuck / not progressing" | symptom_id: workflow_stuck_not_progressing. Use JMX `countStaleWorkflows` to check for stale instances. If not stale, follow the decision tree by step type. Route to `workflow-debugging`. |
| "Auto-advance / timeout jobs not firing" | symptom_id: workflow_auto_advance_failure. Check the Sling Thread Pools page for `default` pool saturation and block policy `ABORT`; check the Sling Jobs page for the `com/adobe/granite/workflow/timeout/job` topic; search error.log for `RejectedExecutionException`. Route to `workflow-debugging` (job-throughput-and-concurrency). |

---

## Step 6: What logs and JMX can and cannot answer

**Can answer (logs + JMX on 6.5 / AMS):**

- Step failures: exception type, message, stack (by host, time, model, step).
- Process not registered: which `process.label` is missing (logs + Felix Console).
- Stuck: step errors, getProcess failures, lock wait, payload/path errors.
- Stale: JMX `countStaleWorkflows` + "Cannot archive workitem" in logs.
- Queue metrics: JMX `returnWorkflowQueueInfo`, `returnSystemJobInfo`, `returnWorkflowJobTopicInfo`.
- Running / failed instance counts: JMX `countRunningWorkflows`, `returnFailedWorkflowCount`.
- Throughput: lock wait, session refresh, JobHandler volume.
- Permission: Terminate/Resume/Suspend failed, AccessControlException.
- Payload/launcher: PathNotFoundException, launcher config errors.
- Purge preview: JMX `purgeCompleted(dryRun=true)` + "Workflow purge …" in logs.
- Thread pool state: Configuration status ZIP → `039_Sling_Thread_Pools.txt`, or the Sling Thread Pools status page.
- Config state: Felix Console or config status ZIP → `003_Configurations.txt`.

**Cannot answer directly:**

- Console state (e.g. "is there a current work item?"). Use the Workflow Console UI (`/libs/cq/workflow/admin/console/content/instances.html`).
- Runtime process step code behavior. Requires code review + log correlation.

Always pair log-based triage with read-only JMX diagnostics and the appropriate runbook in `workflow-debugging`.

---

## Safety & security guardrails

Triage runs against production. Keep it safe:

- **Diagnose read-only; never mutate during triage.** Classification and data-gathering use read-only JMX operations, log reads, and console status pages. The mutating operations in Step 4 (`retryFailedWorkItems`, `restartStaleWorkflows`, `purgeCompleted`, `purgeActive`, `terminateFailedInstances`) change or delete production workflow data — run them only as a deliberate remediation step (see `workflow-debugging`): `dryRun=true` first, scoped by model, after the root cause is fixed, and with change-control approval.
- **Least privilege.** Felix Console and JMX are admin-level surfaces. Restrict them to operators. Keep `/system/console` off public networks — on AMS/on-prem it must sit behind the Dispatcher deny rules and admin authentication, never reachable from publish or the internet.
- **No secrets in queries or shared logs.** Do not embed credentials, tokens, or API keys in Splunk searches or in anything pasted into a ticket; redact them if present.
- **Treat logs and thread dumps as sensitive.** `error.log`, configuration status ZIPs, and thread dumps can contain payload paths, user IDs, and application data. Share only with authorized parties and redact customer PII before attaching to a ticket.
- **Scope every search.** Narrow Splunk/log searches by host, time range, model, and instance ID — for accuracy and to minimize data exposure.

---

## References (in repo)

- **Step-by-step runbook (per symptom):** [`../workflow-debugging/SKILL.md`](../workflow-debugging/SKILL.md)
- **Diagnostic tool pointers, JMX/config locations, and log patterns:** [`../workflow-debugging/reference.md`](../workflow-debugging/reference.md)
- **6.5 LTS guardrails (paths, service users, OSGi annotations):** [`../workflow-development/references/workflow-foundation/65-lts-guardrails.md`](../workflow-development/references/workflow-foundation/65-lts-guardrails.md)
- **Intent router / 6.5 LTS capabilities:** [`../SKILL.md`](../SKILL.md)
