> **Deprecated:** This file is superseded by the `resource-change-listener` expert skill at
> [`../resource-change-listener/SKILL.md`](../resource-change-listener/SKILL.md). It will be removed
> once all five expert skills are in place. Do not update this file — update the skill instead.

# Sling `ResourceChangeListener` (AEM as a Cloud Service)

BPA pattern id: **`resourceChangeListener`**.

Covers existing or newly authored `org.apache.sling.api.resource.observation.ResourceChangeListener`
implementations and how they must be shaped for **AEM as a Cloud Service** — a lightweight listener
that offloads all business logic to a Sling **`JobConsumer`**.

**Before transformation steps:** [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md)
(SCR → OSGi DS, service-user resolvers, SLF4J).

---

## Why `ResourceChangeListener` is the target API

On AEM as a Cloud Service, Sling **`ResourceChangeListener`** is the preferred API for reacting
to repository changes:

- First-class Sling API with typed **`ResourceChange`** events and a typed **`ChangeType`** enum.
- **Cluster-aware**: external (remote-node) vs local changes are flagged via `change.isExternal()`.
- **Path-prefix** and **change-type** filtering are native OSGi component properties — no LDAP filter required.
- No JCR `Session` handling in the listener itself.

**Do not** use the following as a replacement:

| Legacy / discouraged on AEMaaCS | Reason |
|---------------------------------|--------|
| `javax.jcr.observation.EventListener` (`onEvent(EventIterator)`) | Requires a `Session`, is not cluster-aware, not recommended by Adobe for AEMaaCS. Migrate to `ResourceChangeListener`. |
| `org.osgi.service.event.EventHandler` subscribed to `org/apache/sling/api/resource/Resource/*` topics | The OSGi resource topics are an internal dispatcher detail and are deprecated as an application-facing API. Use `ResourceChangeListener` instead. |
| `org.osgi.service.event.EventHandler` for **non-resource** topics (replication, workflow, custom) | Still valid — see [event-migration.md](event-migration.md). |

## Decision table — which API for which event

| Reacting to… | Use |
|--------------|-----|
| Resource (page/asset/property) added, changed, removed | **`ResourceChangeListener`** |
| External (remote-node) change to content | **`ResourceChangeListener`** — implement **`ExternalResourceChangeListener`** |
| Sling resource provider added/removed | **`ResourceChangeListener`** with `CHANGES=PROVIDER_ADDED/PROVIDER_REMOVED` |
| Replication action (`com.day.cq.replication.ReplicationEvent.EVENT_TOPIC`) | OSGi `EventHandler` — see [event-migration.md](event-migration.md) |
| Workflow completion (`com/adobe/granite/workflow/*`) | OSGi `EventHandler` — see [event-migration.md](event-migration.md) |
| Custom OSGi Event Admin topic posted by another bundle | OSGi `EventHandler` — see [event-migration.md](event-migration.md) |
| JCR-level events that `ResourceChangeListener` cannot express (rare) | **Avoid custom JCR listeners on AEMaaCS**; file an Adobe support case before adding one. |

## `ResourceChangeListener` vs `ExternalResourceChangeListener`

| Interface | Receives | When to use |
|-----------|----------|-------------|
| `ResourceChangeListener` | Only **local** changes (same JVM) | Most write-triggers (e.g. post-process what *this* pod just wrote) |
| `ExternalResourceChangeListener` **extends** `ResourceChangeListener` | **Local** *and* **external** (cluster / replicated) changes | Cluster-wide reactions (e.g. cache invalidation on publish, replication follow-ups) |

Choose based on whether the reaction must fire **on every node** when any node writes
(`ExternalResourceChangeListener`), or **only where the write happened** (`ResourceChangeListener`).

## Critical rules for Cloud Service

- **Listener must be lightweight.** `onChange(List<ResourceChange>)` runs on a shared Sling thread;
  blocking it delays **every other** registered listener. Do only:
  1. Filter changes you care about (by path, `ChangeType`, or property names).
  2. Extract the data you need (paths, user id, external flag).
  3. Enqueue a Sling job via `JobManager.addJob(topic, props)`.
