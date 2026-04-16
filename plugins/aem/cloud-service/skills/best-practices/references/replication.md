# Replication API Migration Pattern

Migrates legacy replication code to Cloud Service compatible pattern: **Sling Distribution API** instead of Sling Replication / CQ Replication APIs.

**Before transformation steps:** [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md).

**Source patterns handled:**
- Sling Replication Agent API: `ReplicationAgent`, `ReplicationAgentConfiguration`, `ReplicationAgentException`, `ReplicationResult`, `SimpleReplicationAgent` — `agent.replicate(resolver, ReplicationActionType.ADD, path)`
- CQ Replication API: `com.day.cq.replication.Replicator`, `ReplicationAction` — `replicator.replicate(resolver, new ReplicationAction(ReplicationActionType.ACTIVATE, path))`

**Target pattern:**
- Sling Distribution API: `Distributor`, `DistributionRequest`, `SimpleDistributionRequest`
- `DistributionRequest distributionRequest = new SimpleDistributionRequest(DistributionRequestType.ADD, false, path);`
- Uses `getServiceResourceResolver()` with SUBSERVICE; resolver lifecycle and logging per [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md)

## Classification

Identify which source pattern the file uses:
- **Sling Replication Agent:** Has `ReplicationAgent`, `ReplicationAgentException`, `ReplicationResult`, `agent.replicate(resolver, ReplicationActionType.*, path)`
- **CQ Replicator:** Has `com.day.cq.replication.Replicator`, `ReplicationAction`, `replicator.replicate(resolver, action)`

If the file already uses `Distributor` and `SimpleDistributionRequest`, it may not need migration — verify and skip if already compliant.

## Pattern-Specific Rules

- **DO** replace ReplicationAgent/Replicator with `Distributor`
- **DO** replace ReplicationAction/ReplicationResult with `SimpleDistributionRequest`/`DistributionResponse`
- **DO** map ReplicationActionType to DistributionRequestType (e.g., ACTIVATE → ADD)
- **DO** use `publish` or `preview` to target the specific Distribution Agent or both separately if distributing to both publish and preview tiers
- **DO NOT** use administrative resolver or console logging — follow [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md)

---

## Complete Example: Before and After

### Example 1: CQ Replicator → Sling Content Distribution

#### Before (Legacy CQ Replicator)

```java
package com.example.replication;

import org.apache.felix.scr.annotations.Component;
import org.apache.felix.scr.annotations.Reference;
import org.apache.felix.scr.annotations.Service;
import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import com.day.cq.replication.ReplicationAction;
import com.day.cq.replication.Replicator;
import com.day.cq.replication.ReplicationActionType;

import java.util.HashMap;
import java.util.Map;

@Component(immediate = true)
@Service
public class PropertyNodeReplicationService {

    @Reference
    private Replicator replicator;

    @Reference
    private ResourceResolverFactory resourceResolverFactory;

    public void replicatePropertyNode(String propertyNodePath) {
        ResourceResolver resolver = null;
        try {
            Map<String, Object> authInfo = new HashMap<>();
            authInfo.put(ResourceResolverFactory.USER, "replication-service");
            authInfo.put(ResourceResolverFactory.PASSWORD, "password");
            
            resolver = resourceResolverFactory.getAdministrativeResourceResolver(authInfo);
            
            if (resolver != null) {
                ReplicationAction action = new ReplicationAction(ReplicationActionType.ACTIVATE, propertyNodePath);
                replicator.replicate(resolver, action);
                System.out.println("Property Node Replication successful for path: " + propertyNodePath);
            }
        } catch (Exception e) {
            System.err.println("Property Node Replication failed for path: " + propertyNodePath);
            System.err.println("Error: " + e.getMessage());
            e.printStackTrace();
        } finally {
            if (resolver != null && resolver.isLive()) {
                resolver.close();
            }
        }
    }
}
```

#### After (Cloud Service Compatible)

