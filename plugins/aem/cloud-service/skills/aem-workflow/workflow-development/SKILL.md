---
name: workflow-development
description: Implement custom AEM Workflow Java components on AEM as a Cloud Service. Use when writing WorkflowProcess steps, ParticipantStepChooser implementations, registering services via OSGi DS R6 annotations, reading step arguments from MetaDataMap, accessing JCR payload via WorkflowSession adapter, reading and writing workflow metadata and variables, and handling errors with WorkflowException for retry behavior.
license: Apache-2.0
---

# Workflow Development (Cloud Service)

Implement custom workflow components for AEM as a Cloud Service: `WorkflowProcess`, `ParticipantStepChooser`, OSGi registration, metadata handling, and error patterns.

## Audience

Java developers with OSGi / Maven familiarity building custom workflow steps on AEM as a Cloud Service.

## Variant Scope

- AEM as a Cloud Service only.
- Use OSGi DS R6 annotations (`org.osgi.service.component.annotations.*`). Do not use Felix SCR — Felix SCR is not supported on AEMaaCS.
- The Java source lives in the `core` (or equivalent) Maven module that builds an OSGi bundle. The built bundle is wrapped by your project's `all` content package and deployed via Cloud Manager pipeline. Do not place `.java` source under `ui.apps/src/main/content/jcr_root/...` — `ui.apps` carries OSGi configs and `/apps` content, not Java source.
- **Not for AEM 6.5 LTS.** If the target instance is 6.5 LTS, stop and load the 6.5-lts variant of this skill — Felix SCR support, JMX-based remediation, and direct Package Manager / `mvn install -PautoInstallBundle` deploys documented there do not apply on AEMaaCS.

## Dependencies

This skill builds on:

- `workflow-foundation` references (architecture, API, JCR paths, Cloud Service guardrails) — load alongside.
- `workflow-model-design` — every `WorkflowProcess` and `ParticipantStepChooser` you implement here must be referenced by a step in a deployed model. Build the model first; this skill makes the Java side match.
- `workflow-launchers` — when a launcher routes content into your step, see launcher-side loop-prevention guardrails.

## Workflow

```text
Development Progress
- [ ] 1) Identify what the step does: process (auto) or participant (human) or dynamic participant
- [ ] 2) Create Java class implementing WorkflowProcess or ParticipantStepChooser
- [ ] 3) Register with correct @Component annotation and service property (process.label / chooser.label)
- [ ] 4) Read step arguments from MetaDataMap args (set in model editor)
- [ ] 5) Access payload via item.getWorkflowData().getPayload().toString()
- [ ] 6) Read/write workflow instance metadata via item.getWorkflowData().getMetaDataMap()
- [ ] 7) Return normally to advance; throw WorkflowException to trigger retry
- [ ] 8) Deploy bundle; verify process.label appears in Workflow Model Editor step picker
```

## WorkflowProcess Template (Cloud Service)

```java
@Component(
    service = WorkflowProcess.class,
    property = {
        "process.label=My Custom Process Step",
        "service.description=Short description of what this step does"
    }
)
public class MyCustomProcess implements WorkflowProcess {

    private static final Logger LOG = LoggerFactory.getLogger(MyCustomProcess.class);

    @Reference
    private ResourceResolverFactory resolverFactory;

    @Override
    public void execute(WorkItem item, WorkflowSession session, MetaDataMap args)
            throws WorkflowException {
        // 1. Read payload
        WorkflowData data = item.getWorkflowData();
        String payloadPath = data.getPayload().toString();

        // 2. Read step arguments
        String recipient = args.get("recipient", "workflow-administrators");
        boolean createVersion = args.get("createVersion", false);

        // 3. Read/write shared workflow metadata
        MetaDataMap metadata = data.getMetaDataMap();
        String status = metadata.get("approvalStatus", "PENDING");
        metadata.put("processedBy", "my-custom-step");

        // 4. Access JCR if needed
        try {
            ResourceResolver resolver = session.adaptTo(ResourceResolver.class);
            Resource resource = resolver.getResource(payloadPath);
            // ... do work ...
        } catch (Exception e) {
            LOG.error("Error in MyCustomProcess for payload {}", payloadPath, e);
            throw new WorkflowException("Failed: " + e.getMessage(), e);
        }
        // Return normally = step completes, workflow advances
    }
}
```

