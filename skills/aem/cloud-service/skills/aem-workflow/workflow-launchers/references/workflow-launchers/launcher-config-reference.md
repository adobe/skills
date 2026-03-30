# Launcher Configuration Reference — AEM Cloud Service

## Node Type: `cq:WorkflowLauncher`

A launcher node at `/conf/global/settings/workflow/launcher/config/<name>` must have `jcr:primaryType="cq:WorkflowLauncher"`.

## Property Reference

### `eventType` (Long, required)

Bit-field combining one or more JCR event types:

| Value | Constant | Meaning |
|---|---|---|
| `1` | `Event.NODE_ADDED` | A node was created |
| `2` | `Event.NODE_MODIFIED` | Node properties or child nodes changed |
| `4` | `Event.NODE_REMOVED` | A node was deleted |
| `8` | `Event.PROPERTY_ADDED` | A property was added |
| `16` | `Event.PROPERTY_CHANGED` | A property value changed |
| `32` | `Event.PROPERTY_REMOVED` | A property was removed |

Combine with addition: `eventType="{Long}3"` listens for NODE_ADDED (1) + NODE_MODIFIED (2).

Most common values:
- `1` — fire on creation only (upload)
- `2` — fire on modification only (edit)
- `3` — fire on both creation and modification

### `glob` (String, required)

A glob pattern matched against the **absolute path** of the event node.

Syntax:
- `*` — matches any sequence of characters except `/`
- `**` — matches any sequence of characters including `/`
- `(/.*)?` — suffix meaning "this path or any descendant"

Examples:
```
/content/dam(/.*)?           → any path under /content/dam
/content/dam/.*              → same (regex-style, also accepted)
/content/dam/*/jcr:content   → jcr:content of any direct child of /content/dam
/content/my-site/en/.*       → any path under /content/my-site/en
```

### `nodetype` (String, optional)

JCR node type the event node must match. The launcher fires only if the triggering node is of this type.

Common node types:
- `dam:AssetContent` — content node of a DAM asset
- `nt:file` — file node (e.g., rendition files)
- `cq:Page` — a page
- `cq:PageContent` — a page's jcr:content
- `nt:unstructured` — generic node (broad match)

Leave empty to match any node type.

### `conditions` (String[], optional)

Array of conditions that must all be true on the event node. Format per entry:

```
property=<property-name>,value=<expected-value>,type=<JCR_TYPE>
```

`type` defaults to `STRING` if omitted.

JCR Types: `STRING`, `LONG`, `DOUBLE`, `DATE`, `BOOLEAN`, `NAME`, `PATH`, `REFERENCE`, `BINARY`.

Example — fire only if the node has property `cq:type` equal to `publicationevent`:
```
property=cq:type,value=publicationevent,type=STRING
```

Multiple conditions use multiple array entries — all must match (AND logic).

### `workflow` (String, required)

**Runtime path** of the workflow model. Must be under `/var/workflow/models/`.

```
/var/workflow/models/dam/update_asset
/var/workflow/models/my-custom-workflow
```

Do **not** use the design-time path (`/conf/global/settings/workflow/models/...`).

### `enabled` (Boolean)

`true` to activate the launcher. `false` to deactivate it without deleting the configuration. Defaults to `true`.

### `description` (String, optional)

Free-text description visible in the Launchers UI.

### `excludeList` (String[], optional)

List of workflow model IDs. If the content's `cq:lastReplicatedBy` or similar metadata indicates one of these models triggered the last change, the launcher will not re-fire.

### `runModes` (String[], optional)

Restricts the launcher to specific run modes. Leave empty to apply to all run modes.

Common values: `author`, `publish`.

### `disabledFeatures` (String[], optional)

Internal — do not set in custom launchers.

---

## Complete `.content.xml` Templates

### Template 1: DAM Asset Upload

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root
    xmlns:jcr="http://www.jcp.org/jcr/1.0"
    xmlns:cq="http://www.day.com/jcr/cq/1.0"
    jcr:primaryType="cq:WorkflowLauncher"
    eventType="{Long}1"
    glob="/content/dam(/.*)?/jcr:content/renditions/original"
    nodetype="nt:file"
    workflow="/var/workflow/models/dam/update_asset"
    enabled="{Boolean}true"
    description="DAM Update Asset on original rendition upload"
    runModes="[author]"/>
```

### Template 2: Page Content Modification

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root
    xmlns:jcr="http://www.jcp.org/jcr/1.0"
    xmlns:cq="http://www.day.com/jcr/cq/1.0"
    jcr:primaryType="cq:WorkflowLauncher"
    eventType="{Long}2"
    glob="/content/my-site(/.*)?/jcr:content"
    nodetype="cq:PageContent"
    workflow="/var/workflow/models/my-review-workflow"
    enabled="{Boolean}true"
    description="Request review whenever site page content is modified"
    runModes="[author]"/>
```

### Template 3: Disabled Overlay (suppress OOTB launcher)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root
    xmlns:jcr="http://www.jcp.org/jcr/1.0"
    xmlns:cq="http://www.day.com/jcr/cq/1.0"
    jcr:primaryType="cq:WorkflowLauncher"
    eventType="{Long}1"
    glob="/content/dam(/.*)?/jcr:content/renditions/original"
    nodetype="nt:file"
    workflow="/var/workflow/models/dam/update_asset"
    enabled="{Boolean}false"
    description="OVERLAY: disabled OOTB dam_update_asset_create"/>
```
