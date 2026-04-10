---
name: troubleshoot-distribution
description: |
  Diagnose and fix content distribution issues including stuck content, CDN cache problems,
  publication delays, Preview tier issues, and Sling job failures.
---

# Troubleshoot Distribution

Diagnose and fix content distribution issues in AEM as a Cloud Service.

## Common Issues Overview

| Issue | Symptoms | Common Causes | Quick Fix |
|-------|----------|---------------|-----------|
| Content not appearing | Published but not on Publish/Preview | Sling job failure, permissions | Check Sling jobs, verify permissions |
| Stale CDN cache | Old content showing | CDN cache not purged | Manual CDN purge, check auto-purge |
| Slow distribution | Publishing takes >5 minutes | System overload, large assets | Check system health, reduce batch size |
| Preview tier issues | Content not on Preview | Wrong tier selected, auth issues | Verify tier selection, check access |
| Permission errors | 403 errors during publish | Insufficient permissions | Check service user ACLs |

## Issue 1: Content Not Appearing on Publish/Preview

### Symptoms

- Content published successfully (no errors in UI)
- Timeline shows "Publication successful"
- Content still doesn't appear on Publish or Preview tier
- Or content appears after significant delay (>10 minutes)

### Diagnostic Steps

#### Step 1: Verify Publication Status

```bash
# Check Timeline view
1. Select page in Sites console
2. Click Timeline icon
3. Filter by "Publication"
4. Verify "Publication successful" message
5. Check target tier (Publish vs. Preview)
```

**Expected**: See "Publication successful to Publish" or "Publication successful to Preview"

**If missing**: Publication may have failed silently

#### Step 2: Check Sling Jobs

```bash
# Navigate to Sling Jobs console
URL: https://author-p12345-e67890.adobeaemcloud.com/system/console/slingjobs

1. Check "Failed Jobs" tab
2. Look for jobs with topic: com/day/cq/replication
3. Check error messages

# Or via Felix console
URL: https://author-p12345-e67890.adobeaemcloud.com/system/console/jobs
```

**Common job failure reasons**:
- `javax.jcr.AccessDeniedException`: Permission issue
- `java.net.UnknownHostException`: Network/DNS issue
- `org.apache.jackrabbit.oak.api.CommitFailedException`: Repository lock or constraint violation

#### Step 3: Check Error Logs

```bash
# Download logs from Cloud Manager
1. Go to Cloud Manager
2. Select environment
3. Click "Download Logs"
4. Select "author" instance
5. Download "error.log"

# Search for replication errors
grep -i "replication" error.log | grep -i "error\|exception"

# Look for distribution errors
grep -i "distribution" error.log | grep -i "error\|exception"
```

**Common error patterns**:
```
ERROR [JobHandler: /var/eventing/jobs] Content distribution failed for /content/wknd/en
ERROR [sling-oak-observation] Replication error: Access denied
ERROR [distribution-agent-forward] Failed to distribute content
```

#### Step 4: Check Content Path

```bash
# Verify content path is correct
1. Navigate to CRXDE Lite
2. Browse to content path
3. Verify jcr:content node exists
4. Check cq:lastReplicationAction property

Expected: "Activate" (for published content)
If "Deactivate": Content was unpublished
If missing: Publication may not have triggered
```

### Solutions

#### Solution 1: Retry Publication

```bash
# Manual retry
1. Select content in Sites console
2. Manage Publication > Publish
3. Select target tier
4. Publish again
```

#### Solution 2: Clear Sling Job Queue

```bash
# Via Sling Jobs console
URL: /system/console/slingjobs

1. Go to "Failed Jobs" tab
2. Select failed replication jobs
3. Click "Retry Selected" or "Remove Selected"
4. Monitor job execution
```

#### Solution 3: Fix Permissions

```bash
# Check service user permissions
1. Navigate to /useradmin
2. Search for replication service user
3. Check permissions on content path
4. Grant required permissions:
   - jcr:read on source content
   - rep:write on target

# Or via repoinit
set ACL for replication-service
    allow jcr:read on /content/wknd
end
```

#### Solution 4: Check System Health

