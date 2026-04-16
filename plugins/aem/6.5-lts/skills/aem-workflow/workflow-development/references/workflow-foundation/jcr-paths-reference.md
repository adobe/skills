# JCR Paths Reference — AEM Workflow (6.5 LTS)

## Model Paths

| Path | Purpose | Notes |
|---|---|---|
| `/conf/global/settings/workflow/models/<name>` | Design-time model (preferred) | Requires Sync to deploy to `/var` |
| `/etc/workflow/models/<name>` | Legacy design-time | Auto-treated as runtime-ready; no Sync needed |
| `/var/workflow/models/<name>` | Runtime (deployed) model | Engine reads from here |
| `/libs/settings/workflow/models/` | OOTB models | Mutable but always overlay at `/conf` to survive upgrades |

## Launcher Config Paths

| Path | Priority | Notes |
|---|---|---|
| `/etc/workflow/launcher/config/` | Legacy (backward compat) | Still works on 6.5 |
| `/libs/settings/workflow/launcher/config/` | OOTB | Mutable but use overlay |
| `/conf/global/settings/workflow/launcher/config/` | Override (recommended) | Preferred location |

Override chain (lowest to highest): `/etc` → `/libs` → `/conf/global`

## Instance Paths

| Path | Purpose |
|---|---|
| `/var/workflow/instances/` | All workflow instances |
| `/var/workflow/instances/server0/<yyyy-MM-dd>/<id>` | Specific instance |
| `/var/workflow/instances/server0/<yyyy-MM-dd>/<id>/history` | Step history |
| `/var/workflow/instances/server0/<yyyy-MM-dd>/<id>/workItems/<step>` | Work item nodes |

## Task Management Paths

| Path | Purpose |
|---|---|
| `/var/taskmanagement/tasks/` | Inbox Task nodes |

## Workflow Package Paths

| Path | Purpose |
|---|---|
| `/etc/workflow/packages/` | Legacy workflow packages (multi-page payloads) |
| `/var/workflow/packages/` | Current workflow packages |

## Other Paths

| Path | Purpose |
|---|---|
| `/etc/workflow/scripts/` | Legacy ECMAScript for steps |
| `/libs/workflow/scripts/` | OOTB scripts |
| `/etc/workflow/notification/` | Email notification templates |

## ACL Groups

| Group | Access |
|---|---|
| `workflow-administrators` | Full workflow CRUD + admin operations |
| `workflow-editors` | Create/modify models |
| `workflow-users` | Start workflows, complete work items |

## Service User (6.5 LTS)

Create via CRXDE or repoinit:
```
create service user my-bundle-workflow-user
set ACL for my-bundle-workflow-user
    allow jcr:read,jcr:write on /conf, /var/workflow
end
```

Map in OSGi config `org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-*.xml`:
```xml
<jcr:root jcr:primaryType="sling:OsgiConfig"
    user.mapping="[com.example.my-bundle:workflow=my-bundle-workflow-user]"/>
```
