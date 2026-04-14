---
name: replicate-content
description: Activate and deactivate content in AEM 6.5 LTS using replication agents for publishing to target instances
---

# Replicate Content in AEM 6.5 LTS

This skill guides you through activating (publishing) and deactivating (unpublishing) content in Adobe Experience Manager 6.5 LTS. Replication moves content from the Author environment to one or more Publish instances, making it available to end users.

## When to Use This Skill

Use this skill when you need to:
- Publish pages from Author to Publish environment
- Activate modified content to make changes live
- Deactivate (unpublish) content to remove it from Publish
- Perform tree activation for entire site sections
- Use programmatic replication via API
- Trigger replication via workflows
- Schedule content activation/deactivation
- Replicate assets and DAM content
- Perform package-based replication

## Prerequisites

- AEM 6.5 LTS Author instance with configured replication agents
- At least one replication agent enabled and working (see `configure-replication-agent` skill)
- Author permissions to activate/deactivate content
- Content created and ready for publication
- Understanding of content approval workflows (if implemented)

## Content Replication Methods

AEM 6.5 LTS provides seven primary methods for triggering replication:

| Method | Use Case | Scope | Access |
|--------|----------|-------|--------|
| **Quick Publish** | Simple page activation | Single page (shallow) | Page/Sites console |
| **Manage Publication** | Advanced control | Single/multiple pages | Page/Sites console |
| **Tree Activation** | Hierarchical publishing | Page tree | Classic UI Tools |
| **Package Manager** | Specific content sets | Custom packages | Tools console |
| **Workflows** | Approval-based | Any content | Workflow console |
| **Scheduled Activation** | Time-based | Single/multiple pages | Page properties |
| **Replication API** | Programmatic | Any resource | Custom code |

## Method 1: Quick Publish (Recommended for Simple Cases)

Quick Publish provides the fastest way to activate content with minimal clicks.

### Steps:

1. **Navigate to Sites console:**
   ```
   http://localhost:4502/sites.html/content
   ```

2. **Select content:**
   - Click checkbox next to page(s) to publish
   - Multiple selection supported

3. **Click "Quick Publish":**
   - Button appears in top toolbar
   - Alternatively: Right-click → Quick Publish

4. **Confirmation:**
   - Green success message appears
   - Page status shows "Published" with green checkmark
   - Replication timestamp updates

### Characteristics:
- **Shallow replication**: Only selected page(s), not child pages
- **Immediate**: No delay or scheduling
- **Default agents**: Uses all enabled default replication agents
- **No preview**: Content publishes immediately without review

### When to use Quick Publish:
- Simple page updates
- Single page activation
- No approval workflow needed
- Immediate publication required

## Method 2: Manage Publication (Advanced Control)

Manage Publication wizard provides granular control over what, when, and how content is published.

### Steps:

1. **Select content in Sites console:**
   ```
   Select page(s) → Click "Manage Publication" in toolbar
   ```

2. **Choose action:**
   - **Publish**: Activate to Publish instances
   - **Unpublish**: Deactivate from Publish instances
   - **Publish Later**: Schedule future activation
   - **Unpublish Later**: Schedule future deactivation

3. **Configure scheduling (if "Later" selected):**
   ```
   Activation Date: [YYYY-MM-DD]
   Activation Time: [HH:MM]
   ```

4. **Select scope:**
   - **Selected**: Only chosen pages
   - **Modified**: Pages modified since last publication
   - **Published**: Already published pages
   - **Include children**: Replicate child pages (tree activation)

5. **Configure options:**
   - **Create version**: Snapshot before publish
   - **Workflow**: Trigger approval workflow
   - **References**: Include referenced assets/pages
   - **Activate modified pages only**: Skip unchanged content

6. **Select workflow (if applicable):**
   ```
   Workflow Model: [Request for Activation / Approval Workflow / Custom]
   Workflow Title: "Publish Homepage Updates"
   ```

7. **Review and confirm:**
   - Summary shows:
     - Pages to publish
     - Schedule details
     - Workflow assignment
   - Click "Publish" or "Next" to proceed

8. **Monitor progress:**
   - Progress bar shows replication status
   - Success/failure notifications appear

### Advanced Options:

**Include References:**
- Automatically publishes linked assets
- Includes DAM images, documents
- Publishes referenced experience fragments
- Ensures no broken links on Publish

**Create Version Before Publish:**
- Creates snapshot in version history
- Enables rollback if needed
- Recommended for major updates

