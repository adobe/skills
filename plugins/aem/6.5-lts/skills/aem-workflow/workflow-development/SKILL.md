---
name: workflow-development
description: Implement custom AEM Workflow Java components on AEM 6.5 LTS. Use when writing WorkflowProcess steps, ParticipantStepChooser implementations, registering services via Felix SCR or DS R6 OSGi annotations, reading step arguments from MetaDataMap, accessing JCR payload via WorkflowSession adapter, reading and writing workflow metadata and variables, and handling errors with WorkflowException for retry behavior.
license: Apache-2.0
---

# Workflow Development (AEM 6.5 LTS)

Implement custom workflow components for AEM 6.5 LTS: `WorkflowProcess`, `ParticipantStepChooser`, OSGi registration, metadata handling, and error patterns.

## Audience

Java developers with OSGi / Maven familiarity building custom workflow steps on AEM 6.5 LTS (including AMS).

## Variant Scope

- AEM 6.5 LTS, including Adobe Managed Services (AMS) deployments of 6.5 LTS.
- Both Felix SCR and DS R6 annotations are supported. For new code, default to DS R6. Use Felix SCR only when the existing classes in the same module already use Felix SCR — match the project's annotation style rather than mixing both.
- Felix SCR is supported for the lifetime of AEM 6.5 LTS only. Code intended to outlive 6.5 LTS (e.g., a future Cloud Service migration) should start on DS R6.
- Bundle deployed via Maven (`autoInstallBundle`) or Package Manager.
- **Not for AEM as a Cloud Service.** If the target instance is AEMaaCS, stop and use the cloud-service variant of this skill — the 6.5 LTS patterns here (Felix SCR, `/etc/workflow/models/`, JMX-based remediation) do not apply to AEMaaCS and will produce code that fails to deploy.

## Dependencies

This skill builds on:

- `workflow-foundation` references (architecture, API, JCR paths, 6.5 LTS guardrails) — load alongside.
- `workflow-model-design` — every `WorkflowProcess` and `ParticipantStepChooser` you implement here must be referenced by a step in a deployed model. Build the model first; this skill makes the Java side match.
- `workflow-launchers` — when a launcher routes content into your step, see launcher-side loop-prevention guardrails.

## Prerequisites

- AEM 6.5 LTS author instance reachable (local, dev, or sandbox).
- Maven project with `core` + `ui.content` modules.
- Service user created and mapped via `ServiceUserMapper` with the ACLs your step needs.
- Bundle build + deploy path verified (`mvn install -P autoInstallBundle` or Package Manager upload).
- `filter.xml` covers the workflow model and launcher paths you intend to install.

Full checklist and deploy-verification commands: [quick-start-guide.md](./references/workflow-foundation/quick-start-guide.md).

## Workflow

```text
Development Progress
- [ ] 1) Identify what the step does: process (auto) or participant (human) or dynamic participant
- [ ] 2) Create Java class implementing WorkflowProcess or ParticipantStepChooser
- [ ] 3) Register with @Component/@Service (Felix SCR) or @Component (DS R6) with service property
- [ ] 4) Read step arguments from MetaDataMap args
- [ ] 5) Verify payloadType == "JCR_PATH"; then access via item.getWorkflowData().getPayload().toString()
- [ ] 6) Read/write workflow instance metadata via item.getWorkflowData().getMetaDataMap()
- [ ] 7) Return normally to advance; throw WorkflowException to trigger retry
- [ ] 8) Deploy; verify process.label appears in Workflow Model Editor step picker
```

## WorkflowProcess Template — DS R6 (Preferred)

```java
@Component(
    service = WorkflowProcess.class,
    property = {
        "process.label=My Custom Process Step",
        "service.description=Short description"
    }
)
public class MyCustomProcess implements WorkflowProcess {

    @Override
    public void execute(WorkItem item, WorkflowSession session, MetaDataMap args)
            throws WorkflowException {
        // Guard against non-JCR_PATH payloads (e.g., BLOB).
        // See process-step-patterns.md Pattern 1 for the full payload-type handling.
        if (!"JCR_PATH".equals(item.getWorkflowData().getPayloadType())) {
            return;
        }
        String payloadPath = item.getWorkflowData().getPayload().toString();
        String myArg = args.get("myArgKey", "defaultValue");
        item.getWorkflowData().getMetaDataMap().put("processedBy", "my-step");
        // ... do work ...
    }
}
```

For payload writes, inject a `ResourceResolverFactory` and open a service-user resolver — see [process-step-patterns.md Pattern 5](./references/workflow-development/process-step-patterns.md).

## WorkflowProcess Template — Felix SCR (Still Valid)

```java
@Component(metatype = false)
@Service(value = WorkflowProcess.class)
@Property(name = "process.label", value = "My Custom Process Step")
public class MyCustomProcess implements WorkflowProcess {

    @Override
    public void execute(WorkItem item, WorkflowSession session, MetaDataMap args)
            throws WorkflowException {
        // Guard against non-JCR_PATH payloads (e.g., BLOB).
        // See process-step-patterns.md Pattern 1 for the full payload-type handling.
        if (!"JCR_PATH".equals(item.getWorkflowData().getPayloadType())) {
            return;
        }
        String payloadPath = item.getWorkflowData().getPayload().toString();
        String myArg = args.get("myArgKey", "defaultValue");
        item.getWorkflowData().getMetaDataMap().put("processedBy", "my-step");
        // ... do work ...
    }
}
```

