# Model XML Reference — AEM Workflow (Cloud Service)

## Full Model Structure

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root
    xmlns:cq="http://www.day.com/jcr/cq/1.0"
    xmlns:jcr="http://www.jcp.org/jcr/1.0"
    xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
    jcr:primaryType="cq:WorkflowModel"
    jcr:title="My Workflow Title"
    description="What this workflow does">

  <!-- Optional: workflow variables -->
  <variables jcr:primaryType="nt:unstructured">
    <approvalStatus
        jcr:primaryType="cq:VariableTemplate"
        varName="approvalStatus"
        varType="java.lang.String"/>
    <reviewerList
        jcr:primaryType="cq:VariableTemplate"
        varName="reviewerList"
        varType="java.util.ArrayList"/>
  </variables>

  <!-- Step nodes -->
  <nodes jcr:primaryType="nt:unstructured">
    <node0 jcr:primaryType="cq:WorkflowNode" title="Start" type="START">
      <metaData jcr:primaryType="nt:unstructured"/>
    </node0>

    <node1
        jcr:primaryType="cq:WorkflowNode"
        title="My Step"
        type="PROCESS"
        description="Optional description">
      <metaData
          jcr:primaryType="nt:unstructured"
          PROCESS="com.example.workflow.MyProcess"
          PROCESS_AUTO_ADVANCE="{Boolean}true"
          myArg="argValue"/>
    </node1>

    <node2 jcr:primaryType="cq:WorkflowNode" title="End" type="END">
      <metaData jcr:primaryType="nt:unstructured"/>
    </node2>
  </nodes>

  <!-- Transitions connect nodes -->
  <transitions jcr:primaryType="nt:unstructured">
    <t1 jcr:primaryType="cq:WorkflowTransition"
        from="node0" to="node1" rule=""/>
    <t2 jcr:primaryType="cq:WorkflowTransition"
        from="node1" to="node2" rule=""/>
  </transitions>
</jcr:root>
```

## Property Reference

### cq:WorkflowModel Properties

| Property | Type | Purpose |
|---|---|---|
| `jcr:primaryType` | String | Must be `cq:WorkflowModel` |
| `jcr:title` | String | Display name in model picker |
| `description` | String | Optional description |

### cq:WorkflowNode Properties

| Property | Type | Purpose |
|---|---|---|
| `jcr:primaryType` | String | Must be `cq:WorkflowNode` |
| `title` | String | Display label in editor |
| `type` | String | Node type constant (e.g. `PROCESS`, `PARTICIPANT`) |
| `description` | String | Optional step description |

### cq:WorkflowNode metaData Properties

| Property | Type | Applies to | Purpose |
|---|---|---|---|
| `PROCESS` | String | PROCESS | FQCN or process.label of WorkflowProcess |
| `PROCESS_AUTO_ADVANCE` | Boolean | PROCESS | true = auto advance, false = hold |
| `PARTICIPANT` | String | PARTICIPANT | JCR principal name |
| `DYNAMIC_PARTICIPANT` | String | DYNAMIC_PARTICIPANT | chooser.label value |
| `DESCRIPTION` | String | PARTICIPANT | Instruction shown to user in inbox |
| `allowInboxSharing` | Boolean | PARTICIPANT | Show to all group members |
| `allowExplicitSharing` | Boolean | PARTICIPANT | Allow inbox sharing delegation |
| `PROCESS_ARGS` | String | PROCESS | Legacy comma-separated args string |
| `PERSIST_ANONYMOUS_WORKITEM` | Boolean | PROCESS | Persist transient work item |

### cq:WorkflowTransition Properties

| Property | Type | Purpose |
|---|---|---|
| `jcr:primaryType` | String | Must be `cq:WorkflowTransition` |
| `from` | String | Node ID of source |
| `to` | String | Node ID of destination |
| `rule` | String | ECMA/Groovy rule (empty = always true) |

### cq:VariableTemplate Properties

| Property | Type | Purpose |
|---|---|---|
| `varName` | String | Variable name (used in MetaDataMap) |
| `varType` | String | Java FQCN: `java.lang.String`, `java.lang.Long`, `java.lang.Boolean`, `java.util.Date`, `java.util.ArrayList`, `java.util.HashMap` |

## File Location (Cloud Service)

```
ui.content/src/main/content/jcr_root/
└── conf/global/settings/workflow/models/
    └── my-workflow/
        └── jcr:content/
            └── model/
                └── .content.xml   ← cq:WorkflowModel root
```

> Use `.content.xml` (Sling Docview format) for content packages, as shown above.
