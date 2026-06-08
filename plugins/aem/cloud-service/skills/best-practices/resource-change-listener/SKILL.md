---
name: resource-change-listener
description: AEM Cloud Service expert skill for Sling ResourceChangeListener. Covers the lightweight listener + JobConsumer pattern, migration from javax.jcr.observation.EventListener and resource-topic OSGi EventHandler, ResourceChangeListener vs ExternalResourceChangeListener decision, OSGi filter configuration, review checklist, troubleshooting (silent failures, hot-path blocking, missing service-user mapping), and common pitfalls.
license: Apache-2.0
---

# Resource Change Listener — AEM as a Cloud Service

## Overview

`org.apache.sling.api.resource.observation.ResourceChangeListener` is the preferred API on AEM CS for reacting to repository content changes. The listener runs on a shared Sling thread and should return as quickly as possible.

For any blocking, repository-intensive, network, workflow, replication, indexing, asset-processing, or otherwise non-trivial work, enqueue a Sling Job and perform the processing in a `JobConsumer`.

Very small in-memory operations (metrics, counters, simple event translation, lightweight filtering, or enqueueing a job) may remain inside `onChange()` provided they do not perform repository access, network I/O, workflow operations, or expensive computation.

Two interface variants:

| Interface | Receives | Use when |
|-----------|----------|----------|
| `ResourceChangeListener` | Local changes only (same JVM) | Post-processing what *this* pod just wrote |
| `ExternalResourceChangeListener` (extends RCL) | Local **and** external (other cluster nodes) | Cluster-wide reactions: cache invalidation, replication follow-ups |

Three CS-specific constraints every listener must satisfy:

| Constraint | Why |
|-----------|-----|
| No `ResourceResolver` / `Session` / JCR ops inside `onChange()` | Blocks the shared listener thread; delays every other registered listener |
| `getServiceResourceResolver(SUBSERVICE)` in the consumer | `getAdministrativeResourceResolver` is removed from the CS SDK |
| Filter via `PATHS` / `CHANGES` OSGi properties — not in code | Sling delivers only matching events; in-code filtering wastes the listener thread |

> **`PATHS` are chosen by the implementer from the business scope.** Do not ask the customer for raw `PATHS` syntax (`/content/dam`, `glob:/**/jcr:content/*`, etc.) unless the business scope itself is unclear. Derive the path from what the listener is supposed to react to.

---

## Classification — choose before making any changes