- **Never** open a `ResourceResolver`, `Session`, or perform JCR / repository reads or writes inside `onChange`.
- **Never** call `ResourceResolverFactory.getAdministrativeResourceResolver(...)` — replace with `getServiceResourceResolver(SUBSERVICE)` per [resource-resolver-logging.md](resource-resolver-logging.md). The resolver belongs in the **`JobConsumer`**, not the listener.
- **Filter at registration, not in code.** Use the `paths`, `changes`, and (optionally) `propertyNamesHint`
  OSGi properties so the Sling framework delivers only relevant events.
- Business `@Reference` fields (`ResourceResolverFactory`, domain services) live on the **`JobConsumer`**.
  Only `JobManager` lives on the listener.
- Choose `ResourceChangeListener` vs `ExternalResourceChangeListener` **deliberately** — see the table above.
- Paths **must** start with `/` (e.g. `/content/dam`). A leading `glob:` or a path with `.` globs is allowed — see the Sling API Javadoc.
- On AEMaaCS, service-user mappings referenced via `SUBSERVICE` must be provisioned in **Repoinit**; creating users through the UI is not available. See [resource-resolver-logging.md](resource-resolver-logging.md).

---

## Classification

1. **File already implements `ResourceChangeListener`** and `onChange` contains business logic
   (resolver acquire, JCR/Session ops, heavy processing) → **apply steps R1–R5** below.
2. **File implements `ResourceChangeListener`** and `onChange` only enqueues jobs → **already compliant**; verify only.
3. **File implements `javax.jcr.observation.EventListener`** or **`org.osgi.service.event.EventHandler`
   subscribed to `org/apache/sling/api/resource/Resource/*`** → **this module still applies** (new target is `ResourceChangeListener`); apply **R0** (convert to `ResourceChangeListener`) then R1–R5. For
   non-resource `EventHandler` topics (ReplicationEvent, WorkflowEvent, custom) use [event-migration.md](event-migration.md) instead.

---

## Complete example — before and after

### Before (legacy JCR `EventListener` with inline logic and admin resolver)

```java
package com.example.listeners;

import org.apache.felix.scr.annotations.Component;
import org.apache.felix.scr.annotations.Reference;
import org.apache.felix.scr.annotations.Service;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;

import javax.jcr.observation.Event;
import javax.jcr.observation.EventIterator;
import javax.jcr.observation.EventListener;

@Component(immediate = true)
@Service
public class ACLPolicyListener implements EventListener {

    @Reference
    private ResourceResolverFactory resolverFactory;

    @Override
    public void onEvent(EventIterator events) {
        try {
            ResourceResolver resolver = resolverFactory.getAdministrativeResourceResolver(null);
            while (events.hasNext()) {
                Event event = events.nextEvent();
                if (event.getType() == Event.PROPERTY_CHANGED
                        && event.getPath().contains("/rep:policy")) {
                    // heavy work: recompute ACL audit record, replicate, etc.
                    System.out.println("ACL modified: " + event.getPath());
                }
            }
            resolver.close();
        } catch (Exception e) {
            System.err.println("ACL listener failed: " + e.getMessage());
            e.printStackTrace();
        }
    }
}
```

### After — Cloud Service compatible

**File 1 — `ACLPolicyChangeListener.java`** (lightweight `ResourceChangeListener`)

