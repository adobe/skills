# Workflow Launchers Skill — AEM as a Cloud Service

## Purpose

This skill teaches you how to configure and deploy Workflow Launchers that automatically start workflows in response to JCR content changes on AEM as a Cloud Service.

## When to Use This Skill

- A workflow must start automatically when an asset is uploaded to DAM
- A review workflow should trigger whenever an author modifies content under a specific path
- You need to replicate or replace an OOTB launcher behavior without editing `/libs`
- You want to enable, disable, or restrict a launcher to specific run modes

## Core Concept: What Is a Workflow Launcher?

A **Workflow Launcher** (`cq:WorkflowLauncher`) is a JCR node that registers a JCR event listener. When a node event occurs at a path matching the launcher's glob pattern, node type, and conditions, the Granite Workflow Engine enqueues a workflow start.

The listener is managed by `WorkflowLauncherListener` (an OSGi service). It reads all active launcher configurations at startup and re-evaluates them when configurations change.

## Architecture at a Glance

```
JCR Event (NODE_ADDED / NODE_MODIFIED / NODE_REMOVED)
    ↓
WorkflowLauncherListener (OSGi EventListener)
    ↓ matches: glob, nodetype, event type, conditions
Workflow Engine: enqueue WorkflowData
    ↓
Workflow Instance created at /var/workflow/instances/
```

## Launcher Configuration Properties

| Property | Type | Description |
|---|---|---|
| `eventType` | Long | `1` = NODE_ADDED, `2` = NODE_MODIFIED, `4` = NODE_REMOVED, `8` = PROPERTY_ADDED, `16` = PROPERTY_CHANGED, `32` = PROPERTY_REMOVED |
| `glob` | String | Glob pattern matched against the event node path (e.g., `/content/dam(/.*)?`) |
| `nodetype` | String | JCR node type the event node must be (e.g., `dam:AssetContent`) |
| `conditions` | String[] | Additional JCR property conditions on the event node |
| `workflow` | String | Runtime path of the workflow model `/var/workflow/models/<id>` |
| `enabled` | Boolean | Whether the launcher is active |
| `description` | String | Human-readable description |
| `excludeList` | String[] | Workflow model IDs to exclude |
| `runModes` | String[] | Restrict to specific run modes (e.g., `author`) |

## Deploying a Custom Launcher on Cloud Service

On Cloud Service, `/libs` is immutable. Store launcher configurations at:
```
/conf/global/settings/workflow/launcher/config/<launcher-name>
```

Maven project location:
```
ui.content/src/main/content/jcr_root/conf/global/settings/workflow/launcher/config/
    my-custom-launcher/
        .content.xml
```

Filter in `filter.xml`:
```xml
<filter root="/conf/global/settings/workflow/launcher/config/my-custom-launcher"/>
```

Node structure (`.content.xml`):
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
    description="Start DAM update workflow on new original rendition upload"
    runModes="[author]"/>
```

## Overlaying an OOTB Launcher

To disable or modify an OOTB launcher (e.g., `dam_update_asset_create`):

1. Copy the node from `/libs/settings/workflow/launcher/config/dam_update_asset_create` to `/conf/global/settings/workflow/launcher/config/dam_update_asset_create`
2. Modify the property (e.g., set `enabled="{Boolean}false"` to disable it)
3. Deploy as a content package via Cloud Manager

## Common OOTB Launchers (Cloud Service)

| Launcher | Trigger | Workflow |
|---|---|---|
| `dam_update_asset_create` | NODE_ADDED on `dam:AssetContent` under `/content/dam` | DAM Update Asset |
| `dam_update_asset_modify` | NODE_MODIFIED on asset properties | DAM Update Asset |
| `dam_xmp_writeback` | NODE_MODIFIED on rendition | DAM Writeback |
| `update_page_version_*` | Node events on cq:Page jcr:content | Page Version Create |

## Event Type Combinations

To listen for both ADD and MODIFY, combine event types:
```xml
eventType="{Long}3"  <!-- 1 (ADD) + 2 (MODIFY) = 3 -->
```

## Where-Clause Conditions

The `conditions` array lets you add JCR property conditions on the triggering node:

```xml
conditions="[property=cq:type,value=publicationevent,type=STRING]"
```

Condition format: `property=<name>,value=<value>,type=<JCR_TYPE>` (type is optional, defaults to STRING).

## Disabling a Launcher for a Run Mode

Use `runModes` to restrict:
```xml
runModes="[author]"   <!-- only fires on Author -->
runModes="[publish]"  <!-- only fires on Publish -->
```

Omit `runModes` to fire on all run modes.

## Debugging Launchers

- **Tools → Workflow → Launchers** UI — lists all active launchers, you can enable/disable interactively
- Check `/conf/global/settings/workflow/launcher/config/` in CRXDE Lite for your deployed configs
- Check OSGi console → `WorkflowLauncherListener` service properties
- After deployment, verify via: `curl -u admin:admin http://localhost:4502/etc/workflow/launcher.json`

## References in This Skill

| Reference | What It Covers |
|---|---|
| `references/workflow-launchers/launcher-config-reference.md` | Full property spec and XML templates |
| `references/workflow-launchers/condition-patterns.md` | Common condition patterns, glob syntax, event type codes |
| `references/workflow-foundation/architecture-overview.md` | Granite Workflow Engine overview |
| `references/workflow-foundation/cloud-service-guardrails.md` | Cloud Service constraints for config paths |
| `references/workflow-foundation/jcr-paths-reference.md` | Where launchers live in the JCR |