**Only Modified Pages:**
- Skips pages unchanged since last activation
- Improves performance for large trees
- Reduces replication queue load

### When to use Manage Publication:
- Publishing multiple pages with dependencies
- Scheduled activation/deactivation needed
- Approval workflow required
- Tree activation with selective inclusion
- Creating version snapshots before publish

## Method 3: Tree Activation (Hierarchical Publishing)

Tree Activation publishes an entire content tree hierarchy in one operation.

### Steps (Classic UI):

1. **Navigate to Tools console:**
   ```
   http://localhost:4502/miscadmin
   ```

2. **Access Replication tools:**
   - Click "Replication" in left sidebar
   - Select "Activate Tree"

3. **Configure tree activation:**
   ```
   Start Path: /content/mysite/en
   
   Options:
   - Only Modified: ✓ (publish only changed pages)
   - Only Activated: ✓ (publish only previously activated)
   - Ignore Deactivated: ✓ (skip deactivated pages)
   
   Dry Run: ✓ (test without actually publishing)
   ```

4. **Execute or dry run:**
   - **Dry Run**: Preview what will be published
   - **Activate**: Execute actual replication
   - Progress indicator shows page count

5. **Review results:**
   - Success count
   - Failed pages (if any)
   - Log details for troubleshooting

### When to use Tree Activation:
- Publishing entire site sections
- Initial site launch
- Large content migrations
- Bulk replication operations

### Performance considerations:
- Can generate large replication queues
- May take significant time for large trees
- Use "Only Modified" to reduce load
- Consider off-peak hours for large activations

## Method 4: Package-Based Replication

Package Manager allows replicating specific content sets across environments.

### Steps:

1. **Create package:**
   ```
   Navigate to: http://localhost:4502/crx/packmgr/index.jsp
   Click "Create Package"
   
   Package Name: content-update-2024-04
   Group: myproject
   Version: 1.0.0
   ```

2. **Define package filters:**
   ```
   Click "Edit" → "Filters" tab
   
   Add filter(s):
   Root Path: /content/mysite/en/products
   Rules: Include (default)
   
   Add another:
   Root Path: /content/dam/mysite/images/products
   Rules: Include
   ```

3. **Build package:**
   ```
   Click "Build"
   Wait for completion
   Package .zip created
   ```

4. **Replicate package:**
   ```
   Click "More" → "Replicate"
   Package sent to replication queue
   Distributed to all enabled Publish instances
   ```

5. **Verify on Publish:**
   ```
   Navigate to Publish CRX Package Manager:
   http://publish:4503/crx/packmgr/index.jsp
   
   Package should appear in list
   Status: Installed
   ```

### When to use Package Replication:
- Complex content sets with dependencies
- Cross-environment deployments
- Backup and restore operations
- Specific node structure replication
- Configuration replication

## Method 5: Workflow-Based Replication

Workflows enable approval processes before content goes live.

### Built-in Workflow: Request for Activation

1. **Trigger workflow:**
   ```
   Select page(s) → Timeline panel (left sidebar)
   Click "Start Workflow"
   ```

2. **Select workflow model:**
   ```
   Workflow: Request for Activation
   Title: "Homepage Redesign Approval"
   Comment: "Please review updated homepage design"
   ```

3. **Assign approver:**
   ```
   Participant: [User or Group]
   Example: content-approvers
   ```

4. **Submit request:**
   ```
   Click "Create"
   Workflow initiates
   Notification sent to approver
   ```

5. **Approver actions:**
   ```
   Approver receives inbox notification:
   http://localhost:4502/aem/inbox
   
   Options:
   - Approve: Content activates to Publish
   - Reject: Returns to author with comments
   - Request changes: Sends back for revisions
   ```

6. **After approval:**
   - Content automatically replicates
   - Workflow completes
   - Status updates to "Published"

### Custom Workflow Models

Create custom workflows for complex approval chains:

```
Navigate to: Tools → Workflow → Models

Example workflow steps:
1. Content Author creates/modifies
2. → Content Lead reviews
3. → Legal compliance check
4. → Final approval
5. → Automatic activation
6. → Notification to stakeholders
```

## Method 6: Scheduled Activation/Deactivation

Schedule content to publish or unpublish at specific date/time.

### Configure via Page Properties:

1. **Open page properties:**
   ```
   Select page → Properties (toolbar or right-click)
   ```

2. **Navigate to Advanced tab:**
   ```
   Click "Advanced" in left sidebar
   ```

