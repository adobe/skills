---
name: workflow-launchers
description: Configure and deploy Workflow Launchers that automatically start workflows in response to JCR content changes on AEM 6.5 LTS
license: Apache-2.0
---

# Workflow Launchers Skill — AEM 6.5 LTS

## Purpose

This skill teaches you how to configure and deploy Workflow Launchers that automatically start workflows in response to JCR content changes on AEM 6.5 LTS.

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

## Launcher Storage Paths on 6.5 LTS

On AEM 6.5 LTS, launcher configurations can live at:

| Path | Notes |
|---|---|
| `/libs/settings/workflow/launcher/config/` | OOTB launchers — do **not** edit directly |
| `/conf/global/settings/workflow/launcher/config/` | Recommended for new custom launchers |
| `/apps/settings/workflow/launcher/config/` | Alternative overlay location |
| `/etc/workflow/launcher/config/` | Legacy path (AEM 6.0–6.2); still supported but migrate away |

**Resolution order:** `/conf/global` → `/apps` → `/libs`

## Deploying a Custom Launcher on 6.5 LTS

Maven project location:
```
ui.content/src/main/content/jcr_root/conf/global/settings/workflow/launcher/config/
    my-custom-launcher/
        .content.xml
```

Or for overlay-based approach under `/apps`:
```
ui.apps/src/main/content/jcr_root/apps/settings/workflow/launcher/config/
    my-custom-launcher/
        .content.xml
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

Filter in `filter.xml`:
```xml
<filter root="/conf/global/settings/workflow/launcher/config/my-custom-launcher"/>
```

## Overlaying an OOTB Launcher

To disable or modify an OOTB launcher:

1. Copy the node from `/libs/settings/workflow/launcher/config/<launcher-name>` to `/conf/global/settings/workflow/launcher/config/<launcher-name>` (or `/apps/settings/...`)
2. Modify the property (e.g., `enabled="{Boolean}false"`)
3. Deploy via Package Manager or Maven

## Common OOTB Launchers (6.5 LTS)

| Launcher | Trigger | Workflow |
|---|---|---|
| `dam_update_asset_create` | NODE_ADDED on `dam:AssetContent` | DAM Update Asset |
| `dam_update_asset_modify` | NODE_MODIFIED on asset properties | DAM Update Asset |
| `dam_xmp_writeback` | NODE_MODIFIED on rendition | DAM Writeback |
| `update_page_version_*` | Node events on `cq:Page jcr:content` | Page Version Create |

## Event Type Combinations

To listen for both ADD and MODIFY, combine event types:
```xml
eventType="{Long}3"  <!-- 1 (ADD) + 2 (MODIFY) = 3 -->
```

## Where-Clause Conditions

```xml
conditions="[property=cq:type,value=publicationevent,type=STRING]"
```

Condition format: `property=<name>,value=<value>,type=<JCR_TYPE>` (type is optional, defaults to STRING).

## Debugging Launchers (6.5 LTS)

- **Tools → Workflow → Launchers** UI — lists all active launchers, interactive enable/disable
- Check `/conf/global/settings/workflow/launcher/config/` and `/apps/settings/workflow/launcher/config/` in CRXDE Lite
- Felix Web Console → OSGi → `WorkflowLauncherListener` service
- Check `/var/workflow/launcher/` for active event registrations
- Run `curl -u admin:admin http://localhost:4502/etc/workflow/launcher.json` to list all

## References in This Skill

| Reference | What It Covers |
|---|---|
| `references/workflow-launchers/launcher-config-reference.md` | Full property spec and XML templates |
| `references/workflow-launchers/condition-patterns.md` | Common condition patterns, glob syntax, event type codes |
| `references/workflow-foundation/architecture-overview.md` | Granite Workflow Engine overview |
| `references/workflow-foundation/65-lts-guardrails.md` | 6.5 LTS constraints and legacy path guidance |
| `references/workflow-foundation/jcr-paths-reference.md` | Where launchers live in the JCR |
