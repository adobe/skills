# Workflow API Reference — AEM 6.5 LTS

## WorkflowProcess (SPI)

```java
// com.adobe.granite.workflow.exec.WorkflowProcess
public interface WorkflowProcess {
    void execute(WorkItem item, WorkflowSession session, MetaDataMap args)
            throws WorkflowException;
}
```

**Registration (DS R6 — preferred):**
```java
@Component(service=WorkflowProcess.class, property={"process.label=My Label"})
public class MyProcess implements WorkflowProcess { ... }
```

**Registration (Felix SCR — still valid on 6.5):**
```java
@Component(metatype=false)
@Service(value=WorkflowProcess.class)
@Property(name="process.label", value="My Label")
public class MyProcess implements WorkflowProcess { ... }
```

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

Return value: a valid JCR `rep:principalName` (user ID or group ID).

## WorkflowSession (API)

Obtain via `resourceResolver.adaptTo(WorkflowSession.class)`.

| Method | Purpose |
|---|---|
| `startWorkflow(model, data)` | Start a new workflow instance |
| `getModel(id)` | Get deployed model by `/var/workflow/models/<name>` path |
| `deployModel(model)` | Sync design-time model to runtime (`/var/workflow/models/`) |
| `newWorkflowData(type, payload)` | Create `WorkflowData` for `JCR_PATH` or `BLOB` |
| `getWorkflows(filter)` | Query instances by state |
| `complete(workItem, route)` | Advance a participant step |
| `terminate(workflow)` | Abort a running workflow |
| `suspend(workflow)` / `resume(workflow)` | Pause/resume |

## WorkflowData

```java
WorkflowData data = session.newWorkflowData("JCR_PATH", "/content/mypage");
data.getMetaDataMap().put("initiatorNote", "from batch");
Workflow instance = session.startWorkflow(model, data);
```

## MetaDataMap

`com.adobe.granite.workflow.metadata.MetaDataMap` — typed property bag, persisted with the workflow instance.

```java
MetaDataMap meta = item.getWorkflowData().getMetaDataMap();
String status = meta.get("status", "PENDING");  // with default
meta.put("status", "APPROVED");
```

## WorkItem

| Method | Purpose |
|---|---|
| `getWorkflowData()` | Instance-level data (payload + shared metadata) |
| `getMetaDataMap()` | Step-scoped metadata |
| `getNode()` | Current `WorkflowNode` |
| `getWorkflow()` | `Workflow` instance |

## WorkflowModel Graph

| Interface | Method | Purpose |
|---|---|---|
| `WorkflowModel` | `getId()` | `/var/workflow/models/<name>` path |
| `WorkflowModel` | `getNodes()` | All `WorkflowNode` objects |
| `WorkflowNode` | `getType()` | `START`, `END`, `PROCESS`, `PARTICIPANT`, `DYNAMIC_PARTICIPANT`, `OR_SPLIT`, `AND_SPLIT`, `AND_JOIN` |
| `WorkflowNode` | `getMetaData()` | Step configuration (`PROCESS`, `PARTICIPANT`, etc.) |
| `WorkflowTransition` | `getRule()` | ECMA/Groovy rule string for OR splits |
