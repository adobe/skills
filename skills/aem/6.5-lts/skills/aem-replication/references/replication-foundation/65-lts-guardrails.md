# AEM 6.5 LTS Replication Guardrails

Best practices, limitations, and operational guidelines for replication in AEM 6.5 LTS.

## Service User Requirements

### Never Use Admin Account

**Prohibited:**
```java
// NEVER DO THIS
authInfo.put(ResourceResolverFactory.USER, "admin");
authInfo.put(ResourceResolverFactory.PASSWORD, "admin");
```

**Required:**
```java
// Use service user
authInfo.put(ResourceResolverFactory.SUBSERVICE, "replication-service");
resolver = resolverFactory.getServiceResourceResolver(authInfo);
```

### Service User Configuration

**OSGi Config:** `org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-replication.cfg.json`

```json
{
  "user.mapping": [
    "com.mycompany.aem.core:replication-service=replication-service"
  ]
}
```

**Required JCR Permissions:**

Service user `replication-service` needs:
- Read: `/content`, `/conf`
- Modify: `/var/replication/outbox` (reverse replication)
- Replicate: `jcr:all` on replicated paths

## URI Patterns

### Valid Transport URIs

**Author to Publish:**
```
http://publish-host:4503/bin/receive?sling:authRequestLogin=1
https://publish-host:4503/bin/receive?sling:authRequestLogin=1
```

**Dispatcher Flush:**
```
http://dispatcher-host:80/dispatcher/invalidate.cache
```

**Reverse Replication:**
```
http://author-host:4502/bin/receive?sling:authRequestLogin=1
```

### Invalid Patterns

Avoid these common mistakes:
- Missing `/bin/receive` path
- Missing `sling:authRequestLogin=1` query parameter
- Using `localhost` instead of actual hostname
- Incorrect port numbers (4502 is Author, 4503 is Publish)

## Log Locations

### AEM 6.5 On-Premise

- **Error Log:** `<aem-install>/crx-quickstart/logs/error.log`
- **Replication Log:** `<aem-install>/crx-quickstart/logs/replication.log`
- **Request Log:** `<aem-install>/crx-quickstart/logs/request.log`

### AEM 6.5 on AMS

- **Cloud Manager:** Download logs via Cloud Manager UI
- **SSH Access:** Requires credentials and permissions
- **Log Streaming:** Not available (manual download only)

### Log Level Configuration

Navigate to: `/system/console/slinglog`

Add logger for:
- **Logger Name:** `com.day.cq.replication`
- **Log Level:** INFO (production), DEBUG (troubleshooting)
- **Log File:** `logs/replication.log`

## Timeout Configuration

### Default Values

- **Connection Timeout:** 10000ms (10 seconds)
- **Socket Timeout:** 10000ms (10 seconds)
- **Retry Delay:** 60000ms (1 minute)

### When to Increase Timeouts

**Large DAM Assets:**
- Connection Timeout: 30000ms (30 seconds)
- Socket Timeout: 60000ms (1 minute)

**Slow Networks (WAN):**
- Connection Timeout: 20000ms (20 seconds)
- Socket Timeout: 30000ms (30 seconds)

**Do Not Exceed:**
- Connection Timeout: 120000ms (2 minutes)
- Socket Timeout: 300000ms (5 minutes)

## Batch Size Limits

### Replication Array Method

```java
replicator.replicate(session, type, paths[], opts);
```

**Recommended Batch Sizes:**
- **Small Pages:** 100-500 paths per call
- **Large Pages/DAM:** 50-100 paths per call
- **Maximum:** 1000 paths (risk of timeout/memory)

**Performance Impact:**
- Batches > 500: Higher memory usage, longer serialization
- Batches > 1000: Risk of OutOfMemoryError

### Asynchronous Replication for Bulk

```java
ReplicationOptions opts = new ReplicationOptions();
opts.setSynchronous(false); // Non-blocking
```

Use asynchronous for:
- Batch sizes > 100 items
- Background content updates
- Scheduled maintenance operations

## Resource Lifecycle

### ResourceResolver Management

**Caller Responsibility:**
```java
public void activatePage(ResourceResolver resolver, String path) {
    // Caller must close resolver
    // Do NOT close inside this method
}
```

**Try-with-Resources Pattern:**
```java
try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(authInfo)) {
    replicator.replicate(session, type, path);
} // Auto-closed
```

**Manual Close:**
```java
ResourceResolver resolver = null;
try {
    resolver = resolverFactory.getServiceResourceResolver(authInfo);
    replicator.replicate(session, type, path);
} finally {
    if (resolver != null && resolver.isLive()) {
        resolver.close();
    }
}
```

