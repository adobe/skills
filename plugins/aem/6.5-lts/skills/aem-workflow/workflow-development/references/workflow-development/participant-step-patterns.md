# Participant Step Patterns — AEM Workflow Development

## Static Participant Step

Assigned to a fixed JCR principal in the model XML:

```xml
<node2
    jcr:primaryType="cq:WorkflowNode"
    title="Editorial Review"
    type="PARTICIPANT">
  <metaData
      jcr:primaryType="nt:unstructured"
      PARTICIPANT="content-editors"
      DESCRIPTION="Please review the draft and approve or reject"
      allowInboxSharing="{Boolean}true"/>
</node2>
```

The work item appears in the Inbox of all members of `content-editors`. The user clicks **Approve** or **Reject** (or custom routes) to advance the workflow.

## Dynamic Participant Chooser — Patterns

### Pattern 1: From Workflow Metadata

```java
@Component(service = ParticipantStepChooser.class,
           property = {"chooser.label=Workflow Metadata Assignee"})
public class MetadataAssigneeChooser implements ParticipantStepChooser {
    @Override
    public String getParticipant(WorkItem workItem, WorkflowSession session,
                                 MetaDataMap args) throws WorkflowException {
        String assignee = workItem.getWorkflowData()
                                  .getMetaDataMap().get("assignedTo", String.class);
        return assignee != null ? assignee : args.get("fallback", "workflow-administrators");
    }
}
```

### Pattern 2: From JCR Node Property

```java
@Component(service = ParticipantStepChooser.class,
           property = {"chooser.label=Content Owner Chooser"})
public class ContentOwnerChooser implements ParticipantStepChooser {
    @Override
    public String getParticipant(WorkItem workItem, WorkflowSession session,
                                 MetaDataMap args) throws WorkflowException {
        try {
            Session jcrSession = session.adaptTo(Session.class);
            String path = workItem.getWorkflowData().getPayload().toString() + "/jcr:content";
            if (jcrSession.nodeExists(path)) {
                Node content = jcrSession.getNode(path);
                if (content.hasProperty("cq:lastModifiedBy")) {
                    return content.getProperty("cq:lastModifiedBy").getString();
                }
            }
        } catch (RepositoryException e) {
            throw new WorkflowException("Cannot resolve content owner", e);
        }
        return args.get("fallbackParticipant", "content-authors");
    }
}
```

### Pattern 3: Project-Based Participant

```java
@Component(service = ParticipantStepChooser.class,
           property = {"chooser.label=Project Editors Chooser"})
public class ProjectEditorsChooser implements ParticipantStepChooser {
    @Override
    public String getParticipant(WorkItem workItem, WorkflowSession session,
                                 MetaDataMap args) throws WorkflowException {
        // project.path is set by ProjectTaskWorkflowProcess or a preceding step
        String projectPath = workItem.getWorkflowData()
                                     .getMetaDataMap().get("project.path", String.class);
        if (projectPath != null) {
            return projectPath + "/jcr:content/editors";
        }
        return "workflow-administrators";
    }
}
```

## Completing Participant Steps via Code

```java
// Retrieve available routes for the work item
List<Route> routes = session.getRoutes(workItem, false);
// false = non-backtrack routes (forward routes only)

// Find by name
Route targetRoute = routes.stream()
    .filter(r -> "Approve".equalsIgnoreCase(r.getName()))
    .findFirst()
    .orElseThrow(() -> new WorkflowException("Approve route not found"));

// Complete the step — workflow advances to next node
session.complete(workItem, targetRoute);
```

## Task Manager Integration (Suspend + Inbox Task)

`TaskWorkflowProcess` (label: `Task Manager Step`) is the recommended way to create human tasks on Cloud Service and 6.5:

1. Step creates a `Task` under `/var/taskmanagement/tasks/`
2. Stores `taskId` + `workItemId` in step metadata
3. Returns — workflow is **suspended** (PROCESS_AUTO_ADVANCE=false)
4. User completes task in Inbox
5. `TaskEventListener` → reads `workItemId` → calls `session.complete(workItem, route)`
6. Sets `lastTaskAction` and `lastTaskCompletedBy` in workflow metadata

Read result in subsequent step:
```java
String action = item.getWorkflowData().getMetaDataMap().get("lastTaskAction", "UNKNOWN");
// APPROVE, REJECT, or custom action ID
```

## Inbox Sharing

Set `allowInboxSharing=true` on the participant step to show the work item in all members' inboxes. A single member completing the task removes it from everyone else's inbox.

Use `allowExplicitSharing=true` to allow a user to explicitly share their inbox with another user via **Tools → User → Inbox Settings**.
