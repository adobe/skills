# Cloud Service Guardrails — AEM Workflow

## Immutability Constraints

| Path | Status | Action |
|---|---|---|
| `/libs/settings/workflow/models/` | **Immutable** | Create models under `/conf/global/settings/workflow/models/` |
| `/libs/settings/workflow/launcher/config/` | **Immutable** | Create launchers under `/conf/global/settings/workflow/launcher/config/` |
| `/libs/workflow/scripts/` | **Immutable** | Do not edit OOTB scripts |
| `/etc/workflow/` | **Deprecated** | Avoid; use `/conf/global` |

## Model Deployment

1. Source model: `/conf/global/settings/workflow/models/<name>/jcr:content/model`
2. Deploy to runtime: call `WorkflowSession.deployModel(model)` or use Workflow Model Editor → **Sync**
3. Engine reads only from `/var/workflow/models/<name>`
4. Deploy via Cloud Manager pipeline — models land as content package in `ui.content`

**filter.xml (use `merge` mode):**
```xml
<filter root="/conf/global/settings/workflow/models/my-workflow" mode="merge"/>
```

## Service Users

- Always use service users — never use admin credentials in production code
- Map your bundle's sub-service to `workflow-process-service` or a custom user with minimal ACLs
- Define mappings via `org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-*.xml` OSGi configs in `ui.apps`
- Use repoinit (`sling.content.repoinit`) to create custom service users and set ACLs

## OSGi Annotations

On Cloud Service (AEM SDK targets OSGi 7):
- Use `org.osgi.service.component.annotations.*` (DS R6/R7)
- Avoid Felix SCR (`org.apache.felix.scr.annotations.*`) — deprecated
- Use `@Designate(ocd=...)` + `@ObjectClassDefinition` for configuration schemas

## Deployment via Cloud Manager

- Workflow models and launcher configs go into the `ui.content` package
- Bundle containing custom `WorkflowProcess` classes goes into `ui.apps`
- Do not write workflow-related content to mutable repository paths from bundle activators in Cloud Service

## Disabling OOTB Launchers

Never modify `/libs`. Override with an `enabled=false` node at `/conf/global/settings/workflow/launcher/config/<same-name>`:

```xml
<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:WorkflowLauncher"
    enabled="{Boolean}false"/>
```

## Globally Excluded Launcher Paths

These paths never trigger launchers regardless of configuration:
- `/var/audit`
- `/var/eventing`
- `/var/taskmanagement`
- `/tmp`
- `/var/workflow/instances`

## Purge

Configure purge via **Adobe Granite Workflow Purge Configuration** OSGi factory  
(`com.adobe.granite.workflow.purge.Scheduler`) — do not manually delete from `/var/workflow/instances`.

Run under: **Tools → Operations → Maintenance → Weekly Maintenance**.
