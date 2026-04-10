---
name: publish-content
description: |
  Publish content to Publish and Preview tiers using AEM as a Cloud Service publishing workflows.
  Covers Quick Publish, Manage Publication, Tree Activation, scheduled publishing, and unpublishing.
---

# Publish Content

Publish content to Publish and Preview tiers using AEM as a Cloud Service publishing workflows.

## When to Use This Skill

Use this skill for content publishing operations:
- Publishing pages, assets, content fragments, or experience fragments
- Publishing to Preview tier for content review
- Publishing to Publish tier for production
- Scheduled publishing with timezone support
- Unpublishing content from Publish or Preview tiers
- Bulk content publishing (Tree Activation)

For programmatic publishing in custom code, use [Content Distribution API](../distribution-api/SKILL.md) instead.

## Publishing Methods Overview

| Method | Use Case | Tiers Supported | Scheduling | Bulk Operations |
|--------|----------|-----------------|------------|-----------------|
| Quick Publish | Simple one-click activation | Publish only | No | Yes (limited) |
| Manage Publication | Advanced control with Preview | Preview, Publish, Both | Yes | Yes |
| Tree Activation | Hierarchical bulk publishing | Preview, Publish | No | Yes |
| Package Manager | Specific content sets | Publish | No | Yes |
| Workflows | Approval-based publishing | Preview, Publish | Via workflow | Yes |

## Method 1: Quick Publish

Simplest publishing method for immediate activation to the Publish tier.

### When to Use

- Simple page or asset activation
- No approval workflow needed
- No Preview review needed
- Immediate publishing required

### Steps

1. **Navigate to the content**
   - Sites Console: Navigate to the page
   - Assets Console: Navigate to the asset
   - Content Fragments: Navigate to the fragment

2. **Select content**
   - Select one or more items using checkboxes

3. **Trigger Quick Publish**
   - Click **Quick Publish** in the toolbar
   - Or right-click and select **Quick Publish**

4. **Verify**
   - Check "Publication successful" notification
   - Verify content appears on Publish tier

### Limitations

- **Publish tier only** (no Preview option)
- **No scheduling** (immediate only)
- **Limited bulk operations** (recommended: < 50 items at once)

### Example Use Cases

```
# Daily content operations
- Publish a news article immediately
- Activate a corrected asset
- Publish a content fragment for API consumption

# Small bulk operations
- Publish 10 related pages
- Activate a folder of related assets (< 50 assets)
```

## Method 2: Manage Publication (Recommended)

Advanced publishing method with Preview tier support, scheduling, and fine-grained control.

### When to Use

- Preview tier review needed
- Scheduled publishing required
- Approval workflows
- Complex publishing scenarios (publish + unpublish combinations)
- Publish to both Preview and Publish tiers

### Steps

#### Basic Publish to Publish Tier

1. **Select content**
   - Navigate to content in Sites or Assets console
   - Select items using checkboxes

2. **Open Manage Publication**
   - Click **Manage Publication** in toolbar
   - Or right-click and select **Manage Publication**

3. **Configure publication**
   - **Action**: Publish (default)
   - **When**: Now or Later (for scheduling)
   - **Scope**: Selected items or include children
   - **Targets**: Select "Publish" tier

4. **Review and publish**
   - Review the content list
   - Click **Publish**

5. **Verify**
   - Check "Publication started" notification
   - Monitor publication status in Timeline view

#### Publish to Preview Tier

1. **Open Manage Publication** (same as above)

2. **Configure for Preview**
   - **Action**: Publish
   - **When**: Now
   - **Scope**: Selected items or include children
   - **Targets**: Select **"Preview"** tier (instead of Publish)

3. **Publish to Preview**
   - Click **Publish**
   - Content distributes to Preview tier

4. **Access Preview content**
   - Use Preview tier URL: `https://preview-<program-id>-<environment-id>.adobeaemcloud.com/content/...`
   - Or use Preview button in Sites console

#### Scheduled Publishing

1. **Open Manage Publication**

2. **Configure scheduling**
   - **Action**: Publish
   - **When**: Select **"Later"**
   - **Activation Date**: Choose date and time
   - **Timezone**: Select appropriate timezone (important for global teams!)
   - **Targets**: Publish or Preview

3. **Set deactivation (optional)**
   - Click **"Include Deactivation Date"**
   - Set date and time for automatic unpublish

