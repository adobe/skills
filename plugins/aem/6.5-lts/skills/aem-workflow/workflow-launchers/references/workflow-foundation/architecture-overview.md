# Granite Workflow Engine — Architecture Overview (AEM 6.5 LTS)

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
- **Two JCR sessions** per job: one for workflow state (`/var/workflow/instances`), one for payload operations.
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
| `WorkflowProcess` | `process.label` | Display label in model editor |
| `ParticipantStepChooser` | `chooser.label` | Label in Dynamic Participant step config |

## 6.5-Specific: Felix SCR vs DS R6

Both Felix SCR (`org.apache.felix.scr.annotations.*`) and DS R6 (`org.osgi.service.component.annotations.*`) are supported on 6.5 LTS. DS R6 is preferred for new code.

## Thread Pool

Workflow jobs run on the Sling Job Queue `com/adobe/granite/workflow/job`. Configure via OSGi `org.apache.sling.event.impl.jobs.queues.QueueConfigurationImpl`.

Monitor at: `/system/console/slingevent` or **Tools → Workflow → Instances**.