```java
package com.example.replication;

import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.apache.sling.distribution.Distributor;
import org.apache.sling.distribution.DistributionRequest;
import org.apache.sling.distribution.DistributionResponse;
import org.apache.sling.distribution.DistributionRequestType;
import org.apache.sling.distribution.SimpleDistributionRequest;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Collections;

@Component(service = PropertyNodeReplicationService.class)
public class PropertyNodeReplicationService {

    private static final Logger LOG = LoggerFactory.getLogger(PropertyNodeReplicationService.class);

    @Reference
    private Distributor distributor;

    @Reference
    private ResourceResolverFactory resolverFactory;

    public void replicatePropertyNode(String propertyNodePath) {
        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "property-node-distribution-service"))) {

            if (resolver == null) {
                LOG.warn("Could not acquire resource resolver");
                return;
            }

            DistributionRequest distributionRequest = new SimpleDistributionRequest(
                DistributionRequestType.ADD,
                false,
                propertyNodePath
            );
            DistributionResponse distributionResponse = distributor.distribute("publish", resolver, distributionRequest);

            LOG.info("Property Node Distribution successful for path: {}", propertyNodePath);

        } catch (LoginException e) {
            LOG.error("Failed to get resource resolver", e);
        } catch (Exception e) {
            LOG.error("Error during distribution", e);
        }
    }
}
```

### Example 2: Sling Replication Agent → Sling Content Distribution

#### Before (Legacy Sling Replication Agent)

```java
package com.example.replication;

import org.apache.felix.scr.annotations.Component;
import org.apache.felix.scr.annotations.Reference;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.apache.sling.replication.agent.api.ReplicationAgent;
import org.apache.sling.replication.agent.api.ReplicationAgentException;
import org.apache.sling.replication.agent.api.ReplicationResult;
import org.apache.sling.replication.agent.api.ReplicationActionType;

import java.util.HashMap;
import java.util.Map;

@Component(immediate = true)
public class ContentReplicationService {

    @Reference
    private ReplicationAgent agent;

    @Reference
    private ResourceResolverFactory resourceResolverFactory;

    public void replicateContent(String contentPath) {
        try {
            ResourceResolver resolver = resourceResolverFactory.getAdministrativeResourceResolver(null);
            if (resolver != null) {
                ReplicationResult result = agent.replicate(resolver, ReplicationActionType.ADD, contentPath);
                if (result.isSuccessful()) {
                    System.out.println("Forward Replication successful for path: " + contentPath);
                } else {
                    System.err.println("Forward Replication failed for path: " + contentPath);
                }
                resolver.close();
            }
        } catch (ReplicationAgentException e) {
            System.err.println("ReplicationAgentException occurred: " + e.getMessage());
            e.printStackTrace();
        } catch (Exception e) {
            System.err.println("Exception occurred: " + e.getMessage());
            e.printStackTrace();
        }
    }
}
```

#### After (Cloud Service Compatible)

```java
package com.example.replication;

import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.apache.sling.distribution.Distributor;
import org.apache.sling.distribution.DistributionRequest;
import org.apache.sling.distribution.DistributionResponse;
import org.apache.sling.distribution.DistributionRequestType;
import org.apache.sling.distribution.SimpleDistributionRequest;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Collections;

@Component(service = ContentReplicationService.class)
public class ContentReplicationService {

    private static final Logger LOG = LoggerFactory.getLogger(ContentReplicationService.class);

    @Reference
    private Distributor distributor;

    @Reference
    private ResourceResolverFactory resolverFactory;

    public void replicateContent(String contentPath) {
        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "content-distribution-service"))) {

            if (resolver == null) {
                LOG.warn("Could not acquire resource resolver");
                return;
            }

            DistributionRequest distributionRequest = new SimpleDistributionRequest(
                DistributionRequestType.ADD,
                false,
                contentPath
            );
            DistributionResponse distributionResponse = distributor.distribute("publish", resolver, distributionRequest);
            LOG.info("Forward Distribution successful for path: {}", contentPath);

        } catch (LoginException e) {
            LOG.error("Failed to get resource resolver", e);
        } catch (Exception e) {
            LOG.error("Error during distribution", e);
        }
    }
}
```

**Key Changes:**
- ✅ Replaced `Replicator`/`ReplicationAgent` → `Distributor`
- ✅ Replaced `ReplicationAction`/`ReplicationResult` → `DistributionRequest`/`DistributionResponse`
- ✅ Mapped `ReplicationActionType.ACTIVATE` → `DistributionRequestType.ADD`
- ✅ Used correct `publish`/`preview` agent
- ✅ Replaced `getAdministrativeResourceResolver()` → `getServiceResourceResolver()` with SUBSERVICE
- ✅ Removed USER/PASSWORD from authInfo (Cloud Service uses SUBSERVICE only)
- ✅ Replaced `System.out/err` → SLF4J Logger
- ✅ Used try-with-resources for ResourceResolver

