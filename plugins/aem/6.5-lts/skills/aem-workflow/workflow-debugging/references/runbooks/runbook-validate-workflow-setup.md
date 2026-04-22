# Runbook: Validate workflow setup

**symptom_id:** `workflow_setup_validation`

---

## Symptom

New or changed workflow not starting or step not executing; systematic validation needed.

---

## Root cause categories

- model_not_synced_or_invalid
- launcher_misconfigured
- process_not_registered
- permissions_or_visibility

---

## Decision tree

- **IF** workflow never starts on event **THEN** → [runbook-launcher-not-starting.md](runbook-launcher-not-starting.md) Checklist.
- **IF** step does not run **THEN** → Checklist 1 + 3 below; [custom-process-development.md](../docs/custom-process-development.md).
- **IF** user does not see workflow or item **THEN** → [runbook-inbox-and-permissions.md](runbook-inbox-and-permissions.md) Checklist.
- **IF** failed or queue backlog **THEN** → [runbook-failed-work-items.md](runbook-failed-work-items.md), [runbook-job-throughput-and-concurrency.md](runbook-job-throughput-and-concurrency.md).

---

## Checklist

### 1. Model and editor

- [ ] **Model location** – Custom under `/conf/global/settings/workflow/models/`; runtime under `/var/workflow/models/`. [jcr-paths.md](../docs/jcr-paths.md).
- [ ] **Model synced** – Editor: Sync clicked and succeeded. Sync fails → OR/AND branch missing step (e.g. add No Operation). [workflow-editor-and-steps.md](../docs/workflow-editor-and-steps.md).
- [ ] **Process step** – Step **Process** name = OSGi `process.label` for that WorkflowProcess. [custom-process-development.md](../docs/custom-process-development.md).

### 2. Launcher (if auto-start)

→ Run [runbook-launcher-not-starting.md](runbook-launcher-not-starting.md) Checklist.

### 3. Custom process (if Process step)

- [ ] **Bundle deployed** – WorkflowProcess bundle active.
- [ ] **Service** – OSGi: service present; `process.label` = step **Process** field.
- [ ] **execute()** – Handles JCR_PATH/JCR_UUID; payload path readable. [custom-process-development.md](../docs/custom-process-development.md), [error-patterns.md](../docs/error-patterns.md).

### 4. Visibility and permissions

→ Run [runbook-inbox-and-permissions.md](runbook-inbox-and-permissions.md) Checklist. Model tags (WCM etc.): [workflow-editor-and-steps.md](../docs/workflow-editor-and-steps.md).

### 5. Instances, failures, queues

→ If failed: [runbook-failed-work-items.md](runbook-failed-work-items.md). If queue backlog: [runbook-job-throughput-and-concurrency.md](runbook-job-throughput-and-concurrency.md). Console URLs: [references-and-sources.md](../docs/references-and-sources.md#console-and-ui-urls-reference).

---

## Quick decision (routing)

| Validating | Go to |
|------------|--------|
| Workflow never starts on event | [runbook-launcher-not-starting.md](runbook-launcher-not-starting.md) |
| Step doesn’t run / "process not found" | [custom-process-development.md](../docs/custom-process-development.md); Checklist 1+3 above |
| Sync fails in editor | [workflow-editor-and-steps.md](../docs/workflow-editor-and-steps.md) (OR/AND branches) |
| User can’t see item | [runbook-inbox-and-permissions.md](runbook-inbox-and-permissions.md) |
| Workflow stuck | [runbook-decision-guide.md](runbook-decision-guide.md) |
