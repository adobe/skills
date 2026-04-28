---
name: workflow-launchers
description: Configure and deploy Workflow Launchers that automatically start workflows in response to JCR content changes on AEM as a Cloud Service
license: Apache-2.0
---

# Workflow Launchers Skill — AEM as a Cloud Service

## Audience

Developers and integrators (and the IDE LLM acting on their behalf) configuring `cq:WorkflowLauncher` nodes that auto-start workflows on JCR content events on AEM as a Cloud Service — DAM asset processing on upload, review workflows on page edit, custom auto-trigger patterns, or overlays that disable/replace OOTB launcher behavior.

## Variant Scope

- AEM as a Cloud Service only.
- Custom launchers live at `/conf/global/settings/workflow/launcher/config/`. Legacy `/etc/workflow/launcher/config/` is deprecated and not the canonical surface on AEMaaCS.
- Deploy via Cloud Manager pipeline; no direct Package Manager production deploys.
- Workflow execution is **author-tier only** by default on AEMaaCS — publish-tier launcher use cases are rare and should be confirmed with the user before configuring.
- **Not for AEM 6.5 LTS.** If the target is 6.5 LTS, stop and use the 6.5-lts variant of this skill — `/etc` legacy paths, `mvn install -PautoInstallPackage`, and Felix Console JMX-based launcher diagnostics documented there do not apply on AEMaaCS.

## Dependencies

Launchers depend on three upstream concerns — verify all three before expecting a launcher to start a working instance:

- **workflow-model-design** — the workflow referenced by the launcher's `workflow=` property must already be deployed and synced to `/var/workflow/models/<name>`.
- **workflow-development** — every `WorkflowProcess` and `ParticipantStepChooser` referenced by that model must be registered as an OSGi service. Missing services produce `Process not found` on first instance execution.
- **workflow-triggering** — launchers are one of several triggering mechanisms; if you need a different one (manual, programmatic, HTTP API), see [workflow-triggering](../workflow-triggering/SKILL.md).

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

> **Never disable an OOTB DAM launcher (`dam_update_asset_*`, `dam_xmp_writeback`) without confirming with the user that asset processing is intentionally being replaced.** Disabling these breaks rendition generation, metadata extraction, and XMP writeback — typically discovered hours later when assets render incorrectly. Only disable an OOTB launcher when you are explicitly replacing it with a custom workflow on the same path, and validate end-to-end asset upload after the change.

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

## Architecture Considerations

Launchers are the surface where workflow load is *automated*. A single bad glob can flood the workflow job queue with one content edit. On AEMaaCS this matters more — auto-scaling absorbs the spike rather than failing loudly, so excess load surfaces as cost and metric noise rather than visible failure. Apply these before deploying any launcher:

- **Narrow your glob, node type, and conditions.** A broad glob (`/content(/.*)?`) paired with `eventType=2` (NODE_MODIFIED) fires on every property change under `/content`. Always pair the glob with a specific `nodetype` (`cq:PageContent`, `dam:AssetContent`) and conditions that match only the events you care about.
- **Watch multi-event amplification.** A single DAM asset upload fires multiple events — the asset node, each rendition, the metadata node. Without narrowing, one upload starts N workflows. Pin the glob to a specific descendant (e.g., `/jcr:content/renditions/original`) when you only want one trigger per upload.
- **Avoid infinite loops.** A workflow whose process step writes to a path the launcher watches will re-trigger itself. **Default strategy: tag the JCR `Session` with `setUserData("workflowmanager")` before the write so `WorkflowLauncherListener` ignores the resulting events.** The `session` parameter on `WorkflowProcess.execute()` is a `WorkflowSession`, **not** a JCR `Session` — adapt it first: `javax.jcr.Session jcrSession = session.adaptTo(javax.jcr.Session.class); jcrSession.getWorkspace().getObservationManager().setUserData("workflowmanager");`. If you write through a service-user `ResourceResolver`, tag that resolver's underlying `Session` — it is a different `Session` instance and the flag does not propagate. Use the launcher's `excludeList` only when you can statically name every model that might re-trigger; use a JCR property flag when the workflow writes to a different node than the launcher watches. See `condition-patterns.md` for code.
- **Use transient workflows for high-volume launchers.** Set `transient="true"` on the workflow model (see [workflow-model-design](../workflow-model-design/SKILL.md)). Persistent workflows in this regime bloat `/var/workflow/instances` quickly — and on AEMaaCS this surfaces as repository-growth alerts and Cloud Manager Logs noise.
- **Disable broad launchers in lower environments via run-mode-aware folders.** A broad-match OOTB or custom launcher active in dev/stage with the same content as prod can fire on every content sync, masking real prod-vs-dev behavior. Package the launcher's `.content.xml` under `config.author.dev/` or `config.author.stage/` to scope it; do not rely solely on the launcher's `runModes` property (see Disabling a Launcher for a Run Mode below).
- **Stack mechanisms cautiously.** Pairing a Workflow Launcher with another auto-trigger mechanism on the same content fires multiple workflows per content change. Pick one mechanism per content event.

## Disabling a Launcher for a Run Mode

> **Reliability note:** the `runModes` property on `cq:WorkflowLauncher` has known honoring issues. The canonical AEMaaCS pattern is to package the launcher's `.content.xml` under a run-mode-aware folder (`config.author/`, `config.author.dev/`, `config.publish/`) and let Sling's run-mode-aware OSGi config handling drive it.

> **AEMaaCS-specific:** workflow execution is **author-tier only** by default. `runModes="[publish]"` launchers are rarely meaningful on AEMaaCS — confirm the use case with the user before configuring one.

Run-mode-aware packaging (canonical):
```
ui.content/src/main/content/jcr_root/conf/global/settings/workflow/launcher/config.author/
    my-author-only-launcher/
        .content.xml
```

Legacy property-based form (use only if run-mode-aware packaging is not feasible):
```xml
runModes="[author]"
```

Omit `runModes` to fire on all run modes.

## Debugging Launchers

- **Tools → Workflow → Launchers** UI (canonical) — lists all active launchers, you can enable/disable interactively
- Check `/conf/global/settings/workflow/launcher/config/` in CRXDE Lite for your deployed configs
- Check OSGi console → `WorkflowLauncherListener` service properties
- After deployment, verify via the **Tools → Workflow → Launchers** UI, or query `/conf/global/settings/workflow/launcher/config/<name>.json` against your **local AEMaaCS SDK** at `localhost:4502` only. Never embed credentials in scripts targeting Cloud Service environments — production auth is IMS-based, and the legacy `/etc/workflow/launcher.json` endpoint is not the canonical surface on AEMaaCS.

## References in This Skill

| Reference | What It Covers |
|---|---|
| `references/workflow-launchers/launcher-config-reference.md` | Full property spec and XML templates |
| `references/workflow-launchers/condition-patterns.md` | Common condition patterns, glob syntax, event type codes |
| `references/workflow-foundation/architecture-overview.md` | Granite Workflow Engine overview |
| `references/workflow-foundation/cloud-service-guardrails.md` | Cloud Service constraints for config paths |
| `references/workflow-foundation/jcr-paths-reference.md` | Where launchers live in the JCR |
