---
name: workflow-triage
description: Triage AEM workflow issues by classifying the symptom, identifying the failing step or misconfiguration, and recommending the correct remediation path. Use when a user reports a workflow not starting, stuck in running, failed with an error, slow, or building up too many instances. Covers AEM as a Cloud Service and AEM 6.5.
---

# AEM Workflow Triage

Systematically classify and triage AEM workflow issues. Identify the root cause category fast so you can either remediate immediately or hand off to the **workflow-debugging** skill for deep investigation.

## When to Use This Skill

Use this skill when the user reports:
- Workflow is **not starting** (launcher not firing)
- Workflow is **stuck** or **running indefinitely**
- Workflow **failed** (visible in the Failures console or as an error)
- Workflow is **unexpectedly slow**
- **Many instances** piling up or degraded workflow engine performance
- **Unclear** what went wrong — start here to classify first

**Related skill:** For deep investigation (log analysis, JCR inspection, custom step debugging), proceed to **workflow-debugging** after completing triage.

---

## Workflow Console Map

Know where to look before anything else.

| Console | Navigation | Purpose |
|---------|-----------|---------|
| **Instances** | Tools > Workflow > Instances | All currently running workflow instances; suspend, resume, terminate |
| **Failures** | Tools > Workflow > Failures | Instances that ended in error; Failure Details, stack trace, Retry/Terminate |
| **Archive** | Tools > Workflow > Archive | Completed (and user-aborted) instances; Open History for step timeline |
| **Models** | Tools > Workflow > Models | Workflow definitions; verify step order, process labels, routing |
| **Launchers** | Tools > Workflow > Launchers | When and what triggers a workflow; event type, path glob, enabled flag |
| **Inbox** | Tools > Inbox | Participant steps waiting for human action |
| **JMX** | System Console > JMX (6.5) | WorkflowMaintenanceMBean: purge, count, inspect |

> On **AEM as a Cloud Service**: JMX is not directly accessible. Use the Developer Console for log streaming, and rely on Tools > Workflow consoles and CRXDE Lite (where available) for inspection.

---

## Triage Workflow

### Step 1: Gather Symptom Details

Ask or confirm the following before proceeding:

1. **What is the observed behavior?** (not starting / stuck / failed / slow / many instances)
2. **Which workflow model?** (e.g. DAM Update Asset, custom model name)
3. **What is the payload?** (e.g. `/content/dam/mysite/image.jpg`, `/content/mysite/en/page`)
4. **Since when?** (after a deployment, after a content change, always, or intermittent)
5. **How many instances are affected?** (one, many, all)
6. **AEM version?** (6.5 or Cloud Service, and patch level if known)

---

### Step 2: Classify the Issue

Map the symptom to the primary issue class using the table below, then follow the corresponding triage path.

| Symptom | Issue Class | Triage Path |
|---------|-------------|-------------|
| Workflow never starts after expected trigger | **Launcher** | → Section A |
| Workflow started but progress stopped on one step | **Step execution** | → Section B |
| Workflow shows FAILED / visible in Failures console | **Step error** | → Section C |
| Workflow history shows COMPLETED but status still RUNNING | **Model-runtime mismatch** | → Section D |
| High number of running instances, engine sluggish | **Instance buildup** | → Section E |
| Participant step waiting, no inbox item | **Inbox / routing** | → Section F |

---

### Section A — Launcher Not Firing

**Goal:** Confirm whether the launcher exists, is enabled, and its conditions match.

**Checks (in order):**

1. **Launcher exists and is enabled**
   - Tools > Workflow > Launchers
   - Confirm the launcher row is present and the **Activate** status is ON

2. **Event type matches**
   - `NODE_CREATED`, `NODE_MODIFIED`, `NODE_REMOVED`, or `Replication`
   - Does this match what the user expects? (e.g. uploading an asset fires `NODE_CREATED` on the asset node)

3. **Path/glob matches**
   - The glob must cover the payload path (e.g. `/content/dam(/.*)` covers all assets)
   - Test mentally: does the payload path satisfy the glob? Watch for escaped slashes or typos

4. **Condition (if set)**
   - Optional EL condition; an error in the condition silently prevents the launch
   - Remove or simplify the condition to test if the launcher fires without it

5. **Workflow model is published/synced**
   - The model at `/conf/.../workflow/models/` (editable) must be synced to `/var/workflow/models/` (runtime)
   - In the Models console: Sync button must have been clicked after last save

