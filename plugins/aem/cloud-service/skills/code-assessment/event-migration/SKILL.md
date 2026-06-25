---
name: event-migration
description: AEM Cloud Service expert skill for OSGi Event Admin handlers (non-resource events). Covers migration of javax.jcr.observation.EventListener (residual non-resource cases) and OSGi EventHandler with inline business logic to the lightweight EventHandler + JobConsumer split. Includes routing rules (resource events go to resource-change-listener, external notification goes to AEM Eventing), TopologyEventListener for leader-only execution, replication and workflow event patterns, service-user setup, review checklist, troubleshooting, and common pitfalls.
license: Apache-2.0
---

# Event Migration — AEM as a Cloud Service

## Overview

`org.osgi.service.event.EventHandler` is the API for reacting to **non-resource** OSGi Event Admin events on AEM CS — replication events (`com.day.cq.replication.ReplicationEvent.EVENT_TOPIC`), workflow events (`com/adobe/granite/workflow/*`), and custom inter-bundle event topics. The handler runs on a shared OSGi event thread and **must** stay lightweight — all business logic must be offloaded to a Sling Job via `JobManager.addJob()`.

**Three CS-specific constraints every event handler must satisfy:**

| Constraint | Why |
|-----------|-----|
| No `ResourceResolver` / `Session` / JCR ops inside `handleEvent()` | Blocks the shared OSGi event-admin thread; can delay every other registered handler |
| `getServiceResourceResolver(SUBSERVICE)` in the consumer | `getAdministrativeResourceResolver` is removed from the CS SDK |
| Leader-only handlers must implement `TopologyEventListener` and check `isLeader` | A simple run-mode check fires on every author cluster pod — `TopologyEventListener` is the supported way to elect a single leader |

> **`handleEvent()` runs synchronously on a shared OSGi thread.** Doing repository, network, or workflow work inline blocks event delivery for every other handler subscribed to anything. Always offload to a `JobConsumer`.

---

## Routing — is this the right skill?

**Use this skill when** the source listens to a **non-resource** OSGi Event Admin topic:

| Source topic | Description |
|--------------|-------------|
| `com.day.cq.replication.ReplicationEvent.EVENT_TOPIC` | Replication actions (activate, deactivate, etc.) |
| `com/adobe/granite/workflow/*` | Workflow lifecycle events |
| Custom OSGi topics posted by another bundle | Inter-bundle event signaling |
| Other non-resource OSGi events | Any OSGi event that is not a resource-change topic |

**Route elsewhere when:**

| Source observes… | Use instead |
|------------------|-------------|
| Repository content (page, asset, property added/changed/removed) | **`resource-change-listener` skill** — `ResourceChangeListener` is the supported API on CS |
| External system notification (Adobe I/O Events, App Builder, webhooks, downstream services) | **AEM Eventing** — cloud-native, runs outside AEM, distinct from OSGi Event Admin |
| Anything subscribed to `org/apache/sling/api/resource/Resource/*` | **`resource-change-listener` skill** — those OSGi resource topics are a deprecated internal Sling dispatcher detail |

**Do not** subscribe a new `EventHandler` to `org/apache/sling/api/resource/Resource/ADDED|CHANGED|REMOVED`. Those topics are an internal Sling dispatcher detail, deprecated as an application-facing API. Use `ResourceChangeListener` for resource observation.

### Where to find topic constants

Always subscribe via a documented topic constant — never invent or copy-paste a topic string. The canonical constants live in the producing bundle's API:

| Producing API | Constant |
|---------------|----------|
| Replication | `com.day.cq.replication.ReplicationEvent.EVENT_TOPIC` |
| Workflow | `com.adobe.granite.workflow.event.WorkflowEvent.EVENT_TOPIC` — combine with `WorkflowEvent.EVENT_TYPE` property to discriminate the sub-event |
| Sling Jobs (lifecycle) | `org.apache.sling.event.jobs.NotificationConstants.*` |
| Custom bundle topics | Check the producing bundle's source or documentation for its declared `static final String` topic constant |

A typo'd topic string compiles fine and silently subscribes to a topic that nothing posts to — the handler is `ACTIVE` but never fires. Reference the constant in code instead of duplicating the literal string.

---

## Classification — choose before making any changes

