# Variables and Metadata — AEM Workflow Development

## Two Metadata Scopes

| Scope | Access | Lifespan |
|---|---|---|
| Instance metadata | `item.getWorkflowData().getMetaDataMap()` | Entire workflow instance (shared across all steps) |
| Step metadata | `item.getMetaDataMap()` | Current step only (not shared) |

Both implement `com.adobe.granite.workflow.metadata.MetaDataMap`.

## Workflow Variables (Declared)

Declare on the model using `cq:VariableTemplate` nodes. Type-safe at design time.

Supported types: `String`, `Long`, `Double`, `Boolean`, `Date`, `ArrayList`, `HashMap`, XML (`Document`), JSON (`JsonObject`).

```java
// Write
MetaDataMap meta = item.getWorkflowData().getMetaDataMap();
meta.put("approvalStatus", "APPROVED");
meta.put("retryCount", 3L);
meta.put("dueDate", new Date());

// Read with default
String status = meta.get("approvalStatus", "PENDING");
Long count = meta.get("retryCount", 0L);
Boolean flag = meta.get("contentFlagged", false);
ArrayList<?> reviewers = meta.get("reviewerList", ArrayList.class);
```

## Inter-Step Communication Pattern

```java
// Step 1: Resolve reviewer group and store
String group = resolveReviewerGroup(payloadPath);
metadata.put("reviewerGroup", group);

// Step 2 (Dynamic Participant Chooser): Read
public String getParticipant(WorkItem item, WorkflowSession session, MetaDataMap args) {
    return item.getWorkflowData().getMetaDataMap()
               .get("reviewerGroup", "content-authors");
}

// Step 3: Read review result set by TaskEventListener
String decision = metadata.get("lastTaskAction", "UNKNOWN");
String reviewer = metadata.get("lastTaskCompletedBy", "unknown");
```

## Engine-Reserved Metadata Keys

| Key | Set by | Meaning |
|---|---|---|
| `initiator` | Engine on start | User ID who started the workflow |
| `workflowTitle` | Engine | Display title of the workflow instance |
| `lastTaskAction` | TaskEventListener | Completed task's action (APPROVE, REJECT, custom) |
| `lastTaskCompletedBy` | TaskEventListener | User who completed the task |
| `taskId` | TaskWorkflowProcess | ID of the created task |
| `workItemId` | TaskWorkflowProcess | Work item ID for task correlation |

## Set Variable Step (OOTB SetVariableProcess)

Use instead of custom code when assignment logic is simple:

| Assignment mode | `variableName` arg | Source |
|---|---|---|
| `LITERAL` | `"approvalStatus"` | A literal string `"APPROVED"` |
| `RELATIVE_TO_PAYLOAD` | `"payloadTitle"` | JCR property relative to payload (e.g. `jcr:title`) |
| `ABSOLUTE_PATH` | `"result"` | Full JCR path to a property |
| `EXPRESSION` | `"computed"` | ECMAScript expression |
| `VARIABLE` | `"copy"` | Another variable's value |
| `JSON_DOT_NOTATION` | `"field"` | JSON path like `data.response.status` |
| `XPATH` | `"xmlField"` | XPath over an XML-typed variable |

## OR_SPLIT After a Participant Step (Approve / Reject Routing)

The `TaskEventListener` writes `lastTaskAction` to instance metadata when a participant completes a task. Use it as the OR_SPLIT condition immediately after the participant step.

Model transitions (ECMAScript rules):

```xml
<!-- Participant produced lastTaskAction; route by value -->
<transitionApprove
    jcr:primaryType="cq:WorkflowTransition"
    from="participantNode"
    to="approveProcessNode"
    rule="function check(){ return 'APPROVE' === String(workflowData.getMetaDataMap().get('lastTaskAction','')); }"/>

<transitionReject
    jcr:primaryType="cq:WorkflowTransition"
    from="participantNode"
    to="rejectProcessNode"
    rule="function check(){ return 'REJECT' === String(workflowData.getMetaDataMap().get('lastTaskAction','')); }"/>
```

OR_SPLIT transitions are evaluated in document order; the first rule that returns `true` fires. Always provide a second branch — never rely on Approve being the only outcome. For unknown / custom action IDs, keep a default branch with `rule="function check(){ return true; }"` last.

Common mistake: collapsing both Approve and Reject into a single downstream PROCESS step that branches in Java. Do not do this — the model editor will not show the two outcomes, and reviewers cannot reason about the workflow visually.

## Goto Step for Retry Loops (OOTB GotoProcess)

Workflow rules (OR_SPLIT branches, Goto, launcher conditions) are evaluated as **ECMAScript** (Rhino) on AEM 6.5 LTS. Groovy is not supported for workflow rules.

```javascript
// OR_SPLIT / PROCESS Goto rule — ECMAScript
function check() {
    var count = workflowData.getMetaDataMap().get("retryCount", 0);
    return count < 3 && !workflowData.getMetaDataMap().get("processingDone", false);
}
```

Increment counter in preceding step:
```java
int count = metadata.get("retryCount", 0);
metadata.put("retryCount", count + 1);
```
