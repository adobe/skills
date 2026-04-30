# Runbook: Validate workflow setup — Cloud Service

**symptom_id:** `workflow_setup_validation`

> **Variant:** AEM as a Cloud Service. All config is Git + Cloud Manager pipeline; all diagnosis is Developer Console + Workflow Console.

---

## Symptom

A new or changed workflow is not starting, a step is not executing, or a user cannot see/complete items — but the cause isn't yet known. Used for **systematic pre-release validation** and for incidents where the narrower runbooks haven't isolated the problem.

---

## Root cause categories

- `model_not_synced_or_invalid` — design-time model is present but runtime copy isn't up to date, often because of an empty OR/AND branch.
- `launcher_misconfigured` — path, node type, event type, or run-mode wrong.
- `process_not_registered` — `@Component process.label` doesn't match the model's Process field.
- `permissions_or_visibility` — assignee / initiator / superuser group, or payload ACL.
- `service_user_mapping_missing` — custom Process step runs as a service user that isn't mapped.

---

## Decision tree

- **IF** workflow doesn't start on the expected event → [`runbook-launcher-not-starting.md`](runbook-launcher-not-starting.md), then return here for process-registration and permissions checks.
- **IF** workflow starts but a step never runs → Checklist sections 1 and 3 below.
- **IF** user doesn't see an item or can't complete it → [`runbook-inbox-and-permissions.md`](runbook-inbox-and-permissions.md).
- **IF** instance fails or queue backlogs → [`runbook-failed-work-items.md`](runbook-failed-work-items.md) and [`runbook-job-throughput-and-concurrency.md`](runbook-job-throughput-and-concurrency.md).

---

## Checklist

### 1. Model and editor

- [ ] **Design-time path** — Model lives at `/conf/global/settings/workflow/models/<id>` (not `/libs`, which is read-only).
- [ ] **Runtime path** — `/var/workflow/models/<id>` exists and reflects the latest design-time content. Re-Sync if not.
- [ ] **Sync succeeded** — Workflow Model Editor → Sync completed without an error banner. **Silent failure cause #1:** an OR/AND branch with no step. Add a `No Operation` step to each empty branch.
- [ ] **Model committed** — Any edits made through the UI on lower envs are also committed to `ui.content` in the customer repo; UI-only edits do not survive pod restarts on AEMaaCS.
- [ ] **Process step's Process field** — matches an `@Component process.label` string exactly (case-sensitive).
- [ ] **Participant step's assignee** — is a **group** provisioned via repoinit, not an individual IMS user ID.
- [ ] **Model metadata `noRetryOnException`** — set deliberately. Default (absent) means retries use the global `cq.workflow.job.retry`.

### 2. Launcher (if auto-start)

Run the full [`runbook-launcher-not-starting.md`](runbook-launcher-not-starting.md) checklist. Then confirm:

- [ ] Launcher config committed under `ui.content` (not only authored in the UI on a lower env).
- [ ] Run-mode scoping is correct (`config.author/` for all author tiers, or tier-specific `config.author.prod/`).
- [ ] `enabled=true`.
- [ ] The launcher references the correct `workflow=<modelId>`.

### 3. Custom Process step (if present)

- [ ] **Bundle active** — Developer Console → OSGi → Bundles → the bundle containing the Process class is `Active`.
- [ ] **Component active** — Developer Console → OSGi → Components → the `WorkflowProcess` service is `Active` (not `Satisfied` or `Unsatisfied`).
- [ ] **`process.label` match** — case-sensitive exact match with the model's Process field.
- [ ] **Payload handling** — the step reads `JCR_PATH` / `JCR_UUID` from `item.getWorkflowData()` and null-checks the path.
- [ ] **Service user** — if the step needs elevated access, it uses a service user via `ResourceResolverFactory.getServiceResourceResolver(Map.of(SUBSERVICE, "...")))` and the subservice is mapped in `ServiceUserMapperImpl.amended-*.cfg.json`. Never `loginAdministrative` (forbidden on AEMaaCS).
- [ ] **External calls bounded** — any HTTP / DB / downstream call has a timeout < 30s; step throws `WorkflowException` on recoverable failures (triggers retry), not a generic `RuntimeException`.

### 4. Visibility and permissions

Run the full [`runbook-inbox-and-permissions.md`](runbook-inbox-and-permissions.md) checklist. Additionally for new setups:

- [ ] `cq.workflow.superuser` on `com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json` points at a repoinit group, not individual IDs. See [`../examples/com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json`](../examples/com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json).
- [ ] Participant group has `jcr:read` on the payload tree (via `ui.apps/.../repoinit`).
- [ ] `enforceWorkitemAssigneePermissions` / `enforceWorkflowInitiatorPermissions` values are what the customer actually wants — they default to `true`.

### 5. Instances, failures, and queues

Pre-release smoke test:
- [ ] Trigger the expected event; confirm a single instance starts.
- [ ] Confirm the instance reaches each step in order.
- [ ] Confirm failure path (e.g. invalid payload) lands in `/aem/inbox` as a failure item, not in a silent loop.
- [ ] Confirm the Granite Workflow Queue (`/system/console/slingjobs` on lower envs) has a healthy active/queued ratio after the test — no unexpected backlog.
- [ ] Confirm Cloud Manager logs have no `Error executing workflow step` / `getProcess for '*' failed` for the test run.

---

## Quick routing

| Validating | Go to |
|------------|-------|
| Workflow never starts on event | [`runbook-launcher-not-starting.md`](runbook-launcher-not-starting.md) |
| Step doesn't run / `getProcess for '<name>' failed` | Checklist §3 above; fix `process.label` or bundle deploy |
| Sync fails in editor | Checklist §1: empty OR/AND branch |
| User can't see item | [`runbook-inbox-and-permissions.md`](runbook-inbox-and-permissions.md) |
| Instance fails | [`runbook-workflow-fails-or-shows-error.md`](runbook-workflow-fails-or-shows-error.md) |
| Queue / throughput issues | [`runbook-job-throughput-and-concurrency.md`](runbook-job-throughput-and-concurrency.md) |
| Instance stuck | [`runbook-workflow-stuck.md`](runbook-workflow-stuck.md) |
| Decision guide | [`runbook-decision-guide.md`](runbook-decision-guide.md) |

---

## Pre-release checklist (copy into your release ticket)

```
[ ] Model committed to /conf/global/settings/workflow/models/<id>
[ ] No empty OR/AND branches
[ ] Sync succeeds on lower env
[ ] Launcher committed to ui.content, enabled=true, correct run-mode scope
[ ] Custom Process bundle has @Component process.label matching model
[ ] Service user mapped (if elevated access required); no loginAdministrative
[ ] Participant step assigns to a group, not an individual
[ ] cq.workflow.superuser references a repoinit group
[ ] Smoke test: event fires, instance starts, reaches every step, completes
[ ] Smoke test: invalid payload produces a failure item, not a silent loop
[ ] Cloud Manager logs clean for the test run
```

---

## References

- Bundled WorkflowSessionFactory config: [`../examples/com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json`](../examples/com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json)
- Error patterns: [`../docs/error-patterns.md`](../docs/error-patterns.md)
- Related runbooks: every sibling in this folder is reachable via the Quick routing table above.