**Implements `EventHandler` for a non-resource topic** and `handleEvent()` only enqueues jobs
→ Already compliant — verify against the [Review Checklist](#review-checklist) only.

**Implements `EventHandler` for a non-resource topic** and `handleEvent()` contains business logic (resolver, JCR ops, heavy processing)
→ Apply **E1–E5**.

**Implements `javax.jcr.observation.EventListener`** for a concern that **cannot** be expressed as a `ResourceChangeListener` (rare — most legacy JCR listeners should route to the `resource-change-listener` skill)
→ Apply **E0** (convert to `EventHandler` for the appropriate non-resource topic) then **E1–E5**. If unsure whether RCL covers it, prefer RCL and ask before falling through to this skill.

**One pattern per session.** If the bundle has multiple legacy handlers, migrate one class at a time.

**Before starting:** Read [`../references/aem-cloud-service-pattern-prerequisites.md`](../references/aem-cloud-service-pattern-prerequisites.md) and apply SCR→DS, service-user, and SLF4J fixes if present in the same changeset.

---

## Discovery

Detection is performed by the analyzer ([`../scripts/analyze.sh`](../scripts/README.md)), run by the runbook:

```bash
bash ../scripts/analyze.sh <workspace-root> --pattern event-migration
```

**Match criteria (what the detector flags):** a class that **`implements org.osgi.service.event.EventHandler`** or **`javax.jcr.observation.EventListener`** (import-aware) — both map here per the BPA subtype taxonomy.

Emitted at the class declaration, with the class header as the snippet. Parse-level only — direct `implements` clause; the subscribed topic (resource vs non-resource) is not resolved at detection, so topic-based routing to `resource-change-listener` happens during remediation (see Routing / Classification). A class implementing both an event interface and `ResourceChangeListener` is flagged by both patterns (rare).

## Resolution contract

**guided** — `apply (guided)`. The analyzer locates each handler/listener; remediation is judgment-based and applied via E0–E5 (per the Classification above) in an apply session. **Rows are evaluated top-down — first match wins**, so resource/content observation routes to `resource-change-listener` *before* the E0 fall-through is considered.

| Site shape | Disposition |
|---|---|
| Observes repository content — a `javax.jcr.observation.EventListener` watching content, or an `EventHandler` on a resource topic (`org/apache/sling/api/resource/Resource/*`) | skipped: `wrong-pattern` (use `resource-change-listener`) |
| `EventHandler` on a non-resource topic (replication / workflow / custom), `handleEvent()` does heavy work | apply (guided) → E1–E5 |
| Legacy `javax.jcr.observation.EventListener` that **genuinely cannot** be modeled as a `ResourceChangeListener` (rare residual) | apply (guided) → E0 then E1–E5 |
| `EventHandler` on a non-resource topic, `handleEvent()` only enqueues a Sling Job | skipped: `already-compliant` |
| Test code (`src/test/`) | skipped: `test-scope` |

---

## Complete example — before and after

### Before (replication EventHandler with inline business logic)

```java
package com.example.listeners;

import org.apache.felix.scr.annotations.Component;
import org.apache.felix.scr.annotations.Reference;
import org.apache.sling.api.resource.ModifiableValueMap;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.osgi.service.event.Event;
import org.osgi.service.event.EventConstants;
import org.osgi.service.event.EventHandler;
import com.day.cq.replication.ReplicationAction;
import com.day.cq.replication.ReplicationActionType;
import com.day.cq.replication.ReplicationEvent;

import java.util.Calendar;
import java.util.Collections;

@Component(
    immediate = true,
    property = {
        EventConstants.EVENT_TOPIC + "=com/day/cq/replication"
    }
)
public class ReplicationDateEventHandler implements EventHandler {

    @Reference
    private ResourceResolverFactory resolverFactory;

    @Override
    public void handleEvent(Event event) {
        try {
            ReplicationAction action = ReplicationEvent.fromEvent(event).getReplicationAction();
            if (action.getType() == ReplicationActionType.ACTIVATE) {
                ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
                        Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "replication-service"));
                Resource resource = resolver.getResource(action.getPath() + "/jcr:content");
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

### After — Cloud Service compatible

**File 1 — `ReplicationDateEventHandler.java`** (lightweight `EventHandler` + leader election)

```java
package com.example.listeners;

import org.apache.sling.discovery.TopologyEvent;
import org.apache.sling.discovery.TopologyEventListener;
import org.apache.sling.event.jobs.JobManager;
import org.osgi.framework.Constants;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.osgi.service.event.Event;
import org.osgi.service.event.EventConstants;
import org.osgi.service.event.EventHandler;
import com.day.cq.replication.ReplicationAction;
import com.day.cq.replication.ReplicationActionType;
import com.day.cq.replication.ReplicationEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.Map;

@Component(
    service = { EventHandler.class, TopologyEventListener.class },
    immediate = true,
    property = {
        Constants.SERVICE_DESCRIPTION + "=Update lastReplicated on activation",
        EventConstants.EVENT_TOPIC + "=com/day/cq/replication"
    }
)
public class ReplicationDateEventHandler implements EventHandler, TopologyEventListener {

    public static final String JOB_TOPIC = "com/example/replication/date/update";

    private static final Logger LOG = LoggerFactory.getLogger(ReplicationDateEventHandler.class);
    private volatile boolean isLeader = false;

    @Reference
    private JobManager jobManager;

    @Override
    public void handleTopologyEvent(TopologyEvent event) {
        if (event.getType() == TopologyEvent.Type.TOPOLOGY_CHANGED
                || event.getType() == TopologyEvent.Type.TOPOLOGY_INIT) {
            isLeader = event.getNewView().getLocalInstance().isLeader();
            LOG.info("Topology updated; isLeader={}", isLeader);
        }
    }

    @Override
    public void handleEvent(Event event) {
        if (!isLeader) {
            return;
        }
        try {
            ReplicationAction action = ReplicationEvent.fromEvent(event).getReplicationAction();
            if (action.getType() != ReplicationActionType.ACTIVATE) {
                return;
            }
            Map<String, Object> jobProperties = new HashMap<>();
            jobProperties.put("path", action.getPath());
            jobManager.addJob(JOB_TOPIC, jobProperties);
        } catch (Exception e) {
            LOG.error("Failed to enqueue replication-date job", e);
        }
    }
}
```

**File 2 — `ReplicationDateJobConsumer.java`** (business logic runs here, with a service-user resolver)

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
    property = {
        JobConsumer.PROPERTY_TOPICS + "=com/example/replication/date/update"
    }
)
public class ReplicationDateJobConsumer implements JobConsumer {

    private static final Logger LOG = LoggerFactory.getLogger(ReplicationDateJobConsumer.class);
    private static final String SUBSERVICE = "event-handler-service";

    @Reference
    private ResourceResolverFactory resolverFactory;

    @Override
    public JobResult process(final Job job) {
        final String path = job.getProperty("path", String.class);
        if (path == null) {
            LOG.warn("Job missing 'path' property; CANCEL");
            return JobResult.CANCEL;
        }

        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, SUBSERVICE))) {

            Resource resource = resolver.getResource(path + "/jcr:content");
            if (resource != null) {
                ModifiableValueMap map = resource.adaptTo(ModifiableValueMap.class);
                map.put("cq:lastReplicated", Calendar.getInstance());
                resolver.commit();
                LOG.debug("Updated lastReplicated for {}", path);
            }
            return JobResult.OK;

        } catch (LoginException e) {
            LOG.error("Could not open service resolver for '{}'", SUBSERVICE, e);
            return JobResult.FAILED;
        } catch (PersistenceException e) {
            LOG.error("Failed to commit lastReplicated for {}", path, e);
            return JobResult.FAILED;
        }
    }
}
```

**Required Repoinit** (in `ui.config`):

```
create service user event-handler-service

set ACL for event-handler-service
    allow jcr:read,rep:write on /content
end
```

**Required service-user mapping** (`ui.config`, file named e.g. `org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-event-handler.cfg.json`):

```json
{
  "user.mapping": [
    "com.example.mybundle:event-handler-service=[event-handler-service]"
  ]
}
```

Use the **amend** form (`ServiceUserMapperImpl.amended-<name>.cfg.json`) and the **principal-name** mapping (square-bracket form `=[service-user-name]`). Do not use the deprecated `userName` form. Permissions must be declared **directly on the service user** — do not rely on group inheritance.

### Variant — workflow events

Workflow events live on topics under `com/adobe/granite/workflow/*` and expose payload properties via `com.adobe.granite.workflow.event.WorkflowEvent` constants. The overall shape (lightweight handler + leader election + JobConsumer) is identical to the replication example — only the topic, the event-type discriminator, and the payload keys change. Full standalone handler:

```java
package com.example.listeners;

import com.adobe.granite.workflow.event.WorkflowEvent;
import org.apache.sling.discovery.TopologyEvent;
import org.apache.sling.discovery.TopologyEventListener;
import org.apache.sling.event.jobs.JobManager;
import org.osgi.framework.Constants;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.osgi.service.event.Event;
import org.osgi.service.event.EventConstants;
import org.osgi.service.event.EventHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.Map;

@Component(
    service = { EventHandler.class, TopologyEventListener.class },
    immediate = true,
    property = {
        Constants.SERVICE_DESCRIPTION + "=Handle workflow completion",
        EventConstants.EVENT_TOPIC + "=com/adobe/granite/workflow/event"
    }
)
public class WorkflowCompletedEventHandler implements EventHandler, TopologyEventListener {

    public static final String JOB_TOPIC = "com/example/workflow/completed";

    private static final Logger LOG = LoggerFactory.getLogger(WorkflowCompletedEventHandler.class);
    private volatile boolean isLeader = false;

    @Reference
    private JobManager jobManager;

    @Override
    public void handleTopologyEvent(TopologyEvent event) {
        if (event.getType() == TopologyEvent.Type.TOPOLOGY_CHANGED
                || event.getType() == TopologyEvent.Type.TOPOLOGY_INIT) {
            isLeader = event.getNewView().getLocalInstance().isLeader();
        }
    }

    @Override
    public void handleEvent(Event event) {
        if (!isLeader) {
            return;
        }
        try {
            String eventType = (String) event.getProperty(WorkflowEvent.EVENT_TYPE);
            if (!WorkflowEvent.WORKFLOW_COMPLETED_EVENT.equals(eventType)) {
                return;
            }
            Map<String, Object> jobProperties = new HashMap<>();
            jobProperties.put("workflowId", event.getProperty(WorkflowEvent.WORKFLOW_ID));
            jobProperties.put("workItemId", event.getProperty(WorkflowEvent.WORK_ITEM));
            jobProperties.put("path", event.getProperty("path"));
            jobManager.addJob(JOB_TOPIC, jobProperties);
        } catch (Exception e) {
            LOG.error("Failed to enqueue workflow-completed job", e);
        }
    }
}
```

Common `WorkflowEvent` payload keys:

| Key | Purpose |
|-----|---------|
| `WorkflowEvent.EVENT_TYPE` | Event subtype — `WORKFLOW_STARTED_EVENT`, `WORKFLOW_COMPLETED_EVENT`, `WORKFLOW_ABORTED_EVENT`, `WORK_ITEM_COMPLETED_EVENT`, etc. |
| `WorkflowEvent.WORKFLOW_ID` | The workflow instance ID |
| `WorkflowEvent.WORK_ITEM` | The current work item ID |
| `path` | The payload path the workflow is operating on (when applicable) |

The JobConsumer pattern is unchanged from the replication example — read the properties via `job.getProperty("key", Type.class)` and apply the business logic.

---

## E0 — Convert legacy `javax.jcr.observation.EventListener` to `EventHandler` (rare)

Apply only when the legacy `EventListener` observes a concern that **cannot** be expressed as a `ResourceChangeListener`. The default route for JCR observation is the `resource-change-listener` skill — fall through to E0 only after confirming the use case is non-resource.

```java
// BEFORE — JCR Observation
import javax.jcr.observation.Event;
import javax.jcr.observation.EventListener;
import javax.jcr.observation.EventIterator;

public class MyListener implements EventListener {
    @Override
    public void onEvent(EventIterator events) {
        while (events.hasNext()) { /* ... */ }
    }
}

// AFTER — OSGi EventHandler on a non-resource topic
import org.osgi.framework.Constants;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.event.Event;
import org.osgi.service.event.EventConstants;
import org.osgi.service.event.EventHandler;

@Component(
    service = EventHandler.class,
    immediate = true,
    property = {
        Constants.SERVICE_DESCRIPTION + "=My handler",
        EventConstants.EVENT_TOPIC + "=com/example/my/topic"
    }
)
public class MyEventHandler implements EventHandler {
    @Override
    public void handleEvent(Event event) { /* enqueue job — see E2 */ }
}
```

Pick the topic from the producing bundle's documented OSGi event topics — do not invent topics. If you cannot find a documented non-resource topic that matches the legacy intent, the use case probably is a resource observation and belongs in the `resource-change-listener` skill.

---

## E1 — Make `handleEvent()` lightweight; offload to Sling Job

For production AEMaaCS code, the recommended pattern is:

1. Inspect the event for the data you need (path, action type, properties)
2. Apply minimal filtering (e.g. `ReplicationActionType.ACTIVATE` only)
3. Build a job payload (`Map<String, Object>`)
4. Call `jobManager.addJob(JOB_TOPIC, props)`
5. Return immediately

Repository access, service resolver creation, workflow operations, replication API calls, external API calls, and other expensive work belong in a `JobConsumer` — never inside `handleEvent()`.

```java
@Override
public void handleEvent(Event event) {
    try {
        String path = (String) event.getProperty("path");
        Map<String, Object> jobProperties = new HashMap<>();
        jobProperties.put("path", path);
        jobManager.addJob(JOB_TOPIC, jobProperties);
    } catch (Exception e) {
        LOG.error("Failed to enqueue job for event {}", event.getTopic(), e);
    }
}
```

**Wrap the body in try/catch.** A thrown exception from `handleEvent()` does not abort the OSGi event-admin dispatcher, but it bypasses your normal error handling and pollutes the OSGi logs with framework-level stack traces. Always log and continue.

### Subscribing to multiple topics or wildcards

The `EVENT_TOPIC` property accepts an array of topics, and Sling supports a trailing `/*` wildcard to subscribe to a topic hierarchy:

```java
// Multiple specific topics in one handler:
property = {
    EventConstants.EVENT_TOPIC + "=com/adobe/granite/workflow/event",
    EventConstants.EVENT_TOPIC + "=com/day/cq/replication"
}

// All workflow events via wildcard:
property = {
    EventConstants.EVENT_TOPIC + "=com/adobe/granite/workflow/*"
}
```

When subscribing to multiple topics or a wildcard, `handleEvent()` must inspect `event.getTopic()` to know which topic fired and dispatch accordingly:

```java
@Override
public void handleEvent(Event event) {
    if (!isLeader) {
        return;
    }
    String topic = event.getTopic();
    if (topic.startsWith("com/adobe/granite/workflow/")) {
        enqueueWorkflowJob(event);
    } else if (ReplicationEvent.EVENT_TOPIC.equals(topic)) {
        enqueueReplicationJob(event);
    }
}
```

Prefer one handler per topic when the handler logic differs significantly — a wildcard handler that grew a long if/else chain is a refactor signal.

---

## E2 — Create the JobConsumer (business logic)

Create a **new** class that moves *all* the business logic from `handleEvent()` into `process(Job)`:

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
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "event-handler-service"))) {
            // business logic
            return JobResult.OK;
        } catch (LoginException e) {
            LOG.error("Could not open service resolver", e);
            return JobResult.FAILED;
        }
    }
}
```

Rules:
- Topic on the `JobConsumer` component **must** match the topic used in `jobManager.addJob`. Share the topic as a `static final String` referenced by both classes.
- Move **all** business `@Reference` fields (`ResourceResolverFactory`, domain services) to the `JobConsumer`.
- Extract job data via `job.getProperty("key", Type.class)` — never the deprecated `JobUtil.getProperty(...)`.
- Return `JobResult.OK` on success, `JobResult.FAILED` on retryable failure, `JobResult.CANCEL` for unrecoverable failures (missing required job property, permission denied with no retry path).
- `getServiceResourceResolver` throws `LoginException` on failure — it does **not** normally return `null`. Catch `LoginException`; do not add a `resolver == null` branch unless a custom wrapper is in use.

**Write-side consumers — `resolver.commit()` is mandatory:** If `process()` modifies JCR content, call `resolver.commit()` before the try-with-resources closes the resolver. Without it, changes are silently discarded. Catch `PersistenceException` separately.

---

## E3 — `TopologyEventListener` for leader-only execution

In AEMaaCS author clusters, an OSGi event posted by one node may be delivered to **every** author pod. For side-effecting handlers (writing back to the repo, triggering replication, sending notifications), enqueueing the job from every pod produces N duplicate jobs.

`TopologyEventListener` is the supported way to elect a single leader and gate execution:

```java
@Component(
    service = { EventHandler.class, TopologyEventListener.class },
    immediate = true,
    property = {
        EventConstants.EVENT_TOPIC + "=" + ReplicationEvent.EVENT_TOPIC
    }
)
public class LeaderOnlyHandler implements EventHandler, TopologyEventListener {

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
        if (!isLeader) {
            return;
        }
        // enqueue job
    }
}
```

**Add `TopologyEventListener` when:**

- The handler subscribes to a topic that is fan-out delivered across the cluster (replication, workflow lifecycle, custom topics emitted on each node)
- The downstream action must execute exactly once per logical event (write back to repo, trigger external system, send notification, replicate)
- The original legacy code had any `isLeader()` / `isMaster()` / "only run on one instance" logic

**Skip `TopologyEventListener` when:**

- The handler reads ephemeral local state (per-pod metrics, local cache update)
- The downstream action is genuinely idempotent at the data layer (every pod doing the same write produces the same final state)
- The topic is delivered only to one node by design (rare for OSGi Event Admin — verify before assuming)

> **A simple `SlingSettingsService.getRunModes().contains("author")` check is not enough.** Run-mode tells you author vs publish; it does not elect one author pod over another. For singleton execution on author, use `TopologyEventListener`.

---

## E4 — Update imports

**EventHandler class — Remove:**

```java
import org.apache.felix.scr.annotations.*;
import org.apache.sling.api.resource.ResourceResolverFactory;  // moves to JobConsumer
import javax.jcr.observation.Event;                            // only if migrating from JCR
import javax.jcr.observation.EventListener;                    // only if migrating from JCR
import javax.jcr.observation.EventIterator;                    // only if migrating from JCR
```

**EventHandler class — Add:**

```java
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
// For leader-only handlers:
import org.apache.sling.discovery.TopologyEvent;
import org.apache.sling.discovery.TopologyEventListener;
```

**JobConsumer class — Add:**

```java
import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.PersistenceException;  // only if writing
import org.apache.sling.api.resource.Resource;              // only if writing
import org.apache.sling.api.resource.ModifiableValueMap;    // only if writing
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
```

---

## E5 — Repoinit and service-user mapping

The JobConsumer acquires a resolver via `SUBSERVICE`. On AEM as a Cloud Service, the backing system user **must** be created via **Repoinit** (the `repo-init` OSGi factory config) and mapped through `ServiceUserMapperImpl.amended`. The classic UI-based user admin is not available.

Repoinit (in `ui.config`):

```
create service user event-handler-service

