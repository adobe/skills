# Model XML Reference — AEM Workflow (6.5 LTS)

## Design-time vs Runtime

AEM 6.5 LTS separates workflow model storage into two layers at distinct paths. Never mix them.

| Layer | Path | Format | Managed by |
|---|---|---|---|
| Design-time | `/conf/global/settings/workflow/models/<id>/` | `cq:Page` → `jcr:content` → `flow` (parsys components) | Content package + editor |
| Runtime | `/var/workflow/models/<id>/` | `cq:WorkflowModel` → `nodes` + `transitions` | AEM Sync (automatic) |

A content package delivers the **design-time** layer only. After installation, an operator opens the model in the Workflow Model Editor and clicks **Sync** to generate the runtime layer at `/var`. Sync also adds the implicit START and END nodes and derives transitions from the step sequence and step component configuration.

## Full Model Structure (canonical `/conf` form)

A `/conf`-based workflow model is a `cq:Page` whose `jcr:content` carries a `flow` node of type `nt:unstructured` with `sling:resourceType="foundation/components/parsys"`. Each workflow step is a direct named child of `flow`, also `nt:unstructured`, with a `sling:resourceType` that identifies the step type. The `cq:template` and `sling:resourceType` values on `jcr:content` are required — wrong values produce a model that opens incorrectly in the Workflow Model Editor or fails to Sync.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root
    xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
    xmlns:cq="http://www.day.com/jcr/cq/1.0"
    xmlns:jcr="http://www.jcp.org/jcr/1.0"
    xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
    jcr:primaryType="cq:Page">
  <jcr:content
      cq:template="/libs/cq/workflow/templates/model"
      cq:designPath="/libs/settings/wcm/designs/default"
      jcr:primaryType="cq:PageContent"
      jcr:title="My Workflow"
      sling:resourceType="cq/workflow/components/pages/model">
    <flow
        jcr:primaryType="nt:unstructured"
        sling:resourceType="foundation/components/parsys">
      <!--
        Add step components here as direct children of flow.
        Use descriptive node names (not node0/node1).
        Step type is expressed by sling:resourceType, not a type= property.
        Transitions are NOT declared here — Sync derives them from step order
        and step component configuration.
      -->
      <mystep
          jcr:primaryType="nt:unstructured"
          jcr:title="My Step"
          jcr:description="What this step does"
          sling:resourceType="cq/workflow/components/model/process">
        <metaData
            jcr:primaryType="nt:unstructured"
            PROCESS="com.example.workflow.MyProcess"
            PROCESS_AUTO_ADVANCE="true"/>
      </mystep>
    </flow>
  </jcr:content>
</jcr:root>
```

See [step-types-catalog.md](./step-types-catalog.md) for the correct `sling:resourceType` and `metaData` structure for each step type.

Common pitfalls — do not use any of these; they look plausible but are wrong:

- ❌ `cq:template="/libs/settings/workflow/templates/model"` — wrong. The correct value confirmed from live AEM is `/libs/cq/workflow/templates/model`.
- ❌ Generating a `<model jcr:primaryType="cq:WorkflowModel">` node inside `jcr:content` at the `/conf` path — this is the runtime format that belongs at `/var/workflow/models/`, not the design-time format. The Workflow Model Editor cannot open models with this structure, and Sync cannot operate on them.
- ❌ Using `cq:WorkflowNode` as the step node type in the design-time model — steps at `/conf` must be `nt:unstructured` with `sling:resourceType`.
- ❌ Including `<transitions>` or `<nodes>` containers in the `/conf` model — these are not part of the design-time `flow` layer. Sync derives them automatically.
- ❌ Using sequential names `node0`, `node1` for step nodes — use descriptive slugs that match the step's purpose (e.g., `sendnotification`, `contentreview`, `approvaldecision`).
- ❌ Omitting the `<flow>` wrapper with `sling:resourceType="foundation/components/parsys"` — without this, the Workflow Model Editor cannot display the model canvas.
- ❌ Using `{Boolean}true` for `PROCESS_AUTO_ADVANCE` — in the design-time `flow` layer this property is stored as a plain string `"true"`, not a typed boolean.

## File Locations (6.5 LTS)

The XML above is a single file representing the entire `cq:Page` subtree:

```
ui.content/src/main/content/jcr_root/

Option A — /conf (recommended, requires Sync):
└── conf/global/settings/workflow/models/my-workflow/.content.xml

Option B — /etc (legacy, auto-deployed):
└── etc/workflow/models/my-workflow/.content.xml
```

For `/conf` models: after `mvn clean install -P autoInstallPackage`, open **Tools → Workflow → Models**, select the model, click **Edit**, then click **Sync**. Verify the model appears in `/var/workflow/models/` via CRX/DE and all steps render on the editor canvas before starting a test instance.

## Property Reference

### Step metaData Properties

These properties go inside the `<metaData jcr:primaryType="nt:unstructured"/>` child of each step node in the `flow` layer. The property names are the same regardless of whether you are looking at the design-time `flow` format or the runtime model.

| Property | Applies to | Purpose |
|---|---|---|
| `PROCESS` | PROCESS | FQCN or process.label of the registered OSGi service |
| `PROCESS_AUTO_ADVANCE` | PROCESS | String `"true"` = auto-advance; `"false"` = hold for external completion |
| `PARTICIPANT` | PARTICIPANT | JCR principal name (user ID or group ID) |
| `DYNAMIC_PARTICIPANT` | DYNAMIC_PARTICIPANT | chooser.label value or ECMAScript path |
| `DESCRIPTION` | PARTICIPANT | Instruction text shown in the Inbox |
| `allowInboxSharing` | PARTICIPANT | Show work item to all members of the assigned group |
| `allowExplicitSharing` | PARTICIPANT | Allow explicit inbox sharing |

### Workflow Variables

Variables are declared in the runtime model at `/var` after Sync, either via the Workflow Model Editor's variable configuration panel or by adding `cq:VariableTemplate` nodes to the synced model. They are not declared in the design-time `flow` layer.

### cq:VariableTemplate Properties (runtime `/var` model only)

| varType value | Java type |
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

`Set Variable Step` supports seven assignment modes via step metaData. Configure on the step node's `<metaData>`. Use this OOTB step instead of writing a custom `WorkflowProcess` for simple value assignment.

| Mode | Source |
|---|---|
| `LITERAL` | A literal string value (e.g., `"APPROVED"`) |
| `RELATIVE_TO_PAYLOAD` | JCR property relative to the payload (e.g., `jcr:title`) |
| `ABSOLUTE_PATH` | Full JCR path to a property |
| `EXPRESSION` | ECMAScript expression evaluated against `workflowData` |
| `VARIABLE` | Another workflow variable's value |
| `JSON_DOT_NOTATION` | JSON path like `data.response.status` (over a JSON-typed variable) |
| `XPATH` | XPath over an XML-typed variable |
