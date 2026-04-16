---
name: configure-replication-agent
description: Configure AEM 6.5 LTS replication agents for content publishing, dispatcher cache flushing, and reverse replication
license: Apache-2.0
---

# Configure AEM Replication Agent

This skill guides you through configuring replication agents in Adobe Experience Manager 6.5 LTS. Replication agents are the core mechanism for distributing content from Author to Publish environments, managing Dispatcher cache, and handling user-generated content flows.

## When to Use This Skill

Use this skill when you need to:
- Set up new replication agents for Publish instances
- Configure Dispatcher Flush agents for cache invalidation
- Implement Reverse Replication for user-generated content
- Add replication agents for multiple publish instances
- Troubleshoot or reconfigure existing replication agents
- Implement custom replication workflows

## Prerequisites

- AEM 6.5 Author instance running (typically port 4502)
- AEM 6.5 Publish instance(s) running (typically port 4503+)
- Administrator access to AEM Author environment
- Network connectivity between Author and Publish instances
- Understanding of your deployment topology (single/multiple publish instances)

## Replication Agent Types

AEM supports several replication agent types for different purposes:

| Agent Type | Purpose | Location | Serialization Type |
|------------|---------|----------|-------------------|
| **Default Agent** | Publishes content from Author to Publish | Author | Default |
| **Dispatcher Flush** | Invalidates Dispatcher cache | Publish | Dispatcher Flush |
| **Reverse Replication** | Returns user input from Publish to Author | Author (polling) + Publish (outbox) | Default |
| **Static Agent** | Stores static node representation to filesystem | Author/Publish | Static Content Builder |

## Configuration Workflow

### Step 1: Access Replication Agent Configuration

**Classic UI:**
1. Navigate to `http://localhost:4502/etc/replication/agents.author.html`
2. Or go to Tools → Replication → Agents on author

**Touch UI:**
1. Navigate to Tools → Deployment → Replication
2. Select "Agents on author"

### Step 2: Create or Edit Replication Agent

**For new agent:**
1. Click "New..." or "Create" button
2. Enter a unique name (e.g., `publish_instance_1`, `dispatcher_flush`)
3. Select template based on agent type
4. Click "Create"

**For existing agent:**
1. Select the agent from the list
2. Click "Edit" to open configuration

### Step 3: Configure Settings Tab

Essential settings to configure:

```
Field: Enabled
Value: ✓ (checked)
Purpose: Activates the replication agent

Field: Serialization Type
Values: 
  - Default (standard content replication)
  - Dispatcher Flush (cache invalidation only)
  - Static Content Builder (filesystem storage)
Purpose: Determines how content is packaged

Field: Retry Delay (ms)
Value: 60000 (default)
Purpose: Time between retry attempts on failure

Field: Agent User Id
Value: replication-service (create dedicated user)
Purpose: Service account with minimal required permissions
WARNING: Never use 'admin' account in production

Field: Log Level
Values: Error | Info | Debug
Purpose: Controls logging verbosity for troubleshooting
```

**Security Best Practice:**
Create a dedicated replication service account:
1. Navigate to Security → Users
2. Create new user `replication-service`
3. Grant minimum permissions: read on source paths, replicate privilege
4. Set this user in "Agent User Id" field

### Step 4: Configure Transport Tab

Configure connection details to target instance:

```
Field: URI
Format: http[s]://<hostname>:<port>/bin/receive?sling:authRequestLogin=1
Examples:
  - http://localhost:4503/bin/receive?sling:authRequestLogin=1
  - https://publish1.example.com:4503/bin/receive?sling:authRequestLogin=1

Field: User
Value: admin (or dedicated replication receiver account)
Purpose: Authentication to Publish instance

Field: Password
Value: [secure password]
Purpose: Authentication credentials

Field: OAuth Settings
Value: Leave empty unless using OAuth
Purpose: Alternative authentication mechanism

Field: NTLM Domain/Host/User/Password
Value: Configure if using Windows NTLM authentication
Purpose: Domain-based authentication

Field: SSL
Options:
  - Relaxed SSL: Allow self-signed certificates (development only)
  - Allow expired: Accept expired certificates (not recommended)
Purpose: SSL/TLS configuration
```

