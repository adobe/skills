---
name: workflow-debugging
description: Deep debugging of AEM workflow issues: log analysis, JCR inspection of workflow instance data, custom WorkflowProcess step debugging, launcher event tracing, OSGi service and service-user diagnostics, and workflow model validation. Use after workflow-triage when the root cause requires deeper investigation. Applies to AEM as a Cloud Service and AEM 6.5.
---

# AEM Workflow Debugging

Deep-dive investigation for AEM workflow issues. Apply after **workflow-triage** has classified the symptom and a quick fix was not sufficient.

## When to Use This Skill

Use this skill when:
- Triage identified the issue class but root cause is not clear
- You need to read and interpret workflow-related logs
- You need to inspect JCR nodes for a workflow instance or model
- A custom `WorkflowProcess` step is behaving unexpectedly
- A launcher is not firing and console checks did not reveal the cause
- An OSGi service or service-user is suspected but not confirmed

**Prerequisite:** Complete **workflow-triage** first to classify the issue. This skill assumes you know the issue class (launcher / process step / model / buildup / inbox).

---

## Debugging Workflow

### Step 1: Enable Targeted Logging

Before looking at existing logs, ensure you have the right log levels.

**Key loggers to enable at DEBUG level:**

| Logger | Package / Class | What it reveals |
|--------|-----------------|-----------------|
| Workflow engine | `com.day.cq.workflow` | Step execution, routing decisions, instance state transitions |
| Workflow session | `com.adobe.granite.workflow` | Granite workflow API calls, session operations |
| Launcher | `com.day.cq.workflow.impl.launcher` | Launcher matching, event filtering, launch decisions |
| Custom step | Your `WorkflowProcess` class package | Step-level output |
| Sling jobs (if applicable) | `org.apache.sling.event` | Job queue and execution |

**How to set log levels:**

- **6.5:** Felix Console > Sling > Log Support > add logger configuration
- **Cloud Service:** `ui.config` module — add `org.apache.sling.commons.log.LogManager.factory.config-<pid>.cfg.json`:

```json
{
  "org.apache.sling.commons.log.level": "DEBUG",
  "org.apache.sling.commons.log.names": ["com.day.cq.workflow.impl.launcher"],
  "org.apache.sling.commons.log.file": "logs/error.log"
}
```

> Remove DEBUG configs from production after investigation. DEBUG on `com.day.cq.workflow` is very verbose on busy instances.

---

### Step 2: Log Analysis

See `resources/debugging-guide.md` for exact log patterns and search queries. Key patterns to look for:

**Launcher not firing — look for:**
```
Evaluating launcher <id> for event <event-type> on <path>
Launcher <id> does not match — condition: <reason>
Launching workflow <model> for path <payload>
```
If no "Evaluating launcher" lines appear for the expected event, the event itself is not reaching the launcher observer (permissions, replication filter, or the node is not triggering the event type).

**Step execution — look for:**
```
Executing step <process-label> for workItem <id>
WorkflowProcess.execute called for payload <path>
Step completed for workItem <id>
WorkflowException thrown in step <label>: <message>
```

**Service user issues — look for:**
```
AccessDeniedException for path <path> using service user <user>
ResourceResolverFactory: cannot get ResourceResolver for subServiceName <name>
```

**OSGi service not available — look for:**
```
Cannot bind reference 'xxx' — no service registered for interface <interface>
ServiceException: service is unregistered
```

---

### Step 3: JCR Inspection

Inspect the live state of a workflow instance and its model directly in the repository.

**Instance data path:**
```
/var/workflow/instances/<date>/<id>/
```

Key nodes and properties:

| Node / Property | What it tells you |
|-----------------|-------------------|
| `./data/payload` | The payload path |
| `./data/metaData/` | Workflow variables set by steps |
| `./history/` | Step history nodes; each has `startTime`, `endTime`, `stepInfo` |
| `./workItems/` | Active work items (steps in progress); the node exists as long as the step is running |
| `./state` | `RUNNING`, `COMPLETED`, `ABORTED`, `STALE` |

**Finding the stuck work item:**
- Navigate to `/var/workflow/instances/<date>/<id>/workItems/`
- The persisted work item node is the currently executing step
- Its `node` property points back to the step node in the model's flow

