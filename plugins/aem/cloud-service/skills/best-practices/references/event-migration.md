> **Deprecated:** This file is superseded by the `event-migration` expert skill at
> [`../event-migration/SKILL.md`](../event-migration/SKILL.md). It will be removed once all
> five expert skills are in place. Do not update this file — update the skill instead.

# Event Migration Pattern

Covers two legacy event-listening styles on AEM as a Cloud Service:

1. **JCR observation (`eventListener` / BPA):** `javax.jcr.observation.EventListener` listening to **repository** changes via `onEvent(EventIterator)`.
2. **OSGi Event Admin (`eventHandler` / BPA):** `org.osgi.service.event.EventHandler` with **`handleEvent`** — often already OSGi, but must not hold heavy JCR/resolver work inline.

**Before path files:** [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md) (SCR → DS, service-user resolvers, SLF4J).

## First — pick the right target API

Not every legacy listener should become an OSGi `EventHandler`. Use this table:

| Legacy source is reacting to… | Cloud Service target | Reference |
|-------------------------------|----------------------|-----------|
| **Repository changes** (page, asset, property added / changed / removed) | **`org.apache.sling.api.resource.observation.ResourceChangeListener`** | [resource-change-listener.md](resource-change-listener.md) |
| External (cluster) repository changes | **`ExternalResourceChangeListener`** | [resource-change-listener.md](resource-change-listener.md) |
| `com.day.cq.replication.ReplicationEvent.EVENT_TOPIC` | OSGi `EventHandler` + `JobConsumer` | **this file** (Path B) |
| Workflow topics (`com/adobe/granite/workflow/*`) | OSGi `EventHandler` + `JobConsumer` | **this file** (Path B) |
| Custom OSGi Event Admin topic posted by another bundle | OSGi `EventHandler` + `JobConsumer` | **this file** (Path B) |
| Any other non-resource OSGi event | OSGi `EventHandler` + `JobConsumer` | **this file** (Path B) |

**Rule of thumb:** repository content events → `ResourceChangeListener`. Non-content OSGi events
(replication, workflow, custom) → OSGi `EventHandler`.

> The OSGi resource topics `org/apache/sling/api/resource/Resource/ADDED|CHANGED|REMOVED` are
> an internal Sling dispatcher detail that is now deprecated as an application-level API. Do not
> make a new `EventHandler` subscribe to them — use `ResourceChangeListener` for that.
> Legacy code that already does this and only needs minor cleanup can still be migrated per
> Path B; but for **new** work or major refactors, move it to `ResourceChangeListener`.

**Two paths based on source pattern (within this file):**
- **Path A (JCR observation → `ResourceChangeListener` when the source observes resources; OSGi `EventHandler` otherwise):** Source uses **`javax.jcr.observation.EventListener`** — replace JCR observation with the appropriate Sling API and offload work to a `JobConsumer`.
- **Path B (OSGi `EventHandler` with inline logic):** Source already uses **`org.osgi.service.event.EventHandler`** (correctly scoped to a non-resource topic) but runs resolver/session/node code inside **`handleEvent()`** — offload to a `JobConsumer`.

---

## Quick Examples

> Reminder: if the source watches **resources**, do not follow the examples below; route to
> [resource-change-listener.md](resource-change-listener.md) and use `ResourceChangeListener`
> as the target.

### Path A Example (JCR EventListener for a non-resource concern)

> **If the legacy listener observes repository content, stop — go to
> [resource-change-listener.md](resource-change-listener.md).** The example below shows a
> residual non-resource JCR use case that still needs migration through this module.

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
    EventConstants.EVENT_TOPIC + "=com/example/custom/topic"
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

### Route to [resource-change-listener.md](resource-change-listener.md) when the source observes *resources*

- Class implements `javax.jcr.observation.EventListener` **and** the `onEvent` body inspects
  JCR node / property paths (i.e. it is observing repository content).
- Class implements `EventHandler` and subscribes to `org/apache/sling/api/resource/Resource/*`
  (ADDED / CHANGED / REMOVED / PROVIDER_*).

In both cases the Cloud Service target is **`ResourceChangeListener`**, not an OSGi
`EventHandler`. Use the [resource-change-listener.md](resource-change-listener.md) module.

### Use Path A (this file) when ALL of these are true:
- Class implements `javax.jcr.observation.EventListener`.
- The `onEvent` body observes something that **cannot** be expressed through
  `ResourceChangeListener` (e.g. a JCR-level concern that has no resource-layer equivalent — rare).

**If Path A → read [`event-migration-path-a.md`](event-migration-path-a.md) and follow its steps.**

### Use Path B (this file) when ANY of these are true:
- Class already implements `org.osgi.service.event.EventHandler` subscribed to a
  **non-resource topic** (`ReplicationEvent.EVENT_TOPIC`, workflow topics, custom topics).
- `handleEvent(Event)` has inline business logic (ResourceResolver, JCR Session, Node operations).

**If Path B → read [`event-migration-path-b.md`](event-migration-path-b.md) and follow its steps.**

### Already compliant — skip migration:
- Class implements `EventHandler` for a non-resource topic and `handleEvent()` ONLY calls `jobManager.addJob()` — already the correct pattern.
- Class implements `ResourceChangeListener` correctly — confirm against [resource-change-listener.md](resource-change-listener.md).

## Event-Specific Rules

- **ROUTE FIRST** — resource-content observers go to [resource-change-listener.md](resource-change-listener.md), not this file.
- **CLASSIFY SECOND** — determine Path A or Path B before making any changes.
- **DO** offload ALL business logic from `handleEvent()` / `onEvent()` to a `JobConsumer`.
- **DO** keep `handleEvent()` lightweight — only extract event data and create a job.
- **DO NOT** subscribe a new `EventHandler` to `org/apache/sling/api/resource/Resource/*` —
  those topics are deprecated as an application API; use `ResourceChangeListener` instead.
- **DO** preserve event filtering logic (paths, property names, event types).
- **DO** add `TopologyEventListener` for handlers that should only run on the leader node.
- **DO** distribute `@Reference` fields: infrastructure services (e.g. `JobManager`) stay in the
  `EventHandler`; business logic services (e.g. `ResourceResolverFactory`) move to the
  `JobConsumer`.
- **DO NOT** put `ResourceResolver`, JCR `Session`, or `Node` operations in the `EventHandler`.
- **DO NOT** change the business logic — move it as-is to the `JobConsumer`.

## IMPORTANT

**Read ONLY the path file that matches your classification. Do NOT read both.**
