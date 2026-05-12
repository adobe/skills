# Model XML Reference — AEM Workflow (Cloud Service)

## Design-time vs Runtime

AEM as a Cloud Service separates workflow model storage into two layers at distinct paths. Never mix them.

| Layer | Path | Format | Managed by |
|---|---|---|---|
| Design-time | `/conf/global/settings/workflow/models/<id>/` | `cq:Page` → `jcr:content` → `flow` (parsys components) | Content package + editor |
| Runtime | `/var/workflow/models/<id>/` | `cq:WorkflowModel` → `nodes` + `transitions` | AEM Sync (automatic) |

A content package delivers the **design-time** layer only. After Cloud Manager pipeline installation, an operator opens the model in the Workflow Model Editor and clicks **Sync** to generate the runtime layer at `/var`. Sync also adds the implicit START and END nodes and derives transitions from the step sequence and step component configuration.

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

## Runtime Model Structure (what Sync generates at /var — never hand-author this)

After Sync, AEM writes the runtime model at `/var/workflow/models/<id>/`. Its shape is a mirror of
the `/conf` page wrapper but with `jcr:content` being a `cq:WorkflowModel` node instead of
`cq:PageContent`, and steps replaced by `cq:WorkflowNode` entries with a `type` property:

```
/var/workflow/models/<id>/          ← cq:Page (AEM-managed, never ship in a package)
└── jcr:content/                    ← cq:WorkflowModel  (jcr:content IS the model — no "model/" child)
    ├── nodes/  (nt:unstructured)
    │   ├── node0  cq:WorkflowNode  type=START
    │   ├── node1  cq:WorkflowNode  type=PROCESS / PARTICIPANT / OR_SPLIT / …
    │   └── node3  cq:WorkflowNode  type=END
    ├── transitions/  (nt:unstructured)
    │   └── t01  cq:WorkflowTransition  from=node0  to=node1
    └── variables/  (nt:unstructured)
```

Key facts:
- `jcr:content` at `/var` **is** the `cq:WorkflowModel`. There is no separate `model/` child node.
- Step nodes under `nodes/` use `cq:WorkflowNode` primary type and a `type` string property (`START`, `END`, `PROCESS`, `PARTICIPANT`, `OR_SPLIT`, `AND_SPLIT`, `AND_JOIN`).
- Sequential names (`node0`, `node1`) are used by Sync — never use them in the design-time `flow` layer.
- AEM derives this entire structure from the design-time `flow` layer when you click **Sync**.

## Forbidden Patterns — if you are about to generate any of these, STOP

**Forbidden 1 — `model/` child inside `jcr:content` at `/conf`:**

```xml
<!-- WRONG — never generate this -->
<jcr:content jcr:primaryType="cq:PageContent" ...>
  <flow .../>                            <!-- correct -->
  <model jcr:primaryType="cq:WorkflowModel">   <!-- FORBIDDEN: no model/ child at /conf -->
    <variables jcr:primaryType="nt:unstructured"/>
    <nodes jcr:primaryType="nt:unstructured">
      <node0 jcr:primaryType="cq:WorkflowNode" type="START"/>
    </nodes>
    <transitions jcr:primaryType="nt:unstructured"/>
  </model>
</jcr:content>
```

Why wrong: `jcr:content` at `/conf` is `cq:PageContent`. The `cq:WorkflowModel` format lives at `/var/workflow/models/<id>/jcr:content`, not as a child called `model/` inside the design-time page content. Sync creates it; you never write it.

**Forbidden 2 — any file under `jcr_root/var/`:**

```xml
<!-- WRONG — never ship /var content in a package -->
<!-- var/workflow/models/my-workflow/.content.xml -->
<jcr:root jcr:primaryType="cq:WorkflowModel" ...>
  <nodes .../>
  <transitions .../>
</jcr:root>
```

Why wrong: AEM Sync owns `/var/workflow/models/` entirely. Shipping it in a package produces conflicts and stale runtime state on re-install.

**Forbidden 3 — `cq:WorkflowNode` steps or `{Boolean}` properties in the `/conf` flow layer:**

```xml
<!-- WRONG — cq:WorkflowNode belongs only at /var -->
<node1 jcr:primaryType="cq:WorkflowNode" type="PROCESS">
  <metaData PROCESS_AUTO_ADVANCE="{Boolean}true"/>   <!-- also wrong: must be plain string -->
</node1>
```

Why wrong: Steps in the design-time `flow` layer must be `nt:unstructured` with `sling:resourceType`. Property values like `PROCESS_AUTO_ADVANCE` are plain strings (`"true"`), not typed JCR booleans.

- ❌ `cq:template="/libs/settings/workflow/templates/model"` — wrong. The correct value is `/libs/cq/workflow/templates/model`.
- ❌ Sequential node names `node0`, `node1` in the `flow` layer — use descriptive slugs (`sendnotification`, `approvaldecision`). Sequential names are generated by Sync at `/var`.
- ❌ Omitting the `<flow>` wrapper with `sling:resourceType="foundation/components/parsys"` — the Workflow Model Editor cannot display the canvas without it.
- ❌ Writing to `/etc/workflow/models/` — this path is deprecated and unsupported on AEM as a Cloud Service. All custom models must be at `/conf/global/settings/workflow/models/`.

## File Location (Cloud Service)

Only `/conf` is supported on AEMaaCS — `/etc/workflow/models/` is deprecated and must not be used.

```
ui.content/src/main/content/jcr_root/
└── conf/global/settings/workflow/models/my-workflow/.content.xml
```

After Cloud Manager pipeline installation: open **Tools → Workflow → Models**, select the model, click **Edit**, then click **Sync**. Verify the model appears in `/var/workflow/models/` via CRX/DE and all steps render on the editor canvas before starting a test instance.

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
| `PERSIST_ANONYMOUS_WORKITEM` | PROCESS | Persist transient work item across step boundaries |

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

## OOTB Process Steps (Cloud Service)

| process.label | FQCN | Purpose |
|---|---|---|
| `Create Version` | `com.day.cq.wcm.workflow.process.CreateVersionProcess` | JCR version |
| `Set Variable Step` | `com.adobe.granite.workflow.core.process.SetVariableProcess` | Set workflow variable |
| `Goto Step` | `com.adobe.granite.workflow.core.process.GotoProcess` | Loop-back redirect |
| `Lock Payload Process` | `com.adobe.granite.workflow.core.process.LockProcess` | JCR lock |
| `Unlock Payload Process` | `com.adobe.granite.workflow.core.process.UnlockProcess` | Remove JCR lock |
| `Task Manager Step` | `com.adobe.granite.taskmanagement.impl.workflow.TaskWorkflowProcess` | Create Inbox task |

> `Activate Page` / `Deactivate Page` are 6.5 LTS only — use replication APIs or Sling distribution on AEMaaCS.

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
