# Process Step Patterns — AEM Workflow Development

## Pattern 1: Read Payload and Process Content

```java
@Override
public void execute(WorkItem item, WorkflowSession session, MetaDataMap args)
        throws WorkflowException {
    String payloadPath = item.getWorkflowData().getPayload().toString();

    // Verify payload type
    if (!"JCR_PATH".equals(item.getWorkflowData().getPayloadType())) {
        return; // only handles JCR_PATH payloads
    }

    ResourceResolver resolver = session.adaptTo(ResourceResolver.class);
    Resource resource = resolver.getResource(payloadPath);
    if (resource == null) {
        throw new WorkflowException("Payload not found: " + payloadPath);
    }
    ValueMap props = resource.getValueMap();
    String title = props.get("jcr:title", String.class);
}
```

## Pattern 2: Read Step Arguments

Arguments are set in the Workflow Model Editor → step Properties → Arguments tab.

```java
// Single string arg
String targetPath = args.get("targetPath", "/content/default");

// Boolean arg
boolean activate = args.get("activateOnComplete", false);

// Legacy PROCESS_ARGS comma-separated
String rawArgs = args.get("PROCESS_ARGS", "");
String[] parts = StringUtils.split(rawArgs, ",");

// Multi-value string array (configured as "tag1,tag2" or String[])
String[] tags = args.get("cq:tags", new String[0]);
```

## Pattern 3: Write Workflow Metadata for Next Steps

```java
MetaDataMap metadata = item.getWorkflowData().getMetaDataMap();

// Store computed result
metadata.put("approvalStatus", "READY_FOR_REVIEW");
metadata.put("processedAt", Calendar.getInstance());
metadata.put("assignedGroup", resolveReviewGroup(payloadPath));
```

## Pattern 4: Advance a Participant Step Programmatically

```java
// Used inside a task completion listener or custom step
List<Route> routes = session.getRoutes(workItem, false);
Route approveRoute = routes.stream()
    .filter(r -> "Approve".equalsIgnoreCase(r.getName()))
    .findFirst()
    .orElse(routes.get(0));

// Store decision before completing
item.getWorkflowData().getMetaDataMap().put("reviewDecision", "APPROVE");
session.complete(workItem, approveRoute);
```

## Pattern 5: Use a Separate ResourceResolver for JCR Writes

The `session.adaptTo(ResourceResolver.class)` resolver is tied to the workflow system user and may have limited write ACLs. For payload writes, use your service user:

```java
Map<String, Object> auth = Collections.singletonMap(
    ResourceResolverFactory.SUBSERVICE, "workflow-process");
try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(auth)) {
    Resource res = resolver.getResource(payloadPath + "/jcr:content");
    if (res != null) {
        ModifiableValueMap map = res.adaptTo(ModifiableValueMap.class);
        map.put("cq:reviewStatus", "approved");
        resolver.commit();
    }
}
```

## Pattern 6: Iterate a Workflow Package Payload

```java
@Reference
private ResourceCollectionManager rcManager;

@Override
public void execute(WorkItem item, WorkflowSession session, MetaDataMap args)
        throws WorkflowException {
    WorkflowData data = item.getWorkflowData();
    if ("JCR_PATH".equals(data.getPayloadType())) {
        ResourceResolver resolver = session.adaptTo(ResourceResolver.class);
        Resource payload = resolver.getResource(data.getPayload().toString());
        ResourceCollection collection = rcManager.getResourceCollection(payload);
        if (collection != null) {
            // Multi-page workflow package
            collection.list(new String[]{"cq:Page", "dam:Asset"})
                      .forEachRemaining(node -> processNode(node));
        } else {
            processNode(payload.adaptTo(Node.class));
        }
    }
}
```

## Error Handling Matrix

| Situation | Action | Engine behavior |
|---|---|---|
| Transient error (network, lock) | `throw new WorkflowException(msg, cause)` | Retry (up to queue limit) |
| Permanent failure | Log + `throw new WorkflowException(msg)` | After retries: FAILED state + Inbox alert |
| Business skip (not an error) | Return normally | Workflow advances |
| Hold for external event | Use TaskWorkflowProcess or EXTERNAL_PROCESS | Step remains SUSPENDED |

## Testing

```java
@Test
public void testExecute() throws WorkflowException {
    WorkItem mockItem = mock(WorkItem.class);
    WorkflowData mockData = mock(WorkflowData.class);
    MetaDataMap mockMeta = new SimpleMetaDataMap();

    when(mockItem.getWorkflowData()).thenReturn(mockData);
    when(mockData.getPayload()).thenReturn("/content/test");
    when(mockData.getPayloadType()).thenReturn("JCR_PATH");
    when(mockData.getMetaDataMap()).thenReturn(mockMeta);

    WorkflowSession mockSession = mock(WorkflowSession.class);
    MetaDataMap args = new SimpleMetaDataMap();
    args.put("myArg", "testValue");

    new MyCustomProcess().execute(mockItem, mockSession, args);

    assertEquals("expected", mockMeta.get("resultKey", String.class));
}
```