3. **Set On Time (activation):**
   ```
   On Time: 2024-04-15 09:00:00
   
   Effect: Page automatically activates at specified time
   Requires: Replication agent with "On-/Offtime reached" trigger enabled
   ```

4. **Set Off Time (deactivation):**
   ```
   Off Time: 2024-05-15 23:59:00
   
   Effect: Page automatically deactivates at specified time
   Removes from Publish instances
   ```

5. **Save properties:**
   ```
   Click "Save & Close"
   ```

### Verify Scheduled Activation:

```
Replication agent configuration:
Navigate to: /etc/replication/agents.author/[agent-name]
Triggers tab: "On-/Offtime reached" must be enabled
```

### When to use Scheduled Activation:
- Marketing campaigns with specific launch dates
- Time-sensitive announcements
- Content embargoes
- Temporary promotions
- Event-based content

## Method 7: Programmatic Replication (API)

Use the Replication API for custom code integration.

### Java API Example:

```java
import com.day.cq.replication.Replicator;
import com.day.cq.replication.ReplicationActionType;
import com.day.cq.replication.ReplicationException;
import org.apache.sling.api.resource.ResourceResolver;

@Reference
private Replicator replicator;

public void activatePage(ResourceResolver resolver, String pagePath) 
    throws ReplicationException {
    
    // Activate (publish) content
    replicator.replicate(
        resolver.adaptTo(Session.class),
        ReplicationActionType.ACTIVATE,
        pagePath
    );
}

public void deactivatePage(ResourceResolver resolver, String pagePath) 
    throws ReplicationException {
    
    // Deactivate (unpublish) content
    replicator.replicate(
        resolver.adaptTo(Session.class),
        ReplicationActionType.DEACTIVATE,
        pagePath
    );
}

public void deleteFromPublish(ResourceResolver resolver, String pagePath) 
    throws ReplicationException {
    
    // Delete content from Publish
    replicator.replicate(
        resolver.adaptTo(Session.class),
        ReplicationActionType.DELETE,
        pagePath
    );
}
```

### ReplicationActionType Options:

| Type | Purpose | Effect |
|------|---------|--------|
| `ACTIVATE` | Publish content | Sends to Publish instances |
| `DEACTIVATE` | Unpublish content | Removes from Publish |
| `DELETE` | Delete from Publish | Permanent removal |
| `TEST` | Test replication | Verifies connectivity |
| `REVERSE` | Reverse replicate | Publish → Author |

### Advanced API: ReplicationOptions

```java
import com.day.cq.replication.ReplicationOptions;
import com.day.cq.replication.AgentFilter;

// Custom replication with options
ReplicationOptions opts = new ReplicationOptions();

// Synchronous replication (wait for completion)
opts.setSynchronous(true);

// Suppress versions
opts.setSuppressVersions(true);

// Filter to specific agents
opts.setFilter(new AgentFilter() {
    public boolean isIncluded(Agent agent) {
        return agent.getId().equals("publish_instance_1");
    }
});

// Execute with options
replicator.replicate(session, ReplicationActionType.ACTIVATE, pagePath, opts);
```

### CURL API Examples

**Activate page (with error handling):**
```bash
# Note: Replace $AEM_USER:$AEM_PASSWORD with your service account credentials
response=$(curl -s -w "\n%{http_code}" -u $AEM_USER:$AEM_PASSWORD -X POST \
  http://localhost:4502/bin/replicate.json \
  -F "cmd=Activate" \
  -F "path=/content/mysite/en/products")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" -eq 200 ]; then
  # Validate JSON response structure and success status
  if command -v jq &> /dev/null; then
    success=$(echo "$body" | jq -r '.success // empty')
    path=$(echo "$body" | jq -r '.path // empty')
    
    if [ "$success" = "true" ]; then
      echo "Activation successful for path: $path"
    else
      error=$(echo "$body" | jq -r '.message // "Unknown error"')
      echo "Activation reported failure: $error"
      exit 1
    fi
  else
    echo "Activation successful (HTTP 200)"
    echo "$body"
  fi
else
  echo "Activation failed with HTTP $http_code"
  echo "$body"
  exit 1
fi
```

