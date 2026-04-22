# Runbook: Stale workflows — Cloud Service

**symptom_id:** `stale_workflow_no_work_item`

> **Variant:** AEM as a Cloud Service. No JMX. The JMX `countStaleWorkflows` /
> `restartStaleWorkflows(dryRun)` operations used on 6.5 LTS / AMS are **not
> reachable** on AEMaaCS — they are replaced by the bundled
> [`StaleWorkflowServlet`](../examples/StaleWorkflowServlet.java).

---

## Symptom

Workflow instance is in state `RUNNING` but has **no current work item**. The Workflow Console shows the instance as running; opening it shows no active task; Inbox is empty for the expected assignee.

This is an inconsistent persisted state — typically caused by a JCR session crash or pod eviction during a step transition, so the workflow got archived on one side but never handed off on the other.

---

## Root cause categories

- `job_crashed_during_transition` — pod terminated mid-archive (AEMaaCS rolls pods for deploys, scaling, platform maintenance).
- `archive_workitem_exception` — `Cannot archive workitem` in `error.log` at the instant the step completed.
- `node_left_inconsistent` — Oak session timeout / lock release during step transition.

---

## Decision tree

- **IF** the instance shows `RUNNING` **AND** has no active work item → continue with the Checklist.
- **IF** the instance has an active work item → not stale; follow [`runbook-workflow-stuck.md`](runbook-workflow-stuck.md) or [`runbook-workflow-fails-or-shows-error.md`](runbook-workflow-fails-or-shows-error.md).
- **IF** the instance is in `FAILED` state → not stale; follow [`runbook-failed-work-items.md`](runbook-failed-work-items.md).

---

## Checklist

1. **Workflow Console — confirm no active work item**
   Open `/libs/cq/workflow/admin/console/content/instances.html` (read-only admin path; allowed on AEMaaCS). Filter by `Running`. Open the suspect instance. If there is a current task, the instance is **not** stale — stop and follow `runbook-workflow-stuck.md`.

2. **Cloud Manager logs — confirm the transition crashed**
   Cloud Manager → **Environments → Logs** (download or stream). Grep for:
   - `Cannot archive workitem` — the smoking gun for staleness.
   - The instance ID (`/var/workflow/instances/...`).
   - `restartStaleWorkflows` — if any prior stale-restart attempt happened.

3. **Deploy the stale-workflow servlet** (one-time, if not already deployed)
   The bundled example [`StaleWorkflowServlet.java`](../examples/StaleWorkflowServlet.java) is the AEMaaCS equivalent of the 6.5 JMX operations. Copy it into your `core` bundle (e.g. `core/src/main/java/.../support/workflow/StaleWorkflowServlet.java`), commit, and deploy via your Cloud Manager pipeline. ACL it so only workflow superusers can invoke it.

4. **Enumerate stale instances** (dry-run, no writes)
   Call `GET /bin/support/workflow/stale?dryRun=true` from an author-tier URL as a user who is a member of the group named by `cq.workflow.superuser` on `com.adobe.granite.workflow.core.WorkflowSessionFactory`. The servlet returns JSON:
   ```json
   { "dryRun": true, "staleCount": N, "instances": [ { "id": "...", "model": "...", "payload": "..." } ] }
   ```
   Scope to one model with `&model=<modelId>` if you only want to see that model.

5. **Verify superuser identity** *before* you conclude `staleCount: 0`
   If the servlet responds `403 {"error": "Caller is not a workflow superuser..."}`, you are *not* seeing the full picture — non-superusers are silently limited to their own initiated workflows. Add your principal to the superuser group and retry.

---

## Remediation

| Action | How |
|--------|-----|
| **Preview stale set** | `GET /bin/support/workflow/stale?dryRun=true[&model=<modelId>]` → returns JSON with `staleCount`, instance IDs, and payload paths. No writes. Always do this first. |
| **Restart stale workflows** | `POST /bin/support/workflow/stale?dryRun=false[&model=<modelId>]` → calls `WorkflowSession.restartWorkflow(wf)` per instance. Returns `restarted` and `errors` counts. Each failure is reported inline with `restartError` per instance. |
| **Scope to one model** | Add `&model=<modelId>` to both GET and POST. Use when one workflow model is misbehaving and you don't want to touch others. |
| **If restart fails for an instance** | Read the per-instance `restartError` in the response. Typical causes: payload deleted (`PathNotFoundException`), process not registered (`getProcess for '<name>' failed`), or permissions. Fix the root cause, then re-run `POST ...?dryRun=false`. |

> **Always `dryRun=true` first.** `POST ...?dryRun=false` mutates workflow state for every stale instance it finds; on a system with hundreds of stale workflows that is not a small action.

---

## When restart is not the answer

Restarting a stale workflow replays it from the last known step. If the underlying cause is a bug in a process step that will fail again (e.g. external service is down, payload is malformed), restart just creates a new stale instance a few seconds later. Before restart:

- Read `error.log` for the original transition to see *why* the archive failed.
- If the root cause is a deployed bug, fix and redeploy *before* restart — or restart will loop.
- If the instance is tied to a deleted payload, terminate it instead of restarting (the servlet does not terminate; use `/aem/inbox` or the Workflow Console).

---

## Escalation

- Servlet returns `500` with a `WorkflowException` → check Cloud Manager logs for the stack trace; if it references Granite internals (not customer code), open an Adobe Support ticket with the stack, instance ID, and the JSON response body.
- Stale count keeps growing despite successful restarts → open Support. Persistent staleness usually indicates a platform-level issue (pod churn, Oak lock contention, JCR quota) that a customer cannot self-service.

---

## References

- Bundled servlet: [`../examples/StaleWorkflowServlet.java`](../examples/StaleWorkflowServlet.java)
- Debugging index: [`../docs/debugging-index.md`](../docs/debugging-index.md)
- Error patterns (for `Cannot archive workitem`): [`../docs/error-patterns.md`](../docs/error-patterns.md)
- Related runbooks: [`runbook-workflow-stuck.md`](runbook-workflow-stuck.md), [`runbook-failed-work-items.md`](runbook-failed-work-items.md)