6. **Permissions**
   - The system user or session that performs the triggering operation must have rights that allow the launcher to observe the event
   - On Cloud Service, `sling-default` or a custom service user must be mapped correctly

**Resolution:**
- Fix launcher config (path, event type, condition)
- Sync the model
- If still not firing → proceed to **workflow-debugging** for OSGi event/launcher log analysis

---

### Section B — Workflow Stuck on a Step

**Goal:** Identify the exact step and why it is not completing.

**Checks (in order):**

1. **Identify the stuck step**
   - Tools > Workflow > Instances > select instance > Open History
   - The last completed step is the one before the stuck step; note its **process label**

2. **Step type**

   | Step type | Typical cause of stall |
   |-----------|------------------------|
   | **Process Step** (custom `WorkflowProcess`) | `execute()` is not calling `complete()`, or blocking on external I/O |
   | **Participant Step** | Waiting for a user — check Inbox; user may not have the item or wrong assignee |
   | **Dynamic Participant Step** | Script error in participant chooser — check logs for NPE or wrong return |
   | **OR/AND split/join** | Routing condition error; join waiting for a branch that already completed or never started |
   | **Goto Step** | Infinite loop — condition always true, never exits |

3. **Payload still exists**
   - Confirm the resource at the payload path still exists in the repository
   - If deleted mid-workflow, many process steps will block or error

4. **External dependency**
   - Is the step calling an external API, database, or service? Check if that service is reachable and responsive
   - On Cloud Service, outbound calls require explicit allow-listing

5. **Thread / engine state**
   - Is only ONE instance stuck, or ALL? If all, the workflow engine may be overloaded or the executor thread pool is exhausted

**Resolution:**
- For Participant Step: check Inbox, correct assignee, or delegate/complete the item
- For Process Step not calling `complete()`: fix code and redeploy; then Terminate and re-run
- For external dependency: Retry Step after the dependency recovers
- For detailed stack/thread analysis → proceed to **workflow-debugging**

---

### Section C — Workflow Failed (Error in Failures Console)

**Goal:** Identify the failing step and root cause category from the error.

**Checks (in order):**

1. **Open Failure Details**
   - Tools > Workflow > Failures > select instance > **Failure Details**
   - Note: Failure Message, Step name, Failure Stack

2. **Map the step to code**
   - Use the process label from Failure Details to find the `WorkflowProcess` implementation
   - Search the codebase for `process.label=<label>` in the `@Component` annotation

3. **Classify the exception**

   | Exception | Likely cause |
   |-----------|--------------|
   | `WorkflowException` | Custom code threw it intentionally or wrapped another exception |
   | `NullPointerException` | Null payload, missing process argument, or unresolved service dependency |
   | `javax.jcr.PathNotFoundException` | Payload node or a referenced node does not exist |
   | `javax.jcr.AccessDeniedException` | Service user lacks permission on the payload or referenced path |
   | `RepositoryException` | JCR issue; check if repository is healthy; may be transient |
   | `java.net.SocketTimeoutException` | External HTTP call timed out |
   | `org.osgi.framework.ServiceException` | Required OSGi service not available — check OSGi console |

4. **Process arguments**
   - Check if required process arguments (e.g. `PROCESS_ARGS`) are correctly set in the workflow model step dialog

5. **Determine remediability**
   - **Transient** (network blip, brief outage) → fix condition then **Retry Step**
   - **Code/config bug** → fix and redeploy; then use **Terminate and Retry** for a fresh instance
   - **Irrecoverable** (payload deleted, business state invalid) → **Terminate**

**Actions available in Failures console:**
- **Retry Step** — re-runs the failed step without starting a new instance (use after fixing transient issues)
- **Terminate** — stops the instance; use when the instance cannot recover
- **Terminate and Retry** — terminates and starts a new instance with the same payload, title, and description

---

### Section D — Status RUNNING but History Shows COMPLETED

**Goal:** Identify and resolve model-runtime mismatch or stale engine state.

**This typically happens when:**
- The workflow model was edited but not synced to the runtime path (`/var/workflow/models/`)
- A step was added/removed/reordered after the instance started
- A goto/routing condition was changed that broke the exit path

**Checks:**

