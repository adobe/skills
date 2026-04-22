# Runbook: Failed work items (retries exhausted) — Cloud Service

**symptom_id:** `step_failed_retries_exhausted`

> **Variant:** AEM as a Cloud Service. No JMX. The JMX `retryFailedWorkItems` /
> `terminateFailedInstances` operations used on 6.5 LTS / AMS are **not
> reachable** on AEMaaCS — remediation goes through `/aem/inbox` Retry or, for
> bulk replay, a custom servlet (with strict caveats, below).

---

## Symptom

A workflow step failed after all configured retries; a failure work item was created. The instance is in `RUNNING` state with a failure task in Inbox (or, if auto-terminate-on-failure is configured, the instance is `FAILED`).

---

## Root cause categories

- `process_not_registered_or_label_mismatch` — `@Component process.label` doesn't match the Process field in the model.
- `exception_in_process_execute` — unhandled exception in `WorkflowProcess.execute()`.
- `payload_or_repository_error` — `PathNotFoundException`, `AccessDeniedException`, or JCR error in the step.
- `external_service_failure` — timeout, 5xx, or rate-limit from a service the step depends on.

---

## Decision tree

- **IF** a failure work item shows in `/aem/inbox` → execute the Checklist, then apply Remediation.
- **IF** the step fails on first run (retries not yet exhausted) → use [`runbook-workflow-fails-or-shows-error.md`](runbook-workflow-fails-or-shows-error.md) for diagnosis; the Remediation may still apply.
- **IF** the root cause is a code bug → fix, deploy via Cloud Manager pipeline, **then** retry (retrying before deploy just re-exhausts retries).

---

## Checklist

1. **Read `error.log` from Cloud Manager**
   Cloud Manager → **Environments → Logs** → download or stream. Grep for `Error executing workflow step`. Capture the **exception type**, **message**, and **stack trace**. Identify the Process class from the stack.

2. **Confirm retry configuration**
   Retry count lives in OSGi config `com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json` → property `cq.workflow.job.retry` (default `3`). See the bundled example [`../examples/com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json`](../examples/com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json).
   Per-model / per-instance overrides: `noRetryOnException` (model metadata) or `noretry` (instance metadata) disables retries — if set, the step gets one attempt regardless of `cq.workflow.job.retry`.

3. **Confirm process registration**
   Developer Console → **OSGi → Components**. Search for services with `process.label` matching the model's Process field. Confirm:
   - Bundle is `Active`.
   - `process.label` exact string matches the model's Process step (case-sensitive).
   - If the component is missing, the bundle didn't deploy or the `@Component` annotation was removed in a recent commit.

4. **Confirm payload is still valid**
   Open the failed instance in Workflow Console (`/libs/cq/workflow/admin/console/content/instances.html` — read-only path, allowed). Get the payload path. Verify it exists in the JCR (e.g. via CRXDE Lite on lower envs, or a browser GET on author). `PathNotFoundException` in the log for that path means the payload was deleted after the workflow started.

5. **Confirm workflow service user permissions**
   Failed steps often use a service user via `ServiceUserMapperImpl.amended-*.cfg.json`. If the service user lost access to the payload path (ACL change, content move), the step will fail with `AccessDeniedException`. Check recent ACL commits and repoinit.

---

## Remediation

### Preferred: single-item Retry from Inbox

This **preserves the original instance, its history, step durations, and comments**. Safe for audit-regulated workflows.

| Action | How |
|--------|-----|
| Fix root cause first | Deploy code/config fix through Cloud Manager pipeline. Retrying before the fix just re-exhausts retries. |
| Retry from Inbox | `/aem/inbox` → locate the failure item → **Retry**. Single click per item. |

### Bulk retry — there is no clean AEMaaCS primitive for this

On 6.5 / AMS this is `retryFailedWorkItems` via JMX. On AEMaaCS, there is **no equivalent JMX operation**, and the Granite Workflow API does not expose a public "retry all failed" call. Options:

| Approach | Safety | When to use |
|----------|--------|-------------|
| **Iterate `/aem/inbox` manually** | ✅ Preserves history per item | Tens of items, or any audit-regulated workflow (pharma, finance, legal). |
| **Custom replay servlet (`terminateWorkflow` + `startWorkflow`)** | ⚠️ **Loses** original instance history, step durations, and comments — creates a *new* instance per replay | **Only** with explicit customer approval; **never** for audit-regulated workflows. Document the audit-trail loss in the change record. |
| **Open Adobe Support ticket** | ✅ Engineering can run a one-off platform operation | Hundreds of items, audit-regulated content, or customer cannot deploy a servlet in time. |

If you build a bulk-retry servlet, gate it behind a superuser check (see [`../examples/StaleWorkflowServlet.java`](../examples/StaleWorkflowServlet.java) for the 403 pattern), and always expose `?dryRun=true` as the default.

### Terminate a failed instance

If the failure is unrecoverable (payload deleted, model removed, bug will recur):

| Action | How |
|--------|-----|
| Terminate single instance | Workflow Console → open instance → **Terminate**. Requires initiator or `cq.workflow.superuser`. |
| Bulk terminate | No AEMaaCS primitive; same constraints as bulk retry. Consider opening a Support ticket rather than writing code. |

### Disable retries for a step (rarely correct)

Set `noRetryOnException` in the model metadata, or `noretry` in the instance metadata. Use only if a step is known to be non-idempotent and a second attempt is worse than a first-attempt failure. Most of the time, **fix the step to be idempotent** instead.

---

## Escalation

- Stack trace references only Granite Workflow internals (no customer code) → Adobe Support ticket with stack + instance ID + model ID.
- Payload-path `PathNotFoundException` across many instances → content-migration incident, not a workflow incident; loop in the content team.
- ACL or service-user `AccessDeniedException` → check the recent repoinit / `ServiceUserMapperImpl.amended-*.cfg.json` deploys first. Support only if you can't trace the permission regression to a commit.

---

## References

- Bundled WorkflowSessionFactory config example: [`../examples/com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json`](../examples/com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json)
- Superuser-gated servlet pattern (for bulk operations): [`../examples/StaleWorkflowServlet.java`](../examples/StaleWorkflowServlet.java)
- Error patterns: [`../docs/error-patterns.md`](../docs/error-patterns.md)
- Related: [`runbook-workflow-fails-or-shows-error.md`](runbook-workflow-fails-or-shows-error.md), [`runbook-inbox-and-permissions.md`](runbook-inbox-and-permissions.md)