## ParticipantStepChooser Template

```java
@Component(
    service = ParticipantStepChooser.class,
    property = {"chooser.label=Department Head Chooser"}
)
public class DepartmentHeadChooser implements ParticipantStepChooser {

    @Override
    public String getParticipant(WorkItem workItem, WorkflowSession session,
                                 MetaDataMap args) throws WorkflowException {
        String department = workItem.getWorkflowData()
                                    .getMetaDataMap().get("department", "marketing");
        return department + "-managers";
    }
}
```

## Guardrails

- Never use `loginAdministrative()`. Always use a service user mapped via `ServiceUserMapper`.
- Felix SCR: keep `metatype=false` unless exposing configuration to the OSGi console.
- Do not mix Felix SCR and DS R6 annotations in the same class.
- Throw `WorkflowException` for retryable errors; log and rethrow for unexpected errors.
- Do not log full payload contents or metadata values at `INFO` — payloads may carry PII or confidential content. Log the payload path and a correlation key; log full values only at `DEBUG` on non-production instances.
- Model XML and Java are co-authored. The `PROCESS=` value on a `cq:WorkflowNode` must resolve to either the fully qualified class name **or** the exact `process.label` of a deployed `WorkflowProcess`. A model that references a label you have not registered will fail at runtime with `Process not found`. Generate the Java class first, deploy and confirm it appears in the Model Editor step picker, then reference it from the model.
- **Avoid launcher re-trigger loops.** If your process step modifies a JCR path that any `cq:WorkflowLauncher` watches, the change will re-trigger the same workflow. Before the write, mark the JCR session with `session.getWorkspace().getObservationManager().setUserData("workflowmanager")` — `WorkflowLauncherListener` ignores events tagged with that user data. See [workflow-launchers](../workflow-launchers/SKILL.md) for code examples and the alternative `excludeList` / JCR-flag patterns.

## Rollback / Recovery

If a deployed `WorkflowProcess` or `ParticipantStepChooser` misbehaves (throws on every payload, leaks resources, or produces stuck instances):

1. Uninstall or replace the bundle — Felix Console → Bundles → **Uninstall**, or deploy a corrected bundle via Package Manager / Maven. If the environment is under change control, prefer redeploying the previous known-good content package via the customer's deploy pipeline over a direct Felix Console uninstall.
2. Disable the launcher that routes content into the broken step — set `enabled={Boolean}false` at `/conf/global/settings/workflow/launcher/config/<name>` (do not delete the `/libs` node).
3. Drain stuck or failed instances — Tools → Workflow → Instances (terminate individual instances) or JMX (`com.adobe.granite.workflow:type=Maintenance` → `retryFailedWorkItems`, `restartStaleWorkflows`). Before terminating, confirm each instance is expendable (test data, known-bad payloads). If an instance represents live business work, prefer `retryFailedWorkItems` or suspend/resume first — terminate destroys the in-flight work item.
4. Monitor **Tools → Workflow → Failures** and `error.log` for at least 15 minutes of post-rollback traffic, or one full processing cycle of the affected launcher — whichever is longer — before declaring the incident closed.

For full remediation workflows (stuck instances, thread pool exhaustion, purge), use the sibling [workflow-debugging](../workflow-debugging/SKILL.md) skill.

## Escalation

Engage the sibling [workflow-debugging](../workflow-debugging/SKILL.md) skill first, then Adobe Support, when:

- A Granite-internal stack trace appears (classes under `com.adobe.granite.workflow.core.*`) that is not caused by the customer's own code.
- Workflow instances remain stuck after `retryFailedWorkItems` and bundle redeploy.
- The workflow Sling Job queue shows thread pool exhaustion that cannot be explained by the custom step's own runtime.
- The Workflow Model Editor does not surface a registered `process.label` after bundle activation and a console restart.

Artifacts to collect before opening a support ticket:

- Bundle symbolic name + version.
- Relevant `error.log` snippet with workflow instance ID / correlation ID.
- Thread dump (`jstack <pid>` or Felix Console → Status → Threads).
- Configuration Status ZIP (Felix Console → Status → Configuration Status).
- Export of the stuck instance node under `/var/workflow/instances/server0/<date>/<id>`.

## References

Development patterns:
- [process-step-patterns.md](./references/workflow-development/process-step-patterns.md) — WorkflowProcess patterns with Felix SCR and DS R6 examples
- [participant-step-patterns.md](./references/workflow-development/participant-step-patterns.md) — ParticipantStepChooser patterns and completing steps
- [variables-and-metadata.md](./references/workflow-development/variables-and-metadata.md) — MetaDataMap, workflow variables, inter-step data

Foundation:
- [quick-start-guide.md](./references/workflow-foundation/quick-start-guide.md) — prerequisites, minimum viable workflow, deployment verification
- [architecture-overview.md](./references/workflow-foundation/architecture-overview.md) — Granite engine flow, Sling Jobs, instance states
- [jcr-paths-reference.md](./references/workflow-foundation/jcr-paths-reference.md) — model / launcher / instance / package paths and ACL groups
- [api-reference.md](./references/workflow-foundation/api-reference.md) — `WorkflowProcess`, `WorkflowSession`, `MetaDataMap`, `ParticipantStepChooser` contracts
- [65-lts-guardrails.md](./references/workflow-foundation/65-lts-guardrails.md) — model storage, deployment, service users, workflow packages
