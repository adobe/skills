# Runbook: Model delete and update — Cloud Service

**symptom_id:** `cannot_delete_model`

> **Variant:** AEM as a Cloud Service. No JMX. `countRunningWorkflows` / `terminateFailedInstances` JMX operations are not available — running-instance counts come from the Workflow Console; termination is per-instance (UI) or via a superuser-gated servlet.

---

## Symptom

- Cannot delete a workflow model — error indicates running instances; or
- Model changes not visible after deploy (Sync didn't apply or runtime copy is stale).

---

## Root cause categories

- `running_instances_exist_for_model` — at least one RUNNING or SUSPENDED instance still references the model.
- `model_not_synced_after_deploy` — design-time changes landed at `/conf/global/settings/workflow/models/<id>` but `/var/workflow/models/<id>` (runtime) wasn't refreshed.
- `empty_or_or_and_branch_blocks_sync` — Sync operation fails silently because a branch has no steps.
- `cached_old_model_in_ui` — browser-side cache serves the old model.

---

## Decision tree

- **IF** deletion is blocked by "running instances" → follow **Delete model — steps** below.
- **IF** deletion succeeds but new instances still use old behaviour → runtime cache; Sync + hard refresh.
- **IF** Sync fails in the editor → an OR/AND branch is empty; fix the model.
- **IF** the model appears at design-time but not at runtime → sync issue; re-run Sync after confirming no empty branches.

---

## Delete model — steps

1. **Count running instances**
   Workflow Console → Instances → filter by **Model** = your target model and **State** = `Running` (and `Suspended`). Note the count. There is no `countRunningWorkflows` JMX on AEMaaCS — this UI-based count is the canonical approach.

   For programmatic counts (e.g. part of a pre-release check), build a superuser-gated read-only servlet following the pattern in [`../examples/StaleWorkflowServlet.java`](../examples/StaleWorkflowServlet.java) — but query `getWorkflows(new String[]{"RUNNING", "SUSPENDED"}, 0, -1)` filtered by model ID. Dry-run by default.

2. **Terminate or complete each running instance**
   - If the instance can finish naturally, let it.
   - Otherwise, open the instance in the Workflow Console → **Terminate** (requires initiator or `cq.workflow.superuser` membership).
   - For large counts, either: iterate the UI (tens of instances), build a bulk-terminate servlet (same audit-trail caveat as the bulk-retry pattern — see [`runbook-failed-work-items.md`](runbook-failed-work-items.md)), or open an Adobe Support ticket.

3. **Delete the model source**
   - Remove the model node from `/conf/global/settings/workflow/models/<id>` in the `ui.content` module of your customer repo.
   - Commit; deploy via Cloud Manager pipeline.
   - The runtime copy at `/var/workflow/models/<id>` is auto-cleaned on Sync or pod restart; if it lingers, re-Sync from the Workflow Console.

4. **Verify**
   - Workflow Console → Models → the model should be gone.
   - Create a test payload — no workflow should launch against it (assuming the launcher referenced that model).

---

## Update model — steps

1. **Edit the model at design-time**
   Work in the customer repo under `/conf/global/settings/workflow/models/<id>`. Changes via the Workflow Model Editor on lower envs are fine for design, but **commit the resulting XML** to the repo — UI-only edits on AEMaaCS don't persist.

2. **Sync before deploy on lower envs**
   The Workflow Model Editor → **Sync** button copies the design-time model to `/var/workflow/models/<id>`. On AEMaaCS, Sync fails silently if an OR/AND branch has no step — add a `No Operation` step to every empty branch first.

3. **Deploy via Cloud Manager pipeline**
   Commit the edited model files; merge; run pipeline. The deploy applies design-time; the runtime Sync happens on service activation.

4. **Existing running instances keep the old model**
   A running instance captured the model snapshot when it started. Edits only affect *new* instances. If you need to change behaviour on a live instance:
   - Terminate it and restart with the new model (loses history).
   - Or wait for it to complete.

---

## Remediation

| Scenario | Fix |
|----------|------|
| "Could not delete model due to running instances" | Terminate or complete the listed instances (Workflow Console), then delete the model node from the repo and redeploy. |
| Model not visible after deploy | Check Sync succeeded. Empty OR/AND branch? Fix and re-Sync. Browser cache? Hard refresh. |
| Model visible but behaviour unchanged on running instances | Expected — running instances keep their original model snapshot. Terminate + restart to pick up changes, or wait. |
| Model edits on a lower env vanished after a pod restart | UI-only edits don't persist on AEMaaCS. Commit to the repo. |

---

## AEMaaCS-specific gotchas

- **No JMX `countRunningWorkflows`.** Use the Workflow Console filter, or a custom superuser-gated read-only servlet. Never block a release on a count you can't verify.
- **Sync failures are silent.** The only hint is that the runtime `/var/workflow/models/<id>` doesn't reflect recent design-time changes. Always visually confirm a Sync after editing OR/AND branches.
- **Terminated instances are still in the repo.** Terminating doesn't purge; it marks the instance `ABORTED`. Purge Scheduler cleans them up later — see [`runbook-purge-and-cleanup.md`](runbook-purge-and-cleanup.md).
- **Version semantics.** AEMaaCS supports workflow model versions. If an instance was started on v1 and you deploy v2, the instance keeps v1 metadata until it ends. "Version does not exist" errors usually mean an instance references a version the current model no longer has — don't delete old versions until no live instances reference them.

---

## Escalation

- Delete succeeds in the UI but the model reappears after a pod restart → repo drift; find the persistent source (probably another branch of the repo, or a release that re-includes the model) and delete there too.
- Sync appears to succeed but `/var/workflow/models/<id>` doesn't update → platform issue; open an Adobe Support ticket with environment ID, model path, and a Sync timestamp.

---

## References

- Bundled servlet pattern (for custom read-only instance-count queries): [`../examples/StaleWorkflowServlet.java`](../examples/StaleWorkflowServlet.java)
- Error patterns (model / version errors): [`../docs/error-patterns.md`](../docs/error-patterns.md)
- Related runbooks: [`runbook-purge-and-cleanup.md`](runbook-purge-and-cleanup.md), [`runbook-failed-work-items.md`](runbook-failed-work-items.md), [`runbook-validate-workflow-setup.md`](runbook-validate-workflow-setup.md)
