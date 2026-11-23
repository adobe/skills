# Replication Agent Types

Reference guide for AEM 6.5 LTS replication agent types and their purposes.

## Default Replication Agent (Author to Publish)

**Purpose:** Distributes activated content from Author to Publish instances.

**Key Characteristics:**
- Transport Type: HTTP/HTTPS
- Default URI Pattern: `http://publish-host:4503/bin/receive?sling:authRequestLogin=1`
- Serialization Type: Dispatcher Flush
- Direction: Author → Publish

**When to Use:**
- Standard content publishing workflow
- Initial environment setup
- Multiple publish instances (one agent per instance)

## Dispatcher Flush Agent

**Purpose:** Invalidates cached content on Dispatcher after activation.

**Key Characteristics:**
- Transport Type: HTTP/HTTPS
- Default URI Pattern: `http://dispatcher-host:80/dispatcher/invalidate.cache`
- Serialization Type: Dispatcher Flush
- Direction: Publish → Dispatcher

**When to Use:**
- Every publish instance requires a flush agent
- Cache invalidation after content changes
- Coordinated with Author default agents

**Dispatcher Configuration Required:**
```apache
/allowedClients {
    /0 { /type "allow" /glob "*" }
}
```

## Reverse Replication Agent

**Purpose:** Transfers user-generated content from Publish to Author.

**Key Characteristics:**
- Transport Type: HTTP/HTTPS
- Reverse Direction: Publish → Author
- Outbox Path: `/var/replication/outbox`
- Direction: Publish → Author

**When to Use:**
- Form submissions
- User-generated content
- Community features
- Social collaboration

## Static Agent

**Purpose:** Exports content to filesystem for static delivery.

**Key Characteristics:**
- Transport Type: Filesystem
- Export Path: Local filesystem directory
- No network transport required

**When to Use:**
- Static site generation
- Content export for external systems
- Filesystem-based CDN integration

## Agent Configuration Common Fields

All agent types share these configuration fields:

- **Name:** Unique identifier for the agent
- **Enabled:** Boolean flag to activate/deactivate
- **Serialization Type:** Content format (Default, Dispatcher Flush, Static)
- **Retry Delay:** Milliseconds between retry attempts (default: 60000)
- **User ID:** Authentication user for target endpoint
- **Log Level:** Error, Info, Debug

## Agent Ordering and Execution

### Multiple Agents Processing Content

When multiple agents are configured and enabled, replication behavior depends on agent filtering:

**Without AgentFilter (default):**
- All enabled agents receive replication requests
- Agents process in **parallel** (not sequential)
- Replication completes when **all** agents finish successfully
- If **any** agent fails, the entire replication operation fails

**With AgentFilter:**
- Only agents matching the filter receive requests
- Filtered agents process in parallel
- Completion/failure logic same as above

### Ordering Implications

**Agent Creation Order Does NOT Affect Processing:**
- Agents are not processed in creation order
- No guaranteed sequence between agents
- Each agent processes independently

**Practical Impact:**
1. **Default Agents + Flush Agents:** Both process simultaneously when content activates
2. **Multiple Publish Agents:** All publish instances receive content in parallel (good for performance)
3. **Failure Propagation:** If publish1 succeeds but publish2 fails, the operation is marked as failed even though content reached publish1

**When Order Matters:**
Use `AgentFilter` to control which agents process specific requests:

```java
// Example: Only activate to specific publish instance
ReplicationOptions opts = new ReplicationOptions();
opts.setFilter(agent -> agent.getId().equals("publish_prod_1"));

replicator.replicate(session, ReplicationActionType.ACTIVATE, path, opts);
```

**Best Practice for High Availability:**
- Configure one agent per publish instance
- Let all agents process in parallel (maximize throughput)
- Monitor individual agent queues for failures
- Don't rely on agent ordering for correctness

## Programmatic Agent Access

When accessing agents programmatically via the AgentManager API, always validate agent availability:

```java
import com.day.cq.replication.Agent;
import com.day.cq.replication.AgentManager;
import org.osgi.service.component.annotations.Reference;

@Reference
private AgentManager agentManager;

public void checkAgentStatus(String agentId) {
    // Get agent with null check
    Agent agent = agentManager.getAgent(agentId);
    
    if (agent == null) {
        LOG.warn("Agent not found: {}", agentId);
        return;
    }
    
    // Validate agent configuration
    if (!agent.isEnabled()) {
        LOG.info("Agent {} is disabled", agentId);
        return;
    }
    
    // Check transport URI is configured
    String transportURI = agent.getConfiguration().getTransportURI();
    if (transportURI == null || transportURI.trim().isEmpty()) {
        LOG.error("Agent {} has no transport URI configured", agentId);
        return;
    }
    
    // Safe to use agent
    LOG.info("Agent {} is enabled with URI: {}", agentId, transportURI);
}
```

**Key null safety checks:**
- Verify agent exists before accessing properties (`agent == null`)
- Check configuration fields before use (`transportURI == null`)
- Validate enabled status before operations
- Handle missing or malformed configuration gracefully

## Best Practices

1. **One Agent Per Target:** Create separate agents for each publish instance
2. **Service Users:** Use dedicated service accounts, never admin
3. **Monitoring:** Enable logging at Info level for production agents
4. **Naming Convention:** Use descriptive names like `publish_prod_1`, `flush_dispatcher_az1`
5. **Security:** Use HTTPS transport for external-facing endpoints
6. **Null Safety:** Always check agent existence and configuration validity when accessing programmatically
