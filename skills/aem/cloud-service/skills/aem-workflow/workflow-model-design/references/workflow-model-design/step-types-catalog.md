# Step Types Catalog — AEM Workflow

## START Node

```xml
<node0
    jcr:primaryType="cq:WorkflowNode"
    title="Start"
    type="START">
  <metaData jcr:primaryType="nt:unstructured"/>
</node0>
```

One START node per model. All transitions originate from here.

## END Node

```xml
<node_end
    jcr:primaryType="cq:WorkflowNode"
    title="End"
    type="END">
  <metaData jcr:primaryType="nt:unstructured"/>
</node_end>
```

Terminal node. Multiple branches can converge to END.

## PROCESS Node (Auto-executed Java Step)

```xml
<node1
    jcr:primaryType="cq:WorkflowNode"
    title="Send Notification"
    type="PROCESS"
    description="Sends an email to the assignee">
  <metaData
      jcr:primaryType="nt:unstructured"
      PROCESS="com.example.workflow.SendNotificationProcess"
      PROCESS_AUTO_ADVANCE="{Boolean}true"
      recipient="workflow-administrators"
      subject="Content ready for review"/>
</node1>
```

- `PROCESS`: fully-qualified class name or `process.label` value of the registered OSGi service
- `PROCESS_AUTO_ADVANCE`: `true` = auto-advance after execute(); `false` = step holds (TaskWorkflowProcess pattern)
- Additional metaData keys = step arguments accessible via `MetaDataMap args` in `execute()`

## PARTICIPANT Node (Static Human Task)

```xml
<node2
    jcr:primaryType="cq:WorkflowNode"
    title="Content Review"
    type="PARTICIPANT">
  <metaData
      jcr:primaryType="nt:unstructured"
      PARTICIPANT="content-reviewers"
      DESCRIPTION="Please review the content and approve or reject"
      allowInboxSharing="{Boolean}true"
      allowExplicitSharing="{Boolean}true"/>
</node2>
```

- `PARTICIPANT`: JCR principal name (user ID or group ID)
- `allowInboxSharing`: shows work item in all group members' inboxes
- User completes by selecting a route in the Inbox (Approve / Reject / custom)

## DYNAMIC_PARTICIPANT Node (Runtime-Resolved Human Task)

```xml
<node3
    jcr:primaryType="cq:WorkflowNode"
    title="Manager Approval"
    type="DYNAMIC_PARTICIPANT">
  <metaData
      jcr:primaryType="nt:unstructured"
      DYNAMIC_PARTICIPANT="Department Manager Chooser"
      fallbackGroup="workflow-administrators"/>
</node3>
```

- `DYNAMIC_PARTICIPANT`: must match the `chooser.label` property of a registered `ParticipantStepChooser` OSGi service
- Additional metaData keys = args passed to `getParticipant()`

## OR_SPLIT Node (Decision Branch)

```xml
<node_split
    jcr:primaryType="cq:WorkflowNode"
    title="Approval Decision"
    type="OR_SPLIT">
  <metaData jcr:primaryType="nt:unstructured"/>
</node_split>

<!-- Transitions with rules — first matching transition wins -->
<t_approve
    jcr:primaryType="cq:WorkflowTransition"
    from="node_split"
    to="node_activate"
    rule="function check(){
        return workflowData.getMetaDataMap().get('decision','')=='APPROVE';
    }"/>
<t_reject
    jcr:primaryType="cq:WorkflowTransition"
    from="node_split"
    to="node_notify"
    rule="function check(){ return true; }"/>
```

Rules are ECMA (JavaScript). `workflowData` is the `WorkflowData` object. Use `get('key', defaultValue)` for safe reads.

## AND_SPLIT / AND_JOIN (Parallel Branches)

```xml
<!-- AND_SPLIT fans out to all connected outgoing transitions -->
<node_split
    jcr:primaryType="cq:WorkflowNode"
    title="Start Parallel Review"
    type="AND_SPLIT">
  <metaData jcr:primaryType="nt:unstructured"/>
</node_split>

<!-- AND_JOIN waits for all incoming branches to arrive -->
<node_join
    jcr:primaryType="cq:WorkflowNode"
    title="Synchronize"
    type="AND_JOIN">
  <metaData jcr:primaryType="nt:unstructured"/>
</node_join>
```

All outgoing transitions from AND_SPLIT execute. Workflow pauses at AND_JOIN until all branches complete.

## EXTERNAL_PROCESS Node (Polling Step)

```xml
<node_ext
    jcr:primaryType="cq:WorkflowNode"
    title="Wait for DAM Processing"
    type="EXTERNAL_PROCESS">
  <metaData
      jcr:primaryType="nt:unstructured"
      EXTERNAL_PROCESS="com.example.workflow.DamProcessingExternalStep"
      pollingInterval="{Long}30000"/>
</node_ext>
```

`WorkflowExternalProcess` SPI — the engine polls at `pollingInterval` ms until the process signals completion.

## OOTB Process Labels Reference

| process.label | Purpose |
|---|---|
| `Activate Page` | Replicates page to publish (6.5 LTS only) |
| `Deactivate Page` | Deactivates page from publish |
| `Create Version` | Creates a JCR version of the payload |
| `Set Variable Step` | Assigns workflow variable from literal/expression/JCR |
| `Goto Step` | Loop-back redirect if rule evaluates true |
| `Lock Payload Process` | JCR-locks the payload node |
| `Unlock Payload Process` | Removes JCR lock from payload |
| `Task Manager Step` | Creates Inbox task and suspends workflow |