1. **Compare the model in Models console with CRXDE Lite**
   - Model editor path: `/conf/.../settings/workflow/models/<model>/jcr:content/flow`
   - Runtime path: `/var/workflow/models/<model>/jcr:content/flow`
   - Number and order of step nodes must match

2. **Sync the model**
   - In the Models console, open the model and click **Sync** (button in the toolbar)
   - This copies the editable model to `/var/workflow/models/`

3. **If model is correct, terminate the stuck instance**
   - Tools > Workflow > Instances > select > **Terminate**
   - Restart the workflow from the payload if needed

4. **Persistent stale instances**
   - Use JMX `WorkflowMaintenanceMBean` (6.5) or the purge OSGi config to clean up
   - On Cloud Service, open a support ticket if engine state is corrupted

---

### Section E — Instance Buildup / Engine Slow

**Goal:** Stop the growth and recover engine performance.

**Checks (in order):**

1. **Volume** — How many instances are in RUNNING state? (Tools > Workflow > Instances — sort by model)

2. **Root cause of buildup**
   - A new launcher that fires on a very broad path (e.g. `/content(/.*)?` on `NODE_MODIFIED`)
   - A long-running or stuck process step that queues up behind it
   - Purge not configured — completed instances accumulating since launch

3. **Purge configuration**
   - OSGi PID: `com.adobe.granite.workflow.purge.Scheduler`
   - Configure to purge `COMPLETED` instances older than N days
   - Optionally add a second config to purge `RUNNING` instances older than a timeout threshold

4. **Throttle the launcher (immediate relief)**
   - Temporarily disable or narrow the offending launcher path
   - Bulk-terminate excessive RUNNING instances if they are stuck, not legitimately active

5. **Thread pool**
   - OSGi PID: `com.adobe.granite.workflow.core.WorkflowSessionFactory` — `granite.workflow.inboxQuerySize`
   - On 6.5: check `com.day.cq.workflow.impl.WorkflowQueueManagerImpl` for queue depth

---

### Section F — Participant Step / Inbox Issues

**Goal:** Find why the Inbox item is missing or the step is not routing.

**Checks:**

1. **Inbox item exists?**
   - Tools > Inbox — filter by workflow model or assignee
   - If missing: the Participant Chooser script may have failed silently

2. **Participant Chooser (Dynamic Participant Step)**
   - Open the step in the model editor; inspect the ECMA script or Java class used to resolve the participant
   - Test the script/class in isolation with the expected payload
   - Check logs for errors during participant resolution (search for the step name or class)

3. **Assignee group/user exists**
   - Confirm the resolved user or group exists in `/home/users` or `/home/groups`
   - On Cloud Service, IMS users/groups must be synced

4. **Delegate / complete manually**
   - If the user cannot act: Admin can open the Inbox item on their behalf or delegate the workflow

---

### Step 3: Summarize and Recommend

After completing the relevant section, summarize:

```
Symptom:      [what the user reported]
Issue class:  [Launcher / Step execution / Step error / Model mismatch / Buildup / Inbox]
Root cause:   [specific finding, e.g. "Launcher glob /content/dam/.* doesn't match /content/dam/brand/"]
Immediate action: [e.g. Fix glob and re-enable launcher / Retry Step after fix]
Next step:    [Resolved | Needs code fix + redeploy | Escalate to workflow-debugging]
```

---

## Quick Reference

| Goal | Action |
|------|--------|
| See all running instances | Tools > Workflow > Instances |
| See failed instances + stack | Tools > Workflow > Failures > Failure Details |
| Re-run a failed step | Failures > select > Retry Step |
| Stop a stuck instance | Instances > select > Terminate |
| New instance with same payload | Failures > select > Terminate and Retry |
| View step-by-step history | Archive or Instances > select > Open History |
| Fix model not firing | Tools > Workflow > Models > Sync |
| Configure purge | OSGi: `com.adobe.granite.workflow.purge.Scheduler` |

---

## Resources

- **Detailed triage checklist:** `resources/triage-checklist.md`
- **Deep debugging guidance:** use skill **workflow-debugging**
- **Experience League:** [Administering Workflow Instances](https://experienceleague.adobe.com/en/docs/experience-manager-65/content/sites/administering/operations/workflows-administering)
- **Experience League:** [Developing and Extending Workflows](https://experienceleague.adobe.com/en/docs/experience-manager-65/content/implementing/developing/extending-aem/extending-workflows/workflows)
