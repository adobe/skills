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
| `eventType` | Long | Bitmask of JCR event types — see [Event Type Bitmask](#event-type-bitmask) below |
| `glob` | String | Glob pattern matched against the event node path (e.g., `/content/dam(/.*)?`) |
| `nodetype` | String | JCR node type the event node must be (e.g., `dam:AssetContent`) |
| `conditions` | String[] | Additional JCR property conditions on the event node |
| `workflow` | String | Runtime path of the workflow model `/var/workflow/models/<id>` |
| `enabled` | Boolean | Whether the launcher is active |
| `description` | String | Human-readable description |
| `excludeList` | String[] | Runtime model paths (`/var/workflow/models/...`) whose active instances suppress this launcher — primary loop-prevention mechanism |
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

## Event Type Bitmask

`eventType` is a bitmask combining one or more of the following values:

| Value | Name | Meaning |
|-------|------|---------|
| `1` | `NODE_ADDED` | A node was created (e.g., asset uploaded, page created) |
| `2` | `NODE_MODIFIED` | A node's properties or child nodes changed |
| `4` | `NODE_REMOVED` | A node was deleted |
| `8` | `PROPERTY_ADDED` | A property was added to a node |
| `16` | `PROPERTY_CHANGED` | A property value was changed |
| `32` | `PROPERTY_REMOVED` | A property was removed from a node |

Common combined values:

| `eventType` value | Listens for |
|---|---|
| `1` | Creation only |
| `2` | Modification only |
| `3` | Creation **or** modification (1+2) |
| `7` | Creation, modification, **or** deletion (1+2+4) |
| `18` | Property added **or** property changed (8+16) — fine-grained metadata watch |

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

## Launcher Loop Prevention

A **launcher loop** occurs when a workflow step writes back to a JCR path that matches the same launcher's `glob`, causing the launcher to fire again — repeatedly, until the queue floods.

**Scenario:** A process step updates `jcr:content/metadata` on a DAM asset. A launcher on `/content/dam(/.*)?` with `eventType=2` (NODE_MODIFIED) re-triggers the same workflow, which updates metadata again, ad infinitum.

### Prevention Strategy 1: `excludeList` (recommended)

Add the workflow model's runtime path to `excludeList`. When an instance of that model is already running against the same payload, the launcher will not enqueue a new instance.

```xml
excludeList="[/var/workflow/models/my-workflow]"
```

This is the safest approach: the launcher still fires for new content, but suppresses re-entry while the workflow is in-flight.

### Prevention Strategy 2: Narrow the `glob`

Make the glob pattern specific enough that the paths written by the workflow don't match:

```xml
<!-- Fires on original rendition upload only, not on metadata writes -->
glob="/content/dam(/.*)?/jcr:content/renditions/original"
nodetype="nt:file"
eventType="{Long}1"
```

### Prevention Strategy 3: `conditions` filter

Add a property condition that is only true on the initial trigger path, not on paths written by the workflow:

```xml
conditions="[property=dam:assetState,value=processing,type=STRING]"
```

### Detecting a Loop

Signs of a launcher loop in Cloud Manager logs:
- `WorkflowLauncherListener` enqueue messages for the same payload repeating rapidly
- Sling Job queue depth for the workflow topic growing without bound
- `numberOfQueuedJobs` metric continuously increasing

## Debugging Launchers

- **Tools → Workflow → Launchers** UI — lists all active launchers, you can enable/disable interactively
- Check `/conf/global/settings/workflow/launcher/config/` in CRXDE Lite for your deployed configs
- Check OSGi console → `WorkflowLauncherListener` service properties
- After deployment, verify via: `curl -u <user>:<password> http://localhost:4502/conf/global/settings/workflow/launcher/config.json` (local SDK only; replace credentials with your own — never use default `admin` credentials)

## References in This Skill

| Reference | What It Covers |
|---|---|
| `references/workflow-launchers/launcher-config-reference.md` | Full property spec and XML templates |
| `references/workflow-launchers/condition-patterns.md` | Common condition patterns, glob syntax, event type codes |
| `references/workflow-foundation/architecture-overview.md` | Granite Workflow Engine overview |
| `references/workflow-foundation/cloud-service-guardrails.md` | Cloud Service constraints for config paths |
| `references/workflow-foundation/jcr-paths-reference.md` | Where launchers live in the JCR |
