---
name: troubleshoot-replication
description: Diagnose and fix common AEM 6.5 LTS replication issues including blocked queues, connectivity failures, and content distribution problems
license: Apache-2.0
---

# Troubleshoot AEM 6.5 LTS Replication

This skill provides systematic troubleshooting guidance for Adobe Experience Manager 6.5 LTS replication issues. Use this to diagnose and resolve problems with content distribution, agent configuration, and replication workflows.

## When to Use This Skill

Use this skill when experiencing:
- Replication queues blocked or stuck
- Content not appearing on Publish instances
- Replication agent showing red/error status
- "Replication triggered, but no agent found" errors
- Timeout errors during replication
- Authentication failures (401 Unauthorized)
- Connection refused errors
- Slow or delayed replication
- Dispatcher cache not invalidating
- Reverse replication failures
- Missing or incorrect replication status

## Prerequisites

- AEM 6.5 LTS Author and Publish instances
- Administrator access to AEM environments
- Access to replication agent configuration
- Access to log files (error.log, replication.log)
- Understanding of your replication topology

## Diagnostic Workflow

Follow this systematic approach to identify and resolve replication issues:

```
1. Verify Symptoms
   ↓
2. Check Agent Status
   ↓
3. Review Replication Queue
   ↓
4. Test Connectivity
   ↓
5. Examine Logs
   ↓
6. Verify Configuration
   ↓
7. Apply Fix
   ↓
8. Validate Resolution
```

## Common Issues and Solutions

### Issue 1: Replication Queue Blocked

**Symptoms:**
- Red status indicator on replication agent
- Queue shows items waiting
- First item in queue failed
- Subsequent items cannot process (FIFO blocking)

**Diagnosis:**

1. **Check agent status:**
   ```
   Navigate to: Tools → Deployment → Replication → Agents on author
   Look for: Red indicator next to agent name
   ```

2. **View queue details:**
   ```
   Click agent name
   Review queue entries
   Check error message on failed item
   ```

**Root Causes:**
- Network connectivity lost to Publish instance
- Publish instance down or unavailable
- Authentication credentials expired or incorrect
- Insufficient permissions on target content
- Disk space full on Publish
- Large package timeout
- SSL/TLS certificate issues

**Solutions:**

**Solution A: Retry Failed Item**
```
Steps:
1. Open blocked replication agent
2. Click "Force Retry" button
3. Monitor queue to see if item processes
4. If successful, remaining items will process automatically
```

**Solution B: Clear Failed Item**
```
Steps:
1. Open blocked replication agent
2. Select failed item in queue
3. Click "Clear" to remove it
4. Remaining items will process
5. Manually re-replicate cleared content if needed
```

**Solution C: Restart Replication Components**
```
Navigate to: /system/console/bundles
Search for: "replication"

Restart these bundles:
- com.day.cq.cq-replication
- com.day.cq.cq-replication-audit
- com.day.cq.wcm.cq-wcm-replication

Steps:
1. Find bundle
2. Click "Stop"
3. Wait for status: Resolved
4. Click "Start"
5. Verify status: Active
```

**Solution D: Restart Event Processing**
```
OSGi Console: /system/console/bundles
Restart: Apache Sling Event Support (org.apache.sling.event)

This clears event queue backlogs
```

### Issue 2: Connection Refused

**Symptoms:**
- Error: "Connection refused"
- Test connection fails
- Replication queue blocked with connectivity errors

**Diagnosis:**

1. **Verify Publish instance is running:**
   ```bash
   # Check if Publish is accessible
   curl -I http://publish-host:4503/system/console
   
   # Or browse to:
   http://publish-host:4503/system/console
   ```

2. **Test network connectivity:**
   ```bash
   # From Author server
   telnet publish-host 4503
   
   # Or
   nc -zv publish-host 4503
   
   # Or
   ping publish-host
   ```

3. **Check replication agent URI:**
   ```
   Navigate to: Agent → Edit → Transport tab
   Verify: URI matches Publish host and port
   Expected: http://publish-host:4503/bin/receive?sling:authRequestLogin=1
   ```

**Root Causes:**
- Publish instance not running
- Firewall blocking connection
- Incorrect hostname or port in agent configuration
- Network routing issues
- DNS resolution failures

