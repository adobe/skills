# Replication API Migration Pattern

Migrates legacy replication code to Cloud Service compatible pattern: **Sling Distribution API** instead of Sling Replication / CQ Replication APIs.

**Source patterns handled:**
- Sling Replication Agent API: `ReplicationAgent`, `ReplicationAgentConfiguration`, `ReplicationAgentException`, `ReplicationResult`, `SimpleReplicationAgent` — `agent.replicate(resolver, ReplicationActionType.ADD, path)`
- CQ Replication API: `com.day.cq.replication.Replicator`, `ReplicationAction` — `replicator.replicate(resolver, new ReplicationAction(ReplicationActionType.ACTIVATE, path))`

**Target pattern:**
- Sling Distribution API: `DistributionAgent`, `DistributionRequest`, `SimpleDistributionRequest`
- `distributionAgent.execute(new SimpleDistributionRequest(DistributionRequestType.ADD, path))`
- Uses `getServiceResourceResolver()` with SUBSERVICE (no `getAdministrativeResourceResolver()`)
- ResourceResolver in try-with-resources
- SLF4J for logging

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
- **DO NOT** use `getAdministrativeResourceResolver()` — use `getServiceResourceResolver()` with SUBSERVICE
- **DO NOT** use System.out/System.err/e.printStackTrace() — use SLF4J Logger

---

# Transformation Steps

## P1: Migrate Felix SCR to OSGi DS annotations (if present)

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
    @Property(name = "scheduler.expression", value = "0 0/5 * * * ?")
})

// AFTER (OSGi DS)
@Component(service = Runnable.class, property = {
    Constants.SERVICE_DESCRIPTION + "=Replication Agent",
    "scheduler.expression=0 0/5 * * * ?",
    "scheduler.concurrent=false"
})
```

## P2: Replace ReplicationAgent/Replicator with DistributionAgent

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

**Note:** `DistributionAgent.execute(request)` does not require a ResourceResolver parameter — the agent uses its own service user. If the resolver is needed for other logic, retain it in try-with-resources.

## P3: Replace System.out, System.err, and e.printStackTrace() with SLF4J Logger

```java
// ADD after class declaration
private static final Logger LOG = LoggerFactory.getLogger(PropertyNodeDistributionAgent.class);

// REPLACE
System.out.println("Property Node Replication successful for path: " + propertyNodePath)
    ->  LOG.info("Property Node Distribution successful for path: {}", propertyNodePath)

System.err.println("LoginException occurred: " + e.getMessage())
    ->  LOG.error("LoginException occurred", e)

e.printStackTrace()
    ->  LOG.error("Error occurred", e)
```

## P4: Replace getAdministrativeResourceResolver() with getServiceResourceResolver()

If the file uses deprecated `getAdministrativeResourceResolver()`:

```java
// BEFORE (deprecated)
ResourceResolver resolver = resourceResolverFactory.getAdministrativeResourceResolver(null);

// AFTER
try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
        Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "property-node-distribution-service"))) {
    // use resolver
} catch (LoginException e) {
    LOG.error("Failed to get resource resolver", e);
}
```

**Auth info:** Prefer SUBSERVICE only for Cloud Service. Remove USER/PASSWORD from authInfo:

```java
// BEFORE (legacy)
Map<String, Object> authInfo = new HashMap<>();
authInfo.put(ResourceResolverFactory.SUBSERVICE, "property-node-distribution-service");
authInfo.put(ResourceResolverFactory.USER, user);
authInfo.put(ResourceResolverFactory.PASSWORD, password);

// AFTER (Cloud Service)
Map<String, Object> authInfo = Collections.singletonMap(
    ResourceResolverFactory.SUBSERVICE, "property-node-distribution-service");
```

## P5: ResourceResolver try-with-resources

Replace manual null-check and finally-close with try-with-resources:

```java
// BEFORE (manual management)
ResourceResolver resolver = null;
try {
    resolver = resolverFactory.getServiceResourceResolver(authInfo);
    distributionAgent.execute(request);
} catch (LoginException e) {
    LOG.error("LoginException occurred", e);
} finally {
    if (resolver != null && resolver.isLive()) {
        resolver.close();
    }
}

// AFTER (try-with-resources)
try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(authInfo)) {
    DistributionRequest request = new SimpleDistributionRequest(DistributionRequestType.ADD, contentPath);
    distributionAgent.execute(request);
    LOG.info("Distribution successful for path: {}", contentPath);
} catch (LoginException e) {
    LOG.error("Failed to get resource resolver", e);
} catch (DistributionAgentException e) {
    LOG.error("Distribution failed", e);
}
```

## P6: Update imports

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

**Remove (common):**
```java
import org.apache.felix.scr.annotations.*;
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
- [ ] No Felix SCR annotations remain
- [ ] Uses `DistributionAgent` with `@Reference(target = "(name=agent-name)")`
- [ ] Uses `DistributionRequest` / `SimpleDistributionRequest` with `DistributionRequestType`
- [ ] No `getAdministrativeResourceResolver()` — uses `getServiceResourceResolver()` with SUBSERVICE
- [ ] ResourceResolver in try-with-resources (no manual null-check/finally-close)
- [ ] Auth info uses SUBSERVICE only (no USER/PASSWORD for Cloud Service)
- [ ] SLF4J Logger is present
- [ ] No `System.out`, `System.err`, or `e.printStackTrace()` calls remain
- [ ] `scheduler.concurrent=false` is set (if using scheduler)
- [ ] Code compiles: `mvn clean compile`