**Workflow model runtime path:**
```
/var/workflow/models/<model-name>/jcr:content/flow/
```
Each step is a child node. The `type` property maps to the step component (e.g. `dam/gui/components/workflow/...` or `cq/workflow/components/process`).

**Comparing editable vs runtime model:**
- Editable: `/conf/<tenant>/settings/workflow/models/<model>/jcr:content/flow/`
- Runtime: `/var/workflow/models/<model>/jcr:content/flow/`
- Step node count, order, and `process.label` values must match

---

### Step 4: Custom WorkflowProcess Step Debugging

When a custom step (`WorkflowProcess`) is the suspect, use this checklist.

**4a. Locate the implementation:**
- Search for `@Component(... "process.label=<label from Failure Details>" ...)`
- Confirm the bundle containing this class is Active in the OSGi console (Felix Console > Bundles)
- Confirm the service is registered: Felix Console > Services > filter by `WorkflowProcess`

**4b. Inspect the execute() method:**

Common mistakes and what to look for:

```java
// MISTAKE: Not calling complete() on success
@Override
public void execute(WorkItem workItem, WorkflowSession workflowSession, MetaDataMap args)
        throws WorkflowException {
    doWork();
    // ← Missing: workflowSession.complete(workItem, null); — step will hang
}

// MISTAKE: Swallowing exception instead of rethrowing as WorkflowException
try {
    doWork();
} catch (Exception e) {
    log.error("Failed", e); // ← step appears to complete but silently skipped
    // Missing: throw new WorkflowException(e.getMessage(), e);
}

// MISTAKE: Getting ResourceResolver from workflow session for service operations
ResourceResolver resolver = workflowSession.adaptTo(ResourceResolver.class);
// This resolver is tied to the workflow user, not a service user
// Use ResourceResolverFactory with a service user for privileged operations
```

**4c. Process arguments:**

```java
// Correct: read with type and default
String myArg = args.get("MY_ARG", "default-value");

// Pitfall: wrong type causes ClassCastException
Long myLong = args.get("MY_ARG", Long.class); // fails if stored as String "123"
// Fix: read as String then parse
String raw = args.get("MY_ARG", "0");
long myLong = Long.parseLong(raw);
```

Verify that the **step dialog** in the workflow model (Process Arguments field) has the correct key=value pairs.

**4d. Service user:**

For steps that read/write content with service-level permissions:

```java
@Reference
private ResourceResolverFactory resolverFactory;

private ResourceResolver getServiceResolver() throws LoginException {
    Map<String, Object> params = new HashMap<>();
    params.put(ResourceResolverFactory.SUBSERVICE, "my-workflow-service");
    return resolverFactory.getServiceResourceResolver(params);
}
```

Required OSGi config (`org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended`):
```json
{
  "user.mapping": ["com.myproject.core:my-workflow-service=[my-service-user]"]
}
```

Verify: Felix Console > Sling > Service User Mapper — confirm mapping is listed.

**4e. Local unit test approach:**

When you need to reproduce outside AEM:
1. Use `wcm.io AEM Mocks` or `Sling Mocks`
2. Set up a mock `WorkItem`, `WorkflowSession`, and `MetaDataMap`
3. Call `execute()` directly in a JUnit test with the known inputs

---

### Step 5: Launcher Event Tracing

When the launcher is confirmed correct in the console but still not firing:

**5a. Verify the event is generated:**

For `NODE_MODIFIED` on a JCR node, the observation must be registered. Check:
- Felix Console > OSGi > Events — browse recent events for the expected path (6.5)
- Search logs for `ObservationManager` or `EventAdmin` with the payload path

**5b. Launcher condition debugging:**

If a condition expression is set on the launcher:
- Open the launcher in edit mode; copy the condition EL expression
- Test it in a Groovy Console or via the SlingPostServlet on a test node
- Common issue: `${payload.properties['jcr:primaryType'] == 'dam:Asset'}` — single quotes inside a Granite EL expression must use correct quoting

**5c. Multiple launchers competing:**

Check the launcher list for:
- Multiple launchers on overlapping paths with the same event — AEM picks the most specific match
- A launcher that fires but routes to a different or disabled model
- A launcher with `runModes` restriction that does not include the current run mode