set ACL for event-handler-service
    allow jcr:read on /content
    allow jcr:read,rep:write on /var/my-app
end
```

`ServiceUserMapperImpl.amended-<bundle>.cfg.json`:

```json
{
  "user.mapping": [
    "com.example.mybundle:event-handler-service=[event-handler-service]"
  ]
}
```

**Mapping conventions:**

- Use the **amend** form — do not edit the base `ServiceUserMapperImpl` config
- Use **principal-name mapping**: the square-bracket form `=[service-user-name]`
- Do **not** use the deprecated `userName` form
- Bundle symbolic name on the left of `:` **must** match the bundle owning the JobConsumer
- Permissions must be declared **directly on the service user** — do not rely on group inheritance

See [`../references/aem-cloud-service-pattern-prerequisites.md`](../references/aem-cloud-service-pattern-prerequisites.md) for the full Repoinit workflow.

---

## Greenfield — writing a new EventHandler from scratch

When writing a new handler for a non-resource topic (not migrating legacy), use this template. It bundles the AEMaaCS best practices into one self-contained pair: lightweight handler, optional leader election, JobConsumer with proper outcome classification.

```java
// File 1: lightweight EventHandler with optional leader election
@Component(
    service = { EventHandler.class, TopologyEventListener.class },
    immediate = true,
    property = {
        Constants.SERVICE_DESCRIPTION + "=My custom event handler",
        EventConstants.EVENT_TOPIC + "=com/example/custom/topic"
    }
)
public class MyEventHandler implements EventHandler, TopologyEventListener {

