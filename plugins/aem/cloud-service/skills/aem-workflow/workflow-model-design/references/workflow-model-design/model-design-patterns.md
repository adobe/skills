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

OR_SPLIT transition rules (ECMAScript / Rhino — wrap Java string returns with `String(...)` and use strict equality `===` for safety):
```javascript
// Approve transition
function check() {
    return workflowData.getMetaDataMap().get("reviewDecision", "") == "APPROVE";
}
// Reject transition (catch-all)
function check() { return true; }
```

The PARTICIPANT step must store the decision in metadata before completing:
```java
item.getWorkflowData().getMetaDataMap().put("reviewDecision", "APPROVE");
session.complete(item, routes.get(0));
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
// In Validate step: increment counter
int count = meta.get("retryCount", 0);
meta.put("retryCount", count + 1);
// If validation succeeds, put "retryDone=true"
```

Goto Step ECMAScript (Rhino) rule:
```javascript
function check() {
    var count = workflowData.getMetaDataMap().get("retryCount", 0);
    return count < 3 && workflowData.getMetaDataMap().get("retryDone", false) == false;
}
```

---

## Pattern 5: Task Manager Integration

```
START → [PROCESS: TaskWorkflowProcess (SUSPEND)] → [PROCESS: Post-Approval] → END
```

`TaskWorkflowProcess` creates an Inbox Task, stores `taskId` in metadata, and **suspends** the workflow (`PROCESS_AUTO_ADVANCE=false`). When the user completes the task, `TaskEventListener` advances the workflow automatically.

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
