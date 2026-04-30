# Step Types Catalog — AEM Workflow (Cloud Service)

This catalog documents the design-time format for workflow steps in the `flow/parsys` layer at
`/conf/global/settings/workflow/models/<id>/jcr:content/flow/`. Steps are `nt:unstructured` nodes
whose type is expressed by `sling:resourceType`, not a `type=` property or `cq:WorkflowNode`
primary type.

After Cloud Manager pipeline installation, click **Sync** in the Workflow Model Editor to generate
the runtime model at `/var/workflow/models/`. Sync adds START/END nodes and derives transitions from
the step sequence and step component configuration.

## sling:resourceType Reference

| Step type | sling:resourceType |
|---|---|
| Initiator Participant Chooser | `cq/workflow/components/workflow/initiatorparticipantchooser` |
| PROCESS | `cq/workflow/components/model/process` |
| PARTICIPANT | `cq/workflow/components/model/participant` |
| DYNAMIC_PARTICIPANT | `cq/workflow/components/model/dynamic_participant` |
| OR_SPLIT | `cq/workflow/components/model/or` |
| AND_SPLIT | `cq/workflow/components/model/AND_split` |
| AND_JOIN | `cq/workflow/components/model/AND_join` |
| EXTERNAL_PROCESS | `cq/workflow/components/model/external_process` |
| END | `cq/workflow/components/model/end` |

## Initiator Participant Chooser (AEM default first step)

AEM's Workflow Model Editor pre-inserts this as "Step 1" when a new model is created. It is a
Dynamic Participant step backed by `/libs/workflow/scripts/initiator-participant-chooser.ecma`,
which resolves to the user who triggered the workflow. Include it when the workflow needs to assign
a task back to the initiator. Not required in every model.

```xml
<initiatorparticipant
    jcr:primaryType="nt:unstructured"
    jcr:title="Step 1"
    jcr:description="Description of step 1"
    sling:resourceType="cq/workflow/components/workflow/initiatorparticipantchooser">
  <metaData
      jcr:primaryType="nt:unstructured"
      DYNAMIC_PARTICIPANT="/libs/workflow/scripts/initiator-participant-chooser.ecma"
      PROCESS_AUTO_ADVANCE="true"/>
</initiatorparticipant>
```

## PROCESS Node (Auto-executed Java Step)

```xml
<sendnotification
    jcr:primaryType="nt:unstructured"
    jcr:title="Send Notification"
    jcr:description="Sends an email to the assignee"
    sling:resourceType="cq/workflow/components/model/process">
  <metaData
      jcr:primaryType="nt:unstructured"
      PROCESS="com.example.workflow.SendNotificationProcess"
      PROCESS_AUTO_ADVANCE="true"
      recipient="workflow-administrators"
      subject="Content ready for review"/>
</sendnotification>
```

- `PROCESS`: fully-qualified class name or `process.label` value of the registered OSGi service
- `PROCESS_AUTO_ADVANCE`: `"true"` = auto-advance after execute(); `"false"` = step holds
- Additional metaData keys = step arguments accessible via `MetaDataMap args` in `execute()`

## PARTICIPANT Node (Static Human Task)

```xml
<contentreview
    jcr:primaryType="nt:unstructured"
    jcr:title="Content Review"
    sling:resourceType="cq/workflow/components/model/participant">
  <metaData
      jcr:primaryType="nt:unstructured"
      PARTICIPANT="content-reviewers"
      DESCRIPTION="Please review the content and approve or reject"
      allowInboxSharing="true"
      allowExplicitSharing="true"/>
</contentreview>
```

- `PARTICIPANT`: JCR principal name (user ID or group ID)
- `allowInboxSharing`: shows work item in all group members' inboxes
- User completes by selecting a route in the Inbox (Approve / Reject / custom)

## DYNAMIC_PARTICIPANT Node (Runtime-Resolved Human Task)

```xml
<managerapproval
    jcr:primaryType="nt:unstructured"
    jcr:title="Manager Approval"
    sling:resourceType="cq/workflow/components/model/dynamic_participant">
  <metaData
      jcr:primaryType="nt:unstructured"
      DYNAMIC_PARTICIPANT="Department Manager Chooser"
      fallbackGroup="workflow-administrators"/>
</managerapproval>
```

- `DYNAMIC_PARTICIPANT`: must match the `chooser.label` property of a registered
  `ParticipantStepChooser` OSGi service
- Additional metaData keys = args passed to `getParticipant()`

## OR_SPLIT Node (Decision Branch)

```xml
<approvaldecision
    jcr:primaryType="nt:unstructured"
    jcr:title="Approval Decision"
    sling:resourceType="cq/workflow/components/model/or">
  <metaData jcr:primaryType="nt:unstructured"/>
</approvaldecision>
```