**Connection String Examples:**

| Scenario | URI Pattern |
|----------|-------------|
| Local Publish | `http://localhost:4503/bin/receive?sling:authRequestLogin=1` |
| Remote Publish | `https://publish.example.com:4503/bin/receive?sling:authRequestLogin=1` |
| Multiple Instances | Create separate agents for each: port 4503, 4504, 4505, etc. |

### Step 5: Configure Proxy Tab (Optional)

Only configure if network routing requires proxy:

```
Field: Proxy Host
Value: proxy.corporate.com

Field: Proxy Port
Value: 8080

Field: Proxy User/Password
Value: [proxy credentials if required]
```

### Step 6: Configure Extended Tab

Advanced HTTP settings:

```
Field: HTTP Method
Values: GET (default) | POST
Purpose: HTTP verb for replication requests

Field: HTTP Headers
Default headers:
  CQ-Action:{action}
  CQ-Handle:{path}
  CQ-Path:{path}
Purpose: Custom headers for replication requests

Field: Connection Timeout (ms)
Value: 10000 (default)
Purpose: Maximum time to establish connection

Field: Socket Timeout (ms)
Value: 10000 (default)
Purpose: Maximum time waiting for data

Field: Protocol Version
Values: HTTP/1.0 | HTTP/1.1
Default: HTTP/1.0
Purpose: HTTP protocol version
```

### Step 7: Configure Triggers Tab

Control when the agent activates:

```
Option: Ignore default
Effect: Excludes agent from default replication
Use case: Custom workflows only

Option: On Modification
Effect: Auto-activates on page changes
Use case: Automatic publishing workflows

Option: On Distribute
Effect: Triggers on distribution events
Use case: Package replication

Option: On Receive
Effect: Chains replication from incoming events
Use case: Multi-tier replication

Option: No Status Update
Effect: Doesn't update replication status
Use case: Read-only monitoring agents

Option: No Versioning
Effect: Skips version creation
Use case: Performance optimization
```

### Step 8: Test Connection

**Before enabling:**
1. Click "Test Connection" button in Transport tab
2. Verify success message: "Replication test succeeded"
3. Check for any authentication or connectivity errors

**Common test failures:**

| Error | Cause | Solution |
|-------|-------|----------|
| Connection refused | Publish instance not running | Start Publish instance |
| 401 Unauthorized | Invalid credentials | Verify user/password |
| Timeout | Network/firewall issue | Check connectivity, adjust timeouts |
| SSL handshake failed | Certificate issue | Configure SSL settings or update certificates |

### Step 9: Enable and Save

1. Ensure "Enabled" checkbox is checked on Settings tab
2. Click "OK" to save configuration
3. Agent status should show green indicator (idle/ready state)

## Agent-Specific Configuration

### Default Replication Agent (Author to Publish)

**Purpose:** Publishes content from Author to Publish environment

**Configuration specifics:**
- Serialization Type: **Default**
- Transport URI: `http://publish-host:4503/bin/receive?sling:authRequestLogin=1`
- Location: Author instance (`/etc/replication/agents.author`)
- Triggers: Enable "On Modification" for automatic publishing
- User: Dedicated replication-service account with read permissions

**Multiple Publish Instances:**
Create one agent per Publish instance:
- Agent 1: `publish_instance_1` → `http://publish1:4503/bin/receive`
- Agent 2: `publish_instance_2` → `http://publish2:4504/bin/receive`
- Agent 3: `publish_instance_3` → `http://publish3:4505/bin/receive`

### Dispatcher Flush Agent

**Purpose:** Invalidates Dispatcher cache when content is published

**Configuration specifics:**
- Serialization Type: **Dispatcher Flush**
- Transport URI: `http://dispatcher-host:80/dispatcher/invalidate.cache`
- Location: Publish instance (`/etc/replication/agents.publish`)
- HTTP Method: GET or POST (depending on Dispatcher config)
- User: May not require authentication depending on network setup

**Important settings:**
```
Settings Tab:
  - Serialization Type: Dispatcher Flush
  - Enabled: ✓

Transport Tab:
  - URI: http://dispatcher:80/dispatcher/invalidate.cache
  - (Authentication may not be required)

Extended Tab:
  - HTTP Headers: Add custom headers if Dispatcher requires them
```