```bash
# Cloud Manager - check system status
1. Go to Cloud Manager
2. Select environment
3. Check "Monitoring" tab
4. Verify all services are healthy
5. Check CPU/memory utilization

# If system is overloaded
- Wait for utilization to decrease
- Retry publication during off-peak hours
- Reduce batch size for bulk operations
```

## Issue 2: Stale CDN Cache (Old Content Showing)

### Symptoms

- Content published successfully
- Content updated on Publish tier (verified via direct Publish URL)
- Old content still showing via CDN/production URL
- Hard refresh (Ctrl+F5) shows new content

### Diagnostic Steps

#### Step 1: Verify CDN vs. Origin

```bash
# Test direct Publish tier (bypasses CDN)
curl -I https://publish-p12345-e67890.adobeaemcloud.com/content/wknd/en.html

# Test via CDN (production URL)
curl -I https://www.wknd.site/en.html

# Compare response headers
- Look for "X-Cache: HIT" (served from CDN cache)
- Check "Age" header (cache age in seconds)
- Compare "Last-Modified" timestamps
```

**Expected**: Direct Publish URL shows new content, CDN shows old content

#### Step 2: Check CDN Cache Headers

```bash
# Check cache control headers
curl -I https://www.wknd.site/en.html | grep -i "cache-control\|age\|x-cache"

# Response headers indicate caching:
Cache-Control: max-age=3600
Age: 1234
X-Cache: HIT
```

**Key headers**:
- `Cache-Control: max-age=3600`: Content cached for 1 hour
- `Age: 1234`: Content has been in cache for 1234 seconds
- `X-Cache: HIT`: Served from CDN cache (not origin)

### Solutions

#### Solution 1: Manual CDN Purge

```bash
# Use Cloud Manager API to purge CDN cache
# (Requires API credentials)

curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-api-key: $API_KEY" \
  https://cloudmanager.adobe.io/api/program/$PROGRAM_ID/environment/$ENV_ID/invalidate \
  -d '{
    "paths": ["/content/wknd/en.html"]
  }'
```

**Or via Cloud Manager UI** (if available):
1. Go to Cloud Manager
2. Select environment
3. Find CDN invalidation option
4. Enter content path
5. Submit purge request

#### Solution 2: Verify Auto-Purge Configuration

```bash
# Check Dispatcher configuration
# File: dispatcher/src/conf.d/available_vhosts/*.vhost

# Verify cache invalidation is enabled
<VirtualHost *:80>
    # CDN auto-purge should be automatic in Cloud Service
    # No manual Flush agent configuration needed
</VirtualHost>
```

**In Cloud Service**: CDN auto-purge is automatic - no configuration needed

**If auto-purge not working**: Contact Adobe Support

#### Solution 3: Use Cache-Busting Query Parameters (Temporary)

```bash
# Add query parameter to force CDN refresh
https://www.wknd.site/en.html?v=20250410

# Or use timestamp
https://www.wknd.site/en.html?t=1712751234
```

**Note**: This is a temporary workaround, not a permanent solution

#### Solution 4: Check Client Library Versioning

```bash
# For CSS/JS files, verify clientlib versioning is enabled
# File: ui.apps/src/main/content/jcr_root/apps/wknd/clientlibs/.content.xml

<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0"
    allowProxy="{Boolean}true"
    longCacheKey="{String}wknd-v1"/>
```

**Versioned clientlib URLs**:
```
/etc.clientlibs/wknd/clientlibs/clientlib-site.lc-abc123def456-lc.min.css
                                                  ^^^^^^^^^^^^^ hash ensures unique URL
```

## Issue 3: Slow Content Distribution

### Symptoms

- Publishing takes >5 minutes
- UI shows "Publishing..." for extended period
- Sling job queue has high backlog
- System performance degraded

### Diagnostic Steps

#### Step 1: Check Sling Job Queue Depth

```bash
# Via Sling Jobs console
URL: /system/console/slingjobs

1. Check "Statistics" tab
2. Look for job backlog
3. Check average processing time

# Normal: < 10 jobs in queue, < 30s processing time
# Slow: > 50 jobs in queue, > 2 minutes processing time
```

#### Step 2: Check System Resources

```bash
# Cloud Manager - monitor system health
1. Go to Cloud Manager
2. Select environment
3. "Monitoring" tab
4. Check CPU, memory, disk I/O

# Warning signs:
- CPU utilization > 80%
- Memory utilization > 90%
- Disk I/O saturation
```

