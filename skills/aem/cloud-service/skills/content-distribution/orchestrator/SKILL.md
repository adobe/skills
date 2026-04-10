---
name: content-distribution-orchestrator
description: |
  Orchestrates end-to-end content distribution workflows spanning publishing, Preview tier,
  troubleshooting, and CDN optimization. Coordinates complex scenarios like go-live preparation
  and production incident response.
---

# Content Distribution Orchestrator

Coordinates complex content distribution workflows that span multiple sub-skills.

## When to Use This Skill

Use the orchestrator for multi-step scenarios requiring coordination:
- **Go-Live Preparation**: Configure Preview → Test workflows → CDN warmup → Launch
- **Production Incidents**: Diagnose → Fix → Clear CDN → Verify
- **CDN Optimization**: Analyze cache → Configure rules → Validate performance

For single-concern tasks, use the specific sub-skill directly.

## Workflow 1: Site Go-Live Preparation

End-to-end workflow for launching a new site on Cloud Service.

### Prerequisites

- Author, Preview, and Publish tiers running
- Content authored and ready
- Development complete (components, templates)
- DNS configured for production domain

### Timeline

**Recommended**: 2 weeks before go-live

### Steps

#### Phase 1: Content Preparation (Week 1)

**Day 1-3: Content Review and Publishing to Preview**

**Delegate to:** [publish-content](../publish-content/SKILL.md)

1. **Audit content readiness**
   - All pages authored
   - All assets uploaded
   - Content complete and approved

2. **Bulk publish to Preview tier**
   - Use Manage Publication
   - Select root content path
   - Target: Preview tier
   - Include all children and references

3. **Verify on Preview**
   - Test all key pages
   - Verify assets load
   - Check navigation

**Day 4-7: Preview Tier Testing**

**Delegate to:** [preview-tier](../preview-tier/SKILL.md)

1. **UAT Testing on Preview**
   - QA team tests all functionality
   - Verify responsive design
   - Test forms and interactions
   - Check cross-browser compatibility

2. **Stakeholder Review**
   - Share Preview URLs with stakeholders
   - Gather feedback
   - Address issues

3. **Performance Testing**
   - Load test Preview tier
   - Measure page load times
   - Optimize as needed

**Checkpoint**: All content approved, UAT passed, performance acceptable

#### Phase 2: Pre-Launch Configuration (Week 2)

**Day 8-10: CDN Configuration**

1. **Verify CDN settings**
   - Check cache headers (Cache-Control)
   - Configure cache TTLs
   - Set up custom cache rules if needed

2. **Configure custom domain**
   - Update DNS CNAME records
   - Verify SSL certificate
   - Test domain resolution

3. **CDN warmup (optional)**
   - Pre-cache key pages
   - Warm up edge servers
   - Reduce go-live load

**Day 11-12: Final Content Publishing**

**Delegate to:** [publish-content](../publish-content/SKILL.md)

1. **Schedule content publication**
   - Use Manage Publication > Later
   - Schedule for go-live date/time
   - Target: Publish tier
   - Set timezone appropriately

2. **Verify scheduled jobs**
   - Check Timeline view
   - Verify all content scheduled
   - Review scheduled activation list

**Day 13-14: Go-Live Day**

1. **Monitor publication**
   - Watch Sling job queue
   - Monitor system health
   - Verify content appears on Publish

2. **Verify CDN**
   - Test production URLs
   - Verify cache headers
   - Check page load times

3. **Post-launch monitoring**
   - Monitor error logs
   - Track system metrics
   - Watch for issues

### Success Criteria

- [ ] All content published to Publish tier
- [ ] Production domain resolves correctly
- [ ] CDN serving content with correct cache headers
- [ ] Page load times < 3 seconds
- [ ] No errors in logs for 1 hour post-launch
- [ ] Stakeholders can access site
- [ ] Analytics tracking confirmed

### Rollback Plan

If issues occur during go-live:

1. **DNS rollback**
   - Revert DNS to previous site
   - Update CNAME records

2. **Content rollback**
   - Unpublish problematic content
   - Or unpublish entire site if severe

3. **Communication**
   - Notify stakeholders
   - Document issues
   - Plan remediation

## Workflow 2: Production Incident Response

End-to-end workflow for responding to content distribution incidents.

### Incident Severity Levels

**P1 (Critical)**: Complete site down or major functionality broken
- Response time: Immediate
- Resolution target: < 2 hours

**P2 (High)**: Significant functionality impaired, affects multiple users
- Response time: < 1 hour
- Resolution target: < 8 hours

**P3 (Medium)**: Minor functionality issues, workarounds available
- Response time: < 4 hours
- Resolution target: < 24 hours

### Incident Response Steps

#### Step 1: Triage and Assessment (15 minutes)

1. **Gather incident details**
   - What is broken? (specific pages, entire site, Preview/Publish)
   - When did it start? (timestamp)
   - What changed recently? (deployments, configuration, content)

2. **Assess impact**
   - How many users affected?
   - Which tier affected? (Author, Preview, Publish)
   - Is it partial or complete failure?

3. **Determine severity**
   - Use severity levels above
   - Escalate to management if P1

#### Step 2: Diagnose Root Cause (30-60 minutes)

**Delegate to:** [troubleshoot-distribution](../troubleshoot-distribution/SKILL.md)

1. **Check content distribution**
   - Is content published? (Timeline view)
   - Are Sling jobs failing? (/system/console/slingjobs)
   - Check error logs for exceptions

2. **Check CDN**
   - Is CDN serving stale content? (curl -I)
   - Check X-Cache headers
   - Compare Publish tier vs CDN

3. **Check system health**
   - Cloud Manager monitoring
   - CPU/memory utilization
   - Service availability