**Solutions:**

**Solution A: Start Publish Instance**
```bash
cd /path/to/publish/crx-quickstart
./bin/start
```

**Solution B: Fix Network/Firewall**
```
1. Verify firewall rules allow Author → Publish on port 4503
2. Check network ACLs and security groups (cloud environments)
3. Verify no proxy blocking connection
4. Test from Author server command line
```

**Solution C: Correct Agent URI**
```
Steps:
1. Edit replication agent
2. Transport tab
3. Update URI to correct host/port:
   http://correct-publish-host:4503/bin/receive?sling:authRequestLogin=1
4. Save
5. Test Connection
```

### Issue 3: 401 Unauthorized

**Symptoms:**
- Error: "401 Unauthorized"
- Authentication failures in logs
- Test connection fails with credential error

**Diagnosis:**

1. **Check agent credentials:**
   ```
   Agent → Edit → Transport tab
   Verify: User and Password fields
   ```

2. **Verify user exists on Publish:**
   ```
   Publish instance: http://publish:4503/crx/explorer
   Navigate to: /home/users
   Search for: replication service user
   ```

3. **Check user permissions:**
   ```
   On Publish instance:
   User → Permissions
   Required: Read, Write, Replicate privileges
   ```

**Root Causes:**
- Incorrect username or password
- User doesn't exist on target instance
- User password changed
- User disabled or locked
- Insufficient permissions

**Solutions:**

**Solution A: Update Credentials**
```
Steps:
1. Edit replication agent
2. Transport tab
3. Enter correct username
4. Enter correct password
5. Save
6. Test Connection
```

**Solution B: Create/Enable User on Publish**
```
On Publish instance:
1. Navigate to: Security → Users
2. Create user: replication-service
3. Set password (match Agent configuration)
4. Save

Grant permissions:
1. Navigate to: Security → Permissions
2. Select user: replication-service
3. Add entries:
   - Path: /content
   - Privileges: jcr:read, crx:replicate, jcr:write
4. Save
```

**Solution C: Reset Password**
```
On Publish instance:
1. Navigate to: Security → Users
2. Find user in agent configuration
3. Click "Set Password"
4. Enter new password
5. Save

On Author:
1. Update replication agent with new password
2. Save
3. Test Connection
```

### Issue 4: SSL/TLS Certificate Errors

**Symptoms:**
- SSL handshake failed
- Certificate validation errors
- HTTPS connection failures

**Diagnosis:**

1. **Check agent URI protocol:**
   ```
   Agent → Transport tab
   URI: https://... or http://...
   ```

2. **Review error logs:**
   ```
   error.log contains:
   - javax.net.ssl.SSLHandshakeException
   - PKIX path building failed
   - Certificate validation failed
   ```

**Solutions:**

**Solution A: Enable Relaxed SSL (Development Only)**
```
WARNING: Only for development/testing environments

Steps:
1. Edit replication agent
2. Transport tab
3. SSL section:
   ✓ Relaxed SSL (allow self-signed certificates)
   ✓ Allow expired (allow expired certificates)
4. Save
5. Test Connection
```

**Solution B: Import Certificates (Production)**
```
On Author instance:

1. Export certificate from Publish:
   openssl s_client -connect publish:4503 -showcerts > publish-cert.pem

2. Import into Java keystore:
   cd $JAVA_HOME/jre/lib/security
   keytool -import -alias publish-aem -file publish-cert.pem \
     -keystore cacerts -storepass changeit

3. Restart AEM Author

4. Test replication agent connection
```

**Solution C: Use HTTP (Not Recommended for Production)**
```
If SSL is not required:
1. Edit agent
2. Transport tab
3. Change URI from https:// to http://
4. Save
5. Test Connection
```

### Issue 5: Content Not Appearing on Publish

**Symptoms:**
- Replication succeeds (green status)
- Queue processes successfully
- Content still doesn't appear on Publish
- Old content served

**Diagnosis:**

1. **Check content directly on Publish:**
   ```
   Bypass Dispatcher:
   http://publish:4503/content/mysite/en/page.html
   
   If content appears here but not via Dispatcher:
   → Dispatcher cache issue
   
   If content doesn't appear:
   → Replication issue
   ```

