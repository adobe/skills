# Model Design Patterns — AEM Workflow

## Pattern 1: Linear (Process → Approve → Publish)

```
START → [PROCESS: Validate] → [PARTICIPANT: Review] → [PROCESS: Activate] → END
```

Use for: simple content approval with no branching.

Key metaData on Participant: `PARTICIPANT=content-reviewers`, `allowInboxSharing=true`

After the Participant step, the reviewer selects **Approve** or **Reject** route in their Inbox. The default forward route advances to the next step.

---

## Pattern 2: Decision Branch (OR_SPLIT)

```
START → [PARTICIPANT: Review] → [OR_SPLIT] ──approve──→ [PROCESS: Activate] → END
                                           └──reject───→ [PROCESS: Notify]   → END
```

OR_SPLIT transition rules (ECMAScript / Rhino). Wrap Java string returns with `String(...)` and use strict equality (`===`) — Rhino's `==` between a Java String and a JS literal works through coercion but is fragile and inconsistent with the sibling skill's style.
```javascript
// Approve transition
function check() {
    return 'APPROVE' === String(workflowData.getMetaDataMap().get('reviewDecision', ''));
}
// Reject transition (catch-all)
function check() { return true; }
```

The PARTICIPANT step must store the decision in metadata before completing:
```java
item.getWorkflowData().getMetaDataMap().put("reviewDecision", "APPROVE");
List<Route> routes = session.getRoutes(item, false);
Route approveRoute = routes.stream()
    .filter(r -> "Approve".equalsIgnoreCase(r.getName()))
    .findFirst()
    .orElse(routes.get(0));
session.complete(item, approveRoute);
```

---

## Pattern 3: Parallel Review (AND_SPLIT / AND_JOIN)

```
START → [AND_SPLIT] ──→ [PARTICIPANT: Legal]    ──→ [AND_JOIN] → [PROCESS: Publish] → END
                    └──→ [PARTICIPANT: Marketing] ──→
```

Both PARTICIPANT steps run simultaneously. AND_JOIN waits for both before continuing.

---

## Pattern 4: Retry Loop (Goto Step)

```
START → [PROCESS: Validate] → [PROCESS: Goto?] ──true (retry)──→ [PROCESS: Validate]
                                                └──false──────→ END
```

Goto Step evaluates a rule. If retryCount < 3, redirects to Validate node; otherwise falls through.

```java
// In Validate step: increment counter. Use Long consistently — MetaDataMap
// is type-strict, and mixing Integer/Long across steps throws ClassCastException.
Long count = meta.get("retryCount", 0L);
meta.put("retryCount", count + 1L);
// If validation succeeds, put "retryDone=true"
```

Goto Step ECMAScript (Rhino) rule:
```javascript
function check() {
    // MetaDataMap is type-strict. When Java stored Long, calling
    // get(key, 0) from Rhino casts against the default's class (Double in
    // Rhino) and can throw ClassCastException. Read raw, then longValue()
    // for a clean numeric compare that survives both step types.
    var raw = workflowData.getMetaDataMap().get('retryCount');
    var count = raw != null ? raw.longValue() : 0;
    return count < 3 && !workflowData.getMetaDataMap().get('retryDone', false);
}
```

---

## Pattern 5: Task Manager Integration

```
START → [PROCESS: TaskWorkflowProcess (SUSPEND)] → [PROCESS: Post-Approval] → END
```

`TaskWorkflowProcess` creates an Inbox Task, stores `taskId` in metadata, and **suspends** the workflow (`PROCESS_AUTO_ADVANCE=false`). When the user completes the task, `TaskEventListener` advances the workflow automatically.

Configure the step as a PROCESS node referencing the OOTB `Task Manager Step` (design-time `flow` layer format):
```xml
<approvecontent
    jcr:primaryType="nt:unstructured"
    jcr:title="Approve Content"
    sling:resourceType="cq/workflow/components/model/process">
  <metaData
      jcr:primaryType="nt:unstructured"
      PROCESS="Task Manager Step"
      PROCESS_AUTO_ADVANCE="false"
      taskTitle="Approve content for publication"
      taskDescription="Review the page and approve or reject."
      taskInstructions="Click Approve to publish, Reject to send back to author."
      taskOwner="content-reviewers"
      taskPriority="medium"/>
</approvecontent>
```

- `PROCESS="Task Manager Step"` — OOTB label (FQCN: `com.adobe.granite.taskmanagement.impl.workflow.TaskWorkflowProcess`).
- `PROCESS_AUTO_ADVANCE="{Boolean}false"` is required — the engine must hold here while the human acts.
- `taskOwner` is a JCR principal name (user ID or group ID).
- After the user completes the task, `TaskEventListener` writes `lastTaskAction` and `lastTaskCompletedBy` to instance metadata; route by `lastTaskAction` in a downstream OR_SPLIT.

Post-approval step reads the task result:
```java
String action = meta.get("lastTaskAction", "UNKNOWN");  // e.g. "APPROVE"
String completedBy = meta.get("lastTaskCompletedBy", "unknown");
```

---

## Pattern 6: Workflow Variables for Inter-Step Data

Variables are declared in the runtime model at `/var/workflow/models/<id>/` after Sync, via the
Workflow Model Editor's variable configuration panel. They are not part of the design-time `flow`
layer at `/conf`. The `cq:VariableTemplate` JCR structure below is what AEM stores in the runtime
model — do not hand-author it in a content package:

```xml
<!-- Runtime /var model only — managed by AEM after Sync -->
<variables jcr:primaryType="nt:unstructured">
  <reviewDecision jcr:primaryType="cq:VariableTemplate"
      varName="reviewDecision" varType="java.lang.String"/>
</variables>
```

Write in step 1:
```java
item.getWorkflowData().getMetaDataMap().put("reviewDecision", "APPROVE");
```

Read in step 2 / OR_SPLIT rule:
```java
String decision = item.getWorkflowData().getMetaDataMap().get("reviewDecision", "");
```