```java
package com.example.listeners;

import org.apache.sling.api.resource.observation.ResourceChange;
import org.apache.sling.api.resource.observation.ResourceChangeListener;
import org.apache.sling.event.jobs.JobManager;
import org.osgi.framework.Constants;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component(
        service = ResourceChangeListener.class,
        property = {
                Constants.SERVICE_DESCRIPTION + "=ACL policy change listener",
                ResourceChangeListener.PATHS + "=glob:/**/rep:policy",
                ResourceChangeListener.CHANGES + "=ADDED",
                ResourceChangeListener.CHANGES + "=CHANGED",
                ResourceChangeListener.CHANGES + "=REMOVED"
        }
)
public class ACLPolicyChangeListener implements ResourceChangeListener {

    private static final Logger LOG = LoggerFactory.getLogger(ACLPolicyChangeListener.class);
    static final String JOB_TOPIC = "com/example/acl/policy/changed";

    @Reference
    private JobManager jobManager;

    @Override
    public void onChange(List<ResourceChange> changes) {
        for (ResourceChange change : changes) {
            try {
                Map<String, Object> props = new HashMap<>();
                props.put("path", change.getPath());
                props.put("type", change.getType().name());
                props.put("external", change.isExternal());
                if (change.getUserId() != null) {
                    props.put("userId", change.getUserId());
                }
                jobManager.addJob(JOB_TOPIC, props);
            } catch (Exception e) {
                LOG.error("Failed to enqueue ACL change job for {}", change.getPath(), e);
            }
        }
    }
}
```

**File 2 — `ACLPolicyJobConsumer.java`** (business logic runs here, with a service-user resolver)

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
        property = {
                JobConsumer.PROPERTY_TOPICS + "=com/example/acl/policy/changed"
        }
)
public class ACLPolicyJobConsumer implements JobConsumer {

    private static final Logger LOG = LoggerFactory.getLogger(ACLPolicyJobConsumer.class);

    @Reference
    private ResourceResolverFactory resolverFactory;

    @Override
    public JobResult process(final Job job) {
        final String path = job.getProperty("path", String.class);
        final String type = job.getProperty("type", String.class);

        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "acl-audit-service"))) {

            // ==== existing business logic from onEvent() moves here ====
            LOG.info("Processing ACL {} at {}", type, path);
            // read resource, update audit record, etc.

            return JobResult.OK;
        } catch (LoginException e) {
            LOG.error("Could not open service resolver for subservice 'acl-audit-service'", e);
            return JobResult.FAILED;
        } catch (Exception e) {
            LOG.error("ACL policy job failed for {}", path, e);
            return JobResult.FAILED;
        }
    }
}
```

**Required Repoinit** (provision the service user and ACLs — goes in your `ui.config` Repoinit OSGi config):

```
create service user acl-audit-service

set ACL for acl-audit-service
    allow jcr:read on /content
    allow jcr:read,rep:write on /var/acl-audit