**Deactivate page (with error handling):**
```bash
# Note: Replace $AEM_USER:$AEM_PASSWORD with your service account credentials
response=$(curl -s -w "\n%{http_code}" -u $AEM_USER:$AEM_PASSWORD -X POST \
  http://localhost:4502/bin/replicate.json \
  -F "cmd=Deactivate" \
  -F "path=/content/mysite/en/products")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" -eq 200 ]; then
  # Validate JSON response structure and success status
  if command -v jq &> /dev/null; then
    success=$(echo "$body" | jq -r '.success // empty')
    path=$(echo "$body" | jq -r '.path // empty')
    
    if [ "$success" = "true" ]; then
      echo "Deactivation successful for path: $path"
    else
      error=$(echo "$body" | jq -r '.message // "Unknown error"')
      echo "Deactivation reported failure: $error"
      exit 1
    fi
  else
    echo "Deactivation successful (HTTP 200)"
    echo "$body"
  fi
else
  echo "Deactivation failed with HTTP $http_code"
  echo "$body"
  exit 1
fi
```

**Tree activation via CURL (with error handling):**
```bash
# Note: Replace $AEM_USER:$AEM_PASSWORD with your service account credentials
response=$(curl -s -w "\n%{http_code}" -u $AEM_USER:$AEM_PASSWORD -X POST \
  http://localhost:4502/etc/replication/treeactivation.html \
  -F "path=/content/mysite/en" \
  -F "onlyModified=true")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" -eq 200 ]; then
  # Note: Tree activation returns HTML, not JSON
  # Check for success indicators in HTML response
  if echo "$body" | grep -q "successfully"; then
    echo "Tree activation initiated successfully"
    # Extract and display any useful information from the HTML response
    if command -v jq &> /dev/null && echo "$body" | jq empty 2>/dev/null; then
      # If response is JSON (rare but possible)
      status=$(echo "$body" | jq -r '.status // "initiated"')
      echo "Status: $status"
    fi
  else
    echo "Tree activation may have encountered issues. Check response:"
    echo "$body"
  fi
else
  echo "Tree activation failed with HTTP $http_code"
  echo "$body"
  exit 1
fi
```

**Simple examples (without error handling):**

For quick testing, you can use simpler commands:
```bash
# Quick activate (no error handling)
curl -u $AEM_USER:$AEM_PASSWORD -X POST \
  http://localhost:4502/bin/replicate.json \
  -F "cmd=Activate" \
  -F "path=/content/mysite/en/products"

# Quick deactivate (no error handling)
curl -u $AEM_USER:$AEM_PASSWORD -X POST \
  http://localhost:4502/bin/replicate.json \
  -F "cmd=Deactivate" \
  -F "path=/content/mysite/en/products"
```

Note: Simple examples above don't check for errors - use error handling versions in production scripts.

## Asset Replication (DAM)

Replicate digital assets from Author to Publish.

### Steps:

1. **Navigate to Assets console:**
   ```
   http://localhost:4502/assets.html/content/dam
   ```

2. **Select asset(s):**
   - Click checkbox on images, videos, documents
   - Multiple selection supported

3. **Click "Quick Publish" or "Manage Publication":**
   - Same options as page replication
   - Assets replicate to Publish DAM

4. **Verify asset renditions:**
   - Original asset replicates
   - All renditions replicate (thumbnails, web-optimized, etc.)
   - Metadata replicates

### Asset Replication Considerations:

**Large file handling:**
- Binary-less replication available for shared datastore
- Direct binary access reduces replication overhead
- Configure in replication agent: Serialization Type = Binary-less

**Asset dependencies:**
- Replicate referenced assets when publishing pages
- Use "Include References" in Manage Publication
- Avoids broken image links on Publish

## Deactivation (Unpublishing)

Remove content from Publish instances.

### Quick Unpublish:

```
Sites console → Select page(s) → Quick Unpublish
```

### Manage Publication (Unpublish):

```
Sites console → Select page(s) → Manage Publication
Action: Unpublish
Scope: Selected / Include children
Click "Unpublish"
```

### Effect of Deactivation:
- Content removed from Publish instances
- URLs return 404 on Publish
- Content remains on Author (not deleted)
- Can be re-activated later
- Dispatcher cache invalidated

## Monitoring Replication Status

### Check Page Replication Status:

**Sites console:**
- Green checkmark = Published
- Gray circle = Never published
- Orange dot = Modified since last publish
- Timeline shows replication history

**Page Properties:**
- Click page → Properties → Basic tab
- Shows: Last published, Last published by, Last modified

### Replication Queue Status:

```
Navigate to: Tools → Deployment → Replication
Click: Agents on author
Select: [agent name]

View:
- Queue status (idle/active/blocked)
- Pending items count
- Last replication timestamp
```

### Replication Logs:

