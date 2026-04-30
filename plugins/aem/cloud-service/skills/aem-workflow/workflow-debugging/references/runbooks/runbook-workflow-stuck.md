# Runbook: Workflow stuck (not progressing) — Cloud Service

**symptom_id:** `workflow_stuck_not_progressing`

> **Variant:** AEM as a Cloud Service. No JMX. All remediation landed via Git + Cloud Manager pipeline; all diagnosis via Developer Console and Cloud Manager logs.

---

## Symptom

Workflow instance remains in `RUNNING` and does not advance to the next step. The Workflow Console shows the instance open; the step type is known (Participant / Process / OR-Split / AND-Split) but nothing happens for hours.

---

## Root cause categories

- `participant_step_assignee_missing_or_no_access`
- `process_step_exception_or_timeout`
- `process_step_invalid_payload`
- `or_and_split_condition_or_route_invalid`
- `stale_instance_no_current_work_item`
- `default_threadpool_saturated` — auto-advance timeout jobs silently rejected

---

## Decision tree

- **IF** the instance has **no current work item** → treat as stale. Use [`runbook-stale-workflows.md`](runbook-stale-workflows.md). **STOP.**
- **IF** current step = Participant → execute Checklist items 2–5.
- **IF** current step = Process → execute Checklist items 6–9.
- **IF** current step = OR-Split or AND-Split → execute Checklist items 10–11.
- **IF** multiple models auto-advance are stuck system-wide → check thread-pool saturation via [`runbook-job-throughput-and-concurrency.md`](runbook-job-throughput-and-concurrency.md) before drilling into a single instance.

---

## Checklist

1. **Open the instance in Workflow Console**
   `/libs/cq/workflow/admin/console/content/instances.html` (read-only admin path; allowed). Filter by `Running`. Open the suspect instance. Note: **current step type**, **step name**, **instance ID**, **payload path**.

### Participant step

2. **Assignee exists** — In the model or instance details, note the assignee (user or group). Confirm the user exists in User Management, or the group has at least one member. On AEMaaCS, users are federated from IMS; a removed IMS principal leaves orphan assignments.

3. **Inbox visibility** — Log in as the assignee (or a group member). Open `/aem/inbox`. If the work item is missing, follow [`runbook-task-not-in-inbox.md`](runbook-task-not-in-inbox.md) — this is a separate symptom.

4. **Payload ACL** — Assignee must have **read** on the payload path. ACL changes land via `ui.apps/.../repoinit` on AEMaaCS; check the recent repoinit commits if access recently regressed.

5. **Dynamic Participant resolver** — If the step type is Dynamic Participant, the `ParticipantStepChooser` implementation picks the assignee at runtime. Check Cloud Manager logs for the chooser's class name and its resolution output. A chooser returning `null` or an unknown principal leaves the step silently stuck.

### Process step

6. **Cloud Manager logs** — Cloud Manager → **Environments → Logs** (download or stream). Grep for:
   - the **instance ID** (`/var/workflow/instances/...`)
   - the workflow model name
   - `Error executing workflow step` + the process class name
   Capture exception type, message, and stack trace.

7. **Payload still valid** — From the instance, resolve the payload path. Confirm the node exists (Workflow Console payload link, or browser GET on author). `PathNotFoundException` in the log means the payload was deleted after the workflow started.

8. **Long-running step vs true hang** — If logs show the step started but never finished:
   - Look at thread dump (Developer Console → **Status → Thread Dump**). Find the `JobHandler: <instanceId>:<payloadPath>` thread.
   - If it's stuck in an external HTTP call → the step has no timeout; add one and redeploy.
   - If it's stuck waiting on a lock (`refreshing the session since we had to wait for a lock`) → see [`runbook-job-throughput-and-concurrency.md`](runbook-job-throughput-and-concurrency.md).

