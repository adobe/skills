# Event Migration Path B: OSGi EventHandler with Inline Logic → Lightweight + JobConsumer

For classes that already implement `org.osgi.service.event.EventHandler` but have business logic (ResourceResolver, JCR Session, Node operations) directly inside `handleEvent()`.

This path keeps the EventHandler class but offloads all business logic to a new Sling JobConsumer.

---

## Complete Example: Before and After

### Before (Legacy OSGi EventHandler with Inline Logic)

```java
package com.example.listeners;

import org.apache.felix.scr.annotations.Component;
import org.apache.felix.scr.annotations.Reference;
import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ModifiableValueMap;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.osgi.service.event.Event;
import org.osgi.service.event.EventConstants;
import org.osgi.service.event.EventHandler;

import java.util.Calendar;
import java.util.Collections;

@Component(
    immediate = true,
    property = {
        EventConstants.EVENT_TOPIC + "=org/apache/sling/api/resource/Resource/CHANGED"
    }
)
public class ReplicationDateEventHandler implements EventHandler {

    @Reference
    private ResourceResolverFactory resourceResolverFactory;

    @Override
    public void handleEvent(Event event) {
        String path = (String) event.getProperty("path");
        try {
            ResourceResolver resolver = resourceResolverFactory.getServiceResourceResolver(
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "replication-service"));
            
            if (resolver != null) {
                // Business logic: update replication date
                Resource resource = resolver.getResource(path + "/jcr:content");
                if (resource != null) {
                    ModifiableValueMap map = resource.adaptTo(ModifiableValueMap.class);
                    map.put("cq:lastReplicated", Calendar.getInstance());
                    resolver.commit();
                }
                resolver.close();
            }
        } catch (Exception e) {
            System.err.println("Error updating replication date: " + e.getMessage());
            e.printStackTrace();
        }
    }
}
```

### After (Cloud Service Compatible)

**File 1: ReplicationDateEventHandler.java** (Lightweight EventHandler)

```java
package com.example.listeners;

import org.osgi.framework.Constants;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.osgi.service.event.Event;
import org.osgi.service.event.EventConstants;
import org.osgi.service.event.EventHandler;
import org.apache.sling.event.jobs.JobManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.Map;

@Component(
    service = EventHandler.class,
    immediate = true,
    property = {
        Constants.SERVICE_DESCRIPTION + "=Event Handler for replication date updates",
        EventConstants.EVENT_TOPIC + "=org/apache/sling/api/resource/Resource/CHANGED"
    }
)
public class ReplicationDateEventHandler implements EventHandler {

    private static final Logger LOG = LoggerFactory.getLogger(ReplicationDateEventHandler.class);
    private static final String JOB_TOPIC = "com/example/replication/date/update";

    @Reference
    private JobManager jobManager;

    @Override
    public void handleEvent(Event event) {
        try {
            String path = (String) event.getProperty("path");
            LOG.debug("Resource event: {} for path: {}", event.getTopic(), path);

            Map<String, Object> jobProperties = new HashMap<>();
            jobProperties.put("path", path);
            jobManager.addJob(JOB_TOPIC, jobProperties);
        } catch (Exception e) {
            LOG.error("Error handling event", e);
        }
    }
}
```

**File 2: ReplicationDateJobConsumer.java** (JobConsumer)

```java
package com.example.listeners;

import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ModifiableValueMap;
import org.apache.sling.api.resource.PersistenceException;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.apache.sling.event.jobs.Job;
import org.apache.sling.event.jobs.consumer.JobConsumer;
import org.apache.sling.event.jobs.consumer.JobResult;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Calendar;
import java.util.Collections;

@Component(
    service = JobConsumer.class,
    immediate = true,
    property = {
        JobConsumer.PROPERTY_TOPICS + "=" + "com/example/replication/date/update"
    }
)
public class ReplicationDateJobConsumer implements JobConsumer {

    private static final Logger LOG = LoggerFactory.getLogger(ReplicationDateJobConsumer.class);

    @Reference
    private ResourceResolverFactory resolverFactory;

    @Override
    public JobResult process(final Job job) {
        String path = (String) job.getProperty("path");
        LOG.info("Processing replication date update job for path: {}", path);

        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "event-handler-service"))) {

            if (resolver == null) {
                LOG.warn("Could not acquire resource resolver");
                return JobResult.FAILED;
            }

            // Business logic: update replication date
            Resource resource = resolver.getResource(path + "/jcr:content");
            if (resource != null) {
                ModifiableValueMap map = resource.adaptTo(ModifiableValueMap.class);
                map.put("cq:lastReplicated", Calendar.getInstance());
                resolver.commit();
                LOG.debug("Updated replication date for: {}", path);
            }

            return JobResult.OK;

        } catch (LoginException e) {
            LOG.error("Failed to get resource resolver", e);
            return JobResult.FAILED;
        } catch (PersistenceException e) {
            LOG.error("Failed to commit changes", e);
            return JobResult.FAILED;
        } catch (Exception e) {
            LOG.error("Error processing job", e);
            return JobResult.FAILED;
        }
    }
}
```

**Key Changes:**
- ✅ Split EventHandler + JobConsumer
- ✅ EventHandler is lightweight — only creates jobs
- ✅ Business logic moved to JobConsumer `process()` method
- ✅ Replaced `System.out/err` → SLF4J Logger
- ✅ Used try-with-resources for ResourceResolver
- ✅ Preserved business logic unchanged

---

## Pattern prerequisites

Read [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md) before the steps below.

## B1: Make EventHandler lightweight — offload to Sling Job

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

## B2: Create the JobConsumer class

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
- Resolver + logging per [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md)

## B3: Add TopologyEventListener for replication handlers (if applicable)

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

## B4: Update imports

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

- [ ] SCR→DS per [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md)
- [ ] `@Component(service = EventHandler.class, property = { EVENT_TOPIC... })` is present
- [ ] No business logic in `handleEvent()` — only event data extraction + job creation
- [ ] No `ResourceResolver`, `Session`, or `Node` operations in `handleEvent()`
- [ ] `@Reference JobManager` is present
- [ ] `jobManager.addJob(TOPIC, properties)` is called
- [ ] Event filtering preserves original filter logic (paths, types, property names)
- [ ] Logging per [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md)
- [ ] Replication handlers implement `TopologyEventListener` and check `isLeader` (if applicable)

## JobConsumer Checklist

- [ ] Implements `JobConsumer`
- [ ] Has `@Component(service = JobConsumer.class, property = { PROPERTY_TOPICS... })`
- [ ] Job topic matches the EventHandler topic
- [ ] Business logic from original `handleEvent()` is preserved
- [ ] Returns `JobResult.OK` or `JobResult.FAILED`
- [ ] Resolver + logging per [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md)
- [ ] Code compiles: `mvn clean compile`