4. **Review and schedule**
   - Review settings
   - Click **Publish**
   - Content will publish at scheduled time

5. **Verify scheduled jobs**
   - Check Timeline view for scheduled activation
   - Use **Scheduled Activations** view to see all scheduled content

#### Publish to Both Preview and Publish

1. **Open Manage Publication**

2. **Configure for both tiers**
   - **Action**: Publish
   - **When**: Now or Later
   - **Targets**: Select **both "Preview" and "Publish"** checkboxes

3. **Publish**
   - Content distributes to both tiers simultaneously

### Advanced Options

#### Include References

- Check **"Include children"** to publish a page hierarchy
- Check **"Add reference"** to include assets/content fragments referenced by pages

#### Workflow Integration

- If workflows are configured, Manage Publication can trigger approval workflows
- Workflow must complete before content publishes

### Example Use Cases

```
# Preview workflow
1. Publish blog post to Preview tier
2. Send Preview URL to stakeholders for review
3. After approval, publish to Publish tier

# Scheduled campaign
1. Create marketing landing page
2. Schedule publication for campaign start date (8 AM EST)
3. Schedule deactivation for campaign end date (11:59 PM EST)

# Global content release
1. Select 50 pages for new product launch
2. Schedule for 9 AM in each timezone (use timezone selector)
3. Include all referenced assets
4. Publish to both Preview (for final QA) and Publish (for production)
```

## Method 3: Tree Activation

Bulk hierarchical publishing for large content structures.

### When to Use

- Publishing a complete site hierarchy
- Publishing large content trees
- Publishing 50+ pages at once

### Steps

1. **Navigate to parent page**
   - Go to Sites console
   - Navigate to the root of the tree

2. **Trigger Tree Activation**
   - Right-click on the parent page
   - Select **Manage Publication** > **Publish Tree**

3. **Configure Tree Activation**
   - **Dry Run**: Recommend checking this first to preview
   - **Only Modified**: Publish only pages modified since last activation
   - **Only Activated**: Publish only pages previously activated
   - **Ignore Deactivated**: Skip pages that were unpublished

4. **Select target tier**
   - Choose **Preview** or **Publish** tier

5. **Execute**
   - Review the list (if Dry Run was checked)
   - Click **Publish**

6. **Monitor progress**
   - Large trees may take time
   - Check Timeline view for status

### Best Practices

- **Dry Run first**: Always run with "Dry Run" to preview the scope
- **Batch size**: Limit to 500 pages maximum per Tree Activation
- **Off-peak hours**: Schedule large tree activations during low-traffic periods
- **Monitoring**: Watch system load during large tree activations

### Example Use Cases

```
# Bulk site publishing
- Tree activate entire /content/wknd site structure
- Use "Only Modified" to avoid re-publishing unchanged content

# New site launch
- Tree activate complete site hierarchy
- Include all children recursively
- Publish to Preview first for final QA
- Then Tree activate to Publish for go-live
```

## Method 4: Package Manager

Publish specific content sets using content packages.

### When to Use

- Precise content set distribution
- Cross-environment content sync
- Specific content deployment

### Steps

1. **Create content package**
   - Navigate to **Package Manager**: `/crx/packmgr`
   - Create new package
   - Add filters for specific content paths

2. **Build package**
   - Select the package
   - Click **Build**

3. **Replicate package**
   - Click **Replicate**
   - Package distributes to Publish tier

4. **Verify on Publish**
   - Access Publish tier Package Manager
   - Package should appear in the list

### Best Practices

- Use meaningful package names
- Document filters in package description
- Test on lower environments first

### Limitations

- **Publish tier only** (no Preview tier support)
- Requires Package Manager access
- Manual process (not workflow-integrated)

## Method 5: Workflows

Approval-based publishing using AEM workflows.

### When to Use

- Content requires approval before publishing
- Multi-step publishing process
- Integration with external systems

### Common Workflows

#### Request for Activation Workflow

1. **Initiate workflow**
   - Select content
   - Timeline panel > **Start Workflow**
   - Choose **"Request for Activation"**

2. **Approver reviews**
   - Approver receives notification in Inbox
   - Reviews content on Preview tier (if configured)
   - Approves or rejects

3. **Automatic publishing**
   - Upon approval, content publishes to Publish tier
   - Author receives notification

#### Custom Publishing Workflows

- Can integrate business logic
- Can publish to Preview, then Publish
- Can include external system notifications

