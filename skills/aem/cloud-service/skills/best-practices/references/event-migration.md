# Event Migration Pattern

Migrates two legacy styles into one Cloud Service–compatible pattern — **lightweight OSGi `EventHandler` + Sling `JobConsumer`**:

1. **JCR observation (`eventListener` / BPA):** `javax.jcr.observation.EventListener` listening to **repository** changes via `onEvent(EventIterator)`.
2. **OSGi Event Admin (`eventHandler` / BPA):** `org.osgi.service.event.EventHandler` with **`handleEvent`** — often already OSGi, but must not hold heavy JCR/resolver work inline.

**Before path files:** [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md) (SCR→DS, resolver, logging).

**Two paths based on source pattern:**
- **Path A (JCR observation → OSGi):** Source uses **`javax.jcr.observation.EventListener`** — replace JCR observation with OSGi topics + offload work to JobConsumer.
- **Path B (OSGi `EventHandler` with inline logic):** Source already uses **`org.osgi.service.event.EventHandler`** but runs resolver/session/node code inside **`handleEvent()`** — offload to JobConsumer only.

---

## Quick Examples

### Path A Example (JCR EventListener)

**Before:**
```java
public class MyListener implements EventListener {
    @Override
    public void onEvent(EventIterator events) {
        while (events.hasNext()) {
            Event event = events.nextEvent();
            ResourceResolver resolver = factory.getAdministrativeResourceResolver(null);
            // business logic
        }
    }
}
```

**After (Split into 2 classes):**

**EventHandler.java:**
```java
@Component(service = EventHandler.class, property = {
    EventConstants.EVENT_TOPIC + "=org/apache/sling/api/resource/Resource/CHANGED"
})
public class MyEventHandler implements EventHandler {
    @Reference private JobManager jobManager;
    
    @Override
    public void handleEvent(Event event) {
        Map<String, Object> props = Map.of("path", event.getProperty("path"));
        jobManager.addJob("my/job/topic", props);
    }
}
```

**JobConsumer.java:**
```java
@Component(service = JobConsumer.class, property = {
    JobConsumer.PROPERTY_TOPICS + "=my/job/topic"
})
public class MyJobConsumer implements JobConsumer {
    @Override
    public JobResult process(Job job) {
        // business logic from onEvent()
        return JobResult.OK;
    }
}
```

### Path B Example (OSGi EventHandler with Inline Logic)

**Before:**
```java
@Component(service = EventHandler.class)
public class MyHandler implements EventHandler {
    @Override
    public void handleEvent(Event event) {
        ResourceResolver resolver = factory.getServiceResourceResolver(...);
        // business logic directly in handler
        resolver.commit();
    }
}
```

**After (Split into 2 classes):**

**EventHandler.java:**
```java
@Component(service = EventHandler.class)
public class MyHandler implements EventHandler {
    @Reference private JobManager jobManager;
    
    @Override
    public void handleEvent(Event event) {
        jobManager.addJob("my/job/topic", Map.of("path", event.getProperty("path")));
    }
}
```

**JobConsumer.java:**
```java
@Component(service = JobConsumer.class, property = {
    JobConsumer.PROPERTY_TOPICS + "=my/job/topic"
})
public class MyJobConsumer implements JobConsumer {
    @Override
    public JobResult process(Job job) {
        // business logic from handleEvent()
        return JobResult.OK;
    }
}
```

---

## Classification

**Classify BEFORE making any changes.**

### Use Path A when ALL of these are true:
- Class implements `javax.jcr.observation.EventListener`
- Has `onEvent(EventIterator)` method
- Uses `import javax.jcr.observation.*`

**If Path A → read `resources/event-migration-path-a.md` and follow its steps.**

### Use Path B when ANY of these are true:
- Class already implements `org.osgi.service.event.EventHandler`
- Has `handleEvent(Event)` with inline business logic (ResourceResolver, JCR Session, Node operations)
- Replication event handler using `ReplicationEvent.EVENT_TOPIC` with inline processing
- Workflow event handler using `WorkflowEvent` with Session/Node operations in handler

**If Path B → read `resources/event-migration-path-b.md` and follow its steps.**

### Already compliant — skip migration:
- Class implements `EventHandler` and `handleEvent()` ONLY calls `jobManager.addJob()` — already uses the correct pattern

## Event-Specific Rules

- **CLASSIFY FIRST** — determine Path A or Path B before making any changes
- **DO** convert JCR `EventListener` to OSGi `EventHandler` (Path A only)
- **DO** offload ALL business logic from `handleEvent()` / `onEvent()` to a `JobConsumer`
- **DO** keep `handleEvent()` lightweight — only extract event data and create a job
- **DO** map JCR event types to OSGi resource event topics (Path A only)
- **DO** preserve event filtering logic (paths, property names, event types)
- **DO** add `TopologyEventListener` for replication handlers that should only run on leader node
- **DO** distribute `@Reference` fields: infrastructure services (e.g., `JobManager`) stay in EventHandler, business logic services (e.g., `ResourceResolverFactory`) move to JobConsumer
- **DO NOT** put ResourceResolver, JCR Session, or Node operations in the EventHandler
- **DO NOT** change the business logic — move it as-is to the JobConsumer

## IMPORTANT

**Read ONLY the path file that matches your classification. Do NOT read both.**
