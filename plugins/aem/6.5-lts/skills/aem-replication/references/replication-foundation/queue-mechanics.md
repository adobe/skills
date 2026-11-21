# Replication Queue Mechanics

Reference guide for AEM 6.5 LTS replication queue behavior and management.

## Queue Architecture

### FIFO Processing

Replication queues use **First-In-First-Out (FIFO)** ordering:
- Replication requests processed in submission order
- No priority-based reordering
- Blocking items prevent queue progress

### Queue States

**Active Queue:**
- Items currently being processed or waiting
- Visible in Agent UI: `/etc/replication/agents.author/<agent-name>.html`
- JMX Bean: `com.day.cq.replication:type=Agent,id=<agent-name>`

**Blocked Queue:**
- Queue processing stopped due to:
  - Network connectivity failure
  - Target instance unavailable
  - Authentication failure
  - Serialization error
- Requires manual intervention or automatic retry

## Queue Item Lifecycle

```
Submit → Queue → Serialize → Transport → Acknowledge → Remove
           ↓                      ↓
       (pending)              (blocked?)
                                  ↓
                              Retry Logic
```

### States

1. **Pending:** Waiting in queue for processing
2. **Active:** Currently being serialized and transported
3. **Blocked:** Failed, awaiting retry
4. **Completed:** Successfully replicated and removed from queue

## Retry Logic

### Automatic Retry

- **Retry Delay:** Configured per agent (default: 60000ms = 1 minute)
- **Maximum Retries:** Infinite until manually cleared
- **Exponential Backoff:** Not implemented - fixed retry delay

### Retry Triggers

Replication retries on:
- Network timeout
- HTTP 5xx server errors
- Connection refused

Does NOT retry on:
- HTTP 4xx client errors (permanent failure)
- Invalid credentials (401/403)
- Missing resources (404)

## Queue Management

### Via UI

Navigate to: `/etc/replication/agents.author/<agent-name>.html`

Actions:
- **View Queue:** See pending items
- **Retry All:** Re-attempt all blocked items
- **Clear Queue:** Remove all items (destructive)
- **Refresh:** Update queue display

### Via JMX Console

Navigate to: `http://localhost:4502/system/console/jmx`

MBean: `com.day.cq.replication:type=Agent,id=<agent-name>`

Metrics:
- `QueueNumEntries` - Current queue depth
- `QueueBlocked` - Boolean blocked status
- `QueueProcessingSince` - Timestamp of current item

Operations:
- `retryFirst()` - Retry first blocked item
- `clear()` - Empty queue (destructive)

**JMX Security Considerations:**

Access to JMX operations requires appropriate permissions:

- **Authentication:** JMX console requires administrator credentials (`http://localhost:4502/system/console/jmx`)
- **Authorization:** Only users in the `administrators` group can invoke JMX operations by default
- **Audit Logging:** JMX operations are not logged in `replication.log` - enable JMX audit logging for compliance environments
- **Production Access:** Restrict JMX console access in production:
  - Use firewall rules to block external access to JMX ports
  - Require VPN or SSH tunnel for remote JMX access
  - Consider read-only JMX access for monitoring users (metrics only, no operations)
- **Destructive Operations:** `clear()` permanently removes queued replication items - use with caution and only after verifying queue state

**Recommended Production Setup:**
- Monitoring tools (New Relic, Datadog): Read-only JMX access for metrics
- Operations team: Full JMX access via secure channel (VPN/SSH)
- Automated scripts: Use HTTP-based Sling APIs instead of JMX where possible

## Performance Considerations

### Queue Depth Thresholds

- **Normal:** 0-10 items
- **Elevated:** 10-50 items (investigate slowness)
- **Critical:** 50+ items (likely blocked or overloaded)

### Queue Saturation

High queue depth causes:
- Delayed content publication
- Increased memory usage (serialized content cached)
- Potential replication event backlog

**Mitigation:**
- Monitor queue metrics via JMX
- Use asynchronous replication for bulk operations
- Increase target instance capacity
- Split workload across multiple agents

## Blocking Behavior

### FIFO Blocking

If item N blocks:
- Items N+1, N+2, ... cannot process
- Entire queue waits for item N to succeed or be cleared
- No automatic skip of blocked items

**Resolution:**
1. Fix root cause (network, credentials, target instance)
2. Retry blocked item
3. Or clear blocked item manually

