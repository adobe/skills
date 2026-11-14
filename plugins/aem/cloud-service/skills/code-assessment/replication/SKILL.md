---
name: replication
description: AEM Cloud Service expert skill for replication / content distribution. Covers migration from CQ Replicator (com.day.cq.replication.Replicator) and Sling Replication Agent (org.apache.sling.replication.agent.api) to the Sling Distribution API (Distributor + SimpleDistributionRequest). Includes agent selection (publish vs preview), async response handling, author cluster coordination, service-user setup, review checklist, troubleshooting, and common pitfalls.
license: Apache-2.0
---

# Replication / Content Distribution — AEM as a Cloud Service

## Overview

On AEM as a Cloud Service, replication is performed via the **Sling Distribution API** (`org.apache.sling.distribution.Distributor`). The legacy CQ `Replicator` (`com.day.cq.replication.*`) and Sling Replication Agent (`org.apache.sling.replication.agent.*`) APIs are **not supported** — code using them either compiles against legacy AEM 6.x jars or fails at runtime on CS.

**AEMaaCS provides two predefined replication agents:**

| Agent name | Targets | Default state |
|-----------|---------|---------------|
| `publish` | Live publish tier | Available by default in every AEMaaCS environment |
| `preview` | Preview tier | **Opt-in** — only available when the preview tier is enabled for the environment |

`publish` is the default agent for activation; `preview` must be explicitly enabled. If both tiers are in use, call `distributor.distribute(...)` **twice** — once per agent name. Legacy `Replicator.replicate(...)` implicitly fanned out to every configured agent; `Distributor.distribute(...)` is explicit and targets one named agent per call.

**Three CS-specific constraints every distribution call must satisfy:**

| Constraint | Why |
|-----------|-----|
| Use `Distributor` + `SimpleDistributionRequest` — not `Replicator` or `ReplicationAgent` | Legacy APIs are removed from the CS SDK |
| Resolver via `getServiceResourceResolver(SUBSERVICE)` — never admin auth or `USER`/`PASSWORD` maps | Admin resolvers are unavailable on CS; service-user auth is the only supported path |
| Inspect `DistributionResponse.isSuccessful()` and `getState()` | `Distributor.distribute()` returns a queued/accepted response — it does NOT block for delivery |

