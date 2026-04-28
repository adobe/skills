---
name: workflow-launchers
description: Configure and deploy Workflow Launchers that automatically start workflows in response to JCR content changes on AEM 6.5 LTS
license: Apache-2.0
---

# Workflow Launchers Skill — AEM 6.5 LTS

## Audience

Developers and integrators configuring `cq:WorkflowLauncher` nodes that auto-start workflows on JCR content events on AEM 6.5 LTS — DAM asset processing on upload, review workflows on page edit, custom auto-trigger patterns, or overlays that disable/replace OOTB launcher behavior.

## Variant Scope

- AEM 6.5 LTS only.
- Custom launchers live at `/conf/global/settings/workflow/launcher/config/` (preferred) or `/apps/settings/workflow/launcher/config/`. Legacy `/etc/workflow/launcher/config/` still works but should be migrated.
- **Not for AEM as a Cloud Service.** AEMaaCS uses Sling Job Topics for event distribution; the JCR-event-listener launcher pattern documented here does not apply directly. If the target is AEMaaCS, stop and use the cloud-service variant of this skill.

## Dependencies

Launchers depend on three upstream concerns — verify all three before expecting a launcher to start a working instance:

- **workflow-model-design** — the workflow referenced by the launcher's `workflow=` property must already be deployed and synced to `/var/workflow/models/<name>`.
- **workflow-development** — every `WorkflowProcess` and `ParticipantStepChooser` referenced by that model must be registered as an OSGi service. Missing services produce `Process not found` on first instance execution.
- **workflow-triggering** — launchers are one of several triggering mechanisms; if you need a different one (manual, programmatic, HTTP API), see [workflow-triggering](../workflow-triggering/SKILL.md).

## Prerequisites

- AEM 6.5 LTS author instance reachable.
- Workflow model deployed and visible at `/var/workflow/models/<name>` (verify via **Tools → Workflow → Models**).
- For OOTB-launcher overlays: write access to `/conf/global/` or `/apps/settings/`.
- `filter.xml` covering the launcher path with `mode="merge"`.

## Required Permissions

- Write access to `/conf/global/settings/workflow/launcher/config/` (or `/apps/settings/...`) for deploying custom launchers via content package.
- `workflow-administrators` (or equivalent) — enable/disable launchers in the **Tools → Workflow → Launchers** UI.
- Read access to `/var/workflow/models/` for runtime path lookup.

## Common Scenarios

Use this table to route a developer's intent to the right launcher pattern:

| Developer intent | Pattern |
|---|---|
| "Start a workflow when an asset is uploaded to DAM" | NODE_ADDED on `nt:file` under `/content/dam(/.*)?/jcr:content/renditions/original` |
| "Trigger review when a page is edited under /content/my-site" | NODE_MODIFIED on `cq:PageContent` under `/content/my-site(/.*)?/jcr:content` |
| "Disable an OOTB DAM launcher I don't need" | Overlay at `/conf/global/.../launcher/config/<same-name>` with `enabled={Boolean}false` |
| "Replace OOTB launcher behavior with my own workflow" | Overlay at `/conf/global/.../launcher/config/<same-name>` with new `workflow=` |
| "Auto-start on every replication event" | Use a Replication Trigger instead — see [workflow-triggering](../workflow-triggering/SKILL.md) Section 5 |

### When NOT to Use a Launcher

Launchers are **event-based** (JCR observation). Use a different mechanism when the trigger is not an event-driven content change:

| Developer intent | Use this instead |
|---|---|
| "Run my workflow nightly" or any time-based schedule | Sling Scheduler + WorkflowSession API — see [workflow-triggering](../workflow-triggering/SKILL.md) `programmatic-api.md` |
| "Run this once for all 500 existing pages" | A one-shot servlet or scheduled job that starts workflows in a capped loop |
| "When workflow X completes, run workflow Y" | A `WorkflowProcess` step in workflow X that triggers Y, not a second launcher (avoids race conditions) |
| "Run when content is replicated to publish" | Replication Trigger (workflow-triggering Section 5), not a launcher on `/var/audit/...` |
| "Run on events under `/var/`, `/jcr:system`, or anonymous-user events" | These paths and the `anonymous` user are excluded by `WorkflowLauncherListener` — launchers cannot fire here |

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
| `runModes` | String[] | Restrict to specific run modes — **honoring is unreliable on 6.5 LTS; prefer `config.author/` packaging** |
| `transient` | Boolean | Run the launched workflow as transient — no `/var/workflow/instances/` node unless persistence is forced. Use for high-volume launchers |
| `noProcess` | Boolean | Match events but do not start the workflow — silence a launcher without removing it |

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
    description="Start DAM update workflow on new original rendition upload"/>
<!-- For author-only restriction, package this .content.xml under config.author/.
     The runModes property on cq:WorkflowLauncher is unreliable on 6.5 LTS. -->

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

## Architecture Considerations

