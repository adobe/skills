# Model XML Reference — AEM Workflow (6.5 LTS)

## Full Model Structure (canonical `/conf` form)

A `/conf`-based workflow model is a `cq:Page` whose `jcr:content` carries a `cq:WorkflowModel` child named `model`. The `cq:template` and `sling:resourceType` values are required — wrong values produce a model that opens differently in the Workflow Model Editor or fails to sync.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root
    xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
    xmlns:cq="http://www.day.com/jcr/cq/1.0"
    xmlns:jcr="http://www.jcp.org/jcr/1.0"
    xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
    jcr:primaryType="cq:Page">
  <jcr:content
      cq:template="/libs/settings/workflow/templates/model"
      jcr:primaryType="cq:PageContent"
      jcr:title="My Workflow"
      sling:resourceType="cq/workflow/components/pages/model">
    <model
        jcr:primaryType="cq:WorkflowModel"
        jcr:title="My Workflow"
        description="What this workflow does"
        sling:resourceType="cq/workflow/components/model">

      <metaData jcr:primaryType="nt:unstructured"/>

      <variables jcr:primaryType="nt:unstructured">
        <approvalStatus
            jcr:primaryType="cq:VariableTemplate"
            varName="approvalStatus"
            varType="java.lang.String"/>
      </variables>

      <nodes jcr:primaryType="nt:unstructured">
        <node0 jcr:primaryType="cq:WorkflowNode" title="Start" type="START">
          <metaData jcr:primaryType="nt:unstructured"/>
        </node0>

        <node1
            jcr:primaryType="cq:WorkflowNode"
            title="My Step"
            type="PROCESS">
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

      <transitions jcr:primaryType="nt:unstructured">
        <t1 jcr:primaryType="cq:WorkflowTransition" from="node0" to="node1" rule=""/>
        <t2 jcr:primaryType="cq:WorkflowTransition" from="node1" to="node2" rule=""/>
      </transitions>
    </model>
  </jcr:content>
</jcr:root>
```

Common pitfalls — do not use any of these; they look plausible but are wrong:

- ❌ `cq:template="/libs/settings/workflow/templates/workflow-model"` — no such template.
- ❌ `cq:template="/libs/cq/workflow/templates/model"` — legacy `/etc`-era template; resolves on some instances but is not the canonical `/conf` template.
- ❌ Missing the `model` child node and putting `nodes` / `transitions` directly under `jcr:content`.
- ❌ Putting `<jcr:primaryType="cq:WorkflowModel">` at the top level of the file without the `cq:Page` and `cq:PageContent` wrappers — Sync will run but the Workflow Model Editor will not load the model.

## File Locations (6.5 LTS)

The XML above is a single file representing the entire `cq:Page` subtree:

```
ui.content/src/main/content/jcr_root/

Option A — /conf (recommended, requires Sync):
└── conf/global/settings/workflow/models/my-workflow/.content.xml

Option B — /etc (legacy, auto-deployed):
└── etc/workflow/models/my-workflow/.content.xml
```

## Property Reference

### cq:WorkflowNode metaData Properties

| Property | Applies to | Purpose |
|---|---|---|
| `PROCESS` | PROCESS | FQCN or process.label |
| `PROCESS_AUTO_ADVANCE` | PROCESS | Boolean: auto advance or hold |
| `PARTICIPANT` | PARTICIPANT | JCR principal name |
| `DYNAMIC_PARTICIPANT` | DYNAMIC_PARTICIPANT | chooser.label value |
| `DESCRIPTION` | PARTICIPANT | Instruction in inbox |
| `allowInboxSharing` | PARTICIPANT | Show to all group members |
| `allowExplicitSharing` | PARTICIPANT | Allow explicit inbox sharing |

### cq:VariableTemplate Properties

| Property | Java Type |
|---|---|
| `java.lang.String` | String |
| `java.lang.Long` | Long |
| `java.lang.Boolean` | Boolean |
| `java.util.Date` | Date |
| `java.util.ArrayList` | ArrayList |
| `java.util.HashMap` | HashMap |

## OOTB Process Steps (6.5 LTS)

| process.label | FQCN | Purpose |
|---|---|---|
| `Activate Page` | `com.day.cq.wcm.workflow.process.ActivatePageProcess` | Replicate to publish |
| `Deactivate Page` | `com.day.cq.wcm.workflow.process.DeactivatePageProcess` | Remove from publish |
| `Create Version` | `com.day.cq.wcm.workflow.process.CreateVersionProcess` | JCR version |
| `Set Variable Step` | `com.adobe.granite.workflow.core.process.SetVariableProcess` | Set workflow variable |
| `Goto Step` | `com.adobe.granite.workflow.core.process.GotoProcess` | Loop-back redirect |
| `Lock Payload Process` | `com.adobe.granite.workflow.core.process.LockProcess` | JCR lock |
| `Unlock Payload Process` | `com.adobe.granite.workflow.core.process.UnlockProcess` | Remove JCR lock |
| `Task Manager Step` | `com.adobe.granite.taskmanagement.impl.workflow.TaskWorkflowProcess` | Create Inbox task |

### SetVariableProcess Argument Modes

`Set Variable Step` supports seven assignment modes via step metaData. Configure on the PROCESS node's `<metaData>`. Use this OOTB step instead of writing a custom `WorkflowProcess` for simple value assignment.

| Mode | Source |
|---|---|
| `LITERAL` | A literal string value (e.g., `"APPROVED"`) |
| `RELATIVE_TO_PAYLOAD` | JCR property relative to the payload (e.g., `jcr:title`) |
| `ABSOLUTE_PATH` | Full JCR path to a property |
| `EXPRESSION` | ECMAScript expression evaluated against `workflowData` |
| `VARIABLE` | Another workflow variable's value |
| `JSON_DOT_NOTATION` | JSON path like `data.response.status` (over a JSON-typed variable) |
| `XPATH` | XPath over an XML-typed variable |
