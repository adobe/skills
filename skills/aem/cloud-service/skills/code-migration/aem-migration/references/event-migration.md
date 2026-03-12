# Event Migration Pattern

Migrates legacy JCR observation listeners and OSGi event handlers with inline business logic to Cloud Service compatible pattern: **lightweight EventHandler + Sling JobConsumer**.

**Two paths based on source pattern:**
- **Path A (JCR EventListener):** Source uses `javax.jcr.observation.EventListener` with `onEvent(EventIterator)` — needs JCR→OSGi conversion + offload to JobConsumer
- **Path B (OSGi EventHandler with inline logic):** Source already uses `org.osgi.service.event.EventHandler` but has business logic directly in `handleEvent()` — needs offload to JobConsumer

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