2. **Verify replication status:**
   ```
   On Author:
   Page → Properties → Basic tab
   Check: Last Published timestamp
   Verify: Status shows "Published"
   ```

3. **Check Publish logs:**
   ```
   Publish instance: crx-quickstart/logs/error.log
   Search for: path of page
   Look for: Errors during content import
   ```

**Root Causes:**
- Dispatcher cache not invalidated
- Dispatcher Flush agent disabled
- Content permissions on Publish
- Sling mapping issues
- Incorrect Publish run mode configuration

**Solutions:**

**Solution A: Manual Dispatcher Cache Clear**
```bash
# On Dispatcher server
cd /path/to/dispatcher/cache
rm -rf *

# Or specific path
rm -rf /path/to/dispatcher/cache/content/mysite/en/*

# Check Dispatcher logs
tail -f /path/to/dispatcher/logs/dispatcher.log
```

**Solution B: Verify Dispatcher Flush Agent**
```
On Publish instance:
1. Navigate to: Tools → Deployment → Replication
2. Select: Agents on publish
3. Click: Dispatcher Flush
4. Verify: Enabled = ✓
5. Transport tab:
   URI: http://dispatcher:80/dispatcher/invalidate.cache
6. Test Connection
7. If failed, fix connectivity
```

**Solution C: Check Content Permissions on Publish**
```
On Publish instance:
1. Navigate to: CRXDE Lite
2. Browse to: /content/mysite/en/page
3. Check node exists
4. Verify permissions: anonymous user can read
5. If not, adjust permissions
```

**Solution D: Force Republish**
```
On Author:
1. Select page(s)
2. Manage Publication
3. Action: Unpublish
4. Execute
5. Wait for completion
6. Manage Publication
7. Action: Publish
8. Execute
9. Verify on Publish
```

### Issue 6: Dispatcher Cache Not Invalidating

**Symptoms:**
- Content published successfully
- Old content served via Dispatcher
- Direct Publish access shows new content
- Dispatcher cache files not deleted

**Diagnosis:**

1. **Check Dispatcher Flush agent:**
   ```
   Publish instance: /etc/replication/agents.publish/flush
   Status: Should be green (idle/active)
   ```

2. **Review Dispatcher configuration:**
   ```
   dispatcher.any file:
   /allowedClients {
     /0 { /type "allow" /glob "*publish-ip*" }
   }
   
   /invalidate {
     /0000 { /glob "*" /type "allow" }
   }
   ```

3. **Check Dispatcher logs:**
   ```
   tail -f /var/log/httpd/dispatcher.log
   
   Look for invalidation requests:
   [date] [I] [pid] Received invalidate request
   ```

**Solutions:**

**Solution A: Enable Dispatcher Flush Agent**
```
On Publish instance:
1. Navigate to: /etc/replication/agents.publish/flush
2. Edit agent
3. Settings tab: ✓ Enabled
4. Serialization Type: Dispatcher Flush
5. Save
```

**Solution B: Fix Dispatcher Configuration**
```
Edit dispatcher.any:

/allowedClients {
  /0 { 
    /type "allow" 
    /glob "*<publish-instance-ip>*" 
  }
}

/cache {
  /invalidate {
    /0000 { /glob "*" /type "allow" }
  }
}

Reload Dispatcher:
apachectl graceful
```

**Solution C: Verify Flush Agent Transport**
```
Dispatcher Flush agent → Transport tab

Correct URI format:
http://dispatcher-host:80/dispatcher/invalidate.cache

OR if virtual host:
http://www.example.com/dispatcher/invalidate.cache

Test Connection
```

### Issue 7: Timeout Errors

**Symptoms:**
- Replication timeout errors
- Large packages fail
- Synchronous replication hangs

**Diagnosis:**

1. **Check agent timeouts:**
   ```
   Agent → Edit → Extended tab
   Connection Timeout: default 10000ms
   Socket Timeout: default 10000ms
   ```

2. **Review package size:**
   ```
   Large packages (>100MB) may timeout
   Check: crx-quickstart/logs/replication.log
   ```

**Solutions:**