### Configuration

Workflows must be configured by developers. See [Content Distribution API](../distribution-api/SKILL.md) for programmatic publishing in workflow steps.

## Unpublishing Content

Remove content from Publish or Preview tiers.

### Quick Unpublish

1. **Select content**
2. **Click "Quick Unpublish"** (or **Unpublish** in toolbar)
3. **Confirm**

Content immediately removed from Publish tier.

### Manage Publication - Unpublish

1. **Select content**
2. **Manage Publication**
3. **Action**: Select **"Unpublish"**
4. **Targets**: Select tier(s) to unpublish from (Preview, Publish, or both)
5. **When**: Now or Later (scheduled unpublish)
6. **Confirm and execute**

### Best Practices for Unpublishing

- **Preview cleanup**: Regularly unpublish old Preview content
- **Scheduled unpublish**: Use for time-limited campaigns
- **CDN cache**: Unpublishing triggers automatic CDN purge (content removed immediately)

## Publication Status

### Check Publication Status

1. **Column View**
   - Enable "Publication Status" column in Sites console
   - Shows: Not Published, Published, Modified, Unpublished

2. **Timeline View**
   - Select page
   - Open Timeline panel
   - See publication history

3. **Page Properties**
   - Open page properties
   - **Advanced** tab > **Publish Status**

### Publication Indicators

- **Green check**: Published
- **Yellow warning**: Published but modified (unpublished changes exist)
- **Gray circle**: Not published
- **Red X**: Unpublished

## Publishing Best Practices

### Content Authoring Best Practices

1. **Preview before Publish**
   - Always publish to Preview tier first
   - Review content on Preview URL
   - Get stakeholder approval
   - Then publish to Publish tier

2. **Use Manage Publication (not Quick Publish)**
   - More control
   - Preview tier support
   - Scheduling capability

3. **Include References**
   - Check "Add reference" when publishing pages
   - Ensures assets and content fragments are published

4. **Scheduled Publishing**
   - Use timezone selector for global content
   - Coordinate with marketing campaigns
   - Set deactivation dates for time-limited content

### Performance Best Practices

1. **Batch Size Limits**
   - Quick Publish: < 50 items
   - Manage Publication: < 100 items
   - Tree Activation: < 500 pages

2. **Off-Peak Publishing**
   - Schedule large publications during low-traffic periods
   - Avoid publishing during peak author usage

3. **Monitor Distribution**
   - Check Timeline view for distribution status
   - Watch for stuck content (see [Troubleshoot Distribution](../troubleshoot-distribution/SKILL.md))

### Security Best Practices

1. **Least Privilege**
   - Grant publish permissions only to authorized users
   - Use groups for permission management

2. **Preview Tier Access**
   - Preview tier requires authentication
   - Configure access for stakeholders and reviewers

3. **Audit Logging**
   - Publication events are logged
   - Review audit.log for publication activity

## Troubleshooting

### Content Not Appearing

**Problem**: Published content doesn't appear on Publish or Preview tier

**Solutions**:
1. Check publication status in Timeline view
2. Verify permissions (user must have publish rights)
3. Check for Sling job failures (Tools > Operations > Jobs)
4. See [Troubleshoot Distribution](../troubleshoot-distribution/SKILL.md) for detailed diagnosis

### Slow Publishing

**Problem**: Publishing takes longer than expected

**Solutions**:
1. Check Sling job queue depth (Tools > Operations > Jobs)
2. Reduce batch size
3. Schedule during off-peak hours
4. See [Troubleshoot Distribution](../troubleshoot-distribution/SKILL.md) for performance diagnosis

### Preview Tier Access Issues

**Problem**: Cannot access content on Preview tier

**Solutions**:
1. Verify Preview URL format: `https://preview-<program-id>-<environment-id>.adobeaemcloud.com`
2. Check authentication (Preview requires login)
3. Confirm content was published to Preview (not just Publish)

## Official Documentation

- [Publishing Pages](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/sites/authoring/sites-console/publishing-pages)
- [Managing Publication](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/sites/authoring/sites-console/managing-publication)
- [Preview Tier](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/using-cloud-manager/manage-environments)

## Related Skills

- **Preview Tier Management**: Detailed Preview tier workflows
- **Content Distribution API**: Programmatic publishing in custom code
- **Troubleshoot Distribution**: Diagnose publishing issues
