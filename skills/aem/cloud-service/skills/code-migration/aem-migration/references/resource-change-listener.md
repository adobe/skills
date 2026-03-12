# Resource Change Listener / Event Listener Migration Pattern

Migrates legacy JCR observation listeners and OSGi event handlers with inline business logic to Cloud Service compatible pattern: **lightweight EventHandler + Sling JobConsumer**.

**Source patterns handled:**
- JCR `javax.jcr.observation.EventListener` with `onEvent(EventIterator)`
- OSGi `org.osgi.service.event.EventHandler` with inline business logic in `handleEvent(Event)`

**Target pattern:**
- OSGi `EventHandler` (lightweight — receives event, creates Sling Job)
- Sling `JobConsumer` (handles business logic asynchronously)

## Classification

No sub-paths — all source patterns transform to the same target (EventHandler + JobConsumer split).

Identify which source pattern the file uses:
- **JCR EventListener:** Has `implements EventListener`, `import javax.jcr.observation.*`, `onEvent(EventIterator)`
- **OSGi EventHandler with inline logic:** Has `implements EventHandler`, `handleEvent(Event)`, and business logic (ResourceResolver, JCR Session, etc.) directly inside `handleEvent()`

If the file already has `implements EventHandler` and already offloads to a Sling Job (i.e., `handleEvent()` only calls `jobManager.addJob()`), it may not need migration — verify and skip if already compliant.

## Pattern-Specific Rules

- **DO** convert JCR `EventListener` to OSGi `EventHandler`
- **DO** offload ALL business logic from `handleEvent()` to a `JobConsumer`
- **DO** keep `handleEvent()` lightweight — it should only extract event data and create a job
- **DO** map JCR event types to OSGi resource event topics
- **DO** preserve event filtering logic (paths, property names, event types)
- **DO NOT** put ResourceResolver, JCR Session, or Node operations in the EventHandler
- **DO NOT** change the business logic — move it as-is to the JobConsumer

---

# Transformation Steps

## R1: Migrate Felix SCR to OSGi DS annotations (if present)

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
    @Property(name = "job.consumer.type", value = "my/job/topic")
})

// AFTER (OSGi DS)
@Component(service = JobConsumer.class, property = {
    JobConsumer.PROPERTY_TOPICS + "=" + "my/job/topic"
})
```

## R2: Convert JCR EventListener to OSGi EventHandler (if applicable)

**Skip this step if the file already implements `EventHandler`.**

If the file implements JCR `EventListener`, convert to OSGi `EventHandler`:

```java
// BEFORE (JCR Observation)
import javax.jcr.observation.Event;
import javax.jcr.observation.EventListener;
import javax.jcr.observation.EventIterator;

public class ACLModificationListener implements EventListener {
    @Override
    public void onEvent(EventIterator events) {
        while (events.hasNext()) {
            Event event = events.nextEvent();
            if (event.getType() == Event.PROPERTY_CHANGED) {
                String path = event.getPath();
                // business logic...
            }
        }
    }
}

// AFTER (OSGi EventHandler — lightweight)
import org.osgi.service.event.Event;
import org.osgi.service.event.EventHandler;
import org.osgi.service.event.EventConstants;

@Component(service = EventHandler.class, immediate = true, property = {
    Constants.SERVICE_DESCRIPTION + "=Event Handler for ACL modifications",
    EventConstants.EVENT_TOPIC + "=org/apache/sling/api/resource/Resource/CHANGED",
    EventConstants.EVENT_FILTER + "=(path=/*/rep:policy)"
})
public class ACLModificationEventHandler implements EventHandler {
    @Reference
    private JobManager jobManager;

    @Override
    public void handleEvent(Event event) {
        String path = (String) event.getProperty("path");
        // offload to job (business logic goes to JobConsumer)
    }
}
```

**JCR event type to OSGi resource topic mapping:**

| JCR Event Type | OSGi Resource Event Topic |
|---------------|--------------------------|
| `Event.NODE_ADDED` | `org/apache/sling/api/resource/Resource/ADDED` |
| `Event.NODE_REMOVED` | `org/apache/sling/api/resource/Resource/REMOVED` |
| `Event.PROPERTY_CHANGED` | `org/apache/sling/api/resource/Resource/CHANGED` |
| `Event.PROPERTY_ADDED` | `org/apache/sling/api/resource/Resource/CHANGED` |
| `Event.PROPERTY_REMOVED` | `org/apache/sling/api/resource/Resource/CHANGED` |

**JCR event data to OSGi event property mapping:**

| JCR Event API | OSGi Event API |
|--------------|----------------|
| `event.getPath()` | `(String) event.getProperty("path")` |
| `event.getIdentifier()` | `(String) event.getProperty("resourceType")` |
| `event.getType()` | Determined by topic (no need to check type) |

## R3: Make EventHandler lightweight — offload to Sling Job

The `handleEvent()` method should ONLY:
1. Extract event data (path, properties, etc.)
2. Create a Sling Job with those properties
3. Return immediately

**Move ALL business logic out of handleEvent():**

```java
// BEFORE (inline business logic in handler)
@Override
public void handleEvent(Event event) {
    String path = (String) event.getProperty("path");
    try (ResourceResolver resolver = resourceResolverFactory.getServiceResourceResolver(AUTH_INFO)) {
        Resource resource = resolver.getResource(path + "/jcr:content");
        if (resource != null) {
            ModifiableValueMap map = resource.adaptTo(ModifiableValueMap.class);
            map.put("cq:lastReplicated", Calendar.getInstance());
            resolver.commit();
        }
    } catch (LoginException | PersistenceException ex) {
        LOG.error("Error", ex);
    }
}