**Solution A: Increase Timeouts**
```
Agent → Edit → Extended tab

Connection Timeout: 30000 (30 seconds)
Socket Timeout: 60000 (60 seconds)

For very large packages: 120000 (2 minutes)
```

**Solution B: Use Asynchronous Replication**
```
For large content:
1. Use default async replication (not synchronous)
2. Monitor queue instead of waiting
3. Package-based replication for very large sets
```

**Solution C: Split Large Packages**
```
Instead of tree activation:
1. Activate in smaller batches
2. Use incremental replication
3. Schedule large activations during off-peak hours
```

### Issue 8: Replication Triggered But No Agent Found

**Symptoms:**
- Error: "Replication triggered, but no agent found"
- Content doesn't replicate
- Logs show agent selection failure

**Diagnosis:**

1. **Check enabled agents:**
   ```
   Navigate to: /etc/replication/agents.author
   Verify: At least one agent is enabled
   Check: Green status indicator
   ```

2. **Review agent triggers:**
   ```
   Agent → Edit → Triggers tab
   Check: "Ignore default" is NOT checked
   Verify: Appropriate triggers enabled
   ```

**Root Causes:**
- All replication agents disabled
- All agents have "Ignore default" checked
- Agent filter excludes all agents
- Custom replication action with invalid agent ID

**Solutions:**

**Solution A: Enable Default Agent**
```
Steps:
1. Navigate to: /etc/replication/agents.author/publish
2. Edit agent
3. Settings tab: ✓ Enabled
4. Triggers tab: Uncheck "Ignore default"
5. Save
```

**Solution B: Check Agent Filters (Programmatic)**
```java
// If using ReplicationOptions in code
ReplicationOptions opts = new ReplicationOptions();

// Ensure filter doesn't exclude all agents
opts.setFilter(new AgentFilter() {
    public boolean isIncluded(Agent agent) {
        // Return true for at least one agent
        return !agent.getId().contains("invalid");
    }
});
```

**Solution C: Verify Agent Configuration**
```
For each agent:
1. Enabled: ✓
2. Transport URI: Valid and reachable
3. Test Connection: Success
4. Triggers: At least one enabled
5. Ignore default: Unchecked (unless custom workflow)
```

### Issue 9: Replication Not Triggering (Blocked Servlet)

**Symptoms:**
- Activation button works but nothing happens
- No errors shown but content doesn't replicate
- Replication queues don't populate

**Diagnosis:**

From official AEM 6.5 LTS documentation: Check for blocking nodes in repository.

1. **Check for blocking nodes:**
   ```
   Navigate to: CRXDE Lite (/crx/de/index.jsp)
   Search for: /bin/replicate or /bin/replicate.json
   
   These nodes may block the replication servlet
   ```

**Root Cause:**
Custom nodes created at `/bin/replicate` or `/bin/replicate.json` can override the default replication servlet, preventing normal replication operations.

**Solution:**

```
Steps:
1. Navigate to CRXDE Lite: http://localhost:4502/crx/de/index.jsp
2. Check path: /bin/replicate
3. If node exists and is not the system servlet:
   - Right-click node
   - Select "Delete"
   - Save All
4. Repeat for: /bin/replicate.json
5. Test replication
```

**Verification:**
```
After deletion:
1. Activate a test page
2. Check replication queue processes
3. Verify content appears on Publish
```

### Issue 10: Namespace Replication Blocked

**Symptoms:**
- Error: "Namespace replication failed"
- Permission denied on namespace operations
- Custom namespace content won't replicate

**Diagnosis:**

From official AEM 6.5 LTS documentation: Replication user lacks namespace management privileges.

1. **Check user permissions:**
   ```
   Navigate to: CRXDE Lite
   Path: Repository level (/)
   Check: Replication user privileges
   ```