**Dispatcher configuration requirements:**
Ensure Dispatcher `dispatcher.any` has:
```
/allowedClients {
  /0 { /type "allow" /glob "*publish-instance-ip*" }
}
```

### Reverse Replication Agent

**Purpose:** Collects user-generated content from Publish and sends to Author

**Requires TWO components:**

**1. Outbox Agent on Publish** (passive collection point)
- Location: `/etc/replication/agents.publish/outbox`
- Serialization Type: Default
- Enabled: ✓
- No transport configuration needed (local collection only)

**2. Reverse Replication Agent on Author** (active polling)
- Location: `/etc/replication/agents.author/reverse_replication`
- Serialization Type: Default
- Transport URI: `http://publish-host:4503/bin/receive?sling:authRequestLogin=1`
- Triggers: Enable polling triggers
- The Author agent periodically polls the Publish outbox

**Configuration steps:**

1. **On Publish instance:**
   - Navigate to `/etc/replication/agents.publish`
   - Verify "Outbox" agent exists and is enabled
   - No additional configuration needed

2. **On Author instance:**
   - Create new replication agent named "reverse_replication"
   - Settings Tab: Serialization Type = Default, Enabled = ✓
   - Transport Tab: URI = `http://publish:4503/bin/receive`
   - Save configuration

**Content requirements for reverse replication:**
Only `cq:Page` nodes are supported out-of-the-box. For other node types, custom implementation required.

To trigger reverse replication, add properties:
- `cq:distribute` (Boolean) = true
- `cq:lastModified` (Date)
- `cq:lastModifiedBy` (String)

## Monitoring Replication Agents

### Agent Status Indicators

| Status | Indicator | Meaning | Action |
|--------|-----------|---------|--------|
| Idle | Green | Queue empty, ready | Normal operation |
| Active | Green | Processing queue | Normal operation |
| Blocked | Red | Queue blocked by failed item | Investigate failure, clear queue |
| Disabled | Gray | Agent not enabled | Enable if needed |

### Access Agent Queue

1. Click agent name in agents list
2. View queue status and pending items
3. Options available:
   - **Refresh**: Update queue display
   - **Clear**: Remove all queued items
   - **Force Retry**: Retry first item in queue
   - **View Log**: Check replication logs

### Monitor via JMX Console

Navigate to JMX Console: `http://localhost:4502/system/console/jmx`

Search for: `com.day.cq.replication:type=Agent`

Monitor:
- Queue size
- Replication status
- Error counts
- Last replication timestamp

## Validation and Testing

### Test Replication Flow

1. **Create test page** on Author:
   - Navigate to Sites console
   - Create new page under `/content/test`
   - Add some content

2. **Activate the page:**
   - Select page
   - Click "Quick Publish" or "Manage Publication"
   - Verify success message

3. **Check replication status:**
   - Page properties should show "Published" status
   - Green checkmark indicator

4. **Verify on Publish:**
   - Navigate to `http://publish:4503/content/test/page-name.html`
   - Content should be visible
   - Check timestamp matches activation time

5. **Check agent queue:**
   - Open replication agent
   - Queue should be empty after successful replication
   - Log should show success entries

### Dispatcher Cache Validation

1. **After content activation:**
   - Check Dispatcher cache directory
   - Verify cached files are invalidated/updated
   - Check Dispatcher logs for invalidation requests

2. **Test cache flush:**
   - Activate a page
   - Verify Dispatcher Flush agent processes request
   - Check Dispatcher cache is properly invalidated

## Troubleshooting

### Common Issues and Solutions

**Issue: Replication queue blocked**
- **Symptom:** Red indicator, items stuck in queue
- **Diagnosis:** First item in queue failed, blocking subsequent items
- **Solution:**
  1. Click agent to view queue
  2. Check error message on failed item
  3. Fix underlying issue (connectivity, permissions, target instance down)
  4. Click "Force Retry" or "Clear" failed item
  5. Verify remaining items process

