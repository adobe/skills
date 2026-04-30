# Runbook: Launcher not starting workflows

**symptom_id:** `workflow_not_starting_launcher`

---

## Symptom

Workflow should start automatically on a node event (e.g. page/asset create or update) but no workflow instance is created.

---

## Root cause categories

- launcher_missing_or_disabled
- launcher_path_node_type_or_event_mismatch
- workflow_model_disabled
- permission_to_start_workflow_denied
- overlapping_launcher_interference

---

## Decision tree

- **IF** no launcher exists for the model/path **THEN** → Checklist items 1–2; Remediation: create path and add launcher.
- **IF** launcher exists **THEN** → Checklist items 3–7 (enabled, path, node type, event type, model enabled, permissions, overlap).

---

## Checklist

1. **Workflow console → Launchers** – List launchers; confirm a launcher exists for the **workflow model** and **path/condition** you expect. Note launcher path in JCR if present.
2. **JCR: /conf/global/settings/workflow/launcher/config** – In CRX/Repository, confirm this node exists. If missing, launcher config cannot be stored. Do not use `/libs` for custom launchers.
3. **Launcher enabled** – In Launcher list or config, confirm the launcher is **enabled** (e.g. "Activate" or enabled flag). Disabled launchers do not fire.
4. **Path / glob** – Launcher **Path** (or glob) must match the payload path where the event occurs (e.g. `/content/dam/...`, `/content/sites/...`). Trigger a test event and confirm path is under the launcher path.
5. **Node type / Event type** – Launcher **Node Type** must match the primary type of the node that changed. **Event Type** must match (e.g. NODE_ADDED, NODE_CHANGED). Check event that actually fired in logs if available.
6. **Workflow model** – In Workflow Models, confirm the model used by the launcher is **enabled** and **synced**. Disabled or unsynced model can prevent start.
7. **Permissions** – The user or service performing the action that triggers the event must have permission to read the payload and to start the workflow. Launcher runs in a service context; payload path must be readable by that context.
8. **Overlapping launchers** – If multiple launchers match the same path/event, another launcher may run instead or conflict. Review launcher order and conditions; disable or narrow overlapping launchers.

---

## Remediation

| Action | How |
|--------|-----|
| Create launcher config path | Create node(s) under `/conf/global/settings/workflow/launcher/config`. Grant workflow service user read access. |
| Add or repair launcher | Use Workflow UI (Launchers) or WorkflowLauncher API to add ConfigEntry: Workflow Model, Run Modes (author/publish), Path, Node Type, Event Type. Enable the launcher. |
| Fix path/event mismatch | Update launcher Path (or glob) and Event Type to match the actual trigger path and JCR event. Sync/save. |
| Enable model | In Workflow Models, enable the model and click Sync. |
| Fix permissions | Grant workflow service user (or triggering user) read access to payload path and start-workflow capability. |
| Resolve overlap | Disable or narrow the scope of the conflicting launcher; or ensure the intended launcher has higher priority if supported. |

---

## References

[error-patterns.md](../docs/error-patterns.md) | [runbook-validate-workflow-setup.md](runbook-validate-workflow-setup.md)

Launcher config path (`/conf/global/settings/workflow/launcher/config`) and model paths (`/conf/global/settings/workflow/models/`, `/var/workflow/models/`): see Checklist items 2 and 6 above.
