# Runbook: Inbox and permissions — Cloud Service

**symptom_id:** `user_cannot_see_or_complete_item`

> **Variant:** AEM as a Cloud Service. All identity flows through IMS federation + repoinit-created JCR groups. Editing `enforce*` flags lands via Git + Cloud Manager pipeline, not Felix Console.

---

## Symptom

A user cannot see work items that should be assigned to them; or cannot perform **Terminate / Resume / Suspend / Delegate / Return**, hitting "Terminate failed", "Resume failed", "Suspend failed", or `AccessControlException` in the UI.

---

## Root cause categories

- `not_assignee_and_enforce_assignee_true` — user is not the specific assignee, and `granite.workflow.enforceWorkitemAssigneePermissions=true`.
- `not_initiator_and_enforce_initiator_true` — user is not the instance initiator, and `granite.workflow.enforceWorkflowInitiatorPermissions=true`.
- `not_in_superuser_group` — `cq.workflow.superuser` points at a group the user isn't in.
- `superuser_points_at_orphan_principals` — the superuser list contains IMS user IDs that have rotated.
- `repository_acl_insufficient` — assignee lacks `jcr:read` on the payload path.

---

## Decision tree

- **IF** user cannot **see** an item → Checklist 1, 2, 5 (assignee mapping + ACL).
- **IF** user cannot **complete** an item → Checklist 1, 2.
- **IF** user cannot **terminate / resume / suspend** → Checklist 3, 4 (initiator or superuser required).
- **IF** user cannot **delegate or return** → Checklist 1, 2, 5.
- **IF** "Terminate failed" / "Resume failed" / "Suspend failed" is specifically in logs → the enforce flags are active; confirm the user's membership, don't just raise the flag.

---

## Checklist

1. **Read the current `WorkflowSessionFactory` config**
   Look at the deployed `com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json` in your `ui.config` module (or reflect on Developer Console → OSGi → Configuration). Bundled example with the full property set: [`../examples/com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json`](../examples/com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json).

   Key properties:

   | Property | Default | Effect when `true` |
   |----------|---------|--------------------|
   | `granite.workflow.enforceWorkitemAssigneePermissions` | `true` | Only the named assignee (or inbox-shared user) can see / complete. |
   | `granite.workflow.enforceWorkflowInitiatorPermissions` | `true` | Only the initiator or a superuser can terminate / resume / suspend. |
   | `cq.workflow.superuser` | `[]` | Principals (should be a **group**) who bypass the above. |

2. **Confirm the user is the assignee or an inbox-share target**
   - Workflow Console → open instance → Participant step → note the `PARTICIPANT` value (user or group ID).
   - If a group, confirm the user is a member (Developer Console → User Management, or `/crx/explorer` group tree on lower envs).
   - If inbox sharing was used (one user explicitly shared work to another), confirm the share is still active.

3. **Confirm the user is the initiator**
   Instance History → first entry shows the initiator (user ID). If the user is trying to terminate/resume/suspend and isn't the initiator, `enforceWorkflowInitiatorPermissions=true` blocks them. Two options: they become the initiator on *new* instances, or they join the superuser group.

4. **Confirm `cq.workflow.superuser` is a group (not individuals)**
   Read the deployed `cq.workflow.superuser` value:
   - **✅ Correct:** `["workflow-administrators"]` — a group name created by repoinit.
   - **❌ Wrong:** `["alice@example.com", "bob@example.com"]` — IMS user IDs. These rotate and silently break.

   Bundled repoinit pattern for the group (include in your `ui.apps/.../repoinit`):
   ```
   create group workflow-administrators
   add admin to group workflow-administrators
   ```
   The `group` keyword after `to` is **required** — without it the repoinit parser fails at startup and the entire script aborts.

5. **Payload ACL**
   For see/complete on a specific item, the assignee needs `jcr:read` on the payload path. Check:
   - recent `ui.apps/.../repoinit` commits for the group the user is in;
   - whether the payload was moved to a path outside the group's `allow` scope.

---

## Remediation

| Scenario | Fix (Git-based) |
|----------|------------------|
| User should be able to terminate but isn't the initiator | Add the user's group to `cq.workflow.superuser` in `com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json`; commit; deploy via Cloud Manager pipeline. |
| Superuser list contains individual IMS user IDs | Replace with a group name; add the individuals to the group via repoinit. Commit + deploy. Prevents IMS-rotation breakage. |
| Assignee lacks `jcr:read` on payload | Add a `repoinit` block granting read to the assignee's group on the payload tree. Commit to `ui.apps/.../repoinit`; deploy. |
| `enforceWorkitemAssigneePermissions=true` too strict for a specific workflow | Use inbox sharing, or assign to a broader group. **Do not** toggle the flag to `false` in prod — it removes a security boundary for every workflow on the environment. |
| `enforceWorkflowInitiatorPermissions=true` blocking ops staff | Add the ops group to `cq.workflow.superuser`. **Do not** toggle the enforce flag off — the issue is group membership, not the flag. |
| Dev env only: need to debug quickly | Set `enforceWorkitemAssigneePermissions=false` *in the `config.author.dev` run-mode folder only*. Never in `config.author.prod`. |

---

## AEMaaCS identity gotchas

- **Never list IMS user IDs in `cq.workflow.superuser`.** IMS principals change on re-invite. Reference a JCR group provisioned via repoinit.
- **Assign Participant steps to groups, not users.** Same reason — survivability across IMS rotation.
- **`repoinit` is the canonical path for ACLs and groups.** CRX/DE edits on lower envs do not persist across pod restarts; Package Manager deploys are not available in prod.
- **Service users for elevated process steps.** If a Process step needs write access beyond what a human user has, use a service user + `ServiceUserMapperImpl.amended-*.cfg.json` — never `loginAdministrative` (forbidden) and never a human user's credentials.

---

## Escalation

- All of the above are correct and the user still gets a permission error → enable trace logging on `com.adobe.granite.workflow.core.WorkflowSessionImpl`, reproduce the action, attach 10 min of logs + instance ID + user ID to an Adobe Support ticket.
- The repoinit parser fails at startup (you see `add X to Y` without `group` errors, or the whole script aborts) → your repoinit syntax is wrong; fix it in the commit rather than via Support. Support can't work around a parse error.

---

## References

- Bundled WorkflowSessionFactory config: [`../examples/com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json`](../examples/com.adobe.granite.workflow.core.WorkflowSessionFactory.cfg.json)
- Error patterns (permission signatures): [`../docs/error-patterns.md`](../docs/error-patterns.md)
- Related runbooks: [`runbook-task-not-in-inbox.md`](runbook-task-not-in-inbox.md), [`runbook-failed-work-items.md`](runbook-failed-work-items.md)