---

# Transformation Steps

## P0: Pattern prerequisites

Read [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md) and apply SCR→DS and ResourceResolver/logging **before** replication-specific steps below.

## P1: Replace ReplicationAgent/Replicator with Distributor

**For Sling Replication Agent (ReplicationAgent):**

```java
// BEFORE (Sling Replication Agent)
@Reference
private ReplicationAgent agent;

ReplicationResult result = agent.replicate(resolver, ReplicationActionType.ADD, propertyNodePath);
if (result.isSuccessful()) {
    System.out.println("Property Node Replication successful for path: " + propertyNodePath);
} else {
    System.out.println("Property Node Replication failed for path: " + propertyNodePath);
}

// AFTER (Sling Content Distributor)
@Reference
private Distributor distributor;

DistributionRequest distributionRequest = new SimpleDistributionRequest(DistributionRequestType.ADD, false, propertyNodePath);

DistributionResponse distributionResponse = distributor.distribute("publish", resolver, distributionRequest);

LOG.info("Property Node Distribution successful for path: {}", propertyNodePath);
```

**For CQ Replicator:**

```java
// BEFORE (CQ Replicator)
@Reference
private Replicator replicator;

ReplicationAction action = new ReplicationAction(ReplicationActionType.ACTIVATE, contentPath);
replicator.replicate(resolver, action);
System.out.println("Forward Replication successful for path: " + contentPath);

// AFTER (Sling Content Distributor)
@Reference
private Distributor distributor;

DistributionRequest distributionRequest = new SimpleDistributionRequest(DistributionRequestType.ADD, false, contentPath);

DistributionResponse distributionResponse = distributor.distribute("publish", resolver, distributionRequest);
LOG.info("Forward Distribution successful for path: {}", contentPath);
```

**ReplicationActionType to DistributionRequestType mapping:**

| ReplicationActionType | DistributionRequestType |
|----------------------|-------------------------|
| `ACTIVATE`           | `ADD`                   |
| `DEACTIVATE`         | `DELETE`                |
| `ADD`                | `ADD`                   |
| `DELETE`             | `DELETE`                |

**Note:** `Distributor.distribute(agent-name, resolver, distributionRequest)` requires a ResourceResolver parameter, retain it per [resource-resolver-logging.md](resource-resolver-logging.md) (try-with-resources, service user).

## P2: Update imports

**Remove (Sling Replication Agent):**
```java
import org.apache.sling.replication.agent.api.ReplicationAgent;
import org.apache.sling.replication.agent.api.ReplicationAgentConfiguration;
import org.apache.sling.replication.agent.api.ReplicationAgentException;
import org.apache.sling.replication.agent.api.ReplicationResult;
import org.apache.sling.replication.agent.impl.SimpleReplicationAgent;
```

**Remove (CQ Replicator):**
```java
import com.day.cq.replication.ReplicationAction;
import com.day.cq.replication.Replicator;
```

**Remove (after SCR→DS migration per [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md)):**
```java
import org.apache.felix.scr.annotations.*;  // must be gone when done
```

**Add:**
```java
import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.apache.sling.distribution.Distributor;
import org.apache.sling.distribution.DistributionRequest;
import org.apache.sling.distribution.DistributionResponse;
import org.apache.sling.distribution.DistributionRequestType;
import org.apache.sling.distribution.SimpleDistributionRequest;
import org.osgi.framework.Constants;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.Collections;
import java.util.Map;
```

---

# Validation

## Replication/Distribution Checklist

- [ ] No `ReplicationAgent`, `Replicator`, `ReplicationAction`, or `ReplicationResult` remains
- [ ] Uses `Distributor` (`org.apache.sling.distribution`)
- [ ] Uses `SimpleDistributionRequest` with `DistributionRequestType` from `org.apache.sling.distribution`
- [ ] Calls `distributor.distribute("publish", resolver, distributionRequest)` with the service-user resolver
- [ ] [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md) satisfied (SCR→DS, resolver/logging, auth maps)
- [ ] `scheduler.concurrent=false` is set (if using scheduler)
- [ ] Code compiles: `mvn clean compile`