// AFTER (lightweight — just creates a job)
@Override
public void handleEvent(Event event) {
    try {
        String path = ReplicationEvent.fromEvent(event).getReplicationAction().getPath();
        LOG.debug("Resource event: {} for path: {}", event.getTopic(), path);

        Map<String, Object> jobProperties = new HashMap<>();
        jobProperties.put("path", path);
        jobManager.addJob(JOB_TOPIC, jobProperties);
    } catch (Exception e) {
        LOG.error("Error handling event", e);
    }
}
```

**Add JobManager injection:**
```java
@Reference
private JobManager jobManager;

private static final String JOB_TOPIC = "com/example/acl/modification/job";
```

**Remove ResourceResolverFactory from EventHandler** — it moves to the JobConsumer.

## R4: Create the JobConsumer class

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
        JobConsumer.PROPERTY_TOPICS + "=" + "com/example/acl/modification/job"
    }
)
public class ACLModificationJobConsumer implements JobConsumer {

    private static final Logger LOG = LoggerFactory.getLogger(ACLModificationJobConsumer.class);

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

            // === EXISTING BUSINESS LOGIC FROM onEvent()/handleEvent() GOES HERE ===

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
- Move ALL business logic from `onEvent()`/`handleEvent()` into `process(Job)`
- Move business-logic `@Reference` fields here (e.g., `ResourceResolverFactory`)
- Extract job properties via `job.getProperty("key")` or `(Type) job.getProperty("key")`
- Return `JobResult.OK` on success, `JobResult.FAILED` on failure
- Replace `getAdministrativeResourceResolver()` with `getServiceResourceResolver()`
- Wrap ResourceResolver in try-with-resources

## R5: Replace System.out and e.printStackTrace() with SLF4J Logger

Replace in BOTH EventHandler and JobConsumer:

```java
// ADD after class declaration
private static final Logger LOG = LoggerFactory.getLogger(MyHandler.class);

// REPLACE
System.out.println("message")  ->  LOG.info("message")
e.printStackTrace()            ->  LOG.error("Error occurred", e)
```

## R6: Replace deprecated ResourceResolver APIs

In the JobConsumer, replace deprecated `getAdministrativeResourceResolver()`:

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

## R7: Add TopologyEventListener for leader election (if applicable)

If the event handler should only run on one instance in a cluster (e.g., replication handlers), add `TopologyEventListener`:

```java
@Component(service = { EventHandler.class, TopologyEventListener.class }, immediate = true, property = {
    EventConstants.EVENT_TOPIC + "=" + ReplicationEvent.EVENT_TOPIC
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
            // create job...
        }
    }
}
```

**Only add this if:**
- The handler processes replication events
- The handler should only fire on one node in the cluster
- The original code had leader-check logic

## R8: Update imports

**EventHandler class — Remove:**
```java
import javax.jcr.observation.Event;
import javax.jcr.observation.EventListener;
import javax.jcr.observation.EventIterator;
import org.apache.felix.scr.annotations.*;
import org.apache.sling.api.resource.ResourceResolverFactory;  // moves to JobConsumer
```

**EventHandler class — Add:**
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

- [ ] No `import javax.jcr.observation.*` remains (if converted from JCR EventListener)
- [ ] No Felix SCR annotations remain
- [ ] No business logic in `handleEvent()` — only event data extraction + job creation
- [ ] No `ResourceResolver`, `Session`, or `Node` operations in `handleEvent()`
- [ ] `@Component(service = EventHandler.class, property = { EVENT_TOPIC... })` is present
- [ ] `@Reference JobManager` is present
- [ ] `jobManager.addJob(TOPIC, properties)` is called
- [ ] Event topics are correctly mapped (JCR → OSGi)
- [ ] Event filtering preserves original filter logic (paths, types)
- [ ] SLF4J Logger is present
- [ ] No `System.out.` or `e.printStackTrace()` calls remain

## JobConsumer Checklist

- [ ] Implements `JobConsumer`
- [ ] Has `@Component(service = JobConsumer.class, property = { PROPERTY_TOPICS... })`
- [ ] Job topic matches the EventHandler topic
- [ ] Business logic from original `onEvent()`/`handleEvent()` is preserved
- [ ] Returns `JobResult.OK` or `JobResult.FAILED`
- [ ] No `getAdministrativeResourceResolver()` — uses `getServiceResourceResolver()`
- [ ] ResourceResolver in try-with-resources
- [ ] SLF4J Logger is present
- [ ] No `System.out.` or `e.printStackTrace()` calls remain
- [ ] Code compiles: `mvn clean compile`
