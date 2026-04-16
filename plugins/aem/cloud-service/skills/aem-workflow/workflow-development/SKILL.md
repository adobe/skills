---
name: workflow-development
description: Implement custom AEM Workflow Java components on AEM as a Cloud Service. Use when writing WorkflowProcess steps, ParticipantStepChooser implementations, registering services via OSGi DS R6 annotations, reading step arguments from MetaDataMap, accessing JCR payload via WorkflowSession adapter, reading and writing workflow metadata and variables, and handling errors with WorkflowException for retry behavior.
license: Apache-2.0
---

# Workflow Development (Cloud Service)

Implement custom workflow components for AEM Cloud Service: `WorkflowProcess`, `ParticipantStepChooser`, OSGi registration, metadata handling, and error patterns.

## Variant Scope

- AEM Cloud Service only.
- Use OSGi DS R6 annotations (`org.osgi.service.component.annotations.*`). Do not use Felix SCR.
- Bundle goes into the `ui.apps` content package and is deployed via Cloud Manager pipeline.

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

- Never use `ResourceResolverFactory.loginAdministrative()`. Always use a service user sub-service.
- Do not call `Session.save()` on the workflow session's JCR session for payload changes — use a separate ResourceResolver obtained from `resolverFactory.getServiceResourceResolver()`.
- If a step must hold (not auto-advance), set `PROCESS_AUTO_ADVANCE=false` in the model metaData and use `TaskWorkflowProcess` or an external completion mechanism.

## References

- [process-step-patterns.md](./references/workflow-development/process-step-patterns.md) — WorkflowProcess patterns: payload access, metadata, error handling
- [participant-step-patterns.md](./references/workflow-development/participant-step-patterns.md) — ParticipantStepChooser patterns and completing participant steps
- [variables-and-metadata.md](./references/workflow-development/variables-and-metadata.md) — MetaDataMap, workflow variables, inter-step data
- [api-reference.md](./references/workflow-foundation/api-reference.md)
- [cloud-service-guardrails.md](./references/workflow-foundation/cloud-service-guardrails.md)
