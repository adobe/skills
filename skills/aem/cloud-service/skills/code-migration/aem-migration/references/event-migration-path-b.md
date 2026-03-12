# Event Migration Path B: OSGi EventHandler with Inline Logic → Lightweight + JobConsumer

For classes that already implement `org.osgi.service.event.EventHandler` but have business logic (ResourceResolver, JCR Session, Node operations) directly inside `handleEvent()`.

This path keeps the EventHandler class but offloads all business logic to a new Sling JobConsumer.

---

## B1: Migrate Felix SCR to OSGi DS annotations (if present)

If the file uses Felix SCR annotations (`org.apache.felix.scr.annotations.*`), migrate to OSGi DS:

**Remove Felix SCR imports:**
```java
import org.apache.felix.scr.annotations.Component;
import org.apache.felix.scr.annotations.Service;
import org.apache.felix.scr.annotations.Properties;
import org.apache.felix.scr.annotations.Property;
import org.apache.felix.scr.annotations.Reference;
```

**Replace annotations:**
```java
// BEFORE (Felix SCR)
@Component(immediate = true)
@Service
@Properties({
    @Property(name = EventConstants.EVENT_TOPIC, value = ReplicationEvent.EVENT_TOPIC)
})

// AFTER (OSGi DS)
@Component(service = EventHandler.class, immediate = true, property = {
    EventConstants.EVENT_TOPIC + "=" + ReplicationEvent.EVENT_TOPIC
})
```

## B2: Make EventHandler lightweight — offload to Sling Job

The `handleEvent()` method should ONLY:
1. Extract event data (path, properties, event type, etc.)
2. Create a Sling Job with those properties
3. Return immediately

**Move ALL business logic out of handleEvent().**

**Replication event example:**
```java
// BEFORE (inline business logic in handler)
@Override
public void handleEvent(Event event) {
    if (ReplicationEvent.fromEvent(event).getReplicationAction().getType().equals(ReplicationActionType.ACTIVATE)) {
        try (ResourceResolver resourceResolver = resourceResolverFactory.getServiceResourceResolver(AUTH_INFO)) {
            Resource resource = resourceResolver.getResource(event.getPath() + "/jcr:content");
            if (resource != null) {
                ModifiableValueMap map = resource.adaptTo(ModifiableValueMap.class);
                map.put("cq:lastReplicated", Calendar.getInstance());
                resource.getResourceResolver().commit();
            }
        } catch (LoginException | PersistenceException ex) {
            LOG.error("Error", ex);
        }
    }
}

// AFTER (lightweight — just creates a job)
@Override
public void handleEvent(Event event) {
    try {
        String path = ReplicationEvent.fromEvent(event).getReplicationAction().getPath();
        LOG.debug("Resource event: {} for path: {}", event.getTopic(), path);

        if (ReplicationEvent.fromEvent(event).getReplicationAction().getType().equals(ReplicationActionType.ACTIVATE)) {
            Map<String, Object> jobProperties = new HashMap<>();
            jobProperties.put("path", path);
            if (isLeader) {
                jobManager.addJob(JOB_TOPIC, jobProperties);
            }
        }
    } catch (Exception e) {
        LOG.error("Error handling event", e);
    }
}
```

**Workflow event example:**
```java
// BEFORE (inline business logic)
@Override
public void handleEvent(Event event) {
    WorkflowEvent wfevent = (WorkflowEvent) event;
    if (wfevent.getEventType().equals(WorkflowEvent.WORKFLOW_COMPLETED_EVENT)) {
        String path = (String) event.getProperty("path");
        Session session = resourceResolver.adaptTo(Session.class);
        Node node = session.getNode(path);
        node.setProperty("property", "Updated Value");
        session.save();
    }
}

// AFTER (lightweight)
@Override
public void handleEvent(Event event) {
    WorkflowEvent wfevent = (WorkflowEvent) event;
    if (wfevent.getEventType().equals(WorkflowEvent.WORKFLOW_COMPLETED_EVENT)) {
        String path = (String) event.getProperty("path");
        Map<String, Object> jobProperties = new HashMap<>();
        jobProperties.put("path", path);
        jobManager.addJob("workflow/completion/job", jobProperties);
    }
}
```

**Add JobManager injection:**
```java
@Reference
private JobManager jobManager;

private static final String JOB_TOPIC = "com/example/event/job";
```

**Remove ResourceResolverFactory from EventHandler** — it moves to the JobConsumer.

## B3: Create the JobConsumer class

Create a NEW class that implements `JobConsumer` to handle the business logic:

```java
package com.example.listeners;

import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.apache.sling.event.jobs.Job;
import org.apache.sling.event.jobs.consumer.JobConsumer;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.Collections;

@Component(
    service = JobConsumer.class,
    immediate = true,
    property = {
        JobConsumer.PROPERTY_TOPICS + "=" + "com/example/event/job"
    }
)
public class ReplicationJobConsumer implements JobConsumer {

    private static final Logger LOG = LoggerFactory.getLogger(ReplicationJobConsumer.class);

    @Reference
    private ResourceResolverFactory resolverFactory;

    @Override
    public JobResult process(final Job job) {
        String path = (String) job.getProperty("path");
        LOG.info("Processing job for path: {}", path);

        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "event-handler-service"))) {

            if (resolver == null) {
                LOG.warn("Could not acquire resource resolver");
                return JobResult.FAILED;
            }

            // === EXISTING BUSINESS LOGIC FROM handleEvent() GOES HERE ===

            return JobResult.OK;

        } catch (LoginException e) {
            LOG.error("Failed to get resource resolver", e);
            return JobResult.FAILED;
        } catch (Exception e) {
            LOG.error("Error processing job", e);
            return JobResult.FAILED;
        }
    }
}
```