### Preventing Blocks

- Test agent connectivity before activation
- Monitor agent health via JMX
- Use HTTP connection pooling
- Configure appropriate timeouts
- Validate target instance availability

## Common Queue Issues

### Queue Never Empties

**Symptom:** Queue depth stays constant or grows

**Causes:**
- Agent disabled
- Target instance down
- Network partition
- Authentication failure

**Diagnosis:**
1. Check agent enabled status
2. Test target URI with curl
3. Review agent error.log
4. Check JMX QueueBlocked status

### Queue Processes Slowly

**Symptom:** Queue depth gradually increases

**Causes:**
- Target instance CPU/memory constrained
- Network latency
- Large asset replication
- Inefficient serialization

**Diagnosis:**
1. Monitor target instance resource usage
2. Check network latency (ping, traceroute)
3. Review replication.log for timing
4. Consider asynchronous replication

## Queue Listener Patterns

`ReplicationListener` callbacks fire **only for synchronous replication** when attached via `ReplicationOptions.setListener()`; registering it as an OSGi service does not subscribe it to queue events.

```java
import com.day.cq.replication.Agent;
import com.day.cq.replication.ReplicationAction;
import com.day.cq.replication.ReplicationListener;
import com.day.cq.replication.ReplicationLog;
import com.day.cq.replication.ReplicationQueue;
import com.day.cq.replication.ReplicationResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class QueueMonitorListener implements ReplicationListener {
    
    private static final Logger LOG = LoggerFactory.getLogger(QueueMonitorListener.class);
    private static final int ALERT_THRESHOLD = 20;
    
    @Override
    public void onStart(Agent agent, ReplicationAction action) {
        // Check queue depth at replication start
        ReplicationQueue queue = agent.getQueue();
        if (queue == null) return;
        int queueSize = queue.entries().size();
        
        if (queueSize > ALERT_THRESHOLD) {
            LOG.warn("Queue depth elevated for agent {}: {} items", 
                agent.getId(), queueSize);
            // Send alert to monitoring system
            alertHighQueueDepth(agent.getId(), queueSize);
        }

    }

    @Override
    public void onMessage(ReplicationLog.Level level, String message) {
        LOG.debug("Replication message ({}): {}", level, message);
    }
    
    @Override
    public void onEnd(Agent agent, ReplicationAction action, ReplicationResult result) {
        if (result.isSuccess()) {
            LOG.debug("Replication completed for path: {}", action.getPath());
        } else {
            LOG.error("Replication failed for path: {}, Queue may be blocked", 
                action.getPath());
            checkQueueBlocked(agent);
        }
    }
    
    @Override
    public void onError(Agent agent, ReplicationAction action, Exception exception) {
        LOG.error("Replication error for path: {}", action.getPath(), exception);
        
        checkQueueBlocked(agent);
    }
    
    private void checkQueueBlocked(Agent agent) {
        ReplicationQueue queue = agent.getQueue();
        if (queue == null) return;
        ReplicationQueue.Status status = queue.getStatus();
        if (!queue.isPaused() && status.getNextRetryTime() > 0) {
            LOG.error("Queue blocked for agent: {}; next retry at {}", agent.getId(), status.getNextRetryTime());
            alertQueueBlocked(agent.getId());
        }
    }
    
    private void alertHighQueueDepth(String agentId, int queueSize) {
        // Integration with monitoring system (e.g., Datadog, New Relic, PagerDuty)
    }
    
    private void alertQueueBlocked(String agentId) {
        // Send critical alert - queue is blocked and requires intervention
    }
}
```

Attach it per call: `options.setSynchronous(true); options.setListener(new QueueMonitorListener());`

For asynchronous replication, poll `Agent.getQueue()` (`entries()`, `getStatus()`, `isPaused()`) or use the Replication UI.

## Best Practices

1. **Monitor Queue Depth:** Alert on sustained depth > 20 items
2. **Regular Health Checks:** Test agent connectivity daily
3. **Async for Bulk:** Use asynchronous replication for large batches
4. **Clear Stale Items:** Remove failed items that won't retry successfully
5. **Size Appropriately:** One agent per publish instance, no sharing
6. **Log Monitoring:** Watch for repeated retry patterns indicating systemic issues
7. **Listener Scope:** Attach ReplicationListener only to synchronous calls; use queue snapshots for broader monitoring
