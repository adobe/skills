# AEM 6.5 LTS Guardrails — Workflow Development

## Model Storage

| Location | Use Case | Notes |
|---|---|---|
| `/conf/global/settings/workflow/models/` | All new models | Requires explicit Sync to `/var` |
| `/etc/workflow/models/` | Legacy models only | Auto-deployed without Sync |
| `/libs/settings/workflow/models/` | OOTB models | Overlay at `/conf` or `/apps` to survive upgrades |

## Deployment

- Use **Package Manager** (`mvn install -P autoInstallPackage`) for development
- Use a **content package** (`ui.content`) for production deployment
- `filter.xml`: always use `mode="merge"` for model paths to avoid overwriting sibling nodes

```xml
<filter root="/conf/global/settings/workflow/models/my-workflow" mode="merge"/>
<filter root="/conf/global/settings/workflow/launcher/config/my-launcher" mode="merge"/>
```

## OSGi Annotations

Both Felix SCR and DS R6 work on 6.5 LTS. Prefer DS R6 for new code:

```java
// DS R6 (preferred)
@Component(service=WorkflowProcess.class, property={"process.label=My Step"})

// Felix SCR (still valid)
@Component(metatype=false)
@Service(value=WorkflowProcess.class)
@Property(name="process.label", value="My Step")
```

Never mix Felix SCR and DS R6 annotations in the same class.

## Service Users

Create in CRXDE Lite or via repoinit. Always use `loginService()` with the sub-service name — never `loginAdministrative()`.

```java
// Correct on 6.5 LTS
Map<String, Object> auth = Collections.singletonMap(
    ResourceResolverFactory.SUBSERVICE, "workflow-process");
ResourceResolver resolver = factory.getServiceResourceResolver(auth);
```

## Workflow Packages (Multi-Page Payloads)

When Manage Publication sends multiple pages, the payload is a `cq:WorkflowContentPackage` node under `/etc/workflow/packages/`.

In process steps, check:
```java
if ("cq:WorkflowContentPackage".equals(
        resource.getValueMap().get("jcr:primaryType", ""))) {
    // iterate members via ResourceCollectionManager
}
```

Purge workflow packages along with instances using `scheduledpurge.purgePackagePayload=true`.

## Launcher Override

To disable an OOTB launcher, create a node with the same name under `/conf/global/settings/workflow/launcher/config/<name>` with `enabled={Boolean}false`. Do not delete or modify the `/libs` or `/etc` node directly.

## Globally Excluded Launcher Paths (Same as Cloud Service)

- `/var/audit`, `/var/eventing`, `/var/taskmanagement`, `/tmp`, `/var/workflow/instances`

## Purge

Configure via **Adobe Granite Workflow Purge Configuration** OSGi factory.

Manual trigger: `curl -u admin:admin -X POST http://localhost:4502/libs/granite/operations/content/maintenance/granite_weekly/granite_workflowpurgetask.run.html`