**Key rules for JobConsumer:**
- Job topic MUST match the topic used in the EventHandler
- Move ALL business logic from `handleEvent()` into `process(Job)`
- Move business-logic `@Reference` fields here (e.g., `ResourceResolverFactory`)
- Extract job properties via `job.getProperty("key")` or `(Type) job.getProperty("key")`
- Return `JobResult.OK` on success, `JobResult.FAILED` on failure
- Replace `getAdministrativeResourceResolver()` or `getWriteResourceResolver()` with `getServiceResourceResolver()`
- Wrap ResourceResolver in try-with-resources

## B4: Replace System.out and e.printStackTrace() with SLF4J Logger

Replace in BOTH EventHandler and JobConsumer:

```java
// ADD after class declaration
private static final Logger LOG = LoggerFactory.getLogger(MyHandler.class);

// REPLACE
System.out.println("message")  ->  LOG.info("message")
e.printStackTrace()            ->  LOG.error("Error occurred", e)
```

## B5: Replace deprecated ResourceResolver APIs

In the JobConsumer, replace deprecated `getAdministrativeResourceResolver()` or `getWriteResourceResolver()`:

```java
// BEFORE (deprecated)
ResourceResolver resolver = resourceResolverFactory.getAdministrativeResourceResolver(null);
// or
ResourceResolver resolver = resourceResolverService.getWriteResourceResolver();

// AFTER
try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
        Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "event-handler-service"))) {
    // use resolver
} catch (LoginException e) {
    LOG.error("Failed to get resource resolver", e);
}
```

## B6: Add TopologyEventListener for replication handlers (if applicable)

If the event handler processes replication events and should only run on one instance in a cluster, add `TopologyEventListener`:

```java
@Component(service = { EventHandler.class, TopologyEventListener.class }, immediate = true, property = {
    EventConstants.EVENT_TOPIC + "=" + ReplicationEvent.EVENT_TOPIC,
    EventConstants.EVENT_FILTER + "(" + ReplicationAction.PROPERTY_TYPE + "=ACTIVATE)"
})
public class PublishDateEventHandler implements EventHandler, TopologyEventListener {

    private volatile boolean isLeader = false;

    @Override
    public void handleTopologyEvent(TopologyEvent event) {
        if (event.getType() == TopologyEvent.Type.TOPOLOGY_CHANGED
                || event.getType() == TopologyEvent.Type.TOPOLOGY_INIT) {
            isLeader = event.getNewView().getLocalInstance().isLeader();
        }
    }

    @Override
    public void handleEvent(Event event) {
        if (isLeader) {
            Map<String, Object> jobProperties = new HashMap<>();
            jobProperties.put("path", ReplicationEvent.fromEvent(event).getReplicationAction().getPath());
            jobManager.addJob(JOB_TOPIC, jobProperties);
        }
    }
}
```

**Only add this if:**
- The handler processes replication events (`ReplicationEvent.EVENT_TOPIC`)
- The handler should only fire on one node in the cluster
- The original code had leader-check logic or similar singleton behavior

## B7: Update imports

**EventHandler class — Remove:**
```java
import org.apache.felix.scr.annotations.*;
import org.apache.sling.api.resource.ResourceResolverFactory;  // moves to JobConsumer
```

**EventHandler class — Add (if not already present):**
```java
import org.osgi.service.event.Event;
import org.osgi.service.event.EventConstants;
import org.osgi.service.event.EventHandler;
import org.osgi.framework.Constants;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.apache.sling.event.jobs.JobManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.HashMap;
import java.util.Map;
```

**If using TopologyEventListener, also add:**
```java
import org.apache.sling.discovery.TopologyEvent;
import org.apache.sling.discovery.TopologyEventListener;
```

**JobConsumer class — Remove:**
```java
import org.apache.felix.scr.annotations.*;
```

**JobConsumer class — Add:**
```java
import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.apache.sling.event.jobs.Job;
import org.apache.sling.event.jobs.consumer.JobConsumer;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.Collections;
```

---

# Validation

## EventHandler Checklist

- [ ] No Felix SCR annotations remain
- [ ] `@Component(service = EventHandler.class, property = { EVENT_TOPIC... })` is present
- [ ] No business logic in `handleEvent()` — only event data extraction + job creation
- [ ] No `ResourceResolver`, `Session`, or `Node` operations in `handleEvent()`
- [ ] `@Reference JobManager` is present
- [ ] `jobManager.addJob(TOPIC, properties)` is called
- [ ] Event filtering preserves original filter logic (paths, types, property names)
- [ ] SLF4J Logger is present
- [ ] No `System.out.` or `e.printStackTrace()` calls remain
- [ ] Replication handlers implement `TopologyEventListener` and check `isLeader` (if applicable)

## JobConsumer Checklist

- [ ] Implements `JobConsumer`
- [ ] Has `@Component(service = JobConsumer.class, property = { PROPERTY_TOPICS... })`
- [ ] Job topic matches the EventHandler topic
- [ ] Business logic from original `handleEvent()` is preserved
- [ ] Returns `JobResult.OK` or `JobResult.FAILED`
- [ ] No `getAdministrativeResourceResolver()` or `getWriteResourceResolver()` — uses `getServiceResourceResolver()`
- [ ] ResourceResolver in try-with-resources
- [ ] SLF4J Logger is present
- [ ] No `System.out.` or `e.printStackTrace()` calls remain
- [ ] Code compiles: `mvn clean compile`
