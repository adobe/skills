# Runbook: Launcher not starting workflows — Cloud Service

**symptom_id:** `workflow_not_starting_launcher`

> **Variant:** AEM as a Cloud Service. Launcher configs live under `/conf/global/settings/workflow/launcher/config` and are deployed through `ui.content` or `ui.config` via Cloud Manager pipeline. `/libs/...` is read-only on AEMaaCS.

---

## Symptom

A workflow should start automatically on a JCR event (page or asset create/update/publish) but no instance is created. The launcher appears to exist yet produces nothing.

---

## Root cause categories

- `launcher_missing_or_disabled` — no launcher config, or `enabled=false`.
- `launcher_path_node_type_or_event_mismatch` — the launcher's `glob`, `nodetype`, or `eventType` doesn't match what fired.
- `workflow_model_disabled_or_not_synced` — the model referenced by the launcher isn't runtime-available at `/var/workflow/models/<id>`.
- `overlay_shadowing_conflict` — a customer overlay at `/conf/global/settings/workflow/launcher/config` has a different name than the OOB, so both fire, or the customer shadows with `enabled=false`.
- `event_suppressed_by_run_mode` — launcher's `runmodes` exclude the tier the event fired on (author vs publish).
- `permission_to_start_workflow_denied` — the launcher runs in a service context that can't read the payload or start the model.

---

## Decision tree

- **IF** no launcher config exists for the model/path → Checklist 1; Remediation: add launcher config.
- **IF** a launcher config exists → Checklist 2–8.
- **IF** a launcher fires on dev but not on prod → Checklist 6 (run-modes) and 7 (ACL).

---

## Checklist

1. **Inventory launchers**
   Go to Tools → Workflow → Launchers (`/libs/cq/workflow/admin/console/content/launchers.html` — read-only admin path). Confirm a launcher exists for the intended model and path. Also check the committed source: customer launcher configs live under `ui.content` or `ui.config` at `/conf/global/settings/workflow/launcher/config`. Cross-check the UI list against the repo — a missing launcher in the repo that shows up in the UI is a lower-env CRX/DE artefact that won't survive a pod restart.

2. **Launcher is enabled**
   Open the launcher config. Property `enabled=true`. A disabled launcher shows in the UI but never fires.

3. **Path / glob matches**
   The launcher's `glob` (or `nodetype` + path) must match the path where the event actually fires. Common mistakes:
   - `/content/dam` vs `/content/dam/` (trailing slash)
   - A glob of `/content/dam/**/jcr:content` when the event fires on the asset node itself
   - Missing `**` for recursion
   Confirm by watching a canonical author action on a lower env: create a test asset under the expected path and check Cloud Manager logs for `Starting workflow` or `Error adding launcher config`.

4. **Node type matches**
   If the launcher has `nodetype=dam:Asset`, it will not fire for a `cq:Page`. Verify by checking the actual primary type of the created/changed node in the JCR.

5. **Event type matches**
   `eventType` is a bitmask of JCR events: `NODE_ADDED`, `NODE_REMOVED`, `PROPERTY_ADDED`, `PROPERTY_CHANGED`, etc. A launcher listening for `NODE_ADDED` will not fire on a property-only change. If you're unsure what event fires for your scenario, enable debug logging on `com.day.cq.workflow.launcher.impl.ConfigEntryImpl` on a lower env and watch.

6. **Run-mode scoping**
   Launcher configs can be scoped by run mode via the `ui.content` folder structure (`config.author/`, `config.author.dev/`, `config.author.prod/`). If the config is under `config.author.dev/` only, it won't deploy to prod. Check the file's folder path in the repo.

7. **Workflow model is deployed and synced**
   The model referenced by `workflow=<modelId>` must exist at `/var/workflow/models/<id>` (runtime) after a successful sync from `/conf/global/settings/workflow/models/<id>` (design-time). Confirm via the Workflow Console → Models. A model present at design-time but missing at runtime means the sync failed — usually caused by an empty OR/AND branch.

8. **Permissions**
   The launcher executes in a service-user context (historically `workflow-process-service`). Confirm that service user has:
   - read on the payload path;
   - write on `/var/workflow/instances/` (platform-granted; rarely the problem).
   Check `ServiceUserMapperImpl.amended-*.cfg.json` for the mapping, and repoinit for the service user's ACLs.

---

## Remediation

| Scenario | Fix (Git + Cloud Manager pipeline) |
|----------|-----------------------------------|
| No launcher config exists | Create the config as a `.content.xml` under `ui.content/src/main/content/jcr_root/conf/global/settings/workflow/launcher/config/<name>/` with properties: `workflow`, `glob` (or `nodetype` + path), `eventType`, `enabled=true`. Commit; deploy. |
| Launcher exists but `enabled=false` | Flip to `true` in the config file; commit; deploy. (Don't flip it in the UI on prod — edits there aren't durable on AEMaaCS.) |
| Path / node-type / event mismatch | Correct the properties in the config; commit; deploy. If multiple launchers overlap, either narrow one or set `priority` to disambiguate. |
| Model not synced at runtime | Fix the model (empty OR/AND branch is the usual cause); Sync from the Workflow Console; commit any model changes to `/conf/global/settings/workflow/models/`; deploy. |
| Run-mode scoping wrong | Move the config file from `config.author.dev/` to `config.author/` (all author tiers) or to both `config.author.dev/` and `config.author.prod/`. Commit; deploy. |
| Service user lacks read on payload | Add a repoinit block granting `jcr:read` on the payload tree to the service user's mapped principal. Commit to `ui.apps/.../repoinit`; deploy. |
| Overlay unintentionally shadowing OOB launcher | Remove the customer overlay if the OOB behaviour was correct, or rename it to avoid the shadow. Commit; deploy. |

---

## AEMaaCS-specific gotchas

- **Never write to `/libs`.** Customer launcher configs belong under `/conf/global/settings/workflow/launcher/config/`. `/libs` is the read-only code layer.
- **CRX/DE edits on lower envs are not durable.** A launcher created by hand on a dev pod will vanish on the next pod restart. Only committed configs under `ui.content` / `ui.config` survive.
- **Event type bitmasks are tricky.** A common support ticket is "launcher configured for `NODE_ADDED` doesn't fire for asset metadata update" — because the metadata update is `PROPERTY_CHANGED`, not `NODE_ADDED`. Instrument before assuming.
- **Publish-tier launchers are rare but real.** If your use case is "start workflow when content replicates", consider whether the correct trigger is a Replication listener, not a JCR launcher. JCR launchers on publish fire for every activation — volume can be surprising.

---

## Escalation

- Launcher config is present, enabled, path/nodetype/event correct, model synced, ACLs correct — and still nothing fires → open Adobe Support with the launcher config file, a test payload path, environment ID, and a 10-minute log window covering a test trigger.
- Launcher config disappears across pod restarts → repo drift; compare committed `ui.content` against runtime `/conf/global/settings/workflow/launcher/config/` (via the Workflow Console read-only view); commit the missing config.

---

## References

- Error patterns (launcher-related): [`../docs/error-patterns.md`](../docs/error-patterns.md)
- Related runbooks: [`runbook-workflow-stuck.md`](runbook-workflow-stuck.md), [`runbook-validate-workflow-setup.md`](runbook-validate-workflow-setup.md)