#### Step 3: Check Content Size

```bash
# Determine if large assets are causing delays
1. Check page size (including referenced assets)
2. Check asset file sizes
3. Check number of references

# Command to check asset size:
curl -I https://author-p12345-e67890.adobeaemcloud.com/content/dam/wknd/large-video.mp4 \
  | grep Content-Length

# Large assets (>100MB) take longer to distribute
```

### Solutions

#### Solution 1: Reduce Batch Size

```bash
# Instead of publishing 200 pages at once:
- Publish in batches of 50 pages
- Allow system to process each batch
- Monitor queue depth between batches
```

#### Solution 2: Schedule During Off-Peak Hours

```bash
# Use scheduled publishing
1. Manage Publication > Later
2. Schedule for off-peak hours (e.g., 2 AM)
3. Set activation date/time
4. Publish

# System has more capacity during off-peak hours
```

#### Solution 3: Optimize Large Assets

```bash
# For large video/image assets:
1. Use Dynamic Media for assets
2. Compress images before upload
3. Use video streaming (not direct file)
4. Consider external asset hosting (CDN)
```

#### Solution 4: Scale Environment (If Persistent)

```bash
# Contact Adobe Support to scale environment
- Increase Author tier capacity
- Add additional nodes
- Upgrade environment tier

# Only for persistent performance issues
```

## Issue 4: Preview Tier Issues

### Symptoms

- Content published to Preview but not appearing
- Preview URL returns 404
- Authentication issues on Preview tier
- Content on Publish but not on Preview (or vice versa)

### Diagnostic Steps

#### Step 1: Verify Preview Tier Selection

```bash
# Check Timeline view
1. Select page in Sites console
2. Timeline panel
3. Filter by "Publication"
4. Verify message says "Publication successful to Preview"

# If says "Publish" instead of "Preview":
- Content was published to wrong tier
- Republish to Preview tier
```

#### Step 2: Verify Preview URL Format

```bash
# Correct Preview URL format:
https://preview-p12345-e67890.adobeaemcloud.com/content/wknd/en.html
       ^^^^^^^ (must say "preview" not "publish")

# Find your Preview URL:
1. Cloud Manager
2. Select environment
3. "Preview" service URL
```

#### Step 3: Check Authentication

```bash
# Test Preview access with authentication
curl -I -u username:password \
  https://preview-p12345-e67890.adobeaemcloud.com/content/wknd/en.html

# Expected: 200 OK
# If 401: Authentication failed (check credentials)
# If 403: User lacks Preview access (check permissions)
# If 404: Content not published to Preview
```

### Solutions

#### Solution 1: Publish to Correct Tier

```bash
# Republish to Preview tier
1. Select content
2. Manage Publication
3. Targets: Check "Preview" (ensure Publish is unchecked if you only want Preview)
4. Publish
```

#### Solution 2: Grant Preview Access

```bash
# Grant user access to Preview tier
1. Navigate to Tools > Security > Users
2. Select user
3. Add to group with read permissions
4. User can now authenticate to Preview

# Verify permissions:
# User needs jcr:read on /content
```

#### Solution 3: Use Preview Button

```bash
# Quick access to Preview from Sites console
1. Select page in Sites console
2. Click "View as Published" dropdown (eye icon)
3. Select "Preview"
4. Page opens in Preview tier with authentication
```

## Issue 5: Permission Errors

### Symptoms

- Error: "Access denied during replication"
- 403 Forbidden during publication
- Sling job fails with `AccessDeniedException`
- Error log shows permission errors

### Diagnostic Steps

#### Step 1: Check Service User Permissions

```bash
# Identify replication service user
# Check error log for service user name

# Navigate to /useradmin
1. Search for service user
2. Check "Effective Policies" tab
3. Verify permissions on content path
```

#### Step 2: Check Replication Privileges

```bash
# Required permissions for replication service user:
- jcr:read on /content (source)
- rep:write on /content (to set replication properties)
- crx:replicate privilege (if using older API)

# Check via CRXDE
1. Select content node
2. Right-click > "Privileges"
3. Check service user has required privileges
```

### Solutions