**Root Cause:**
The replication user (configured in agent's "Agent User Id") doesn't have `jcr:namespaceManagement` privilege, which is required to replicate custom namespaces.

**Solution:**

```
Steps:
1. Navigate to CRXDE Lite
2. Select repository root: /
3. Click "Access Control" tab
4. Find replication service user
5. Add privilege:
   - Privilege: jcr:namespaceManagement
   - Apply
6. Save All
```

**Grant via CRX/DE:**
```
1. Tools → Security → Permissions
2. Search for: replication-service user
3. Repository level permissions:
   ✓ jcr:read
   ✓ jcr:write
   ✓ crx:replicate
   ✓ jcr:namespaceManagement  ← Add this
4. Save
```

### Issue 11: Stuck Replication Jobs in Event Queue

**Symptoms:**
- Multiple agents blocked
- Repository appears to have replication issues
- `/var/replication/data` has many items

**Diagnosis:**

From official AEM 6.5 LTS documentation: Check for corrupted replication jobs.

1. **Check event queue:**
   ```
   Navigate to: CRXDE Lite
   XPath Query:
   /jcr:root/var/eventing/jobs//element(*,slingevent:Job)
   
   This shows all pending Sling event jobs
   ```

2. **Check replication data:**
   ```
   Path: /var/replication/data
   Look for: Large number of nodes
   ```

**Root Cause:**
Repository corruption or serialization errors can cause replication jobs to get stuck in the Sling event queue.

**Solution A: Clean Event Jobs**
```
Via CRXDE Lite:
1. Run XPath query:
   /jcr:root/var/eventing/jobs//element(*,slingevent:Job)
   
2. Review results for stuck jobs
3. Identify jobs with:
   - Old timestamps
   - Error properties
   - Replication-related topic
   
4. Carefully delete stuck jobs
5. Save All
```

**Solution B: Clear Replication Data**
```
WARNING: Only if queue is irreparably stuck

1. Stop AEM instance
2. Navigate to: crx-quickstart/repository/
3. Backup: /var/replication/data
4. Delete corrupted items in /var/replication/data
5. Start AEM
6. Verify replication resumes
```

**Solution C: Enable Detailed Logging**

From official documentation - configure detailed replication logging:

```
Navigate to: /system/console/configMgr
Search for: Apache Sling Logging Logger Configuration

Create new configuration:
- Logger: com.day.cq.replication
- Log Level: DEBUG
- Log File: logs/replication.log

Save and review logs for root cause
```

### Issue 12: Queue Pause Limitations

**Symptoms:**
- Paused queue resumes automatically
- Pause state lost after restart

**Diagnosis:**

From official AEM 6.5 LTS documentation: Queue pause has known limitations.

**Known Limitations:**

1. **Not persisted across restarts**
   - Pause state is in-memory only
   - AEM restart resumes all paused queues

2. **Auto-resume timeout**
   - Idle paused queues automatically resume after ~1 hour
   - Not configurable

**Workaround:**

Instead of pausing, disable the agent:

```
Agent configuration:
1. Edit agent
2. Settings tab
3. Uncheck "Enabled"
4. Save

This persists across restarts
```

**For temporary pause:**
```
Accept the limitations:
- Must re-pause after restart
- Must re-pause if idle >1 hour
- Use agent monitoring to track state
```

## Advanced Troubleshooting

### Analyze Replication Logs

**Location:** `crx-quickstart/logs/replication.log`

**Key patterns to search:**

```bash
# Successful replication
grep "Replication (ACTIVATE) of /content/mysite" replication.log

# Failed replication
grep "ERROR" replication.log | grep replication

# Agent not found
grep "no agent found" replication.log

# Authentication failures
grep "401" replication.log

# Connection issues
grep "Connection refused" replication.log
```

**Example log analysis:**
```
# Find all replication attempts for a path
grep "/content/mysite/en/page" replication.log

# Count failures by type
grep "ERROR" replication.log | cut -d' ' -f5- | sort | uniq -c | sort -rn

# Recent replication activity
tail -100 replication.log | grep "ACTIVATE\|DEACTIVATE"
```

### Monitor via JMX Console

```
Navigate to: /system/console/jmx

Search for: com.day.cq.replication

Monitor MBeans:
- Replication Agent Stats
  - Queue Size
  - Number of queued items
  - Last processed item
  - Error count

- Replication Service
  - Active replications
  - Failed replications
  - Average processing time
```

### Check OSGi Configuration

```
Navigate to: /system/console/configMgr

Relevant configurations:
- Day CQ Replication Service
- Day CQ WCM Replication Impl ReplicationComponentFactoryImpl
- Apache Sling Job Consumer Manager

Verify:
- Services are active
- No configuration errors
- Thread pools not exhausted
```

### Examine Event Queue

```
Navigate to: /system/console/slingevent

Check:
- Event queue depth
- Stuck events
- Processing rate
- Failed events

If queue stuck:
- Restart org.apache.sling.event bundle
- Check disk space
- Review thread dumps
```

## Preventive Measures

### 1. Regular Agent Testing

Schedule periodic tests:
```
Weekly:
1. Test Connection for all agents
2. Verify queues are empty
3. Review error logs
4. Check disk space on Publish
```

### 2. Monitoring and Alerts

Set up monitoring for:
- Replication queue depth > 100
- Agent blocked > 5 minutes
- Replication failures > 10 per hour
- Disk space < 10% free
- High replication lag (>5 minutes)

### 3. Maintenance Tasks

Regular maintenance:
```
Monthly:
- Review and clear old logs
- Verify agent credentials
- Test disaster recovery procedures
- Update documentation

Quarterly:
- Certificate renewal checks
- Performance testing
- Capacity planning review
```

### 4. Best Practices

- **Use dedicated service accounts** for replication (not admin)
- **Implement monitoring** for queue depth and errors
- **Test agent connectivity** after configuration changes
- **Document custom agents** and their purpose
- **Schedule large activations** during off-peak hours
- **Keep Publish instances in sync** with same configuration
- **Regular log review** to catch issues early
- **Maintain runbooks** for common issues

## Diagnostic Checklist

Use this checklist for systematic troubleshooting:

```
□ Verify symptom and impact
□ Check replication agent status (green/red)
□ Review replication queue for stuck items
□ Test agent connectivity
□ Verify Publish instance is running
□ Check authentication credentials
□ Review error.log and replication.log
□ Verify agent configuration (URI, credentials, settings)
□ Check network connectivity (ping, telnet, curl)
□ Test direct Publish access (bypass Dispatcher)
□ Verify Dispatcher Flush agent (if applicable)
□ Check content permissions on Publish
□ Review OSGi bundles status
□ Examine Sling event queue
□ Check disk space on Author and Publish
□ Verify JVM heap usage
□ Test with simple content first
□ Document findings and resolution
```

## Escalation Path

If issue persists after troubleshooting:

1. **Gather diagnostic information:**
   - Exact error messages
   - Replication.log excerpts
   - Agent configuration screenshots
   - Steps to reproduce
   - Environment details (AEM version, OS, Java version)

2. **Check Adobe Experience League Community:**
   - Search for similar issues
   - Post detailed question with diagnostics

3. **Adobe Support (if entitled):**
   - Open support ticket
   - Provide thread dumps if hanging
   - Share log bundles
   - Include replication queue screenshots

## Related Skills

- `configure-replication-agent`: Set up and configure agents properly
- `replicate-content`: Understand replication methods
- `replication-api`: Programmatic replication for custom code

## Success Criteria

- ✓ Replication agents showing green status (idle/active)
- ✓ Replication queues empty or processing normally
- ✓ Test Connection succeeds for all agents
- ✓ Content appears on Publish after activation
- ✓ Dispatcher cache invalidates properly
- ✓ No errors in replication.log or error.log
- ✓ Replication status shows "Published" on Author
- ✓ Performance is acceptable (activation <2 minutes)
- ✓ Root cause identified and documented
- ✓ Preventive measures implemented

## Additional Resources

- [Official AEM 6.5 LTS Replication Documentation](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/configuring/replication)
- [AEM 6.5 LTS Replication Troubleshooting Guide](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/configuring/troubleshoot-rep)
- [AEM 6.5 LTS Documentation Hub](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts)
- [Replication API JavaDoc (Package Summary)](https://developer.adobe.com/experience-manager/reference-materials/6-5-lts/javadoc/com/day/cq/replication/package-summary.html)
- [AEM Replication Cookbook (Community)](https://aemlounge.wordpress.com/2018/03/19/a-cookbook-for-replication-in-aem/)
- Adobe Experience League Community Forums
- AEM Operations Dashboard documentation