4. **Identify root cause**
   - Sling job failure → Permission or system issue
   - CDN cache issue → Auto-purge failure
   - System overload → Capacity issue
   - Deployment issue → Code or configuration bug

#### Step 3: Implement Fix (Variable)

**Based on root cause:**

**Sling Job Failure:**
```bash
# Fix permissions (if AccessDeniedException)
# Delegate to: troubleshoot-distribution

1. Grant required permissions to service user
2. Retry failed jobs
3. Republish content if needed
```

**CDN Cache Issue:**
```bash
# Manual CDN purge
# Delegate to: troubleshoot-distribution

1. Identify affected content paths
2. Submit CDN purge request via Cloud Manager API
3. Verify content refreshed (curl -I)
4. Monitor for recurrence
```

**System Overload:**
```bash
# Reduce load

1. Pause bulk publishing operations
2. Monitor system recovery
3. Resume operations when stable
4. Contact Adobe Support if persistent
```

**Code/Configuration Issue:**
```bash
# Rollback deployment

1. Use Cloud Manager to rollback to previous version
2. Verify issue resolved
3. Fix code/configuration in lower environment
4. Re-deploy when ready
```

#### Step 4: Verify Resolution (15-30 minutes)

1. **Test affected functionality**
   - Verify content appears correctly
   - Test user workflows
   - Check all affected pages

2. **Monitor system**
   - Watch error logs for 30 minutes
   - Monitor Sling job queue
   - Check system metrics

3. **Verify with users**
   - Get confirmation from reporting users
   - Or test from user's perspective

#### Step 5: Post-Incident Review (Within 48 hours)

1. **Document incident**
   - Timeline of events
   - Root cause analysis
   - Resolution steps taken
   - Time to detect, time to resolve

2. **Identify improvements**
   - What early warnings were missed?
   - How can we prevent recurrence?
   - What monitoring should be added?

3. **Update runbooks**
   - Document new troubleshooting patterns
   - Update diagnostic procedures
   - Share learnings with team

### Incident Communication Template

```
Subject: [P{severity}] Content Distribution Incident - {brief description}

Detected: {timestamp}
Impact: {description of user impact}
Status: Investigating | Fixing | Resolved

Root Cause: {preliminary or confirmed}

Actions Taken:
1. {action 1}
2. {action 2}

Next Steps:
1. {next step 1}
2. {next step 2}

ETA for Resolution: {estimate}

Will provide updates every {interval}
```

## Workflow 3: CDN Cache Optimization

End-to-end workflow for optimizing CDN cache performance.

### Goals

- Increase cache hit rate (target: >80%)
- Reduce origin traffic
- Improve page load times
- Reduce Cloud Service costs

### Steps

#### Step 1: Baseline Measurement (1 week)

1. **Measure current performance**
   - CDN cache hit rate
   - Average page load time
   - Origin request volume
   - Traffic patterns

2. **Identify cacheable content**
   - Static pages (about, contact, etc.)
   - Images and assets
   - Client libraries (CSS/JS)
   - Content Fragments for APIs

3. **Identify non-cacheable content**
   - Personalized pages
   - User-specific content
   - Forms with CSRF tokens
   - Admin pages

#### Step 2: Configure Cache Headers

1. **Set appropriate Cache-Control headers**

**For static pages:**
```
Cache-Control: public, max-age=3600, s-maxage=3600
```

**For frequently updated content:**
```
Cache-Control: public, max-age=300, s-maxage=300
```

**For personalized content:**
```
Cache-Control: private, no-cache
```

2. **Configure Dispatcher cache rules**

```apache
# File: dispatcher/src/conf.dispatcher.d/cache/rules.any

/0001 {
  /glob "*"
  /type "allow"
}

# Don't cache user-specific content
/0002 {
  /glob "/content/userdata/*"
  /type "deny"
}
```

#### Step 3: Implement Client Library Versioning

```xml
<!-- ui.apps/.content.xml -->
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0"
    allowProxy="{Boolean}true"
    longCacheKey="{String}wknd-v2"/>
```

This generates versioned URLs:
```
/etc.clientlibs/wknd/clientlibs/clientlib-site.lc-abc123def456-lc.min.css
```

#### Step 4: Configure Image Optimization

Use Dynamic Media or Image Delivery API for automatic optimization:
- WebP format conversion
- Responsive image sizing
- Lazy loading

#### Step 5: Measure Improvements

1. **Re-measure performance** (after 1 week)
   - CDN cache hit rate (target: >80%)
   - Page load time improvement
   - Origin traffic reduction

2. **Compare metrics**
   - Before vs after cache optimization
   - Calculate cost savings

3. **Iterate if needed**
   - Identify remaining cache misses
   - Fine-tune cache rules
   - Optimize additional content

### Expected Improvements

- **Cache hit rate**: 50% → 80-90%
- **Page load time**: 30-50% reduction
- **Origin traffic**: 50-70% reduction
- **Cost savings**: 20-40% reduction in Cloud Service costs

## Cross-Skill Coordination

The orchestrator coordinates across specialist skills:

- **Publish Content**: [publish-content/SKILL.md](../publish-content/SKILL.md)
- **Preview Tier**: [preview-tier/SKILL.md](../preview-tier/SKILL.md)
- **Distribution API**: [distribution-api/SKILL.md](../distribution-api/SKILL.md)
- **Troubleshoot**: [troubleshoot-distribution/SKILL.md](../troubleshoot-distribution/SKILL.md)

## Official Documentation

- [Replication in Cloud Service](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/operations/replication)
- [Cloud Manager](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-manager/content/introduction)
- [CDN in Cloud Service](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/cdn)