end
```

**Required service-user mapping** (`ui.config`, file named e.g.
`org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-acl-audit.cfg.json`):

```json
{
  "user.mapping": [
    "com.example.mybundle:acl-audit-service=[acl-audit-service]"
  ]
}
```

---

## Transformation steps

### R0 — (only if source is JCR `EventListener` or resource-topic OSGi `EventHandler`) convert to `ResourceChangeListener`

Replace the legacy registration/implementation scaffolding with an OSGi DS
`ResourceChangeListener` component:

```java
// AFTER
@Component(
        service = ResourceChangeListener.class,
        property = {
                ResourceChangeListener.PATHS   + "=/content/dam",
                ResourceChangeListener.CHANGES + "=ADDED",
                ResourceChangeListener.CHANGES + "=CHANGED",
                ResourceChangeListener.CHANGES + "=REMOVED"
        }
)
public class MyChangeListener implements ResourceChangeListener {
    @Override
    public void onChange(List<ResourceChange> changes) { /* enqueue jobs */ }
}
```

**Filter options** (OSGi component properties — use the constants on `ResourceChangeListener`):

| Property | Purpose | Values |
|----------|---------|--------|
| `ResourceChangeListener.PATHS` | Path prefixes or globs to observe | `/content/dam`, `glob:/**/jcr:content/*`, `.` (all) |
| `ResourceChangeListener.CHANGES` | Change types | `ADDED`, `CHANGED`, `REMOVED`, `PROVIDER_ADDED`, `PROVIDER_REMOVED` |
| `ResourceChangeListener.PROPERTY_NAMES_HINT` | Hint: only these property names are relevant for CHANGED events | `cq:lastReplicated`, `status` |

**Legacy JCR event type → `ChangeType` mapping:**

| JCR (`javax.jcr.observation.Event.*`) | `ResourceChange.ChangeType` |
|---------------------------------------|-----------------------------|
| `NODE_ADDED` | `ADDED` |
| `NODE_REMOVED` | `REMOVED` |
| `PROPERTY_ADDED` | `CHANGED` |
| `PROPERTY_CHANGED` | `CHANGED` |
| `PROPERTY_REMOVED` | `CHANGED` |
| `NODE_MOVED` | Expressed as `REMOVED` + `ADDED` |

**Legacy JCR `Event` → `ResourceChange` data:**

| JCR | `ResourceChange` |
|-----|------------------|
| `event.getPath()` | `change.getPath()` |
| `event.getType()` | `change.getType()` |
| `event.getUserID()` | `change.getUserId()` |
| `event.getInfo()` / heuristics for clustered events | `change.isExternal()` |
| `event.getIdentifier()` | Not directly available — use path + `getAddedPropertyNames()` / `getChangedPropertyNames()` / `getRemovedPropertyNames()` for property-level detail |

### R1 — Keep `onChange` lightweight; offload to Sling Job

`onChange` must only:

1. Inspect each `ResourceChange` for path, type, and (optionally) property names.
2. Build a job `Map<String, Object>`.
3. Call `jobManager.addJob(JOB_TOPIC, props)`.
4. Return.

Do **not** open resolvers, call `adaptTo(Session.class)`, read child resources, or do I/O here.

```java
@Override
public void onChange(List<ResourceChange> changes) {
    for (ResourceChange change : changes) {
        Map<String, Object> props = new HashMap<>();
        props.put("path", change.getPath());
        props.put("type", change.getType().name());
        props.put("external", change.isExternal());
        jobManager.addJob(JOB_TOPIC, props);
    }
}
```

### R2 — Create the `JobConsumer` (business logic)

Create a **new** class that moves *all* the business logic from the legacy `onEvent` / inline
`handleEvent` / heavy `onChange` into `process(Job)`:

```java
@Component(
        service = JobConsumer.class,
        property = {
                JobConsumer.PROPERTY_TOPICS + "=com/example/your/topic"
        }
)
public class YourJobConsumer implements JobConsumer {

    private static final Logger LOG = LoggerFactory.getLogger(YourJobConsumer.class);

    @Reference
    private ResourceResolverFactory resolverFactory;

    @Override
    public JobResult process(final Job job) {
        final String path = job.getProperty("path", String.class);

        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "my-service-user"))) {
            // business logic
            return JobResult.OK;
        } catch (LoginException e) {
            LOG.error("Could not open service resolver for 'my-service-user'", e);
            return JobResult.FAILED;
        }
    }
}
```

Rules:

- Topic on the `JobConsumer` component **must** match the topic used in `jobManager.addJob`.
- Move **all** business `@Reference` fields (`ResourceResolverFactory`, domain services, etc.) to the `JobConsumer`.
- Extract job data via `job.getProperty("key", Type.class)` — **do not** use the deprecated `JobUtil.getProperty(...)`.
- Return `JobResult.OK` on success, `JobResult.FAILED` on failure (will be retried per the queue config), `JobResult.CANCEL` for unrecoverable failures.

### R3 — Deciding between `ResourceChangeListener` and `ExternalResourceChangeListener`

Default to **`ResourceChangeListener`** (local only). Use
`ExternalResourceChangeListener` **only** if the reaction must run even for changes that happened
on a different cluster node (e.g. a publish tier reacting to a replicated update).

```java
import org.apache.sling.api.resource.observation.ExternalResourceChangeListener;

@Component(
        service = ExternalResourceChangeListener.class,
        property = {
                ResourceChangeListener.PATHS   + "=/content",
                ResourceChangeListener.CHANGES + "=CHANGED"
        }
)
public class PublishedContentListener implements ExternalResourceChangeListener {
    @Override
    public void onChange(List<ResourceChange> changes) { /* ... */ }
}
```

`ExternalResourceChangeListener` **extends** `ResourceChangeListener`; both interfaces expose the same `onChange`.

Inside `onChange`, you can still branch on origin:

```java
if (change.isExternal()) {
    // happened elsewhere in the cluster
}
```

### R4 — Update imports

**Remove** (when source was JCR `EventListener`):

```java
import javax.jcr.observation.Event;
import javax.jcr.observation.EventIterator;
import javax.jcr.observation.EventListener;
```

**Remove** (when source was `EventHandler` on `org/apache/sling/api/resource/Resource/*`):

```java
import org.osgi.service.event.Event;
import org.osgi.service.event.EventConstants;
import org.osgi.service.event.EventHandler;
```

**Remove** (SCR → DS per [scr-to-osgi-ds.md](scr-to-osgi-ds.md)):

```java
import org.apache.felix.scr.annotations.*;
```

**Add** — listener class:

```java
import org.apache.sling.api.resource.observation.ResourceChange;
import org.apache.sling.api.resource.observation.ResourceChangeListener;
// If reacting to external changes too:
import org.apache.sling.api.resource.observation.ExternalResourceChangeListener;
import org.apache.sling.event.jobs.JobManager;
import org.osgi.framework.Constants;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
```

**Add** — job consumer class:

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

### R5 — Repoinit and service-user mapping (must be in `ui.config`)

The `JobConsumer` acquires a resolver via `SUBSERVICE`. On AEM as a Cloud Service, the backing
system user **must** be created through **Repoinit** (the `repo-init` OSGi factory config) and
mapped through `ServiceUserMapperImpl.amended`. The classic UI-based user admin is not available.

```
create service user my-service-user

set ACL for my-service-user
    allow jcr:read on /content
    allow jcr:read,rep:write on /var/my-app
end
```

`org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-<bundle>.cfg.json`:

```json
{
  "user.mapping": [
    "com.example.mybundle:my-service-user=[my-service-user]"
  ]
}
```

See [resource-resolver-logging.md](resource-resolver-logging.md) for the full Repoinit workflow.

---

## Validation checklist

**Listener class**

- [ ] Implements `org.apache.sling.api.resource.observation.ResourceChangeListener`
      (or `ExternalResourceChangeListener` if external changes are needed — justified in a code comment).
- [ ] Component registers via `@Component(service = ResourceChangeListener.class, property = { PATHS..., CHANGES... })`.
- [ ] No `import javax.jcr.observation.*` remains.
- [ ] No OSGi resource-topic `EventHandler` subscription remains (`org/apache/sling/api/resource/Resource/*`).
- [ ] No `ResourceResolverFactory`, `ResourceResolver`, `Session`, or `Node` operation inside `onChange`.
- [ ] `onChange` body only extracts data and calls `jobManager.addJob(...)`.
- [ ] `@Reference JobManager` present; business `@Reference` fields moved to the `JobConsumer`.
- [ ] SLF4J used (no `System.out` / `System.err` / `printStackTrace`).
- [ ] SCR → DS complete — no `org.apache.felix.scr.annotations.*` imports.

**`JobConsumer` class**

- [ ] Implements `JobConsumer`.
- [ ] `@Component(service = JobConsumer.class, property = { PROPERTY_TOPICS = ... })` with the **same** topic used by the listener.
- [ ] Resolver opened via `getServiceResourceResolver` with a `SUBSERVICE` mapping, in try-with-resources.
- [ ] All business logic from the legacy listener lives here.
- [ ] Extracts job data via `job.getProperty(..., Type.class)` — not `JobUtil.getProperty`.
- [ ] Returns `JobResult.OK` / `FAILED` / `CANCEL`; never swallows errors.

**Configuration**

- [ ] Service user created via Repoinit in `ui.config`.
- [ ] `ServiceUserMapperImpl.amended-*.cfg.json` maps `<bundle>:<subservice>` → the service user.
- [ ] `mvn clean install` succeeds and produces no SCR-related or deprecated-API warnings.

---

## See also

- [event-migration.md](event-migration.md) — for non-resource OSGi Event Admin handlers (replication, workflow, custom topics).
- [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md) — SCR → DS, service-user resolvers, SLF4J.
- [`../SKILL.md`](../SKILL.md) — pattern index.
