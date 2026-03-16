# AEM Workflow Triage — Checklist

Quick per-symptom checklist. Use alongside the main triage skill.

---

## A. Workflow Not Starting (Launcher)

- [ ] Launcher exists in Tools > Workflow > Launchers
- [ ] Launcher **Activate** status is **ON**
- [ ] **Event type** matches the triggering operation (NODE_CREATED / NODE_MODIFIED / NODE_REMOVED / Replication)
- [ ] **Path / glob** covers the payload path — test pattern against the actual path manually
- [ ] **Condition expression** (if set) is valid and not throwing an exception
- [ ] Workflow **model is synced** — `Sync` button clicked in Models console after last model save
- [ ] Model exists at `/var/workflow/models/` (runtime copy, not only `/conf/.../workflow/models/`)
- [ ] No other launcher with higher specificity/priority overriding this one
- [ ] Triggering user/session has rights observed by the launcher event listener
- [ ] On Cloud Service: no policy or replica filter blocking the node event on author

---

## B. Workflow Stuck on a Step

- [ ] Open instance > **Open History** — identify the last completed step and the current stuck step
- [ ] Note the **process label** of the stuck step
- [ ] **Step type** identified (Process / Participant / Dynamic Participant / OR-Split / AND-Split-Join / Goto)

**For Process Step (custom WorkflowProcess):**
- [ ] Code calls `workflowSession.complete(workItem, null)` on all success paths
- [ ] Code throws `WorkflowException` on all failure paths (does NOT silently swallow)
- [ ] No blocking I/O without timeout (HTTP calls, JDBC, JCR queries that run forever)
- [ ] Process arguments match what the step dialog has configured

**For Participant / Dynamic Participant Step:**
- [ ] Inbox item exists for the expected assignee — check Tools > Inbox
- [ ] Participant chooser script resolves to a valid user/group that exists in the repository
- [ ] Assignee has Inbox access / correct permissions

**For OR/AND Split/Join:**
- [ ] Routing conditions on branches are valid EL or ECMA and return the correct type
- [ ] AND-Join: all branches have either completed or been terminated; no orphaned branch
- [ ] Goto step: loop exit condition eventually evaluates to false

**Payload and environment:**
- [ ] Payload node still exists at the expected path
- [ ] Service user has read/write access to payload path
- [ ] External service dependencies (HTTP, DB) are reachable and responding
- [ ] On Cloud Service: outbound HTTP is allow-listed in egress config

---

## C. Workflow Failed (Failures Console)

- [ ] Opened Failure Details: Failure Message, Step name, Failure Stack captured
- [ ] Mapped step label to source class via `@Component(property = "process.label=...")`

**Exception classification:**
- [ ] `WorkflowException` → custom code threw it intentionally; read message and inner cause
- [ ] `NullPointerException` → null payload, null process argument, unresolved `@Reference`
- [ ] `PathNotFoundException` → payload or referenced JCR node was deleted or path is wrong
- [ ] `AccessDeniedException` → service user missing ACL on payload or other nodes
- [ ] `RepositoryException` → possibly transient; check if repo is healthy
- [ ] `SocketTimeoutException` / `ConnectException` → external call failed; transient or config issue
- [ ] `ServiceException` → required OSGi service not registered; check Felix console

**Process arguments:**
- [ ] All required process args are set in the step dialog in the workflow model
- [ ] Argument key names match exactly what the code uses (`processArguments.get("KEY", String.class)`)
- [ ] No type mismatch (e.g. passing integer string to a Long field)

**Service user:**
- [ ] Service user mapping exists: `org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-<pid>`
- [ ] Service user has required ACLs (jcr:read, jcr:write, rep:write as needed)

**Remediation decision:**
- [ ] **Transient issue** (network, brief outage) → fix cause, then **Retry Step**
- [ ] **Code/config bug** → fix and redeploy, then **Terminate and Retry**
- [ ] **Irrecoverable** (payload deleted, no valid business state) → **Terminate**

---

## D. Status RUNNING but History Shows COMPLETED

- [ ] Compared model in Models console with CRXDE node at `/var/workflow/models/<model>/jcr:content/flow`
- [ ] Step node count and order matches between editable model and runtime model
- [ ] Clicked **Sync** in Models console to push editable model to runtime
- [ ] Terminated stale RUNNING instance(s) from Instances console
- [ ] No goto step creating an infinite loop that was only recently broken

---

## E. Instance Buildup / Engine Slow

- [ ] Counted RUNNING instances per model in Instances console
- [ ] Identified the launcher or trigger responsible for the volume
- [ ] Checked whether buildup is from legitimate long-running steps or truly stuck instances
- [ ] Disabled or narrowed the offending launcher's path glob as immediate relief
- [ ] Configured or verified purge: `com.adobe.granite.workflow.purge.Scheduler` (COMPLETED, age in days)
- [ ] Considered adding a second purge config for RUNNING instances older than expected max duration
- [ ] On 6.5: checked JMX `WorkflowMaintenanceMBean` for queue depth and executor pool size
- [ ] Bulk-terminated clearly stuck instances (not legitimate in-progress ones)

---

## F. Participant Step / Inbox

- [ ] Inbox item is visible in Tools > Inbox for the expected assignee
- [ ] If missing: checked logs for participant chooser / script errors
- [ ] Participant chooser resolves to a valid, existing user or group
- [ ] On Cloud Service: IMS user/group is synced to AEM
- [ ] Delegation or admin-override used if assignee is unavailable

---

## Quick Severity Classification

| Situation | Severity | Immediate action |
|-----------|----------|------------------|
| All workflows across all models stuck | Critical | Check OSGi workflow engine status; restart if needed |
| Single instance stuck on external call | Medium | Wait then Retry; or Terminate if SLA breached |
| Launcher not firing for one model | Medium | Fix launcher config, re-enable |
| Failed instance, fix available | Low | Redeploy fix, Terminate and Retry |
| Many completed instances not purged | Low | Configure purge scheduler |
| Participant item missing from Inbox | Low-Medium | Fix chooser script or manually delegate |
