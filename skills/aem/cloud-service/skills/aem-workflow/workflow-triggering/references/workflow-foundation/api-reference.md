# Workflow API Reference — AEM Cloud Service

## WorkflowProcess (SPI)

```java
// com.adobe.granite.workflow.exec.WorkflowProcess
public interface WorkflowProcess {
    void execute(WorkItem item, WorkflowSession session, MetaDataMap args)
            throws WorkflowException;
}
```

**Registration:** `@Component(service=WorkflowProcess.class, property={"process.label=My Label"})`

The engine calls `execute()` on a Sling Job thread. Return normally to advance; throw `WorkflowException` to trigger retry.

## ParticipantStepChooser (SPI)

```java
// com.adobe.granite.workflow.exec.ParticipantStepChooser
public interface ParticipantStepChooser {
    String SERVICE_PROPERTY_LABEL = "chooser.label";
    String getParticipant(WorkItem workItem, WorkflowSession session,
                          MetaDataMap args) throws WorkflowException;
}
```

**Registration:** `@Component(service=ParticipantStepChooser.class, property={"chooser.label=My Chooser"})`

Return value must be a valid JCR `rep:principalName` (user ID or group ID).

## WorkflowSession (API)

Obtain via `resourceResolver.adaptTo(WorkflowSession.class)`.

| Method | Purpose |
|---|---|
| `startWorkflow(model, data)` | Start a new workflow instance |
| `startWorkflow(model, data, metaData)` | Start with initial metadata |
| `getModel(id)` | Get a deployed model by its `/var/workflow/models/<name>` path |
| `getModels()` | List all deployed models |
| `deployModel(model)` | Publish design-time model to runtime (`/var/workflow/models/`) |
| `newWorkflowData(type, payload)` | Create a `WorkflowData` for `JCR_PATH` or `BLOB` |
| `getWorkflows(filter)` | Query instances by state |
| `getActiveWorkItems(filter)` | Get active work items for a user |
| `complete(workItem, route)` | Advance a participant step |
| `terminate(workflow)` | Abort a running workflow |
| `suspend(workflow)` | Suspend a running workflow |
| `resume(workflow)` | Resume a suspended workflow |

## WorkflowData (Runtime data carrier)

```java
WorkflowData data = session.newWorkflowData("JCR_PATH", "/content/mypage");
data.getMetaDataMap().put("initiatorNote", "sent from batch job");
Workflow instance = session.startWorkflow(model, data);
```

**Payload types:**
- `"JCR_PATH"` — a JCR repository path
- `"BLOB"` — binary data

## MetaDataMap

`com.adobe.granite.workflow.metadata.MetaDataMap` — a typed property bag.

```java
// Read with default
String status = map.get("approvalStatus", "PENDING");
Long count = map.get("retryCount", Long.class);

// Write
map.put("approver", "john.doe");
map.put("timestamp", new Date());
```

`SimpleMetaDataMap` is the standard implementation for testing.

## WorkflowModel Graph

| Interface | Method | Purpose |
|---|---|---|
| `WorkflowModel` | `getId()` | `/var/workflow/models/<name>` path |
| `WorkflowModel` | `getNodes()` | All `WorkflowNode` objects |
| `WorkflowModel` | `getTransitions()` | All `WorkflowTransition` objects |
| `WorkflowNode` | `getType()` | `START`, `END`, `PROCESS`, `PARTICIPANT`, `DYNAMIC_PARTICIPANT`, `OR_SPLIT`, `AND_SPLIT`, `AND_JOIN`, `EXTERNAL_PROCESS` |
| `WorkflowNode` | `getMetaData()` | `MetaDataMap` of step args (e.g. `PROCESS`, `PARTICIPANT`) |
| `WorkflowTransition` | `getRule()` | ECMA/Groovy rule string (for OR splits) |

## WorkItem

| Method | Purpose |
|---|---|
| `getWorkflowData()` | Get `WorkflowData` (payload + instance metadata) |
| `getMetaDataMap()` | Step-scoped metadata (not shared across steps) |
| `getNode()` | The `WorkflowNode` this work item is at |
| `getWorkflow()` | The `Workflow` instance |
| `getId()` | Unique work item ID |