Launchers are the surface where workflow load is *automated*. A single bad glob can flood the workflow job queue with one content edit. Apply these before deploying any launcher:

- **Narrow your glob, node type, and conditions.** A broad glob (`/content(/.*)?`) paired with `eventType=2` (NODE_MODIFIED) fires on every property change under `/content`. Always pair the glob with a specific `nodetype` (`cq:PageContent`, `dam:AssetContent`) and conditions that match only the events you care about.
- **Watch multi-event amplification.** A single DAM asset upload fires multiple events — the asset node, each rendition, the metadata node. Without narrowing, one upload starts N workflows. Pin the glob to a specific descendant (e.g., `/jcr:content/renditions/original`) when you only want one trigger per upload.
- **Avoid infinite loops.** A workflow whose process step writes to a path the launcher watches will re-trigger itself. **Default strategy: mark the JCR session inside the process step with `session.getWorkspace().getObservationManager().setUserData("workflowmanager")`.** This is the most robust pattern (works across model changes, no static config to keep in sync). Use the launcher's `excludeList` only when you can statically name every model that might re-trigger; use a JCR property flag when the workflow writes to a different node than the launcher watches. See `condition-patterns.md` for code.
- **Use transient workflows for high-volume launchers.** Set `transient="true"` on the workflow model (see [workflow-model-design Architecture Considerations](../workflow-model-design/SKILL.md)). Persistent workflows in this regime bloat `/var/workflow/instances` quickly.
- **Disable broad launchers in lower environments.** A broad-match OOTB or custom launcher active in dev/stage with the same content as prod can fire on every content sync, masking real prod-vs-dev behavior. Either disable in lower envs (`enabled={Boolean}false` overlay), package the launcher under `config.author/` for run-mode restriction, or restrict with conditions tied to a prod-only marker.
- **Stack mechanisms cautiously.** Pairing a Workflow Launcher with a Replication Trigger on the same content fires *two* workflows per content change. Pick one mechanism per content event.

## Debugging Launchers (6.5 LTS)

> **Local development only.** The `curl -u admin:admin` example below targets a local author at `localhost:4502` with the default admin password. Never run it against a shared, stage, or production instance, and never with default `admin:admin` credentials outside an isolated dev box.

- **Tools → Workflow → Launchers** UI — lists all active launchers, interactive enable/disable
- Check `/conf/global/settings/workflow/launcher/config/` and `/apps/settings/workflow/launcher/config/` in CRXDE Lite
- Felix Web Console → OSGi → `WorkflowLauncherListener` service
- Check `/var/workflow/launcher/` for active event registrations
- Run `curl -u admin:admin http://localhost:4502/etc/workflow/launcher.json` to list all

## Verifying the Launcher

After deploying a launcher, confirm it's loaded and firing:

| Surface | How |
|---|---|
| Author UI | **Tools → Workflow → Launchers** — your launcher should appear with the `Enabled` flag set |
| CRXDE | Confirm the node exists at `/conf/global/settings/workflow/launcher/config/<name>` (or `/apps/`) with all properties intact |
| Trigger test | Manually create the event (upload a file to the watched path; edit a page) and check **Tools → Workflow → Instances** for a new instance |
| Logs | Enable `DEBUG` for `com.adobe.granite.workflow.core.launcher` in the Felix console — every launched instance produces a log line |

### When the launcher doesn't fire

If the event happens but no instance appears:

- **Most common:** the glob doesn't match the actual event node path. The event for a DAM asset upload fires on the `dam:AssetContent` node (`/content/dam/.../jcr:content`), not on `dam:Asset` itself. Inspect the event node path in CRXDE before tuning the glob.
- **Node type mismatch:** the `nodetype=` doesn't match the event node's primary type. Confirm in CRXDE.
- **Path resolution:** a same-named launcher node at higher-priority `/conf/global` may shadow the one you deployed at `/apps/`. Check the resolution order in Launcher Storage Paths above.
- **Globally excluded path:** events under specific paths are ignored regardless of launcher config — see `condition-patterns.md`.

If the launcher fires (you see the log line) but the workflow doesn't progress, the issue is downstream — most commonly a referenced `WorkflowProcess` is not registered (see [workflow-development Dependencies](../workflow-development/SKILL.md)). For full diagnosis: [workflow-debugging](../workflow-debugging/SKILL.md).

## References in This Skill

| Reference | What It Covers |
|---|---|
| `references/workflow-launchers/launcher-config-reference.md` | Full property spec and XML templates |
| `references/workflow-launchers/condition-patterns.md` | Common condition patterns, glob syntax, event type codes |
| `references/workflow-foundation/architecture-overview.md` | Granite Workflow Engine overview |
| `references/workflow-foundation/65-lts-guardrails.md` | 6.5 LTS constraints and legacy path guidance |
| `references/workflow-foundation/jcr-paths-reference.md` | Where launchers live in the JCR |