## ParticipantStepChooser Template

```java
@Component(
    service = ParticipantStepChooser.class,
    property = {"chooser.label=Content Owner Chooser"}
)
public class ContentOwnerChooser implements ParticipantStepChooser {

    @Override
    public String getParticipant(WorkItem workItem, WorkflowSession session,
                                 MetaDataMap args) throws WorkflowException {
        String payloadPath = workItem.getWorkflowData().getPayload().toString();
        try {
            Session jcrSession = session.adaptTo(Session.class);
            Node content = jcrSession.getNode(payloadPath + "/jcr:content");
            if (content.hasProperty("cq:lastModifiedBy")) {
                return content.getProperty("cq:lastModifiedBy").getString();
            }
        } catch (RepositoryException e) {
            throw new WorkflowException("Cannot resolve participant", e);
        }
        return args.get("fallbackParticipant", "content-authors");
    }
}
```

## Guardrails

- Never use `ResourceResolverFactory.loginAdministrative()`. Always use a service user sub-service mapped via `ServiceUserMapper`.
- Do not call `Session.save()` on the workflow session's JCR session for payload changes — use a separate `ResourceResolver` obtained from `resolverFactory.getServiceResourceResolver()`.
- If a step must hold (not auto-advance), set `PROCESS_AUTO_ADVANCE=false` in the model metaData and use `TaskWorkflowProcess` or an external completion mechanism.
- Throw `WorkflowException` for retryable errors so the engine respects retry policy; log and rethrow for unexpected errors.
- Do not log full payload contents or metadata values at `INFO` — payloads may carry PII or confidential content. Log the payload path and a correlation key; log full values only at `DEBUG` against the local AEMaaCS SDK, never against cloud environments.
- Model XML and Java are co-authored. The `PROCESS=` value on a `cq:WorkflowNode` must resolve to either the fully qualified class name **or** the exact `process.label` of a deployed `WorkflowProcess`. A model that references a label you have not registered will fail at runtime with `Process not found`. Generate the Java class first, deploy through Cloud Manager and confirm it appears in the Model Editor step picker, then reference it from the model.
- **Avoid launcher re-trigger loops.** If your process step modifies a JCR path that any `cq:WorkflowLauncher` watches, the change will re-trigger the same workflow. The `session` parameter on `execute()` is a `WorkflowSession`, **not** a JCR `Session` — adapt it first: `javax.jcr.Session jcrSession = session.adaptTo(javax.jcr.Session.class);`. Then before the write, call `jcrSession.getWorkspace().getObservationManager().setUserData("workflowmanager")` — `WorkflowLauncherListener` ignores events tagged with that user data. If you write through a service-user `ResourceResolver` instead, tag *that* resolver's underlying `Session` the same way (it is a different `Session` instance and the flag does not propagate). See [workflow-launchers](../workflow-launchers/SKILL.md) for the alternative `excludeList` / JCR-flag patterns.

## References

- [process-step-patterns.md](./references/workflow-development/process-step-patterns.md) — WorkflowProcess patterns: payload access, metadata, error handling
- [participant-step-patterns.md](./references/workflow-development/participant-step-patterns.md) — ParticipantStepChooser patterns and completing participant steps
- [variables-and-metadata.md](./references/workflow-development/variables-and-metadata.md) — MetaDataMap, workflow variables, inter-step data
- [api-reference.md](./references/workflow-foundation/api-reference.md)
- [cloud-service-guardrails.md](./references/workflow-foundation/cloud-service-guardrails.md)