```
Navigate to: Tools → Operations → Logs

Log file: replication.log
Location: crx-quickstart/logs/replication.log

Typical entries:
- Replication initiated: path, type, user
- Replication succeeded/failed: status, duration
- Queue events: item added, processed, failed
```

## Troubleshooting Replication

### Content Not Appearing on Publish

**Check replication status:**
1. Verify page shows "Published" in Sites console
2. Check replication timestamp is recent
3. Review replication agent queue (should be empty after processing)

**Verify on Publish directly:**
```
http://publish-host:4503/content/mysite/en/page-name.html
```

**Check Dispatcher cache:**
- May serve cached old version
- Wait for cache invalidation
- Or manually flush cache
- Verify Dispatcher Flush agent is enabled and working

### Replication Fails

**Common causes:**

1. **Replication agent blocked:**
   - Check agent status (should be green)
   - Review queue for failed items
   - Click "Force Retry" or "Clear" failed item

2. **Publish instance unavailable:**
   - Verify Publish is running: `http://publish:4503/system/console`
   - Test agent connection
   - Check network connectivity

3. **Insufficient permissions:**
   - Verify Agent User Id has replication privileges
   - Check user permissions on target content paths
   - Review error logs for permission denied messages

4. **Content locked:**
   - Check if page is locked by another user
   - Unlock page: Page → Unlock
   - Retry replication

### Page Modified After Publication

If page shows orange dot (modified since publish):

```
Option 1: Re-publish changes
Select page → Quick Publish

Option 2: Review changes first
Select page → Manage Publication
Check "Modified" scope to see what changed
Proceed with publication
```

## Best Practices

1. **Use appropriate method:**
   - Quick Publish for simple single-page updates
   - Manage Publication for complex scenarios
   - Tree Activation for entire sections
   - Workflows for approval processes

2. **Verify before publishing:**
   - Preview content in Author
   - Use staging/UAT environment first
   - Test with limited user group before full launch

3. **Monitor replication:**
   - Check replication status after activation
   - Verify content appears correctly on Publish
   - Review logs for errors

4. **Schedule large activations:**
   - Use off-peak hours for tree activations
   - Avoid business hours for major content releases
   - Coordinate with operations team

5. **Handle dependencies:**
   - Always publish referenced assets
   - Use "Include References" option
   - Verify asset paths are correct

6. **Use workflows for sensitive content:**
   - Implement approval for homepage, legal pages
   - Multi-stage review for compliance
   - Audit trail via workflow history

7. **Clean up deactivated content:**
   - Regularly review unpublished pages
   - Delete obsolete content from Author
   - Maintain organized content tree

8. **Test replication agents:**
   - Periodically test agent connectivity
   - Verify multiple Publish instances receiving content
   - Monitor agent performance metrics

## Security Considerations

**Replication permissions:**
- Grant minimum required activation rights
- Use groups for permission management
- Audit replication activity via logs

**Sensitive content:**
- Use workflows for approval
- Restrict activation to authorized users
- Implement content security policies

**API usage:**
- Secure service user accounts for programmatic replication
- Never hardcode credentials
- Use resource resolver with appropriate permissions

## Related Skills

- `configure-replication-agent`: Set up and configure replication agents
- `troubleshoot-replication`: Diagnose and fix replication issues
- For AEM as a Cloud Service, see content distribution documentation (different architecture)

## Success Criteria

- ✓ Content successfully published to Publish instance(s)
- ✓ Page status shows "Published" with green checkmark
- ✓ Content visible on Publish URL
- ✓ Replication agent queue processed without errors
- ✓ Referenced assets also published
- ✓ Dispatcher cache invalidated (if applicable)
- ✓ Scheduled activation configured correctly (if used)
- ✓ Workflow approval completed (if required)
- ✓ Deactivation removes content from Publish (if tested)
- ✓ Replication logs show successful entries

## Additional Resources

- [Official AEM 6.5 LTS Replication Documentation](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/configuring/replication)
- [AEM 6.5 LTS Replication Troubleshooting Guide](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/configuring/troubleshoot-rep)
- [AEM 6.5 LTS Documentation Hub](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts)
- [Replication API JavaDoc (Package Summary)](https://developer.adobe.com/experience-manager/reference-materials/6-5-lts/javadoc/com/day/cq/replication/package-summary.html)
- [Managing Publications Documentation](https://experienceleague.adobe.com/docs/experience-manager-65/authoring/authoring/publishing-pages.html)
- Workflow Models documentation for approval processes
