---
name: preview-tier
description: |
  Manage the Preview tier for content review, testing, and stakeholder approval.
  Covers Preview publishing workflows, Preview URLs, UAT testing, and Preview to Publish promotion.
---

# Preview Tier Management

Manage the Preview tier for content review, testing, and stakeholder approval.

## What is the Preview Tier?

The **Preview tier** is a production-like environment for content review BEFORE publishing to the Publish tier:

- **Purpose**: Content review, UAT testing, stakeholder approval
- **Architecture**: Separate tier between Author and Publish
- **Access**: Requires authentication (not public)
- **URL Format**: `https://preview-<program-id>-<environment-id>.adobeaemcloud.com`
- **CDN**: Uses same Adobe CDN as Publish tier

**Key Difference from Publish Tier**: Preview requires authentication and is not publicly accessible.

## When to Use Preview Tier

### Use Preview When:

- **Stakeholder Review**: Marketing/legal team needs to review content before go-live
- **UAT Testing**: QA team needs to test content in production-like environment
- **Campaign Preview**: Preview marketing campaigns before launch
- **Content Approval**: Approval workflow requires review before publishing
- **A/B Testing Prep**: Test variations before production deployment

### Don't Use Preview When:

- **Simple corrections**: Minor typo fixes can go directly to Publish
- **Urgent hotfixes**: Critical fixes should skip Preview (use Quick Publish to Publish)
- **Internal-only content**: Use Author environment for internal review

## Preview Publishing Workflows

### Workflow 1: Preview First, Then Publish

**Recommended workflow** for most content:

1. **Author creates/updates content**
   - Create content on Author
   - Save changes

2. **Publish to Preview**
   - Select content
   - **Manage Publication** > Select **"Preview"** tier
   - Click **Publish**

3. **Review on Preview**
   - Access Preview URL
   - Stakeholders review content
   - Provide feedback if needed

4. **Make corrections (if needed)**
   - Author makes changes
   - Republish to Preview
   - Re-review

5. **Publish to Publish tier**
   - After approval, select content
   - **Manage Publication** > Select **"Publish"** tier
   - Click **Publish**

**Timeline Example**:
```
Monday 9 AM:  Publish to Preview
Monday 10 AM: Send Preview URL to stakeholders
Tuesday 2 PM: Receive approval
Tuesday 3 PM: Publish to Publish tier (go-live)
```

### Workflow 2: Publish to Both Preview and Publish Simultaneously

**Use when**: Content doesn't require separate review

1. **Select content**
2. **Manage Publication**
3. **Targets**: Check **both "Preview" and "Publish"** boxes
4. **Publish**

Content appears on both tiers simultaneously.

### Workflow 3: Scheduled Preview, Then Scheduled Publish

**Use for**: Coordinated campaign launches

1. **Schedule Preview publication**
   - **Manage Publication** > **Later**
   - Set Preview date (e.g., Friday 9 AM for team review)
   - Target: **Preview**

2. **Schedule Publish publication**
   - **Manage Publication** > **Later**
   - Set Publish date (e.g., Monday 9 AM for go-live)
   - Target: **Publish**

3. **Team reviews over weekend**
   - Content appears on Preview Friday 9 AM
   - Team reviews and approves
   - Content auto-publishes to Publish Monday 9 AM

## Accessing Preview Content

### Preview URLs

Preview tier uses a specific URL pattern:

```
Format: https://preview-<program-id>-<environment-id>.adobeaemcloud.com<content-path>

Example:
Publish URL:  https://publish-p12345-e67890.adobeaemcloud.com/content/wknd/en.html
Preview URL:  https://preview-p12345-e67890.adobeaemcloud.com/content/wknd/en.html
                      ^^^^^^^^ (only difference)
```

**Finding Your Preview URL**:
1. Go to Cloud Manager
2. Select your environment
3. Find **Preview** service URL

### Authentication

Preview tier **requires authentication**:

