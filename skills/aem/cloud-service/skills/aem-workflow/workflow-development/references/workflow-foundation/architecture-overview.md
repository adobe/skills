# Granite Workflow Engine — Architecture Overview (AEM Cloud Service)

## Engine Flow

```
User / Launcher / API
        ↓
WorkflowSession.startWorkflow(model, data)
        ↓
Sling Event Job created
  topic: com/adobe/granite/workflow/job/**
  (transient: com/adobe/granite/workflow/transient/job/**)
        ↓
JobHandler.process()   ← consumes job, drives step loop
        ↓
For PROCESS nodes:     WorkflowProcess.execute(item, session, args)
For PARTICIPANT nodes: WorkItem persisted → Inbox / Task Management
For EXTERNAL_PROCESS:  ExternalProcessPollingHandler (polling job)
        ↓
On normal return:      workflow advances to next node
On WorkflowException:  retry (up to queue max), then FAILED + Inbox alert
```

## Key Design Points

- **Consecutive PROCESS steps** run in a single thread loop — no job re-queue between them.
- **Two JCR sessions** per job: one for workflow state (`/var/workflow/instances`), one for payload operations. Keeps payload changes isolated from engine state.
- **Transient workflows** create no JCR node until a retry or external process forces persistence.
- **InstanceLock** serializes concurrent access to the same workflow instance.

## Workflow Instance States

| State | Meaning |
|---|---|
| `RUNNING` | Active, steps executing |
| `SUSPENDED` | Paused at a Participant or Task step awaiting human action |
| `COMPLETED` | Terminal — all steps completed normally |
| `ABORTED` | Terminated by admin or a process step |
| `FAILED` | Exhausted retries; failure inbox item created |

## OSGi Registration Requirements

| SPI Interface | Required Property | Value |
|---|---|---|
| `WorkflowProcess` | `process.label` | Display label shown in model editor |
| `ParticipantStepChooser` | `chooser.label` | Label shown in Dynamic Participant step config |
| `WorkflowExternalProcess` | `process.label` | Same as WorkflowProcess |
| `RuleEngine` | (standard OSGi) | Used for OR-split rule evaluation |

## Thread Pool and Queues

Workflow jobs run on the **Sling Job Queue** named `com/adobe/granite/workflow/job`. Thread pool size and queue capacity are configured via:

- OSGi config: `org.apache.sling.event.impl.jobs.queues.QueueConfigurationImpl`
- Queue name: `com\/adobe\/granite\/workflow\/job\/.*`

Monitor queue depth at: **Tools → Workflow → Instances** or `/system/console/slingevent`.