#### Solution 1: Grant Required Permissions

```bash
# Via repoinit (recommended)
# File: ui.config/src/main/content/jcr_root/apps/wknd/osgiconfig/config.author/
#       org.apache.sling.jcr.repoinit.RepositoryInitializer~wknd.config

create service user wknd-replication-service

set ACL for wknd-replication-service
    allow jcr:read,rep:write on /content
    allow jcr:read,rep:write on /content/dam
    allow jcr:versionManagement on /content
end
```

#### Solution 2: Map Service User

```json
// ui.config/src/main/content/jcr_root/apps/wknd/osgiconfig/config/
// org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-replication.cfg.json
{
  "user.mapping": [
    "com.adobe.aem.wknd.core:replicationService=wknd-replication-service"
  ]
}
```

#### Solution 3: Deploy Configuration

```bash
# Build and deploy
mvn clean install -PautoInstallSinglePackage

# Verify service user mapping
# Navigate to: /system/console/jcrresolver
# Search for "replicationService"
# Should show mapped service user
```

## Diagnostic Commands Reference

### Check Publication Status

```bash
# Via Timeline view (UI)
1. Select page
2. Timeline panel
3. Filter: "Publication"

# Via CRXDE (manual)
1. Navigate to /content/wknd/en/jcr:content
2. Check properties:
   - cq:lastReplicationAction: "Activate" | "Deactivate"
   - cq:lastReplicated: timestamp
   - cq:lastReplicatedBy: user ID
```

### Check Sling Jobs

```bash
# Via Felix Console
URL: /system/console/jobs

# Via Sling Jobs Console
URL: /system/console/slingjobs

# Look for:
- Failed jobs (red)
- Queued jobs (yellow)
- Processing time (should be < 60s)
```

### Check System Health

```bash
# Via Cloud Manager
1. Monitoring tab
2. Check metrics:
   - CPU utilization
   - Memory utilization
   - Disk I/O
   - Network throughput

# Via Felix Console
URL: /system/console/components
- Check all components are "active"
```

### Check CDN Cache

```bash
# Test CDN cache headers
curl -I https://www.wknd.site/en.html

# Key headers:
- X-Cache: HIT (cached) | MISS (not cached)
- Age: seconds in cache
- Cache-Control: cache directives
```

## Preventive Measures

### Best Practices to Avoid Issues

1. **Test on Lower Environments**: Always test publishing on Dev/Stage before Production
2. **Use Preview Tier**: Publish to Preview first for content review
3. **Monitor Sling Jobs**: Regularly check job queue depth
4. **Grant Correct Permissions**: Use least privilege principle for service users
5. **Optimize Content**: Compress large assets before publishing
6. **Schedule Bulk Operations**: Publish large content sets during off-peak hours
7. **Set Up Alerts**: Configure Cloud Manager alerts for system issues
8. **Regular Cleanup**: Unpublish old content from Preview tier

### Monitoring Setup

```bash
# Set up Cloud Manager alerts
1. Cloud Manager > Environment > Settings
2. Configure alerts for:
   - High CPU utilization (>80%)
   - High memory utilization (>90%)
   - Service unavailability
   - Error rate threshold

# Log monitoring
- Subscribe to error.log notifications
- Set up log aggregation (Splunk, ELK)
- Alert on replication errors
```

## When to Escalate to Adobe Support

Escalate if:
- **CDN auto-purge not working** after confirming content is published
- **Persistent job failures** despite correct permissions
- **System performance degraded** consistently
- **Cloud Service infrastructure issues** (all services healthy but distribution fails)
- **Preview tier unavailable** or unresponsive

**Information to provide to Support**:
- Environment ID and Program ID
- Content path experiencing issues
- Timeline of issue (when started, frequency)
- Error logs (error.log excerpts)
- Sling job failures (screenshots or logs)
- Steps already taken to troubleshoot

## Official Documentation

- [Replication Troubleshooting](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/operations/replication)
- [Cloud Manager Monitoring](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/using-cloud-manager/manage-environments)
- [CDN in Cloud Service](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/cdn)

## Related Skills

- **Publish Content**: Core publishing workflows
- **Preview Tier Management**: Preview-specific troubleshooting
- **Content Distribution API**: Programmatic publishing issues