    public static final String JOB_TOPIC = "com/example/custom/job";

    private static final Logger LOG = LoggerFactory.getLogger(MyEventHandler.class);
    private volatile boolean isLeader = false;

    @Reference
    private JobManager jobManager;

    @Override
    public void handleTopologyEvent(TopologyEvent event) {
        if (event.getType() == TopologyEvent.Type.TOPOLOGY_CHANGED
                || event.getType() == TopologyEvent.Type.TOPOLOGY_INIT) {
            isLeader = event.getNewView().getLocalInstance().isLeader();
        }
    }

    @Override
    public void handleEvent(Event event) {
        if (!isLeader) {
            return;
        }
        try {
            String path = (String) event.getProperty("path");
            if (path == null) {
                return;
            }
            Map<String, Object> jobProperties = new HashMap<>();
            jobProperties.put("path", path);
            jobManager.addJob(JOB_TOPIC, jobProperties);
        } catch (Exception e) {
            LOG.error("Failed to enqueue job", e);
        }
    }
}

// File 2: JobConsumer with outcome classification
@Component(
    service = JobConsumer.class,
    property = { JobConsumer.PROPERTY_TOPICS + "=com/example/custom/job" }
)
public class MyJobConsumer implements JobConsumer {

    private static final Logger LOG = LoggerFactory.getLogger(MyJobConsumer.class);
    private static final String SUBSERVICE = "my-event-handler-service";