9. **Process registration** — Developer Console → **OSGi → Components**. Search for a service whose `process.label` matches the step's **Process** field exactly. Confirm:
   - the component is `Active`;
   - the bundle containing it is `Active`;
   - the label is case-sensitive — mismatched casing logs `getProcess for '<name>' failed`.

### OR / AND split

10. **Condition evaluates correctly** — Open the model in the Workflow Model Editor. The OR-Split's route condition must resolve against the instance metadata. For dynamic conditions, check Cloud Manager logs for the condition script / rule output for this instance.

11. **All routes have destinations** — Empty branches silently trap the workflow. Every route must terminate at a real step or at End. In the editor: Sync must succeed; if Sync fails, an empty branch is usually the cause — add a `No Operation` step to close it.

### System-wide: auto-advance broken

12. **Sling `default` thread pool** — Developer Console → **Status → Threads** → `default` pool:
    - `activeCount = maxPoolSize` and `blockPolicy = ABORT` → new workflow timeout jobs are silently rejected; auto-advance across the whole instance is broken.
    - Typical customer-code root cause: a custom scheduler without HTTP timeouts + `scheduler.concurrent=true`. Full diagnosis in [`runbook-job-throughput-and-concurrency.md`](runbook-job-throughput-and-concurrency.md).

---

## Remediation

| Action | How |
|--------|-----|
| Stale instance (no work item) | Follow [`runbook-stale-workflows.md`](runbook-stale-workflows.md). Deploy the bundled `StaleWorkflowServlet` and `POST /bin/support/workflow/stale?dryRun=false&model=<id>`. |
| Participant: wrong assignee in model | Edit the model (`/conf/global/settings/workflow/models/...`), correct the Participant step, commit, deploy via Cloud Manager. New instances get the fix; existing stuck instance needs manual reassignment or termination. |
| Participant: orphan IMS user | Terminate the instance; restart with a valid assignee. Prevent recurrence: assign to a group (stable) rather than a user (IMS rotation risk). |
| Process: exception in customer code | Fix the Process class; commit; deploy. Then retry the work item from `/aem/inbox` — see [`runbook-failed-work-items.md`](runbook-failed-work-items.md). |
| Process: payload deleted | Cannot recover the instance as-is; terminate and, if needed, restart with a valid payload. Harden the Process step to null-check the payload. |
| Process: not registered | Redeploy the `core` bundle. Confirm `@Component process.label` matches the model's Process field exactly, then re-sync the model. |
| OR/AND Split: empty route | Add a `No Operation` step to each empty branch; Sync must succeed; commit and deploy. |
| Auto-advance system-wide | Full remediation in [`runbook-job-throughput-and-concurrency.md`](runbook-job-throughput-and-concurrency.md). Short-term: pod restart via Adobe Support ticket. |

---

## Escalation

- Thread dump shows only Granite / platform internals stuck (no customer code) → Adobe Support ticket with thread dump + 1 hour of `error.log` + instance ID.
- Auto-advance system-wide and DefaultThreadPool config is platform-reserved (values don't apply after deploy) → Adobe Support ticket to lift `maxPoolSize` / switch `blockPolicy`.
- Participant step assignee logic depends on a downstream IdP / IMS change you can't trace → coordinate with the identity team; Support is not the right channel.

---

## References

- Bundled servlet (stale path): [`../examples/StaleWorkflowServlet.java`](../examples/StaleWorkflowServlet.java)
- Error patterns: [`../docs/error-patterns.md`](../docs/error-patterns.md)
- MBean replacement table (CS): [`../docs/mbeans.md`](../docs/mbeans.md)
- Related runbooks: [`runbook-stale-workflows.md`](runbook-stale-workflows.md), [`runbook-workflow-fails-or-shows-error.md`](runbook-workflow-fails-or-shows-error.md), [`runbook-task-not-in-inbox.md`](runbook-task-not-in-inbox.md), [`runbook-job-throughput-and-concurrency.md`](runbook-job-throughput-and-concurrency.md)
