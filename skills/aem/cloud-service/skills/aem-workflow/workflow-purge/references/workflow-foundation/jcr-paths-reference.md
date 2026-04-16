# JCR Paths Reference — AEM Workflow (Cloud Service)

## Model Paths

| Path | Purpose | Notes |
|---|---|---|
| `/conf/global/settings/workflow/models/<name>` | Design-time model root | Writable; source of truth for code |
| `/conf/global/settings/workflow/models/<name>/jcr:content/model` | `cq:WorkflowModel` node | Contains `nodes/` and `transitions/` subtrees |
| `/var/workflow/models/<name>` | Runtime (deployed) model | Engine reads from here; written by Sync / `deployModel()` |
| `/libs/settings/workflow/models/` | OOTB models | **Immutable on Cloud Service** — do not write |

## Launcher Config Paths

| Path | Priority | Notes |
|---|---|---|
| `/libs/settings/workflow/launcher/config/` | Base (OOTB) | **Immutable** — never edit directly |
| `/conf/global/settings/workflow/launcher/config/` | Override (customer) | Always write here |
| `/etc/workflow/launcher/config/` | Legacy (backward compat) | Avoid on Cloud Service |

Override chain (lowest to highest): `/etc` → `/libs` → `/conf/global`

## Instance Paths

| Path | Purpose |
|---|---|
| `/var/workflow/instances/` | All active and historical workflow instances |
| `/var/workflow/instances/server0/<yyyy-MM-dd>/<id>` | Specific instance root |
| `/var/workflow/instances/server0/<yyyy-MM-dd>/<id>/history` | Step history log |
| `/var/workflow/instances/server0/<yyyy-MM-dd>/<id>/workItems/<step>` | Work item nodes |

## Task Management Paths

| Path | Purpose |
|---|---|
| `/var/taskmanagement/tasks/` | Inbox Task nodes |
| `/var/taskmanagement/tasks/<bucket>/<taskId>` | Single task node |

## Other Workflow Paths

| Path | Purpose |
|---|---|
| `/var/workflow/packages/` | Workflow packages (multi-page payloads) |
| `/etc/workflow/packages/` | Legacy workflow packages |
| `/libs/workflow/scripts/` | OOTB ECMAScript for workflow steps |
| `/conf/global/settings/inbox/` | Inbox sharing preferences |

## ACL Groups

| Group | Access |
|---|---|
| `workflow-administrators` | Full workflow CRUD + admin operations |
| `workflow-editors` | Create/modify models |
| `workflow-users` | Start workflows, complete work items |

## Service User Mapping (Cloud Service)

The OOTB workflow service user is `workflow-process-service`. Map your bundle's sub-service:

```xml
<!-- org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-<pid>.xml -->
<jcr:root
    jcr:primaryType="sling:OsgiConfig"
    user.mapping="[com.example.my-bundle:workflow=workflow-process-service]"/>
```
