# Replication API Migration Pattern

Migrates legacy replication code to Cloud Service compatible pattern: **Sling Distribution API** instead of Sling Replication / CQ Replication APIs.

**Before transformation steps:** [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md).

**Source patterns handled:**
- Sling Replication Agent API: `ReplicationAgent`, `ReplicationAgentConfiguration`, `ReplicationAgentException`, `ReplicationResult`, `SimpleReplicationAgent` — `agent.replicate(resolver, ReplicationActionType.ADD, path)`
- CQ Replication API: `com.day.cq.replication.Replicator`, `ReplicationAction` — `replicator.replicate(resolver, new ReplicationAction(ReplicationActionType.ACTIVATE, path))`

**Target pattern:**
- Sling Distribution API: `DistributionAgent`, `DistributionRequest`, `SimpleDistributionRequest`
- `distributionAgent.execute(new SimpleDistributionRequest(DistributionRequestType.ADD, path))`
- Uses `getServiceResourceResolver()` with SUBSERVICE; resolver lifecycle and logging per [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md)

## Classification

Identify which source pattern the file uses:
- **Sling Replication Agent:** Has `ReplicationAgent`, `ReplicationAgentException`, `ReplicationResult`, `agent.replicate(resolver, ReplicationActionType.*, path)`
- **CQ Replicator:** Has `com.day.cq.replication.Replicator`, `ReplicationAction`, `replicator.replicate(resolver, action)`

If the file already uses `DistributionAgent` and `DistributionRequest`/`SimpleDistributionRequest`, it may not need migration — verify and skip if already compliant.

## Pattern-Specific Rules

- **DO** replace ReplicationAgent/Replicator with DistributionAgent
- **DO** replace ReplicationAction/ReplicationResult with DistributionRequest/SimpleDistributionRequest
- **DO** map ReplicationActionType to DistributionRequestType (e.g., ACTIVATE → ADD)
- **DO** use `@Reference(target = "(name=agent-name)")` to target the specific Distribution Agent
- **DO NOT** use administrative resolver or console logging — follow [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md)

---

## Complete Example: Before and After

### Example 1: CQ Replicator → Sling Distribution Agent

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
import org.apache.sling.distribution.agent.api.DistributionAgent;
import org.apache.sling.distribution.agent.api.DistributionAgentException;
import org.apache.sling.distribution.agent.api.DistributionRequest;
import org.apache.sling.distribution.agent.api.SimpleDistributionRequest;
import org.apache.sling.distribution.agent.api.DistributionRequestType;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Collections;

@Component(service = PropertyNodeReplicationService.class)
public class PropertyNodeReplicationService {

    private static final Logger LOG = LoggerFactory.getLogger(PropertyNodeReplicationService.class);

    @Reference(target = "(name=myPropertyDistributionAgent)")
    private DistributionAgent distributionAgent;

    @Reference
    private ResourceResolverFactory resolverFactory;

    public void replicatePropertyNode(String propertyNodePath) {
        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "property-node-distribution-service"))) {

            if (resolver == null) {
                LOG.warn("Could not acquire resource resolver");
                return;
            }

            DistributionRequest request = new SimpleDistributionRequest(
                DistributionRequestType.ADD, 
                propertyNodePath
            );
            distributionAgent.execute(request);
            LOG.info("Property Node Distribution successful for path: {}", propertyNodePath);

        } catch (LoginException e) {
            LOG.error("Failed to get resource resolver", e);
        } catch (DistributionAgentException e) {
            LOG.error("Distribution failed for path: {}", propertyNodePath, e);
        } catch (Exception e) {
            LOG.error("Error during distribution", e);
        }
    }
}
```

### Example 2: Sling Replication Agent → Sling Distribution Agent

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
import org.apache.sling.distribution.agent.api.DistributionAgent;
import org.apache.sling.distribution.agent.api.DistributionAgentException;
import org.apache.sling.distribution.agent.api.DistributionRequest;
import org.apache.sling.distribution.agent.api.SimpleDistributionRequest;
import org.apache.sling.distribution.agent.api.DistributionRequestType;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Collections;

@Component(service = ContentReplicationService.class)
public class ContentReplicationService {

    private static final Logger LOG = LoggerFactory.getLogger(ContentReplicationService.class);

    @Reference(target = "(name=my-distribution-agent)")
    private DistributionAgent distributionAgent;

    @Reference
    private ResourceResolverFactory resolverFactory;

    public void replicateContent(String contentPath) {
        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "content-distribution-service"))) {

            if (resolver == null) {
                LOG.warn("Could not acquire resource resolver");
                return;
            }

            DistributionRequest request = new SimpleDistributionRequest(
                DistributionRequestType.ADD, 
                contentPath
            );
            distributionAgent.execute(request);
            LOG.info("Forward Distribution successful for path: {}", contentPath);

        } catch (LoginException e) {
            LOG.error("Failed to get resource resolver", e);
        } catch (DistributionAgentException e) {
            LOG.error("Distribution failed for path: {}", contentPath, e);
        } catch (Exception e) {
            LOG.error("Error during distribution", e);
        }
    }
}
```

