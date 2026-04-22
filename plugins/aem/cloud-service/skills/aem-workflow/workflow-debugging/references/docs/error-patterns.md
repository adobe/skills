# AEM Workflow — Error Patterns (Cloud Service)

Common error patterns and log signatures to look for when debugging workflow issues on **AEM as a Cloud Service**.

> **Where to get these logs on AEMaaCS:**
> - **Cloud Manager → Environments → Logs** — download `error.log` (per-hour rollups) or use log streaming.
> - **Splunk / customer log-aggregator** — if the customer forwards AEM logs, search there.
> - **Developer Console → Logs** — live tail on lower envs; not available in production.
> - `jstack` / file-system `tail -f error.log` are **not available** on AEMaaCS. If you need a thread dump, use Developer Console → Status → Thread Dump (lower envs) or open an Adobe Support ticket with a timestamp range.
> Every log signature below is grep-able in Cloud Manager's downloaded logs; add instance ID, model name, or payload path to narrow.

---

## 1. WorkflowException

**Type:** `com.adobe.granite.workflow.WorkflowException`

Generic workflow API failure. Check message and cause for root reason.

| Message / context | Likely cause |
|-------------------|--------------|
| `Could not delete model due to running instances.` | Model delete attempted while workflows using that model are still running. |
| `unable to retrieve models` | Repository or path issue reading `/var/workflow/models` (or design path). |
| `Unable to refresh session` | JCR session refresh failed during terminate/resume/suspend. |
| `Failed to complete workitem <id>` | Failure during transition (e.g. archive, route, persist). |
| `Error getting delegates` / `Error loading ResourceResolver from Session` | Adapter/session issue when resolving delegates. |
| `Cannot find assignee to return the item` | Return-item action could not resolve assignee. |
| `Could not get work items for <user>` | Inbox/work item query or permission issue for user. |
| `Path not found` / `Error adding launcher config` / `Error removing launcher config` | Launcher config path missing (e.g. `/conf/global/settings/workflow/launcher/config`) or wrong session. |
| `Error retrieving launcher config entries` | Cannot read launcher config from JCR. |

---

## 2. IllegalStateException (workflow state)

| Message | Meaning |
|---------|--------|
| `Workflow is already finished.` | Terminate called on workflow that is already COMPLETED/ABORTED. |
| `Workflow is not currently suspended.` | Resume called on workflow that is not SUSPENDED. |
| `Workflow is not running` | Suspend called on workflow that is not RUNNING. |
| `Cannot complete work item. Workflow instance has been suspended` | Complete called after workflow was suspended. |

---

## 3. Job execution errors (JobHandler)

| Log pattern | Meaning |
|-------------|---------|
| `Error executing workflow step` | Exception in process/step execution; check retry count and noRetry/noretry. |
| `Error processing workflow job` | Outer exception in job processing (e.g. before/after step execution). |
| `Transient workflows must have exactly one start node` | Transient workflow model has 0 or >1 start transitions. |
| `The first node in a transient workflow must be of type: Process` | First node after start is not a Process step. |
| `Workflow with id <id> is in COMPLETED|ABORTED state. Cancelling the job execution` | Job ran for an instance that already finished; job is cancelled. |
| `Cannot archive workitem` | Failure archiving work item when moving to next step; triggers retry. |
| `Skipping workflow step <step> which is on the skip list` | Step explicitly skipped via WorkflowProcessSkiplist. |

---

## 4. Repository / session errors

| Pattern | Likely cause |
|---------|--------------|
| `RepositoryException` during purge | JCR error during purge (e.g. query, save, permission). |
| `failed to adapt WorkflowSession to ResourceResolver` | Adapter from WorkflowSession to ResourceResolver failed. |
| `PathNotFoundException` on launcher config | Launcher config path not created. |

---

## 5. Version / model errors

| Pattern | Meaning |
|---------|---------|
| `Version <version> does not exist for <modelId>` | Requested workflow model version not found (VersionException). |
| Model not found after deploy/sync | Model not under `/var/workflow/models` or overlay; or cache not updated. |

---

## 6. Permission / access

| Pattern | Meaning |
|---------|---------|
| `Terminate failed:`, `Resume failed:`, `Suspend failed:` (with verifyAccess) | Caller is not initiator or superuser. |
| `AccessControlException` on delegate/return | User lacks permission to delegate or return the item. |
| Work items not visible in inbox | Enforce work item assignee / initiator permissions; user not assignee, initiator, or shared with. |

---

## 7. Purge / maintenance

| Log pattern | Meaning |
|-------------|---------|
| `Workflow purge '<name>' : repository exception` | Purge job failed with RepositoryException. |
| `Workflow purge '<name>' : empty state entry, skipping purge` | Purge config has no workflow status selected. |
| `Workflow purge '<name>' : invalid state entry: <state>` | Unsupported state in purge config. |

---

## 8. Process / step not found

| Pattern | Meaning |
|---------|---------|
| `getProcess for '<name>' failed` | No WorkflowProcess (or proxy) registered for the step’s process path. |

---

## 9. Variable / metadata

| Pattern | Meaning |
|---------|---------|
| `conversion to String/boolean/double/long/Calendar/... failed: inconvertible types` | ValueFormatException in MetaDataMap/ValueMap (wrong type for key). |
| Variable persist/fetch errors (metrics) | Check success/error variable persist and fetch counters. |

---

## 10. Transient workflow

| Pattern | Meaning |
|---------|---------|
| `retrys exceeded - remove isTransient` | Transient workflow failed and retries exhausted; instance is persisted for admin handling. |

---

## Where to look in logs (by logger)

| Logger class | What it tells you |
|--------------|-------------------|
| `com.adobe.granite.workflow.core.job.JobHandler` | Step execution, retries, failure item creation. |
| `com.adobe.granite.workflow.core.WorkflowSessionImpl` | Session refresh, complete, delegate, return, lock, terminate / resume / suspend. |
| `com.adobe.granite.workflow.core.launcher.WorkflowLauncherImpl` | Launcher config add / remove / get. |
| `com.adobe.granite.workflow.core.job.PurgeScheduler` / `WorkflowOperationsImpl` | Purge and repository errors. |
| `com.adobe.granite.workflow.core.WorkflowSessionFactory` | Startup, model loading, variable persist / fetch. |

**Thread-name correlation on AEMaaCS:** the thread name `JobHandler: <instanceId>:<payloadPath>` ties log lines to a specific workflow instance and payload. Searching Cloud Manager logs for `JobHandler:` + the instance ID is the fastest way to reconstruct a single run.

**To raise log levels on AEMaaCS:** deploy an `org.apache.sling.commons.log.LogManager.factory.config-<alias>.cfg.json` in `ui.config` with `org.apache.sling.commons.log.names=["com.adobe.granite.workflow"]` and `org.apache.sling.commons.log.level="debug"`. Commit + deploy via Cloud Manager pipeline. Felix Console runtime log-level changes are not durable on AEMaaCS.