**Already implements `ResourceChangeListener`** and `onChange()` only enqueues jobs
→ Already compliant — verify against the [Review Checklist](#review-checklist) only.

**Already implements `ResourceChangeListener`** and `onChange()` contains business logic (resolver, JCR ops, heavy processing)
→ Apply **R1–R5** (skip R0).

**Implements `javax.jcr.observation.EventListener`** or **`EventHandler`** subscribed to `org/apache/sling/api/resource/Resource/*`
→ Apply **R0 then R1–R5**.

**Implements `EventHandler`** subscribed to replication / workflow / custom topics
→ Use the `event-migration` skill instead — not this one.

**One pattern per session.** If the bundle has multiple legacy listeners, migrate one class at a time.

**Before starting:** Read [`../references/aem-cloud-service-pattern-prerequisites.md`](../references/aem-cloud-service-pattern-prerequisites.md) and apply SCR→DS, service-user, and SLF4J fixes if present in the same changeset.

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
import org.apache.sling.api.resource.PersistenceException;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.apache.sling.event.jobs.Job;
import org.apache.sling.event.jobs.consumer.JobConsumer;
import org.apache.sling.event.jobs.consumer.JobResult;
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
            // resolver.commit();  // required if you modify JCR — see R2

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

**Required Repoinit** (goes in your `ui.config` Repoinit OSGi config):

```
create service user acl-audit-service

set ACL for acl-audit-service
    allow jcr:read on /content
    allow jcr:read,rep:write on /var/acl-audit
end
```

**Required service-user mapping** (`ui.config`, file named e.g. `org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-acl-audit.cfg.json`):

```json
{
  "user.mapping": [
    "com.example.mybundle:acl-audit-service=[acl-audit-service]"
  ]
}
```

---

## R0 — Convert to `ResourceChangeListener` (legacy source only)

Apply only when the source is `javax.jcr.observation.EventListener` or `EventHandler` subscribed to `org/apache/sling/api/resource/Resource/*`. Skip if the class already implements `ResourceChangeListener`.

```java
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
    public void onChange(List<ResourceChange> changes) { /* enqueue jobs — see R1 */ }
}
```

**Filter options** (use the constants on `ResourceChangeListener`):

| Property | Purpose | Values |
|----------|---------|--------|
| `ResourceChangeListener.PATHS` | Path prefixes or globs to observe | `/content/dam`, `glob:/**/jcr:content/*`, `.` (all) |
| `ResourceChangeListener.CHANGES` | Change types | `ADDED`, `CHANGED`, `REMOVED`, `PROVIDER_ADDED`, `PROVIDER_REMOVED` |
| `ResourceChangeListener.PROPERTY_NAMES_HINT` | **Hint only** — Sling may use it as an optimization to reduce delivery, but does not guarantee exclusivity | `cq:lastReplicated`, `status` |

> **`PROPERTY_NAMES_HINT` is an optimization hint, not a contract.** Applications must not rely on Sling delivering exclusively those property changes. Always validate the actual `ResourceChange` data inside the listener or consumer (`change.getChangedPropertyNames()`, `change.getAddedPropertyNames()`).

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
| heuristics for clustered events | `change.isExternal()` |
| `event.getIdentifier()` | Not directly available — use path + `getAddedPropertyNames()` / `getChangedPropertyNames()` / `getRemovedPropertyNames()` |

---

## R1 — Keep `onChange()` lightweight; offload to Sling Job

For production AEMaaCS code, the recommended pattern is:

1. Extract the minimal event data required
2. Build a job payload (`Map<String, Object>`)
3. Call `jobManager.addJob(JOB_TOPIC, props)`
4. Return immediately

Repository access, service resolver creation, workflow operations, replication, external API calls, indexing, asset processing, and other potentially expensive work belong in a `JobConsumer` — never inside `onChange()`.

```java
@Override
public void onChange(List<ResourceChange> changes) {
    for (ResourceChange change : changes) {
        try {
            Map<String, Object> props = new HashMap<>();
            props.put("path", change.getPath());
            props.put("type", change.getType().name());
            props.put("external", change.isExternal());
            jobManager.addJob(JOB_TOPIC, props);
        } catch (Exception e) {
            LOG.error("Failed to enqueue job for {}", change.getPath(), e);
            // continue the loop — one bad change must not kill the batch
        }
    }
}
```

**Per-change try/catch is mandatory.** Without it, a single bad event aborts the loop and the remaining changes in the batch are silently dropped.

---

## R2 — Create the JobConsumer (business logic)

Create a **new** class that moves *all* the business logic from the legacy `onEvent` / inline `handleEvent` / heavy `onChange` into `process(Job)`:

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
- Topic on the `JobConsumer` component **must** match the topic used in `jobManager.addJob`. Share the topic as a `static final String` referenced by both classes.
- Move **all** business `@Reference` fields (`ResourceResolverFactory`, domain services) to the `JobConsumer`.
- Extract job data via `job.getProperty("key", Type.class)` — never the deprecated `JobUtil.getProperty(...)`.
- Return `JobResult.OK` on success, `JobResult.FAILED` on retryable failure, `JobResult.CANCEL` for unrecoverable failures.
- `getServiceResourceResolver` throws `LoginException` on failure — it does **not** normally return `null`. Catch `LoginException`; do not add a `resolver == null` branch unless a custom wrapper is in use.

**Write-side consumers — `resolver.commit()` is mandatory:** If `process()` modifies JCR content, call `resolver.commit()` before the try-with-resources closes the resolver. Without it, changes are silently discarded:

```java
@Override
public JobResult process(final Job job) {
    final String path = job.getProperty("path", String.class);
    try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
            Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "my-service-user"))) {
        Resource resource = resolver.getResource(path);
        if (resource != null) {
            ModifiableValueMap props = resource.adaptTo(ModifiableValueMap.class);
            props.put("lastProcessed", System.currentTimeMillis());
            resolver.commit();  // required — changes are discarded without this
        }
        return JobResult.OK;
    } catch (LoginException e) {
        LOG.error("Could not open service resolver", e);
        return JobResult.FAILED;
    } catch (PersistenceException e) {
        LOG.error("Failed to commit changes for {}", path, e);
        return JobResult.FAILED;
    }
}
```

**Author-only consumers:** If the action must only run on author (replication triggers, workflow launchers), inject `SlingSettingsService` and guard at the top of `process()`:

```java
@Reference
private SlingSettingsService slingSettingsService;

@Override
public JobResult process(final Job job) {
    if (!slingSettingsService.getRunModes().contains("author")) {
        return JobResult.OK;  // ack and drop — not a failure
    }
    // author-only logic
}
```

Import: `import org.apache.sling.settings.SlingSettingsService;`

> **Author-only does not mean single execution.** In AEMaaCS author clusters, multiple author pods may process the same logical change. If the operation must execute exactly once across the author tier (e.g. sending a notification, creating a unique audit record), use an appropriate cluster-coordination pattern — leader election (`SlingSettingsService` topology APIs), distributed locking, idempotent processing, or another singleton mechanism. A simple run-mode check guarantees neither uniqueness nor ordering.

---

## R3 — Choose `ResourceChangeListener` vs `ExternalResourceChangeListener`

**Default to plain `ResourceChangeListener`** (local changes only). Switch to `ExternalResourceChangeListener` **only** when the reaction must run on every cluster node, even for changes that happened elsewhere.

`ExternalResourceChangeListener` should be treated as an exception, not the default. Before selecting it, verify:

- The reaction must occur for changes created on other cluster nodes
- Duplicate processing is acceptable or prevented (idempotency or coordination)
- The operation is idempotent — running it N times must equal running it once
- Per-node execution is intentional (cache invalidation, distributed indexing, local warm-up)

If any of these does not hold, use plain `ResourceChangeListener` plus a cluster-coordination layer instead.

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

`ExternalResourceChangeListener` **extends** `ResourceChangeListener`; both interfaces expose the same `onChange` method. Inside `onChange()`, you can still branch on origin:

```java
if (change.isExternal()) {
    // change happened elsewhere in the cluster
}
```

> **Picking external by default fans out writes.** With N publish pods, a single replicated write triggers the consumer N times. Use `ExternalResourceChangeListener` only when the reaction is idempotent or must run per-node (cache invalidation, distributed indexing).

---

## R4 — Update imports

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

**Remove** (SCR → DS):

```java
import org.apache.felix.scr.annotations.*;
```

**Add — listener class:**

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

**Add — JobConsumer class:**

```java
import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.PersistenceException;  // only if writing
import org.apache.sling.api.resource.Resource;              // only if writing
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.apache.sling.api.resource.ModifiableValueMap;    // only if writing
import org.apache.sling.event.jobs.Job;
import org.apache.sling.event.jobs.consumer.JobConsumer;
import org.apache.sling.event.jobs.consumer.JobResult;
import org.apache.sling.settings.SlingSettingsService;       // only if guarding by run mode
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.Collections;
```

---

## R5 — Repoinit and service-user mapping

The JobConsumer acquires a resolver via `SUBSERVICE`. On AEM as a Cloud Service, the backing system user **must** be created via **Repoinit** (the `repo-init` OSGi factory config) and mapped through `ServiceUserMapperImpl.amended`. The classic UI-based user admin is not available.

Repoinit (in `ui.config`):

```
create service user my-service-user

set ACL for my-service-user
    allow jcr:read on /content
    allow jcr:read,rep:write on /var/my-app
end
```

`ServiceUserMapperImpl.amended-<bundle>.cfg.json`:

```json
{
  "user.mapping": [
    "com.example.mybundle:my-service-user=[my-service-user]"
  ]
}
```

The bundle symbolic name on the left of `:` **must** match the bundle owning the `JobConsumer` — a common cause of `LoginException` is a typo or copy-paste from another bundle.

See [`../references/aem-cloud-service-pattern-prerequisites.md`](../references/aem-cloud-service-pattern-prerequisites.md) for the full Repoinit workflow.

---

## Review Checklist

**Cross-cutting:**
- [ ] No `javax.jcr.observation.*` imports remain
- [ ] No `EventHandler` subscribed to `org/apache/sling/api/resource/Resource/*` topics
- [ ] Business logic lives in a `JobConsumer` — never inline in `onChange()`
- [ ] `getServiceResourceResolver(SUBSERVICE)` used — not `getAdministrativeResourceResolver`
- [ ] Resolver in try-with-resources — not a field
- [ ] OSGi DS R6 annotations — no `org.apache.felix.scr.annotations.*` imports
- [ ] SLF4J logging — no `System.out` / `System.err` / `printStackTrace`

**Listener class:**
- [ ] Implements `ResourceChangeListener` or `ExternalResourceChangeListener` (with a code comment justifying external)
- [ ] `@Component(service = ResourceChangeListener.class, property = { PATHS..., CHANGES... })`
- [ ] `PATHS` start with `/`; `glob:` prefix used for wildcard patterns
- [ ] `CHANGES` lists explicit values (`ADDED`, `CHANGED`, `REMOVED`) — not relying on defaults
- [ ] No `ResourceResolverFactory`, `ResourceResolver`, `Session`, or `Node` operations inside `onChange()`
- [ ] `onChange()` body only extracts data and calls `jobManager.addJob(...)`
- [ ] Per-change body wrapped in try/catch so one bad change does not kill the batch
- [ ] `@Reference JobManager` present; business `@Reference` fields moved to the JobConsumer

**JobConsumer class:**
- [ ] Implements `JobConsumer`
- [ ] `@Component(service = JobConsumer.class, property = { PROPERTY_TOPICS + "=<topic>" })` with the **same** topic used by the listener (share via a `static final String`)
- [ ] Resolver opened via `getServiceResourceResolver(SUBSERVICE)` in try-with-resources
- [ ] `resolver.commit()` called if the consumer writes to JCR; `PersistenceException` caught
- [ ] All business logic from the legacy listener lives here
- [ ] Job data read via `job.getProperty("key", Type.class)` — not the deprecated `JobUtil.getProperty`
- [ ] Returns `JobResult.OK` / `FAILED` / `CANCEL`; never swallows errors silently
- [ ] Author-only consumers guard with `SlingSettingsService.getRunModes().contains("author")`

**Configuration:**
- [ ] Service user created via Repoinit in `ui.config`
- [ ] `ServiceUserMapperImpl.amended-*.cfg.json` maps `<bundle>:<subservice>` → the service user
- [ ] Bundle symbolic name in the mapping matches the bundle owning the JobConsumer
- [ ] `mvn clean install` succeeds with no SCR-related or deprecated-API warnings

---

## Troubleshooting

| Symptom | Log to search | Fix direction |
|---------|--------------|--------------|
| Listener never fires after deployment | none (silent) | Inspect the component's runtime state: if `UNSATISFIED`, a `@Reference` is unbound (usually `JobManager`); if `ACTIVE` but receiving no events, `PATHS` is wrong (missing leading `/`, glob syntax error, or path outside watched roots) |
| Other listeners stop reacting; sluggish overall | thread dump shows `sling-default-*` threads stuck on this listener's call stack | This listener is doing too much in `onChange()` — move work to a JobConsumer |
| `LoginException: Unable to retrieve the service resource resolver` in consumer | the exception name verbatim | Service user not provisioned via Repoinit, OR `ServiceUserMapperImpl.amended-*.cfg.json` missing/misnamed, OR bundle symbolic name in mapping doesn't match the bundle owning the JobConsumer |
| Same job fires N times per change (N = pod count) | none | Listener registered as `ExternalResourceChangeListener` when only local was needed — switch to plain `ResourceChangeListener` |
| Job enqueued but consumer never runs | `No JobConsumer for topic …` warning, or job stuck in `org/apache/sling/event/jobs` queue | Topic mismatch between `jobManager.addJob(TOPIC, ...)` and `PROPERTY_TOPICS` on the consumer — share the topic as a `static final String` |
| One bad change kills the whole batch | a single stack trace, then the listener stops processing the rest of the `List<ResourceChange>` | `onChange()` is not catching per-change exceptions — wrap the per-change body in try/catch |
| Listener repeatedly triggers itself | repeated `ResourceChange` events on the same path; consumer logs running in a loop | Consumer writes under an observed path — add recursion protection (skip property the consumer wrote), exclude generated content from `PATHS`, or make the write a no-op when target state already matches |
| Excessive job volume after deployment | large growth in active jobs under `org/apache/sling/event/jobs`; consumer queue backlog | `PATHS` is too broad, or the listener observes generated content paths — narrow `PATHS`, add `CHANGES` filtering, or use `PROPERTY_NAMES_HINT` to reduce delivery |

---

## Common Pitfalls

**Opening a `ResourceResolver` inside `onChange()`** — blocks the shared Sling listener thread and delays every other registered listener. Defeats the entire purpose of the lightweight-listener pattern.

**Using `javax.jcr.observation.EventListener`** — legacy JCR observation should generally be avoided for new AEMaaCS development. Prefer `ResourceChangeListener` unless a documented platform limitation requires JCR-level observation semantics; in that case raise an Adobe support case before introducing a custom JCR listener.

**Subscribing `EventHandler` to `org/apache/sling/api/resource/Resource/*`** — those topics are an internal Sling dispatcher detail and deprecated as an application-facing API. Use `ResourceChangeListener` instead.

**Missing leading `/` in `PATHS`** — `PATHS=content/dam` (no leading slash) silently registers nothing; the listener is `ACTIVE` but never fires.

**Topic constant mismatch** — listener calls `jobManager.addJob("com/example/foo", ...)` but consumer property says `=com/example/Foo` (case-sensitive). Always share the topic as a `static final String` referenced by both classes.

**Throwing from `onChange()` on one bad change** — kills the rest of the batch. Wrap per-change work in try/catch and log; never let one bad event break processing of the others.

**Picking `ExternalResourceChangeListener` by default** — fires the consumer on every cluster node when one writes. With N publish pods, a single replicated write triggers the consumer N times. Use plain `ResourceChangeListener` unless the reaction must be cluster-wide.

**Forgetting `resolver.commit()` in a write-side consumer** — try-with-resources closes the resolver and silently discards pending changes. JCR writes need an explicit commit.

**Observing overly broad paths** — registering on `/content`, `/`, or large DAM trees without strong filtering can generate extremely high event volumes (an "event storm"). Always scope `PATHS` as narrowly as possible and use `CHANGES` and `PROPERTY_NAMES_HINT` to reduce delivery.

**Listener writes back to the observed subtree** — the JobConsumer modifies content under the same path being observed, causing the listener to trigger itself repeatedly. Ensure the processing is idempotent, exclude generated content paths from `PATHS`, or add a guard property the consumer reads to skip its own writes.

---

## Modern Alternatives

| Need | Use |
|------|-----|
| React to JCR content changes (page/asset/property add/change/remove) | `ResourceChangeListener` (this skill) |
| React to cluster-wide content changes (publish, replicated updates) | `ExternalResourceChangeListener` (this skill) |
| Notify external systems (Adobe I/O Events, App Builder, webhooks) about AEM activity | **AEM Eventing** — see note below |
| React to replication, workflow, or custom OSGi Event Admin topics inside AEM | `EventHandler` — see `event-migration` skill |
| Synchronous post-write reaction in the same JVM | `ResourceChangeListener` with local-only filter |
| Heavy / blocking / I/O work | Always offload via `JobManager.addJob()` — never run in `onChange()` |
| Sling resource provider lifecycle (added/removed) | `ResourceChangeListener` with `CHANGES=PROVIDER_ADDED/PROVIDER_REMOVED` |
| JCR-level events RCL cannot express | **Avoid** on AEMaaCS — raise an Adobe support case before adding a custom JCR listener |

### AEM Eventing

If the requirement is to **notify external systems** (Adobe I/O Events, App Builder actions, webhooks, downstream services) about repository activity, evaluate **AEM Eventing** before introducing a new in-process `ResourceChangeListener`.

`ResourceChangeListener` is primarily for **in-process** reactions inside AEM — post-write side effects, cache invalidation, follow-up jobs. AEM Eventing is the supported path for **out-of-process** notification and external integration, with built-in delivery semantics, retries, and observability that an in-process listener does not provide.

---

## Expert Guidance

**Prefer designing consumers to be idempotent.** AEMaaCS is a distributed system:

- Events may be batched
- Events may arrive after related content has changed again
- External events may be delivered from another cluster node
- Retries (`JobResult.FAILED`) may execute the same job more than once
- Author clusters may process the same logical change on multiple pods

Consumers should therefore:

- Tolerate duplicate execution (running the same job twice should not double-apply effects)
- Tolerate missing resources (read-before-write; the target may have moved or been deleted between event and processing)
- Tolerate reordered events (do not assume strict ordering of `onChange()` batches)
- Derive current state from the repository whenever possible, instead of relying solely on event payload ordering

Treat the event as a **trigger** to inspect current state, not as a complete description of what happened.