    @Reference
    private ResourceResolverFactory resolverFactory;

    @Override
    public JobResult process(final Job job) {
        final String path = job.getProperty("path", String.class);
        if (path == null) {
            return JobResult.CANCEL;  // unrecoverable — required property missing
        }

        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, SUBSERVICE))) {
            // business logic; resolver.commit() if writing
            return JobResult.OK;
        } catch (LoginException e) {
            LOG.error("Could not open service resolver", e);
            return JobResult.FAILED;  // retryable
        }
    }
}
```

What this template captures:

- **Leader-only by default** — drop the `TopologyEventListener` parts only if you've verified the action is genuinely idempotent or per-node intentional
- **Topic shared as a `static final String`** — never copy the literal into the consumer's `PROPERTY_TOPICS`
- **`JobResult` outcomes mapped deliberately** — `CANCEL` for missing required job data (won't recover on retry), `FAILED` for transient errors (Sling will retry), `OK` for success

---

## Composition — `EventHandler` → `JobConsumer` → `Distributor`

A common production pattern is reacting to a replication event by triggering follow-up distribution (e.g. mirror the activation to a preview tier, or republish dependent content). The composition is straightforward: the `EventHandler` enqueues a job; the consumer calls `Distributor.distribute(...)`. Full consumer:

```java
@Override
public JobResult process(final Job job) {
    final String path = job.getProperty("path", String.class);
    if (path == null) {
        return JobResult.CANCEL;
    }

    try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
            Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, SUBSERVICE))) {

        DistributionRequest request = new SimpleDistributionRequest(
                DistributionRequestType.ADD, false, path);
        DistributionResponse response = distributor.distribute("preview", resolver, request);

        if (response.isSuccessful()) {
            return JobResult.OK;
        }
        // Map DistributionResponse failure modes to JobResult outcomes
        // See the replication skill for the full mapping
        return JobResult.FAILED;

    } catch (LoginException | DistributionException e) {
        LOG.error("Distribution composition failed for {}", path, e);
        return JobResult.FAILED;
    }
}
```

See the [`replication` skill](../replication/SKILL.md) for the full `DistributionResponse` → `JobResult` mapping (CANCEL for unrecoverable permission/agent errors, FAILED for transient queue/transport, defensive preview handling).

---

## Review Checklist

**Cross-cutting:**
- [ ] Source topic is a non-resource OSGi topic (replication / workflow / custom) — not `org/apache/sling/api/resource/Resource/*`
- [ ] No `javax.jcr.observation.*` imports remain
- [ ] Business logic lives in a `JobConsumer` — never inline in `handleEvent()`
- [ ] `getServiceResourceResolver(SUBSERVICE)` used in try-with-resources
- [ ] OSGi DS R6 annotations — no `org.apache.felix.scr.annotations.*` imports
- [ ] SLF4J logging — no `System.out` / `System.err` / `printStackTrace`

**EventHandler class:**
- [ ] Implements `EventHandler`
- [ ] `@Component(service = EventHandler.class, property = { EVENT_TOPIC... })` — or `service = { EventHandler.class, TopologyEventListener.class }` for leader-only
- [ ] `handleEvent()` body only extracts data and calls `jobManager.addJob(...)`
- [ ] `handleEvent()` body wrapped in try/catch
- [ ] `@Reference JobManager` present; business `@Reference` fields moved to the JobConsumer
- [ ] Event filtering preserves the original filter intent (paths, types, property names)
- [ ] Topic shared as a `static final String` between handler and consumer — not duplicated as a literal

**Leader election (when applicable):**
- [ ] Implements `TopologyEventListener` if the action must execute once per cluster
- [ ] `isLeader` field is `volatile` and set in `handleTopologyEvent()` on `TOPOLOGY_INIT` and `TOPOLOGY_CHANGED`
- [ ] `handleEvent()` early-returns when `!isLeader`
- [ ] Run-mode-only check (`SlingSettingsService.getRunModes().contains("author")`) is **not** used as a substitute for leader election

**JobConsumer class:**
- [ ] Implements `JobConsumer`
- [ ] `@Component(service = JobConsumer.class, property = { PROPERTY_TOPICS + "=<topic>" })` with the **same** topic used by the handler
- [ ] Resolver opened via `getServiceResourceResolver(SUBSERVICE)` in try-with-resources
- [ ] `resolver.commit()` called if the consumer writes to JCR; `PersistenceException` caught
- [ ] Job data read via `job.getProperty("key", Type.class)` — not the deprecated `JobUtil.getProperty`
- [ ] Returns `JobResult.OK` / `FAILED` / `CANCEL` deliberately — missing required data is `CANCEL`, transient errors are `FAILED`

**Configuration:**
- [ ] Service user created via Repoinit in `ui.config`
- [ ] `ServiceUserMapperImpl.amended-*.cfg.json` maps `<bundle>:<subservice>` → the service user (principal-name form)
- [ ] Bundle symbolic name in the mapping matches the bundle owning the JobConsumer
- [ ] `mvn clean install` succeeds with no SCR-related or deprecated-API warnings

---

## Troubleshooting

| Symptom | Log to search | Fix direction |
|---------|--------------|--------------|
| Handler never fires after deployment | none (silent) | Inspect the component's runtime state: if `UNSATISFIED`, a `@Reference` is unbound (usually `JobManager`); if `ACTIVE` but no events, the `EVENT_TOPIC` property is misspelled or the producing bundle hasn't started yet |
| Other handlers stop reacting; sluggish event delivery | thread dump shows OSGi event-admin threads stuck on this handler's call stack | This handler is doing too much in `handleEvent()` — move work to a JobConsumer |
| Same job enqueued N times (N = author pod count) | repeating `addJob` entries with same payload | OSGi event is fan-out delivered across the cluster — add `TopologyEventListener` and gate on `isLeader` |
| `LoginException: Unable to retrieve the service resource resolver` in consumer | the exception name verbatim | Service user not provisioned via Repoinit, OR `ServiceUserMapperImpl.amended-*.cfg.json` missing/misnamed, OR bundle symbolic name in mapping doesn't match the bundle owning the JobConsumer |
| Job enqueued but consumer never runs | `No JobConsumer for topic …` warning, or job stuck in `org/apache/sling/event/jobs` queue | Topic mismatch between `jobManager.addJob(TOPIC, ...)` and `PROPERTY_TOPICS` on the consumer — share the topic as a `static final String` |
| Handler subscribed but never receives expected event | none | Topic name typo (case-sensitive) or wrong topic constant — verify against the producing bundle's documented topic. `EVENT_FILTER` may also be excluding all events; test without the filter to isolate |
| Replication event handler runs but `ReplicationEvent.fromEvent(event)` returns null | `NullPointerException` near `getReplicationAction()` | Handler is subscribed to the wrong topic (not `ReplicationEvent.EVENT_TOPIC`) or to a different replication event class — verify the topic constant |

---

## Common Pitfalls

**Doing business logic inside `handleEvent()`** — blocks the OSGi event-admin thread. Other handlers across the bundle get delayed delivery. Always offload to a `JobConsumer`.

**Subscribing to `org/apache/sling/api/resource/Resource/*` topics** — these are an internal Sling dispatcher detail, deprecated as an application-facing API. Use `ResourceChangeListener` (the `resource-change-listener` skill) for resource observation, not OSGi `EventHandler`.

**Using `SlingSettingsService.getRunModes().contains("author")` as a singleton guard** — run mode says "author vs publish", not "this pod vs other pods". In an author cluster the handler still fires on every node. Use `TopologyEventListener` for true leader election.

**Forgetting `volatile` on the `isLeader` field** — `handleTopologyEvent()` and `handleEvent()` run on different threads; without `volatile`, the handler thread can read a stale value indefinitely and the leader-only guard is broken.

**Topic constant mismatch** — handler calls `jobManager.addJob("com/example/foo", ...)` but consumer property says `=com/example/Foo` (case-sensitive). Always share the topic as a `static final String` referenced by both classes.

**Missing `resolver.commit()` in a write-side consumer** — try-with-resources closes the resolver and silently discards pending changes. JCR writes need an explicit commit.

**Throwing from `handleEvent()`** — does not abort the OSGi dispatcher, but bypasses your normal error handling and pollutes logs with framework-level stack traces. Wrap the body in try/catch and log.

**Using OSGi `EventHandler` for external notification** — if the goal is to notify Adobe I/O Events, App Builder, webhooks, or downstream services, use **AEM Eventing**, not in-process `EventHandler`. OSGi events are an in-process API and don't carry external delivery semantics.

**Subscribing `TopologyEventListener` without consuming the topology** — registering as a `TopologyEventListener` without implementing `handleTopologyEvent()` to update an `isLeader` field means the leader gate is never set; default `isLeader = false` means the handler does nothing.

---

## Modern Alternatives

| Need | Use |
|------|-----|
| React to JCR content changes (page/asset/property add/change/remove) | `ResourceChangeListener` — see `resource-change-listener` skill |
| React to cluster-wide content changes | `ExternalResourceChangeListener` — see `resource-change-listener` skill |
| React to replication, workflow, or custom OSGi Event Admin topics inside AEM | `EventHandler` + `JobConsumer` (this skill) |
| Leader-only execution within author cluster | `TopologyEventListener` + `isLeader` gate (this skill) |
| Notify external systems (Adobe I/O Events, App Builder, webhooks) about AEM activity | **AEM Eventing** — cloud-native external delivery, distinct from OSGi Event Admin |
| Programmatic content distribution / replication | `Distributor.distribute(...)` — see `replication` skill |
| Heavy / blocking / I/O work | Always offload via `JobManager.addJob()` — never run in `handleEvent()` |
| Periodic / scheduled work | Sling Scheduler or Sling Jobs — see `scheduler` skill |

---

## Expert Guidance

**`handleEvent()` runs synchronously on a shared OSGi thread.** Treat it like a webhook receiver: extract the payload, validate the bare minimum, enqueue a job, return. Any work that can fail, block, or take measurable time belongs in the consumer.

**Leader election is not the same as run-mode.** Run mode distinguishes author from publish; `TopologyEventListener` distinguishes the leader author pod from the followers. For singleton execution across the author cluster, use `TopologyEventListener`. Adding a `runMode == author` check on top is fine for safety, but it doesn't replace leader election.

**Idempotency matters in distributed AEMaaCS.** Even with leader election:

- A `TOPOLOGY_CHANGED` event may briefly elect two leaders during transition
- Sling Jobs may retry on `JobResult.FAILED` and replay the consumer
- The consumer may run on any author pod, not necessarily the one that received the event

Consumers should:

- Tolerate duplicate execution (running the same job twice should not double-apply effects)
- Tolerate missing resources (the target may have moved or been deleted between event and processing)
- Derive current state from the repository whenever possible, instead of relying solely on event payload

**Failure modes to plan for:**

- **Required job property missing** — return `JobResult.CANCEL`; retrying won't fix it
- **Transient resolver failure** (`LoginException` during cluster transition) — return `JobResult.FAILED`; Sling will retry per queue config
- **Repository write conflict** (`PersistenceException` on stale state) — return `JobResult.FAILED`; retry will re-read current state
- **Permission denied** — usually `JobResult.CANCEL` (won't recover without config change); log loudly so the misconfiguration is visible

---

### Practical engineering notes

The following are practical observations from production AEMaaCS code rather than items documented as part of Adobe's official OSGi Event Admin or Sling Discovery API contract. They are useful design guidance but should not be treated as guarantees:

- **`TOPOLOGY_CHANGING` events may pause execution briefly.** Between a `TOPOLOGY_CHANGING` and the next `TOPOLOGY_CHANGED`, the cluster has no agreed leader. A conservative pattern is to also reset `isLeader = false` on `TOPOLOGY_CHANGING` to avoid two leaders running in parallel during the transition window. Whether this matters depends on the cost of double-execution in your specific consumer.
- **OSGi event delivery order is not guaranteed across topics.** If your handler depends on receiving Event A before Event B, this is fragile. Prefer per-event idempotency and derive ordering from repository state (e.g. timestamps in `jcr:content`).
- **`EVENT_FILTER` syntax is LDAP filter syntax.** Common mistake: writing `=` instead of `(...=...)`. The filter `(path=/content/*)` works; the filter `path=/content/*` is silently rejected.
