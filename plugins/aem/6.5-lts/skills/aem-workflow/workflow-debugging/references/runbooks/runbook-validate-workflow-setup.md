# Runbook: Validate workflow setup — 6.5 LTS / AMS

**symptom_id:** `workflow_setup_validation`

---

## Symptom

A new or changed workflow is not starting, a step is not executing, or a user cannot see/complete items — but the cause isn't yet known. Used for **systematic pre-release validation** and for incidents where the narrower runbooks haven't isolated the problem.

---

## Root cause categories

- `model_not_synced_or_invalid` — design-time model exists but runtime copy isn't current; often due to an empty OR/AND branch.
- `launcher_misconfigured` — path, node type, event type, or run-mode wrong.
- `process_not_registered` — `@Component process.label` doesn't match the model's Process field.
- `permissions_or_visibility` — assignee / initiator / superuser group, or payload ACL.

---

## Decision tree

- **IF** workflow doesn't start on the expected event → [runbook-launcher-not-starting.md](runbook-launcher-not-starting.md), then return here for process-registration and permissions checks.
- **IF** workflow starts but a step never runs → Checklist sections 1 and 3 below.
- **IF** user doesn't see an item or can't complete it → [runbook-inbox-and-permissions.md](runbook-inbox-and-permissions.md).
- **IF** instance fails or queue backlogs → [runbook-failed-work-items.md](runbook-failed-work-items.md), [runbook-job-throughput-and-concurrency.md](runbook-job-throughput-and-concurrency.md).

---

## Checklist

### 1. Model and editor

- [ ] **Design-time path** — model lives at `/conf/global/settings/workflow/models/<id>` (or the legacy `/etc/workflow/models/<id>` on older 6.5 installs). Never `/libs`.
- [ ] **Runtime path** — `/var/workflow/models/<id>` exists and reflects the latest design-time content. Re-Sync if not.
- [ ] **Sync succeeded** — Workflow Model Editor → Sync completed without an error banner. **Silent failure cause #1:** an OR/AND branch with no step. Add a `No Operation` step to each empty branch.
- [ ] **Process step's Process field** — matches an `@Component process.label` string exactly (case-sensitive).
- [ ] **Participant step's assignee** — is a valid user or group; group has at least one member.
- [ ] **Model metadata `noRetryOnException`** — set deliberately. Default (absent) means retries use the global `cq.workflow.job.retry` (see SKILL.md Step 5).

### 2. Launcher (if auto-start)

Run the full [runbook-launcher-not-starting.md](runbook-launcher-not-starting.md) checklist. Quick summary:

- [ ] Launcher exists under `/conf/global/settings/workflow/launcher/config` and is enabled.
- [ ] Path / glob / node type / event type match the actual trigger.
- [ ] Workflow model referenced by the launcher is enabled and synced.

### 3. Custom Process step (if present)

- [ ] **Bundle active** — Felix Console → OSGi → Bundles → the bundle containing the Process class is `Active`.
- [ ] **Component active** — Felix Console → OSGi → Components → the `WorkflowProcess` service is `Active` (not `Satisfied` or `Unsatisfied`).
- [ ] **`process.label` match** — case-sensitive exact match with the model's Process field.
- [ ] **Payload handling** — the step reads `JCR_PATH` / `JCR_UUID` from `item.getWorkflowData()` and null-checks the path.
- [ ] **External calls bounded** — any HTTP / DB / downstream call has a timeout; step throws `WorkflowException` on recoverable failures (triggers retry), not a generic `RuntimeException`. Log signatures for common failure modes: [error-patterns.md](../docs/error-patterns.md).

### 4. Visibility and permissions

Run the full [runbook-inbox-and-permissions.md](runbook-inbox-and-permissions.md) checklist. Quick summary:

- [ ] `enforceWorkitemAssigneePermissions` / `enforceWorkflowInitiatorPermissions` on WorkflowSessionFactory are what the customer wants (defaults: `true`). See SKILL.md Step 5.
- [ ] `cq.workflow.superuser` includes expected admin principals.
- [ ] Participant group has read ACL on the payload tree.

### 5. Instances, failures, and queues

Pre-release smoke test:

- [ ] Trigger the expected event; confirm a single instance starts.
- [ ] Confirm the instance reaches each step in order.
- [ ] Confirm failure path (e.g. invalid payload) lands in `/aem/inbox` as a failure item, not a silent loop.
- [ ] Confirm Granite Workflow Queue at Felix Console → `/system/console/slingjobs` has a healthy active/queued ratio — no unexpected backlog.
- [ ] Confirm `error.log` is clean for the test run (no `Error executing workflow step`, `getProcess for '*' failed`).

---

## Quick routing

| Validating | Go to |
|------------|-------|
| Workflow never starts on event | [runbook-launcher-not-starting.md](runbook-launcher-not-starting.md) |
| Step doesn't run / `getProcess for '<name>' failed` | Checklist §3 above; fix `process.label` or bundle deploy |
| Sync fails in editor | Checklist §1: empty OR/AND branch |
| User can't see item | [runbook-inbox-and-permissions.md](runbook-inbox-and-permissions.md) |
| Instance fails | [runbook-workflow-fails-or-shows-error.md](runbook-workflow-fails-or-shows-error.md) |
| Queue / throughput issues | [runbook-job-throughput-and-concurrency.md](runbook-job-throughput-and-concurrency.md) |
| Instance stuck | [runbook-workflow-stuck.md](runbook-workflow-stuck.md) |
| Decision guide | [runbook-decision-guide.md](runbook-decision-guide.md) |

---

## Pre-release checklist (copy into your release ticket)

```
[ ] Model committed to /conf/global/settings/workflow/models/<id>
[ ] No empty OR/AND branches
[ ] Sync succeeds
[ ] Launcher enabled under /conf/global/settings/workflow/launcher/config
[ ] Custom Process bundle has @Component process.label matching model
[ ] Participant step assignee exists and has read ACL on payload
[ ] cq.workflow.superuser includes expected admins
[ ] Smoke test: event fires, instance starts, reaches every step, completes
[ ] Smoke test: invalid payload produces a failure item, not a silent loop
[ ] error.log clean for the test run
```

---

## References

- OSGi property matrix (WorkflowSessionFactory, Granite Workflow Queue, DefaultThreadPool, Purge Scheduler): SKILL.md Step 5.
- Log signatures catalog: [error-patterns.md](../docs/error-patterns.md).
- JMX operations reference: [mbeans.md](../docs/mbeans.md).
- Related runbooks: every sibling in this folder is reachable via the Quick routing table above.