OR_SPLIT routing rules (ECMAScript / Rhino) are configured on the outgoing transitions in the
runtime model. After Sync, open the model in the Workflow Model Editor and configure the route
rules on each outgoing arrow from the OR_SPLIT node. Rules use `workflowData.getMetaDataMap()` to
read step-set values. Use `String(...)` and strict equality (`===`) to avoid Rhino coercion issues:

```javascript
// Approve route
function check() {
    return 'APPROVE' === String(workflowData.getMetaDataMap().get('reviewDecision', ''));
}
// Catch-all / reject route
function check() { return true; }
```

## AND_SPLIT / AND_JOIN (Parallel Branches)

```xml
<!-- AND_SPLIT: fans out to all connected outgoing steps -->
<startparallelreview
    jcr:primaryType="nt:unstructured"
    jcr:title="Start Parallel Review"
    sling:resourceType="cq/workflow/components/model/AND_split">
  <metaData jcr:primaryType="nt:unstructured"/>
</startparallelreview>

<!-- AND_JOIN: waits for all incoming branches before continuing -->
<synchronize
    jcr:primaryType="nt:unstructured"
    jcr:title="Synchronize"
    sling:resourceType="cq/workflow/components/model/AND_join">
  <metaData jcr:primaryType="nt:unstructured"/>
</synchronize>
```

All outgoing transitions from AND_SPLIT execute in parallel. Workflow pauses at AND_JOIN until all
branches complete.

## EXTERNAL_PROCESS Node (Polling Step)

```xml
<waitfordamprocessing
    jcr:primaryType="nt:unstructured"
    jcr:title="Wait for DAM Processing"
    sling:resourceType="cq/workflow/components/model/external_process">
  <metaData
      jcr:primaryType="nt:unstructured"
      EXTERNAL_PROCESS="com.example.workflow.DamProcessingExternalStep"
      pollingInterval="30000"/>
</waitfordamprocessing>
```

`WorkflowExternalProcess` SPI — the engine polls at `pollingInterval` ms until the process signals
completion. `pollingInterval` is stored as a plain string in the design-time `flow` layer.

## END Node

```xml
<workflowend
    jcr:primaryType="nt:unstructured"
    jcr:title="End"
    sling:resourceType="cq/workflow/components/model/end">
  <metaData jcr:primaryType="nt:unstructured"/>
</workflowend>
```

Multiple branches can converge to the same END node. Sync also inserts a START node automatically
— you do not need to declare it in the design-time `flow` layer.

## Goto Step (OOTB Loop-back PROCESS Node)

`Goto Step` is an OOTB PROCESS step that re-routes execution back to an earlier step when its
rule returns true. Always enforce a hard cap on the retry counter.

```xml
<retryvalidate
    jcr:primaryType="nt:unstructured"
    jcr:title="Retry Validate?"
    sling:resourceType="cq/workflow/components/model/process">
  <metaData
      jcr:primaryType="nt:unstructured"
      PROCESS="Goto Step"
      PROCESS_AUTO_ADVANCE="true"
      targetStep="validate"/>
</retryvalidate>
```

- `PROCESS`: `"Goto Step"` (label) or `com.adobe.granite.workflow.core.process.GotoProcess` (FQCN)
- `targetStep`: node name of the step in the `flow` layer to redirect to
- Goto rules are configured on the outgoing transition in the runtime model after Sync
- Always cap the retry counter (`count < 3`). An uncapped Goto pins a worker thread

## Task Manager Step (Inbox Task + Workflow Suspend)

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

- `PROCESS="Task Manager Step"` — OOTB label (FQCN: `com.adobe.granite.taskmanagement.impl.workflow.TaskWorkflowProcess`)
- `PROCESS_AUTO_ADVANCE="false"` is required — the engine holds here while the human acts
- `taskOwner` is a JCR principal name (user ID or group ID)
- After task completion, `TaskEventListener` writes `lastTaskAction` and `lastTaskCompletedBy` to
  instance metadata; route by `lastTaskAction` in a downstream OR_SPLIT

## OOTB Process Labels Reference (Cloud Service)

| process.label | Purpose |
|---|---|
| `Create Version` | Creates a JCR version of the payload |
| `Set Variable Step` | Assigns workflow variable from literal/expression/JCR |
| `Goto Step` | Loop-back redirect if rule evaluates true |
| `Lock Payload Process` | JCR-locks the payload node |
| `Unlock Payload Process` | Removes JCR lock from payload |
| `Task Manager Step` | Creates Inbox task and suspends workflow |

> `Activate Page` / `Deactivate Page` are 6.5 LTS only and must not be used on AEMaaCS.