**Issue: Connection refused**
- **Symptom:** "Connection refused" in agent test or logs
- **Diagnosis:** Publish instance not reachable
- **Solution:**
  1. Verify Publish instance is running: `http://publish:4503/system/console`
  2. Check network connectivity: `telnet publish-host 4503`
  3. Verify firewall rules allow connection
  4. Check URI in Transport tab is correct

**Issue: 401 Unauthorized**
- **Symptom:** Authentication failures in replication
- **Diagnosis:** Invalid credentials or insufficient permissions
- **Solution:**
  1. Verify user exists on target instance
  2. Check password is correct
  3. Verify user has replication permissions
  4. Test credentials manually: `curl -u user:password http://publish:4503/bin/receive`

**Issue: SSL handshake failure**
- **Symptom:** SSL/TLS errors in logs
- **Diagnosis:** Certificate issues or SSL misconfiguration
- **Solution:**
  1. For development: Enable "Relaxed SSL" option
  2. For production: Install proper certificates in Java keystore
  3. Verify certificate chain is complete
  4. Check SSL protocol compatibility

**Issue: Dispatcher not flushing cache**
- **Symptom:** Old content served after activation
- **Diagnosis:** Dispatcher Flush agent not working
- **Solution:**
  1. Verify Dispatcher Flush agent enabled on Publish
  2. Check agent Transport URI matches Dispatcher endpoint
  3. Verify Dispatcher `/allowedClients` configuration
  4. Check Dispatcher logs for invalidation requests
  5. Manually test: `curl -X POST http://dispatcher/dispatcher/invalidate.cache`

**Issue: User data not synchronizing**
- **Symptom:** User accounts not replicating to Publish
- **Diagnosis:** Attempting to replicate user data via standard replication
- **Solution:**
  - User data is NOT replicated by default agents
  - Configure User Synchronization separately
  - Navigate to: Configuration → User Synchronization
  - Follow Adobe documentation for user sync setup

## Security Best Practices

1. **Never use admin account for replication**
   - Create dedicated `replication-service` user
   - Grant minimum required permissions
   - Limit access to specific content paths

2. **Use HTTPS for production**
   - Configure SSL certificates
   - Enable secure transport
   - Avoid "Relaxed SSL" in production

3. **Implement Mutual SSL (MSSL) for enhanced security**
   - Certificate-based authentication
   - Bidirectional trust verification
   - Follow Adobe MSSL configuration guide

4. **Restrict agent configuration access**
   - Limit permissions on `/etc/replication` node
   - Only administrators should configure agents
   - Audit configuration changes

5. **Monitor and log replication activity**
   - Enable appropriate log levels
   - Review logs regularly for failures
   - Set up alerts for blocked queues

6. **Network security**
   - Use firewalls to restrict replication traffic
   - Implement VPN for cross-datacenter replication
   - Whitelist IP addresses

## Related Skills

- `replicate-content`: Activate and deactivate content using configured agents
- `troubleshoot-replication`: Diagnose and fix replication issues
- For AEM as a Cloud Service, see content distribution documentation (different architecture)

## Success Criteria

- ✓ Replication agent created and enabled
- ✓ Test connection succeeds
- ✓ Agent status shows green (idle/ready)
- ✓ Test page successfully replicates to Publish
- ✓ Content appears on Publish instance
- ✓ Agent queue processes items without blocking
- ✓ Logs show successful replication entries
- ✓ Dedicated service account configured (not admin)
- ✓ For Dispatcher Flush: cache invalidates on activation
- ✓ For Reverse Replication: both Outbox and polling agents configured

## Additional Resources

- [Official AEM 6.5 LTS Replication Documentation](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/configuring/replication)
- [AEM 6.5 LTS Replication Troubleshooting Guide](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/configuring/troubleshoot-rep)
- [Replication API JavaDoc (Package Summary)](https://developer.adobe.com/experience-manager/reference-materials/6-5-lts/javadoc/com/day/cq/replication/package-summary.html)
- [AEM 6.5 LTS Documentation Hub](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts)
- [AEM Replication Cookbook (Community)](https://aemlounge.wordpress.com/2018/03/19/a-cookbook-for-replication-in-aem/)
- AEM 6.5 Operations Dashboard for monitoring
- Dispatcher documentation for cache invalidation configuration
