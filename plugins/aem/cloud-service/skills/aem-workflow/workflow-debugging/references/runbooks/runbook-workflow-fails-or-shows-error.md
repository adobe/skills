# Runbook: Workflow fails or shows error — Cloud Service

**symptom_id:** `workflow_fails_or_shows_error`

> **Variant:** AEM as a Cloud Service. No JMX. `retryFailedWorkItems` / `terminateFailedInstances` are not reachable — use `/aem/inbox` Retry or a custom replay servlet with audit-trail caveats.

---

## Symptom

Workflow instance is in `FAILED` state; or a step shows an error in History; or `error.log` shows `Error executing workflow step` for a live instance.

---

## Root cause categories

- `process_step_exception` — uncaught exception in `WorkflowProcess.execute()`.
- `payload_missing_or_invalid` — payload path deleted, moved, or ACL changed.
- `process_script_or_java_bug` — reproducible defect in the step's logic.
- `timeout_or_transient_failure` — external service down / rate-limited; step doesn't handle it.
- `service_user_access_denied` — `AccessDeniedException` because the workflow service user lost access to the payload tree.

---

## Decision tree

- **IF** the instance is in `FAILED` → run Checklist items 1–5, then apply the matching Remediation row.
- **IF** logs show a step error but the instance isn't FAILED yet (retries remaining) → run Checklist 2–5 now; if the fix lands before retries exhaust, no terminal failure.
- **IF** the failure is transient and recurring (external-service outage pattern) → fix root cause externally first; *then* retry. Retrying before the root cause is fixed just re-exhausts retries.

---

## Checklist

1. **Instance History — exact error**
   Workflow Console → open the instance → **History** tab. Note the **failing step name**, the **error message** shown, and the **timestamp**.

2. **Cloud Manager logs — full stack trace**
   Cloud Manager → **Environments → Logs** (download or stream). Grep for:
   - the **instance ID** (`/var/workflow/instances/...`)
   - the **model name**
   - `Error executing workflow step`
   - thread name format: `JobHandler: <instanceId>:<payloadPath>`
   Capture: exception type, message, full stack. Key classes in the stack tell you where to look: `JobHandler` / `WorkflowSessionImpl` are framework; the customer's Process class is the usual culprit.

3. **Payload still valid and readable**
   - Resolve the payload path from the instance (`JCR_PATH`).
   - Confirm it exists (browser GET on author, or CRXDE Lite on lower envs).
   - Check the recent content commits — did the payload get deleted or moved?
   - Confirm the workflow service user (via the mapped `ServiceUserMapperImpl.amended-*` config) still has read/write where the step needs it.

4. **Process implementation sanity check**
   Open the failing Process class in the customer repo. Quick checks:
   - Null-check on payload before dereferencing.
   - External HTTP calls have a bounded timeout (missing timeout = thread pool risk, covered in [`runbook-job-throughput-and-concurrency.md`](runbook-job-throughput-and-concurrency.md)).
   - JCR writes use a service resolver, not `loginAdministrative` (forbidden on AEMaaCS).
   - `WorkflowException` is thrown deliberately for retry-worthy failures, not a generic RuntimeException.

5. **Retry and timeout behaviour**
   - `cq.workflow.job.retry` on `com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json` (default `3`) governs retry count. Bundled example: [`../examples/com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json`](../examples/com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json).
   - `noRetryOnException` (model metadata) or `noretry` (instance metadata) disables retries regardless of global config.
   - For transient failures (external service), increase retry count temporarily; for permanent failures, disable retry so the step fails fast instead of wasting cycles.

---

## Remediation

### Fix root cause first, retry second

| Scenario | Fix-first action | Retry action |
|----------|------------------|--------------|
| Process step bug | Patch class, commit, deploy via Cloud Manager pipeline. | `/aem/inbox` → locate failure → **Retry** (preserves history). |
| Payload deleted | Restore payload (content revert) or terminate instance. | If restored, retry via Inbox. If terminated, start a new instance with valid payload. |
| Payload moved | Update payload references in the workflow metadata (or, pragmatically, terminate + restart on the new path). | N/A after terminate. |
| External service was down | Wait for upstream recovery; confirm via synthetic call. | `/aem/inbox` Retry for each affected instance. For many instances, see **Bulk retry** below. |
| Service user ACL regression | Find the commit that dropped the ACL (repoinit / service-user mapping); restore; deploy. | `/aem/inbox` Retry once the service user can access the payload again. |

### Single-item retry (preferred)

`/aem/inbox` → select the failure item → **Retry**. This:
- preserves the original instance, its history, step durations, and comments;
- is safe for audit-regulated workflows (pharma, finance, legal);
- requires the caller to be the assignee of the failure item or a member of `cq.workflow.superuser`.

### Bulk retry — no AEMaaCS primitive

There is no JMX `retryFailedWorkItems` on AEMaaCS. Three options:

| Approach | Trade-off |
|----------|-----------|
| Iterate `/aem/inbox` manually | ✅ Preserves history per item. Tedious past ~50 items. |
| Custom replay servlet (`terminateWorkflow` + `startWorkflow`) | ⚠️ **Loses** original instance history, step durations, and comments — creates a *new* instance per replay. **Never** for audit-regulated workflows. Gate it with a superuser check and `?dryRun=true` default (follow the pattern in [`../examples/StaleWorkflowServlet.java`](../examples/StaleWorkflowServlet.java)). |
| Adobe Support ticket | ✅ Correct for hundreds of failures, audit-regulated content, or urgent deadlines. |

### Terminate a genuinely unrecoverable instance

If the failure will always recur (model removed, payload permanently gone, bug won't be fixed in this instance):

- **Single:** Workflow Console → open instance → **Terminate**. Requires initiator or superuser.
- **Bulk:** no AEMaaCS primitive; same three options as bulk retry.

---

## Escalation

- Stack trace is entirely Granite / Oak internals (no customer code) → Adobe Support with: stack, instance ID, model ID, and the 1-hour Cloud Manager log slice.
- Failure is an `AccessDeniedException` on a path the service user *should* have access to → check recent repoinit commits first; Support only if you can't trace the regression to a commit.
- Many instances failing across multiple models simultaneously → platform incident, not a customer-code bug; Support ticket with environment ID and failure window.

---

## References

- Bundled WorkflowSessionFactory config: [`../examples/com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json`](../examples/com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json)
- Bundled servlet (superuser-guarded pattern for bulk operations): [`../examples/StaleWorkflowServlet.java`](../examples/StaleWorkflowServlet.java)
- Error patterns catalog: [`../docs/error-patterns.md`](../docs/error-patterns.md)
- Related runbooks: [`runbook-failed-work-items.md`](runbook-failed-work-items.md), [`runbook-workflow-stuck.md`](runbook-workflow-stuck.md), [`runbook-inbox-and-permissions.md`](runbook-inbox-and-permissions.md)