- Users must log in with AEM credentials
- Configure access via User Management
- Grant "Read" permissions for reviewers who don't need Author access

**Granting Preview Access**:
1. Navigate to **Tools** > **Security** > **Users**
2. Create user or select existing user
3. Add user to group with read permissions (e.g., `content-authors`)
4. User can now log in to Preview tier

### Preview Button in Sites Console

Quick access to Preview from Sites console:

1. Select page in Sites console
2. Click **"View as Published"** dropdown
3. Select **"Preview"**
4. Page opens in Preview tier

## Preview-Specific Testing

### UAT Testing on Preview

**Setup**:
1. Publish test content to Preview
2. Grant QA team access to Preview tier
3. Provide Preview URLs for test pages

**QA Checklist**:
- Verify content renders correctly
- Test forms and interactions
- Check responsive design (mobile, tablet, desktop)
- Verify assets load correctly
- Test navigation and links
- Check SEO metadata (preview in source)

**Reporting Issues**:
- QA logs issues in tracking system
- Authors fix on Author tier
- Republish to Preview for re-testing

### Stakeholder Review on Preview

**Setup**:
1. Publish content to Preview
2. Share Preview URLs via email or Slack
3. Set review deadline

**Review Process**:
- Stakeholder reviews content on Preview
- Provides feedback via comments or tracking system
- Author makes revisions
- Republish to Preview for final approval

**Approval**:
- Stakeholder approves via email/tracking system
- Author publishes to Publish tier

### Marketing Campaign Preview

**Pre-Launch Checklist**:
- [ ] Landing page renders correctly on Preview
- [ ] All assets load (images, videos)
- [ ] Forms submit correctly
- [ ] Call-to-action buttons work
- [ ] Analytics tracking is configured
- [ ] Mobile experience is optimized
- [ ] Legal/compliance review complete

**Campaign Launch**:
- After all checks pass on Preview
- Schedule publication to Publish for campaign start time

## Preview Content Management

### Cleaning Up Preview Content

Preview tier can accumulate old content. Regular cleanup is recommended.

**When to Clean Up**:
- After campaign ends
- After major site changes
- Monthly maintenance

**Unpublishing from Preview**:
1. Navigate to Sites console
2. Select content to unpublish
3. **Manage Publication** > **Unpublish**
4. **Targets**: Select **"Preview"**
5. Click **Unpublish**

**Bulk Cleanup**:
- Use Tree Activation for hierarchical unpublish
- Or use Package Manager to remove large content sets

### Preview Content Expiration

**Best Practice**: Set deactivation dates when publishing to Preview

1. **Manage Publication** > **Later**
2. Enable **"Deactivation Date"**
3. Set expiration date (e.g., 30 days after publication)
4. Content auto-unpublishes from Preview after expiration

## Preview Analytics and Monitoring

### Tracking Preview Usage

**Use Cases**:
- Track stakeholder engagement with Preview content
- Measure time spent reviewing
- Monitor Preview tier traffic patterns

**Setup** (requires Adobe Analytics):
- Configure separate report suite for Preview
- Use Preview tier URL to segment traffic
- Track page views, time on page, and interactions

**Metrics to Track**:
- Preview page views
- Unique reviewers
- Time spent on Preview pages
- Review completion rate

### Monitoring Preview Tier Health

**Cloud Manager Monitoring**:
- View Preview tier status in Cloud Manager
- Monitor uptime and availability
- Check for errors in Preview logs

**Performance Monitoring**:
- Preview tier performance should match Publish tier
- If Preview is slow, investigate CDN or content issues
- Use Chrome DevTools to profile page load times

## Preview vs. Publish: Key Differences