**Key Changes:**
- ✅ Replaced `Replicator`/`ReplicationAgent` → `DistributionAgent`
- ✅ Replaced `ReplicationAction`/`ReplicationResult` → `DistributionRequest`/`SimpleDistributionRequest`
- ✅ Mapped `ReplicationActionType.ACTIVATE` → `DistributionRequestType.ADD`
- ✅ Added `@Reference(target = "(name=agent-name)")` for agent selection
- ✅ Replaced `getAdministrativeResourceResolver()` → `getServiceResourceResolver()` with SUBSERVICE
- ✅ Removed USER/PASSWORD from authInfo (Cloud Service uses SUBSERVICE only)
- ✅ Replaced `System.out/err` → SLF4J Logger
- ✅ Used try-with-resources for ResourceResolver
- ✅ `DistributionAgent.execute()` no longer requires ResourceResolver parameter (agent uses its own service user)

---

# Transformation Steps

## P0: Pattern prerequisites

Read [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md) and apply SCR→DS and ResourceResolver/logging **before** replication-specific steps below.

## P1: Replace ReplicationAgent/Replicator with DistributionAgent

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

// AFTER (Sling Distribution Agent)
@Reference(target = "(name=myPropertyDistributionAgent)")
private DistributionAgent distributionAgent;

DistributionRequest request = new SimpleDistributionRequest(DistributionRequestType.ADD, propertyNodePath);
distributionAgent.execute(request);
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

// AFTER (Sling Distribution Agent)
@Reference(target = "(name=my-distribution-agent)")
private DistributionAgent distributionAgent;

DistributionRequest request = new SimpleDistributionRequest(DistributionRequestType.ADD, contentPath);
distributionAgent.execute(request);
LOG.info("Forward Distribution successful for path: {}", contentPath);
```

**ReplicationActionType to DistributionRequestType mapping:**

| ReplicationActionType | DistributionRequestType |
|----------------------|-------------------------|
| `ACTIVATE`           | `ADD`                   |
| `DEACTIVATE`         | `DELETE`                |
| `ADD`                | `ADD`                   |
| `DELETE`             | `DELETE`                |

**Note:** `DistributionAgent.execute(request)` does not require a ResourceResolver parameter — the agent uses its own service user. If the resolver is needed for other logic, retain it per [resource-resolver-logging.md](resource-resolver-logging.md) (try-with-resources, service user).

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
import org.apache.sling.distribution.agent.api.DistributionAgent;
import org.apache.sling.distribution.agent.api.DistributionAgentException;
import org.apache.sling.distribution.agent.api.DistributionRequest;
import org.apache.sling.distribution.agent.api.SimpleDistributionRequest;
import org.apache.sling.distribution.agent.api.DistributionRequestType;
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
- [ ] Uses `DistributionAgent` with `@Reference(target = "(name=agent-name)")`
- [ ] Uses `DistributionRequest` / `SimpleDistributionRequest` with `DistributionRequestType`
- [ ] [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md) satisfied (SCR→DS, resolver/logging, auth maps)
- [ ] `scheduler.concurrent=false` is set (if using scheduler)
- [ ] Code compiles: `mvn clean compile`
