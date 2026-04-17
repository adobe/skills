---
name: workflow-development
description: Implement custom AEM Workflow Java components on AEM 6.5 LTS. Use when writing WorkflowProcess steps, ParticipantStepChooser implementations, registering services via Felix SCR or DS R6 OSGi annotations, reading step arguments from MetaDataMap, accessing JCR payload via WorkflowSession adapter, reading and writing workflow metadata and variables, and handling errors with WorkflowException for retry behavior.
license: Apache-2.0
---

# Workflow Development (AEM 6.5 LTS)

Implement custom workflow components for AEM 6.5 LTS: `WorkflowProcess`, `ParticipantStepChooser`, OSGi registration, metadata handling, and error patterns.

## Variant Scope

- AEM 6.5 LTS only.
- Both Felix SCR and DS R6 annotations are supported. DS R6 preferred for new code.
- Bundle deployed via Maven (`autoInstallBundle`) or Package Manager.

## Workflow

```text
Development Progress
- [ ] 1) Identify what the step does: process (auto) or participant (human) or dynamic participant
- [ ] 2) Create Java class implementing WorkflowProcess or ParticipantStepChooser
- [ ] 3) Register with @Component/@Service (Felix SCR) or @Component (DS R6) with service property
- [ ] 4) Read step arguments from MetaDataMap args
- [ ] 5) Access payload via item.getWorkflowData().getPayload().toString()
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

    @Reference
    private ResourceResolverFactory resolverFactory;

    @Override
    public void execute(WorkItem item, WorkflowSession session, MetaDataMap args)
            throws WorkflowException {
        String payloadPath = item.getWorkflowData().getPayload().toString();
        String myArg = args.get("myArgKey", "defaultValue");
        item.getWorkflowData().getMetaDataMap().put("processedBy", "my-step");
        // ... do work ...
    }
}
```

## WorkflowProcess Template — Felix SCR (Still Valid)

```java
@Component(metatype = false)
@Service(value = WorkflowProcess.class)
@Property(name = "process.label", value = "My Custom Process Step")
public class MyCustomProcess implements WorkflowProcess {

    @Reference
    private SlingRepository repository;

    @Override
    public void execute(WorkItem item, WorkflowSession session, MetaDataMap args)
            throws WorkflowException {
        // same body as DS R6 example
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

## References

- [process-step-patterns.md](./references/workflow-development/process-step-patterns.md) — WorkflowProcess patterns with Felix SCR and DS R6 examples
- [participant-step-patterns.md](./references/workflow-development/participant-step-patterns.md) — ParticipantStepChooser patterns and completing steps
- [variables-and-metadata.md](./references/workflow-development/variables-and-metadata.md) — MetaDataMap, workflow variables, inter-step data
- [api-reference.md](./references/workflow-foundation/api-reference.md)
- [65-lts-guardrails.md](./references/workflow-foundation/65-lts-guardrails.md)