| Aspect | Preview Tier | Publish Tier |
|--------|--------------|--------------|
| **Access** | Authenticated (login required) | Public (no login) |
| **Purpose** | Content review, UAT, approval | Production content delivery |
| **CDN** | Adobe CDN (same as Publish) | Adobe CDN |
| **URL** | `preview-*.adobeaemcloud.com` | `publish-*.adobeaemcloud.com` or custom domain |
| **Analytics** | Optional (separate report suite) | Production analytics |
| **Indexing** | Not indexed by search engines | Indexed by search engines (if allowed) |

## Best Practices

### Content Review Best Practices

1. **Always Preview First**
   - Never publish directly to Publish without Preview review for important content
   - Use Preview as a safety net

2. **Set Review Deadlines**
   - Define clear timelines for Preview review
   - Use scheduled publishing to enforce deadlines

3. **Document Approval**
   - Track who approved content and when
   - Use workflow tools or email trails

4. **Test Thoroughly**
   - Test all interactive elements on Preview
   - Check mobile responsiveness
   - Verify asset loading

### Access Management Best Practices

1. **Least Privilege**
   - Grant Preview access only to users who need it
   - Use groups for permission management

2. **External Reviewers**
   - Create temporary accounts for external stakeholders
   - Disable accounts after review period ends

3. **Read-Only Access**
   - Reviewers typically only need read access
   - Don't grant Author access unless necessary

### Content Lifecycle Best Practices

1. **Preview Cleanup**
   - Regularly unpublish old Preview content
   - Set automatic expiration dates

2. **Parallel Publishing**
   - For evergreen content, publish to both Preview and Publish simultaneously
   - For campaign content, use Preview-first workflow

3. **Emergency Publishing**
   - For critical hotfixes, skip Preview and publish directly to Publish
   - Document why Preview was skipped

## Troubleshooting

### Cannot Access Preview URL

**Problem**: Preview URL returns 404 or authentication error

**Solutions**:
1. Verify content was published to Preview (not just Publish)
   - Check Timeline view > Filter by "Preview"
2. Verify Preview URL format is correct
   - Must be `preview-*` not `publish-*`
3. Check user authentication
   - Ensure user has Preview tier access
4. Check Cloud Manager
   - Verify Preview tier is running

### Content Not Appearing on Preview

**Problem**: Published to Preview but content doesn't appear

**Solutions**:
1. Check publication status
   - Timeline view > Filter by "Preview"
   - Verify "Publication successful" message
2. Check Sling job status
   - Tools > Operations > Jobs
   - Look for failed jobs
3. Clear browser cache
   - Preview CDN may have cached old version
4. See [Troubleshoot Distribution](../troubleshoot-distribution/SKILL.md) for detailed diagnosis

### Preview Different from Publish

**Problem**: Content looks different on Preview vs. Publish

**Solutions**:
1. Check publication dates
   - Preview and Publish may have different versions
   - Republish to sync
2. Check client libraries
   - Ensure clientlibs are published to both tiers
3. Check content references
   - Ensure all referenced assets are published to both tiers

## Preview Tier Architecture

### Technical Details

- **Dispatcher Configuration**: Same as Publish tier
- **CDN**: Same Adobe CDN as Publish, different hostname
- **Scaling**: Scales independently of Publish tier
- **SLA**: Same SLA as Publish tier

### Environment-Specific URLs

| Environment | Preview URL |
|-------------|-------------|
| Dev | `https://preview-p<program>-e<dev-env>.adobeaemcloud.com` |
| Stage | `https://preview-p<program>-e<stage-env>.adobeaemcloud.com` |
| Production | `https://preview-p<program>-e<prod-env>.adobeaemcloud.com` |

Each environment has its own Preview tier.

## Official Documentation

- [Preview Tier Overview](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/using-cloud-manager/manage-environments)
- [Managing Publication](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/sites/authoring/sites-console/managing-publication)
- [User Management](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/security/ims-support)

## Related Skills

- **Publish Content**: Core publishing workflows
- **Content Distribution API**: Programmatic Preview publishing
- **Troubleshoot Distribution**: Diagnose Preview tier issues