> **`Distributor.distribute()` is asynchronous.** A successful response means the distribution request was **queued**, not **delivered**. Do not assume content has reached the publish tier just because the call returned `isSuccessful() == true`. See [Expert Guidance](#expert-guidance) below.

---

## Classification — choose before making any changes

Identify the source pattern in the file:

**Uses `com.day.cq.replication.Replicator`** with `ReplicationAction` and `ReplicationActionType` (`ACTIVATE`, `DEACTIVATE`)
→ Apply **P1–P4**.

**Uses `org.apache.sling.replication.agent.api.ReplicationAgent`** with `ReplicationResult` and `agent.replicate(resolver, type, path)`
→ Apply **P1–P4**.

**Uses `Distributor` + `SimpleDistributionRequest` already**
→ Already on the target API — verify against the [Review Checklist](#review-checklist) only.

**Uses `WorkflowSession.startWorkflow(...)` with a replication launcher**
→ This skill covers **programmatic** distribution. If replication is tied to a content workflow step, the workflow handles it — leave the workflow alone, do not introduce a parallel `Distributor` call.

**One pattern per session.** If the bundle has multiple legacy classes, migrate one class at a time.

**Before starting:** Read [`../references/aem-cloud-service-pattern-prerequisites.md`](../references/aem-cloud-service-pattern-prerequisites.md) and apply SCR→DS, service-user, and SLF4J fixes if present in the same changeset.

---

## Discovery

Detection is performed by the analyzer ([`../scripts/analyze.sh`](../scripts/README.md)), run by the runbook:

```bash
bash ../scripts/analyze.sh <workspace-root> --pattern replication
```

**Match criteria (what the detector flags):** a file that imports **`com.day.cq.replication.Replicator`** or any **`org.apache.sling.replication.*`** type — the legacy replication APIs removed on Cloud Service. One finding per file, at the file's primary type, with the class header as the snippet. Parse-level only — import-based, no type resolution. The modern `org.apache.sling.distribution.*` API is not flagged.

> Analyzer-only: `replication` has no BPA subtype, so a `replication` finding originates from the local analyzer, never from a BPA/CAM report.

## Resolution contract

**guided** — `apply (guided)`. The analyzer locates each legacy replication caller; remediation is judgment-based (CQ `Replicator` / Sling Replication Agent → Sling Distribution API) and applied via P1–P4 in an apply session.

| Site shape | Disposition |
|---|---|
| `Replicator` / Sling Replication Agent usage in custom code | apply (guided) → P1–P4 |
| Replication tied to a workflow step (workflow owns it) | skipped: `workflow-owned` |
| Test code (`src/test/`) | skipped: `test-scope` |

---

## Complete example — before and after

### Before (legacy CQ Replicator with admin resolver)

```java
package com.example.replication;

import org.apache.felix.scr.annotations.Component;
import org.apache.felix.scr.annotations.Reference;
import org.apache.felix.scr.annotations.Service;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import com.day.cq.replication.ReplicationAction;
import com.day.cq.replication.ReplicationActionType;
import com.day.cq.replication.Replicator;

import java.util.HashMap;
import java.util.Map;

@Component(immediate = true)
@Service
public class ContentReplicationService {

    @Reference
    private Replicator replicator;

    @Reference
    private ResourceResolverFactory resolverFactory;

    public void replicateContent(String contentPath) {
        ResourceResolver resolver = null;
        try {
            Map<String, Object> authInfo = new HashMap<>();
            authInfo.put(ResourceResolverFactory.USER, "replication-service");
            authInfo.put(ResourceResolverFactory.PASSWORD, "password");
            resolver = resolverFactory.getAdministrativeResourceResolver(authInfo);

            ReplicationAction action = new ReplicationAction(ReplicationActionType.ACTIVATE, contentPath);
            replicator.replicate(resolver, action);
            System.out.println("Replicated: " + contentPath);
        } catch (Exception e) {
            System.err.println("Replication failed: " + e.getMessage());
            e.printStackTrace();
        } finally {
            if (resolver != null && resolver.isLive()) {
                resolver.close();
            }
        }
    }
}
```

### After — Cloud Service compatible

```java
package com.example.replication;

import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.apache.sling.distribution.DistributionException;
import org.apache.sling.distribution.DistributionRequest;
import org.apache.sling.distribution.DistributionRequestType;
import org.apache.sling.distribution.DistributionResponse;
import org.apache.sling.distribution.Distributor;
import org.apache.sling.distribution.SimpleDistributionRequest;
import org.apache.sling.settings.SlingSettingsService;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Collections;

@Component(service = ContentReplicationService.class)
public class ContentReplicationService {

    private static final Logger LOG = LoggerFactory.getLogger(ContentReplicationService.class);
    private static final String SUBSERVICE = "content-distribution-service";

    @Reference
    private Distributor distributor;

    @Reference
    private ResourceResolverFactory resolverFactory;

    @Reference
    private SlingSettingsService slingSettings;

    public void replicateContent(String contentPath) {
        if (!slingSettings.getRunModes().contains("author")) {
            LOG.debug("Skipping distribution on non-author instance for path: {}", contentPath);
            return;
        }

        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, SUBSERVICE))) {

            DistributionRequest request = new SimpleDistributionRequest(
                    DistributionRequestType.ADD, false, contentPath);

            DistributionResponse response = distributor.distribute("publish", resolver, request);

            if (response.isSuccessful()) {
                LOG.info("Content distribution queued for path: {} (state={})",
                        contentPath, response.getState());
            } else {
                LOG.warn("Content distribution not queued for path: {} (state={}, message={})",
                        contentPath, response.getState(), response.getMessage());
            }
        } catch (LoginException e) {
            LOG.error("Could not open service resolver for subservice '{}'", SUBSERVICE, e);
        } catch (DistributionException e) {
            LOG.error("Distribution failed for path: {}", contentPath, e);
        }
    }
}
```

**Required Repoinit** (goes in your `ui.config` Repoinit OSGi config):

```
create service user content-distribution-service

set ACL for content-distribution-service
    allow jcr:read,crx:replicate on /content
end
```

The **`crx:replicate`** privilege is required for the service user to initiate distribution — read access alone is not sufficient.

**Required service-user mapping** (`ui.config`, file named e.g. `org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-content-distribution.cfg.json`):

```json
{
  "user.mapping": [
    "com.example.mybundle:content-distribution-service=[content-distribution-service]"
  ]
}
```

---

## P1 — Replace Replicator / ReplicationAgent with Distributor

**For `com.day.cq.replication.Replicator`:**

```java
// BEFORE
@Reference
private Replicator replicator;

ReplicationAction action = new ReplicationAction(ReplicationActionType.ACTIVATE, path);
replicator.replicate(resolver, action);

// AFTER
@Reference
private Distributor distributor;

DistributionRequest request = new SimpleDistributionRequest(
        DistributionRequestType.ADD, false, path);
DistributionResponse response = distributor.distribute("publish", resolver, request);
```

**For `org.apache.sling.replication.agent.api.ReplicationAgent`:**

```java
// BEFORE
@Reference
private ReplicationAgent agent;

ReplicationResult result = agent.replicate(resolver, ReplicationActionType.ADD, path);
if (result.isSuccessful()) { /* ... */ }

// AFTER
@Reference
private Distributor distributor;

DistributionRequest request = new SimpleDistributionRequest(
        DistributionRequestType.ADD, false, path);
DistributionResponse response = distributor.distribute("publish", resolver, request);
if (response.isSuccessful()) { /* ... */ }
```

**`ReplicationActionType` → `DistributionRequestType` mapping:**

| Legacy `ReplicationActionType` | `DistributionRequestType` |
|--------------------------------|---------------------------|
| `ACTIVATE` | `ADD` |
| `DEACTIVATE` | `DELETE` |
| `ADD` | `ADD` |
| `DELETE` | `DELETE` |
| `INTERNAL_POLL` | No equivalent — drop (CS does not expose poll-style replication) |
| `TEST` | No equivalent — drop |

**`SimpleDistributionRequest` constructor:**

```java
new SimpleDistributionRequest(
    DistributionRequestType type,  // ADD or DELETE
    boolean deep,                  // include descendants (recursive distribution)
    String... paths                // one or more paths
)
```

- `deep = true` distributes the path **and all descendants**. Use sparingly — a single `deep=true` on `/content/mysite` can queue thousands of nodes.
- Pass multiple paths for a single batched request: `new SimpleDistributionRequest(ADD, false, path1, path2, path3)`.

**Distributing to both publish and preview tiers:**

```java
DistributionResponse publishResponse = distributor.distribute("publish", resolver, request);
DistributionResponse previewResponse = distributor.distribute("preview", resolver, request);
```

Two separate calls — there is no "distribute to all" agent name.

**Handle the "preview not enabled" case gracefully.** Because `preview` is opt-in per environment, code that distributes to both tiers must tolerate the absence of the preview agent. The `DistributionResponse` for an unconfigured agent comes back as `DROPPED` with a "no matching agent" message — this is **not** an error condition in environments that haven't enabled preview:

```java
DistributionResponse previewResponse = distributor.distribute("preview", resolver, request);
if (previewResponse.isSuccessful()) {
    LOG.info("Preview distribution queued for path: {}", path);
} else if (previewResponse.getMessage() != null
        && previewResponse.getMessage().contains("no matching agent")) {
    // Preview tier not enabled for this environment — expected on publish-only setups
    LOG.debug("Preview agent not configured; skipping preview distribution for {}", path);
} else {
    LOG.warn("Preview distribution failed for {}: state={}, message={}",
            path, previewResponse.getState(), previewResponse.getMessage());
}
```

Treating "no matching agent" as a warning rather than an info-level log in a publish-only environment creates alert noise; treating it as an error breaks deployments. Inspect the message and log at `debug`.

---

## P2 — Update imports

**Remove (CQ Replicator):**
```java
import com.day.cq.replication.ReplicationAction;
import com.day.cq.replication.ReplicationActionType;
import com.day.cq.replication.Replicator;
import com.day.cq.replication.ReplicationException;
```

**Remove (Sling Replication Agent):**
```java
import org.apache.sling.replication.agent.api.ReplicationAgent;
import org.apache.sling.replication.agent.api.ReplicationAgentConfiguration;
import org.apache.sling.replication.agent.api.ReplicationAgentException;
import org.apache.sling.replication.agent.api.ReplicationResult;
import org.apache.sling.replication.agent.api.ReplicationActionType;
import org.apache.sling.replication.agent.impl.SimpleReplicationAgent;
```

**Remove (SCR → DS):**
```java
import org.apache.felix.scr.annotations.*;
```

**Add:**
```java
import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.apache.sling.distribution.DistributionException;
import org.apache.sling.distribution.DistributionRequest;
import org.apache.sling.distribution.DistributionRequestType;
import org.apache.sling.distribution.DistributionResponse;
import org.apache.sling.distribution.Distributor;
import org.apache.sling.distribution.SimpleDistributionRequest;
import org.apache.sling.settings.SlingSettingsService;            // only if guarding by run mode
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.Collections;
```

---

## P3 — Service-user resolver and auth

Remove all legacy auth patterns:

```java
// REMOVE — admin auth is unavailable on CS
resolver = resolverFactory.getAdministrativeResourceResolver(null);

// REMOVE — USER/PASSWORD auth maps do not work on CS
Map<String, Object> authInfo = new HashMap<>();
authInfo.put(ResourceResolverFactory.USER, "...");
authInfo.put(ResourceResolverFactory.PASSWORD, "...");
resolver = resolverFactory.getResourceResolver(authInfo);
```

Replace with a service-user resolver in try-with-resources:

```java
try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
        Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "content-distribution-service"))) {
    // distribution call
} catch (LoginException e) {
    LOG.error("Could not open service resolver", e);
}
```

`getServiceResourceResolver` throws `LoginException` on failure — it does **not** normally return `null`. Catch `LoginException`; do not add a `resolver == null` branch unless a custom wrapper is in use.

**Service user privileges:** the user needs `crx:replicate` (in addition to `jcr:read`) on every path it distributes. Without it, `Distributor.distribute(...)` returns a non-successful response with a "not authorized" message. Permissions must be **declared directly on the service user** — do not rely on permissions inherited via group membership.

**Mapping file conventions:**

- Use the **amend** form (`ServiceUserMapperImpl.amended-<name>.cfg.json`) — do not edit the base `ServiceUserMapperImpl` config.
- Use **principal-name mapping**: the square-bracket form `=[service-user-name]` (as shown above) is the principal-name form.
- Do **not** use the deprecated `userName` form (single user without brackets) — it is being phased out across Sling.

---

## P4 — Inspect `DistributionResponse`

`Distributor.distribute(...)` returns a `DistributionResponse` describing the **outcome of queuing**, not the outcome of delivery. Always inspect it:

```java
DistributionResponse response = distributor.distribute("publish", resolver, request);

if (response.isSuccessful()) {
    LOG.info("Distribution queued: state={}", response.getState());
} else {
    // common non-successful states: DROPPED, NOT_EXECUTED
    LOG.warn("Distribution not queued: state={}, message={}",
             response.getState(), response.getMessage());
}
```

`DistributionResponse.getState()` values (most common):

| State | Meaning |
|-------|---------|
| `ACCEPTED` | Request queued for processing |
| `DISTRIBUTED` | Request delivered (returned by some agents/configurations) |
| `DROPPED` | Request rejected — typically a permission, validation, or queue-full issue. Inspect `getMessage()` |
| `NOT_EXECUTED` | Distribution not attempted |

> **Do not poll for `DISTRIBUTED`.** Distribution is asynchronous; the response is your only synchronous signal. For delivery visibility, use the Distribution UI (`Tools > Deployment > Distribution`) or operational monitoring — see [Modern Alternatives](#modern-alternatives) and [Practical engineering notes](#practical-engineering-notes).

---

## Greenfield — writing a new distribution caller from scratch

When writing new distribution code (not migrating legacy), use this template. It bundles the AEMaaCS best practices into one self-contained service: run-mode guard, service-user resolver in try-with-resources, agent iteration with defensive preview handling, and `JobResult`-style outcome classification.

```java
package com.example.distribution;

import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.apache.sling.distribution.DistributionException;
import org.apache.sling.distribution.DistributionRequest;
import org.apache.sling.distribution.DistributionRequestType;
import org.apache.sling.distribution.DistributionResponse;
import org.apache.sling.distribution.Distributor;
import org.apache.sling.distribution.SimpleDistributionRequest;
import org.apache.sling.settings.SlingSettingsService;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

@Component(service = MyDistributionService.class)
public class MyDistributionService {

    private static final Logger LOG = LoggerFactory.getLogger(MyDistributionService.class);
    private static final String SUBSERVICE = "my-distribution-service";

    // Iterate over the agents your site supports. Preview agent absence is handled defensively below.
    private static final List<String> AGENTS = Arrays.asList("publish", "preview");

    @Reference
    private Distributor distributor;

    @Reference
    private ResourceResolverFactory resolverFactory;

    @Reference
    private SlingSettingsService slingSettings;

    public void distribute(String path, DistributionRequestType type) {
        if (!slingSettings.getRunModes().contains("author")) {
            LOG.debug("Skipping distribution on non-author instance for path: {}", path);
            return;
        }

        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, SUBSERVICE))) {

            DistributionRequest request = new SimpleDistributionRequest(type, false, path);
            for (String agent : AGENTS) {
                distributeToAgent(agent, resolver, request, path);
            }
        } catch (LoginException e) {
            LOG.error("Could not open service resolver for '{}'", SUBSERVICE, e);
        }
    }

    private void distributeToAgent(String agent, ResourceResolver resolver,
                                   DistributionRequest request, String path) {
        try {
            DistributionResponse response = distributor.distribute(agent, resolver, request);
            if (response.isSuccessful()) {
                LOG.info("[{}] distribution queued for {} (state={})",
                        agent, path, response.getState());
            } else if (isAgentNotConfigured(response)) {
                // Expected when an agent (typically preview) is not enabled for this environment
                LOG.debug("[{}] agent not configured; skipping", agent);
            } else {
                LOG.warn("[{}] distribution failed for {}: state={}, message={}",
                        agent, path, response.getState(), response.getMessage());
            }
        } catch (DistributionException e) {
            LOG.error("[{}] distribution exception for {}", agent, path, e);
        }
    }

    private static boolean isAgentNotConfigured(DistributionResponse response) {
        String message = response.getMessage();
        return message != null && message.contains("no matching agent");
    }
}
```

What this template captures:

- **Single resolver per call** — opened in try-with-resources, reused for all agents in one invocation
- **Per-agent iteration** — adding a new agent in future means editing one list, not new code paths
- **Defensive preview handling** — opt-in agent absence is logged at `debug`, not `warn`
- **Distinct logging for the three outcomes** — queued (`info`), agent-not-configured (`debug`), real failure (`warn`)
- **`DistributionException` caught per agent** — one transport error doesn't abort the other agents

---

## Composition — calling Distributor from a JobConsumer

A common production pattern is **`ResourceChangeListener` → `JobConsumer` → `Distributor`**: the listener stays lightweight (per the [`resource-change-listener` skill](../resource-change-listener/SKILL.md)), the consumer runs the distribution off the listener thread and gets Sling Job retry semantics for free.

```java
import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.apache.sling.distribution.DistributionException;
import org.apache.sling.distribution.DistributionRequest;
import org.apache.sling.distribution.DistributionRequestType;
import org.apache.sling.distribution.DistributionResponse;
import org.apache.sling.distribution.Distributor;
import org.apache.sling.distribution.SimpleDistributionRequest;
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
    property = { JobConsumer.PROPERTY_TOPICS + "=com/example/replicate" }
)
public class ReplicationJobConsumer implements JobConsumer {

    public static final String JOB_TOPIC = "com/example/replicate";

    private static final Logger LOG = LoggerFactory.getLogger(ReplicationJobConsumer.class);
    private static final String SUBSERVICE = "content-distribution-service";

    @Reference
    private Distributor distributor;

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

            DistributionRequest request = new SimpleDistributionRequest(
                    DistributionRequestType.ADD, false, path);
            DistributionResponse response = distributor.distribute("publish", resolver, request);

            if (response.isSuccessful()) {
                return JobResult.OK;
            }

            // Map DistributionResponse failure modes to JobResult outcomes
            String message = response.getMessage();
            if (message != null
                    && (message.contains("not authorized") || message.contains("no matching agent"))) {
                // Permission or configuration error — retrying won't help. CANCEL drains the queue.
                LOG.error("Unrecoverable distribution failure for {}: {}", path, message);
                return JobResult.CANCEL;
            }

            // Transient (queue full / transport / back-pressure) — FAILED triggers Sling retry per queue config
            LOG.warn("Transient distribution failure for {}: {}", path, message);
            return JobResult.FAILED;

        } catch (LoginException e) {
            LOG.error("Could not open service resolver for '{}'", SUBSERVICE, e);
            return JobResult.FAILED;
        } catch (DistributionException e) {
            LOG.error("Distribution exception for {}", path, e);
            return JobResult.FAILED;
        }
    }
}
```

Key composition rules:

- **Run-mode guard belongs on the trigger (listener), not the consumer.** Sling Jobs may run on any author pod; the listener decides whether to enqueue in the first place.
- **Map `DistributionResponse` → `JobResult` deliberately.** Permission/agent errors are unrecoverable (`CANCEL`); transient queue/transport errors are retryable (`FAILED`).
- **Share the topic constant.** The listener and consumer both reference `JOB_TOPIC` (or a shared constants class) — never copy the literal string into both.
- **Service user must own `crx:replicate`** on the paths the consumer distributes, regardless of which pod runs the job.

---

## Author-only execution and cluster coordination

Distribution is initiated from **author**. Running it on publish has no effect (publish has no distribution agents pointing outward) and indicates a code-path bug.

Guard at the top of the public method:

```java
@Reference
private SlingSettingsService slingSettings;

public void replicate(String path) {
    if (!slingSettings.getRunModes().contains("author")) {
        return;
    }
    // distribution logic
}
```

> **Author-only does not mean single execution.** In AEMaaCS author clusters, multiple author pods may receive the same trigger (e.g. a `ResourceChangeListener` event delivered to each node). If the operation must distribute exactly once per logical change, use a cluster-coordination pattern — leader-instance check (`SlingSettingsService` topology APIs), distributed lock, or idempotent design at the trigger layer. A run-mode check alone guarantees neither uniqueness nor ordering across the author cluster.

---

## Review Checklist

**Cross-cutting:**
- [ ] No `com.day.cq.replication.*` imports remain
- [ ] No `org.apache.sling.replication.agent.*` imports remain
- [ ] No `getAdministrativeResourceResolver()` or `USER`/`PASSWORD` auth maps remain
- [ ] `getServiceResourceResolver(SUBSERVICE)` used in try-with-resources
- [ ] OSGi DS R6 annotations — no `org.apache.felix.scr.annotations.*` imports
- [ ] SLF4J logging — no `System.out` / `System.err` / `printStackTrace`

**Distribution call:**
- [ ] `@Reference Distributor` injected — not `Replicator` or `ReplicationAgent`
- [ ] `SimpleDistributionRequest` constructed with explicit `DistributionRequestType` (`ADD` / `DELETE`)
- [ ] `deep=true` used deliberately — narrow scope when possible
- [ ] Agent name explicit (`"publish"` and/or `"preview"`) — not a legacy custom agent name
- [ ] If distributing to both tiers, two separate `distribute(...)` calls
- [ ] `DistributionResponse.isSuccessful()` checked; `getState()` and `getMessage()` logged on failure
- [ ] `DistributionException` caught and logged

**Service user / config:**
- [ ] Service user created via Repoinit in `ui.config`
- [ ] Service user has `crx:replicate` (not just `jcr:read`) on distributed paths
- [ ] `ServiceUserMapperImpl.amended-*.cfg.json` maps `<bundle>:<subservice>` → the service user
- [ ] Bundle symbolic name in the mapping matches the bundle owning the distribution caller

**Execution context:**
- [ ] Caller guards with `SlingSettingsService.getRunModes().contains("author")` (distribution from publish is a no-op)
- [ ] For triggers that may fire on every author cluster node, idempotency is documented or cluster coordination is in place
- [ ] `mvn clean install` succeeds with no SCR-related or deprecated-API warnings

---

## Troubleshooting

| Symptom | Log to search | Fix direction |
|---------|--------------|--------------|
| `LoginException: Unable to retrieve the service resource resolver` | the exception name verbatim | Service user not provisioned via Repoinit, OR `ServiceUserMapperImpl.amended-*.cfg.json` missing/misnamed, OR bundle symbolic name in the mapping doesn't match the bundle owning the distribution caller |
| `DistributionResponse.getState() == DROPPED` with "not authorized" message | `state=DROPPED` and `not authorized` in `getMessage()` | Service user lacks `crx:replicate` — extend Repoinit ACL to add `crx:replicate` on the distributed paths |
| `DistributionResponse.getState() == DROPPED` with "no matching agent" | `agent not found` or `no matching agent` | First argument to `distribute(...)` is a legacy/custom agent name not present on AEMaaCS — use `"publish"` or `"preview"` |
| Distribution call returns successful but content never appears on publish | none synchronously — in the Distribution UI (`Tools > Deployment > Distribution`), open the specific agent (`publish` or `preview`), then check **Queue items** for per-item state and **Logs** for per-item delivery errors | Distribution is asynchronous; the response means **queued**, not delivered. In the Distribution UI, items move from a `persisted` state to `fully published`. Items stuck in `persisted` indicate the publish tier hasn't drained the queue — open the item to see the failure reason. If the agent's overall status shows `blocked` or `paused`, distribution is halted for that agent regardless of individual item state |
| Same path queued N times in quick succession | repeating `Distribution queued for path: …` entries | Trigger fires on every author cluster pod — add idempotency check or leader-only guard. The log noise indicates a real coordination bug even if the final delivered outcome looks correct |
| `ClassNotFoundException: com.day.cq.replication.Replicator` at runtime | the exception name verbatim | Legacy `Replicator` API is not on the CS SDK classpath — code wasn't fully migrated; complete the P1 + P2 steps |
| `ClassNotFoundException: org.apache.sling.replication.agent.*` at runtime | the exception name verbatim | Same as above, for the Sling Replication Agent API |

---

## Common Pitfalls

**Treating `isSuccessful()` as "delivered"** — the response is synchronous; delivery is asynchronous. A successful response means "queued", not "received by publish". Downstream code that assumes immediate availability on publish will see stale or missing content.

**Hardcoding a legacy agent name** — copying `"default"`, `"socialpubsvc"`, or a customer-specific on-prem agent name into `distribute("...", ...)`. On AEMaaCS the only generally-available agents are `"publish"` and `"preview"`.

**Distributing from publish** — code paths that invoke `Distributor.distribute(...)` from publish will silently no-op or fail (no outbound agents). Always guard with `SlingSettingsService.getRunModes().contains("author")`.

**Using `getAdministrativeResourceResolver()` or `USER`/`PASSWORD` auth maps** — both are unsupported on CS. The only resolver path is `getServiceResourceResolver(SUBSERVICE)` with a Repoinit-provisioned service user.

**Missing `crx:replicate` on the service user** — without this privilege, `Distributor.distribute(...)` returns `DROPPED`. `jcr:read` alone is not enough.

**`deep=true` on broad paths** — `new SimpleDistributionRequest(ADD, true, "/content")` distributes every descendant. Often unintended and can flood the distribution queue. Use `deep=true` only when you genuinely need recursive distribution.

**Building a custom bulk loop with `distribute()`** — Adobe recommends the **Tree Activation workflow step** for bulk publishing rather than code that iterates pages calling `distribute()` per path. The workflow handles batching, throttling, and queue back-pressure. Reserve programmatic `distribute()` for narrow, targeted activations.

**Forgetting to distribute to `preview` when both tiers are in use** — if the site has both publish and preview tiers, distributing only to `"publish"` leaves preview stale.

**Polling for completion** — looping on `Distributor.distribute(...)` calls or sleeping to "wait for replication" is a code smell. Distribution is fire-and-forget from the caller's perspective; use the Distribution UI (`Tools > Deployment > Distribution`) or operational monitoring for delivery visibility.

**Catching `Exception` and swallowing it** — `DistributionException` carries the actual failure cause (permission, queue config, transport). Catching the broad `Exception` and logging only the message loses the stack trace and root cause.

---

## Modern Alternatives

| Need | Use |
|------|-----|
| Programmatic single-path activation from code | `Distributor.distribute("publish", resolver, request)` (this skill) |
| Recursive activation of a content tree | `SimpleDistributionRequest(ADD, true, path)` — used carefully |
| Multiple paths in one batch | `SimpleDistributionRequest(ADD, false, path1, path2, ...)` |
| Activation as part of an editorial workflow | AEM Workflow + the built-in **Activate Page** / **Deactivate Page** workflow step — do not add a parallel `Distributor` call |
| **Bulk activation of a tree (multiple pages/assets at once)** | **AEM Tree Activation workflow step** — Adobe's recommended approach for bulk publishing. Do not build a custom loop calling `distribute()` per path |
| Schedule-based distribution | Sling Distribution Trigger (configured via OSGi factory configs, not code) |
| Notify external systems when content changes | **AEM Eventing** (not replication) — replication is for moving content between AEM tiers, not for external notification |
| Initial environment seeding / large-scale content sync | AEM Content Transfer Tool (Cloud Manager) — not a code path |
| Asset distribution to delivery tiers | Distribution agent named `"publish"` handles assets the same way as pages |

---

## Expert Guidance

**Distribution is asynchronous; design for it.** The `DistributionResponse` tells you whether the request was accepted into the queue, not whether content has reached publish. Treat distribution like sending an email: the API confirms it left your outbox, not that the recipient read it. Use the Distribution UI (`Tools > Deployment > Distribution`) and the queue state model (`persisted` → `fully published`) for delivery visibility — not per-call assertions in code.

**Failure modes to plan for:**

- **Permission denied** — `DROPPED` state with "not authorized"; fix the service-user ACL (`crx:replicate`)
- **Agent not found** — `DROPPED` with "no matching agent"; fix the agent name (`publish` / `preview`)
- **Queue full / back-pressure** — `DROPPED` or `NOT_EXECUTED`; transient, retry with backoff
- **`DistributionException` thrown** — the request didn't reach the queue; check the exception cause and resolver state

**Do not invent agent names.** AEMaaCS provides `publish` and `preview` as the predefined agents (`publish` available by default, `preview` opt-in per environment). Custom agent names from on-prem setups (`"socialpubsvc"`, `"flush"`, `"reverse"`, customer-specific names) do not exist on CS. If a customer's legacy code references such names, the migration is to map them to `publish` / `preview` based on intent, not to recreate the agent.

**Preview tier is opt-in.** Even teams that "only have publish" today should be aware: if the site introduces preview later, every `distribute("publish", ...)` call site becomes a place that needs a second `distribute("preview", ...)` call. Wrapping the distribution in a small helper that takes the agent list as a parameter is cheap insurance.

---

### Practical engineering notes

The following are practical observations from production AEMaaCS code rather than items documented as part of Adobe's official Distribution API contract. They are useful design guidance but should not be treated as guarantees:

- **Author-cluster duplicate calls are usually harmless.** When triggers fire on multiple author cluster pods, the underlying distribution agent typically de-duplicates identical pending requests for the same path. Don't *rely* on this — design idempotency in your trigger logic — but it explains why duplicate `distribute()` calls in logs often produce a single delivered outcome.
- **Distribution events on author for observability.** Sling Distribution publishes OSGi events on topics like `org/apache/sling/distribution/agent/package/distributed`. Subscribing to these from an `EventHandler` or `JobConsumer` is a workable pattern for code that needs to react after a successful distribution, but the topic names and payload are Sling implementation detail, not part of the documented AEMaaCS contract. Verify against the Sling version shipped with your SDK before relying on them.
- **Don't poll the publish tier from author** to check whether content arrived. Use the Distribution UI or operational monitoring instead.