## Dangerous Paths

### Never Replicate

**System Paths:**
- `/apps` - Application code (deploy via package manager)
- `/libs` - AEM system libraries
- `/etc/designs` - Design configurations (deploy via package)
- `/var/audit` - Audit logs
- `/etc/replication` - Replication agent configs

**Consequences:**
- Configuration drift between Author/Publish
- Overwriting system defaults
- Security vulnerabilities
- Unpredictable behavior

### Safe Paths

**Content Paths:**
- `/content` - Site content
- `/content/dam` - Digital assets
- `/content/experience-fragments` - Experience fragments
- `/content/forms` - Forms data

## Performance Thresholds

### Queue Depth Monitoring

**Alerting Thresholds:**
- **Warning:** Queue depth > 20 items for > 5 minutes
- **Critical:** Queue depth > 50 items or blocked > 10 minutes

**JMX Monitoring:**
```
com.day.cq.replication:type=Agent,id=<agent-name>
  └─ QueueNumEntries (gauge)
  └─ QueueBlocked (boolean)
```

### Replication Rate

**Expected Rates:**
- **Small Pages:** 50-100 pages/minute
- **Large Pages:** 20-50 pages/minute
- **DAM Assets:** 10-30 assets/minute (size-dependent)

**Degradation Indicators:**
- Rate < 10 pages/minute: Investigate target instance
- Increasing queue depth: Check network/capacity
- Repeated retries: Authentication or connectivity issue

## Version Explosion Prevention

### Problem

Excessive replication creates version history growth:
- Each activation creates a version
- Versions stored in `/var/versions`
- High storage consumption

### Mitigation

**Suppress Versions:**
```java
ReplicationOptions opts = new ReplicationOptions();
opts.setSuppressVersions(true); // No version created
```

**Use For:**
- Bulk content updates
- Automated replication jobs
- Non-critical content changes

**Avoid For:**
- Editorial content (need rollback)
- Legal/compliance content
- Critical business pages

## Security Considerations

### Transport Security

**Use HTTPS For:**
- External-facing publish instances
- Cross-datacenter replication
- Sensitive content replication

**Configuration:**
```
https://publish-host:8443/bin/receive?sling:authRequestLogin=1
```

**Certificate Validation:**
- Import target instance certificate into Author truststore
- Verify certificate chain validity
- Monitor certificate expiration

### Authentication

**Service User:** Preferred method
**Basic Auth:** Acceptable for internal networks
**Token-Based:** Not supported in 6.5 LTS replication

### Input Validation

**Always Validate:**
- Path must start with `/content/`
- Resource type must be replicable (`cq:Page`, `dam:Asset`)
- User has replication permission
- Resource exists

## Version-Specific Considerations

### API Deprecation Tracking

While AEM 6.5 LTS maintains API compatibility throughout the 6.5.x release line, individual point releases may deprecate specific methods or introduce warnings:

**Check Release Notes for Each 6.5.x Version:**
- **Release Notes:** [AEM 6.5 Service Pack Release Notes](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/release-notes/release-notes)
- **Deprecated APIs:** Review JavaDoc `@Deprecated` annotations for alternative methods
- **Breaking Changes:** While rare in LTS, service packs may deprecate experimental APIs introduced in earlier 6.5.x releases

**Recommended Practice:**
1. Before upgrading to a new 6.5.x service pack, review release notes for deprecation notices
2. Check compiler warnings for `@Deprecated` usage after upgrade
3. Test custom replication code against new service pack in lower environments
4. Monitor Adobe Experience League for announcements of API changes

**Known Stable APIs (6.5.0 - 6.5.21+):**
- `Replicator` interface - Core methods stable across all 6.5.x versions
- `ReplicationOptions` - Configuration class stable
- `ReplicationStatus` - Status interface stable
- `AgentManager` - Agent management stable

If your code uses only these documented public APIs from the `com.day.cq.replication` package, it should remain compatible across all AEM 6.5 LTS service packs.

## Migration Considerations

### AEM 6.5 LTS End of Life

- **Extended Support Ends:** 2029
- **Migration Target:** AEM as a Cloud Service
- **API Changes:** Replication API → Sling Distribution API

### Code Future-Proofing

**Avoid:**
- Agent ID filtering (tight coupling to agent names)
- Hardcoded agent paths
- Direct agent configuration manipulation

**Prefer:**
- Agent-agnostic replication options
- Configuration-driven agent selection
- Abstraction layers over direct API calls

This reduces migration effort when moving to Cloud Service.