**5d. Replication launcher (for publish triggers):**

For launchers on `Replication` event type:
- The event is generated on the **author** instance at replication time
- Confirm the content is actually being replicated (not just saved/activated in UI without actual replication agent configured)
- Search logs for `ReplicationEvent` and the payload path

---

### Step 6: Workflow Model Validation

Use when model behavior is unexpected (wrong step order, wrong routing, wrong step executing).

**6a. Validate model structure in CRXDE:**

- Navigate to `/var/workflow/models/<model>/jcr:content/flow/`
- List child nodes — these are the steps in execution order
- For each step node, check:
  - `type` property: must point to a valid step component path
  - For Process Step: `metaData/PROCESS` must equal the `process.label` OSGi property value
  - For Participant Step: `metaData/PARTICIPANT` must resolve to a valid user/group

**6b. OR/AND split/join validation:**

- OR-Split: each branch node must have a routing condition that evaluates to boolean
- AND-Join: must have `N` incoming branches where `N` matches the split fan-out
- Orphaned join branches (e.g. after a model edit that removed a branch) permanently block the join

**6c. Goto step loop detection:**

- If history shows repeating steps, a Goto step is looping
- Check the Goto condition: it must eventually evaluate to `false` based on workflow metadata set by earlier steps

---

### Step 7: OSGi / Engine Diagnostics

When the issue is at the engine or infrastructure level.

**OSGi service inspection (Felix Console > Services):**

| Service interface | What to check |
|-------------------|---------------|
| `com.adobe.granite.workflow.exec.WorkflowProcess` | All registered process steps; confirm your step appears |
| `com.adobe.granite.workflow.WorkflowService` | Core engine service; must be Active |
| `com.day.cq.workflow.WorkflowService` | CQ compatibility layer; must be Active |

**Workflow engine OSGi configs:**

| PID | Key property | Purpose |
|-----|-------------|---------|
| `com.adobe.granite.workflow.core.WorkflowSessionFactory` | `granite.workflow.inboxQuerySize` | Max inbox query result size |
| `com.adobe.granite.workflow.purge.Scheduler` | `scheduledpurge.workflowStatus`, `scheduledpurge.daysold` | Purge completed/running instances |
| `com.day.cq.workflow.impl.WorkflowQueueManagerImpl` (6.5) | `maxThreads`, `queueSize` | Executor thread pool |

**On Cloud Service:**
- Engine config is largely managed by Adobe; avoid changing core workflow engine PIDs
- Use Developer Console for log tailing, heap dumps, and thread dumps if engine appears stuck
- For persistent engine-level issues, open a support ticket with the instance ID and workflow instance IDs

---

## Investigation Summary Template

After completing debugging, summarize findings:

```
Workflow model:       [model name]
Instance ID:         [path in /var/workflow/instances/...]
Payload:             [path]
Issue class:         [from triage]
Failing step:        [process label / step type]
Root cause:          [specific: e.g. "service user 'workflow-svc' missing jcr:write on /content/dam"]
Evidence:            [log line / CRXDE path / exception]
Fix applied:         [e.g. "Added ACL for workflow-svc on /content/dam; redeployed bundle"]
Verification:        [Retry Step succeeded / new instance completed / launcher fired after fix]
Prevention:          [e.g. "Add service user ACL validation to CI pipeline"]
```

---

## Resources

- **Patterns and log examples:** `resources/debugging-guide.md`
- **Triage checklist:** use skill **workflow-triage** → `resources/triage-checklist.md`
- **Experience League:** [Developing and Extending Workflows](https://experienceleague.adobe.com/en/docs/experience-manager-65/content/implementing/developing/extending-aem/extending-workflows/workflows)
- **Experience League:** [Administering Workflow Instances](https://experienceleague.adobe.com/en/docs/experience-manager-65/content/sites/administering/operations/workflows-administering)
- **Experience League:** [Best Practices for Service User Mapping](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/security/best-practices-for-sling-service-user-mapping-and-service-user-definition)
- **wcm.io AEM Mocks:** https://wcm.io/testing/aem-mock/ — for unit testing custom steps
