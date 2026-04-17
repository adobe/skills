# Launcher Configuration Reference — AEM 6.5 LTS

## Node Type: `cq:WorkflowLauncher`

A launcher node stored at `/conf/global/settings/workflow/launcher/config/<name>`, `/apps/settings/workflow/launcher/config/<name>`, or (legacy) `/etc/workflow/launcher/config/<name>` must have `jcr:primaryType="cq:WorkflowLauncher"`.

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

JCR node type the event node must match.

Common node types:
- `dam:AssetContent` — content node of a DAM asset
- `nt:file` — file node (e.g., rendition files)
- `cq:Page` — a page
- `cq:PageContent` — a page's jcr:content
- `nt:unstructured` — generic node (broad match)

### `conditions` (String[], optional)

Array of conditions. Format per entry:
```
property=<property-name>,value=<expected-value>,type=<JCR_TYPE>
```

`type` defaults to `STRING` if omitted.

### `workflow` (String, required)

**Runtime path** of the workflow model.

On 6.5 LTS, valid runtime model paths:
- `/var/workflow/models/<model-name>` — models stored in conf or overlaid
- `/etc/workflow/models/<model-name>` — models still stored at the legacy path

Always confirm the actual runtime ID using **Tools → Workflow → Models → select model → Properties**.

### `enabled` (Boolean)

`true` to activate the launcher. `false` to deactivate.

### `description` (String, optional)

Free-text description visible in the Launchers UI.

### `excludeList` (String[], optional)

List of workflow model IDs whose sessions should not re-trigger the launcher.

### `runModes` (String[], optional)

Restricts the launcher to specific run modes: `author`, `publish`. Leave empty for all run modes.

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

### Template 3: Legacy `/etc` Launcher (6.5 LTS Only)

For projects that have not migrated to `/conf`:
```xml
<!-- Location: /etc/workflow/launcher/config/my-old-launcher/.content.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root
    xmlns:jcr="http://www.jcp.org/jcr/1.0"
    xmlns:cq="http://www.day.com/jcr/cq/1.0"
    jcr:primaryType="cq:WorkflowLauncher"
    eventType="{Long}1"
    glob="/content/legacy-site(/.*)?/jcr:content"
    nodetype="cq:PageContent"
    workflow="/etc/workflow/models/legacy-approval"
    enabled="{Boolean}true"/>
```

### Template 4: Disabled Overlay (suppress OOTB launcher)

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

## Path Resolution Order (6.5 LTS)

When multiple launcher nodes with the same name exist across paths, the resolution order is:

1. `/conf/global/settings/workflow/launcher/config/`
2. `/apps/settings/workflow/launcher/config/`
3. `/libs/settings/workflow/launcher/config/`
4. `/etc/workflow/launcher/config/` (legacy, lowest priority)

Place your overlay at `/conf/global/` or `/apps/` to override an OOTB launcher from `/libs/`.
