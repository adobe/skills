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

`ParticipantStepChooser.getParticipant()` must return a JCR `rep:principalName` (user ID or group ID), **never a path**. For AEM Projects, read the principal(s) from the project's `roles` node and return a principal name.

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
            ResourceResolver resolver = session.adaptTo(ResourceResolver.class);
            Resource roles = resolver.getResource(projectPath + "/jcr:content/roles");
            if (roles != null) {
                // 'editors' is a multi-value property of principal names (user/group IDs)
                String[] editors = roles.getValueMap().get("editors", String[].class);
                if (editors != null && editors.length > 0) {
                    return editors[0];
                }
            }
        }
        return args.get("fallbackParticipant", "workflow-administrators");
    }
}
```

### Pattern 4: Route to the Workflow Initiator

A very common need: notify or route a task back to whoever started the workflow. The `initiator` key is set by the engine on every workflow instance.

```java
@Component(service = ParticipantStepChooser.class,
           property = {"chooser.label=Workflow Initiator Chooser"})
public class InitiatorChooser implements ParticipantStepChooser {
    @Override
    public String getParticipant(WorkItem workItem, WorkflowSession session,
                                 MetaDataMap args) throws WorkflowException {
        String initiator = workItem.getWorkflowData()
                                   .getMetaDataMap().get("initiator", String.class);
        if (initiator == null || initiator.isEmpty()) {
            return args.get("fallbackParticipant", "workflow-administrators");
        }
        return initiator;
    }
}
```

In the model XML, reference this chooser from a `DYNAMIC_PARTICIPANT` step:

```xml
<node jcr:primaryType="cq:WorkflowNode"
      title="Notify Initiator"
      type="DYNAMIC_PARTICIPANT">
  <metaData jcr:primaryType="nt:unstructured"
            PARTICIPANT_CHOOSER="Workflow Initiator Chooser"
            DESCRIPTION="The acknowledgement message shown to the initiator."/>
</node>
```

Do **not** rely on a string like `PARTICIPANT="$initiator$"` or `PARTICIPANT="${initiator}"` in the static PARTICIPANT step — variable substitution in the static `PARTICIPANT` field is not consistently supported across 6.5 LTS releases. Use the chooser above.

## Notification-Only Participant Steps (Dialog Participant)

When the spec says "notify the initiator" or "send back to the requester," the cleanest 6.5 LTS implementation is a Participant or Dynamic Participant step whose only purpose is to surface a message in the user's Inbox; the user clicks a single route to acknowledge and the workflow ends.

```xml
<node jcr:primaryType="cq:WorkflowNode"
      title="No Promo Banner — Notify Initiator"
      type="DYNAMIC_PARTICIPANT">
  <metaData jcr:primaryType="nt:unstructured"
            PARTICIPANT_CHOOSER="Workflow Initiator Chooser"
            DESCRIPTION="No Promo Banner found on the page. Acknowledge to close."/>
</node>
```

Two design rules:

- One notification step per distinct outcome — do not multiplex outcomes through a shared step that decides the message in Java. Keeping outcomes as separate model nodes preserves the visual flow in the Model Editor.
- The `DESCRIPTION` is the message the user sees in their Inbox. Keep it short and action-oriented.

If a true email is required (not just an Inbox task), use the OOTB `Send Email` process step or a custom `WorkflowProcess` that calls the Day Communications Mail Service — that path is outside the scope of this skill.

## Completing Participant Steps via Code

```java
// Retrieve forward routes available from this work item.
// For back routes (rewind), use session.getBackRoutes(workItem).
List<Route> routes = session.getRoutes(workItem, false);

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
