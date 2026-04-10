# Cloud Service Guardrails

Rate limits, best practices, and constraints for content distribution in AEM as a Cloud Service.

## Publishing Guardrails

### Batch Size Limits

**Recommended Limits**:
- **Quick Publish**: < 50 items per operation
- **Manage Publication**: < 100 items per operation  
- **Tree Activation**: < 500 pages per operation
- **API bulk operations**: < 100 paths per API call

**Why**: Large batches can:
- Exhaust system memory
- Block other operations
- Cause timeouts
- Degrade system performance

**Best Practice**: Batch operations with commits every 50-100 items

### Publication Rate Limits

**Author Tier**:
- **Concurrent publications**: Limit to 5-10 concurrent Manage Publication operations
- **API calls**: Max 100 requests/minute per user
- **Bulk operations**: Space out batches by 30-60 seconds

**Why**: Too many concurrent operations can:
- Saturate Sling job queue
- Cause memory pressure
- Impact other authors

**Best Practice**: Schedule bulk publications during off-peak hours

### Content Size Limits

**Single Asset**:
- **Recommended max**: 2 GB per asset
- **Soft limit**: 5 GB (may experience timeouts)
- **Distribution time**: ~1 minute per 100 MB

**Page Size**:
- **Recommended**: < 10 MB per page (including referenced assets)
- **Component limit**: < 100 components per page

**Why**: Large content:
- Takes longer to distribute
- Increases memory usage
- May timeout during distribution

**Best Practice**: 
- Use Dynamic Media for large assets
- Optimize images before upload
- Split large pages into smaller sections

## System Resource Guardrails

### CPU and Memory

**Author Tier** (per environment tier):
- **Baseline**: 4 vCPU, 16 GB RAM
- **Standard**: 8 vCPU, 32 GB RAM
- **Enhanced**: 16 vCPU, 64 GB RAM

**Publish Tier** (auto-scaling):
- **Min instances**: 2
- **Max instances**: Varies by tier
- **Auto-scale triggers**: CPU > 70%, Memory > 80%

**Best Practice**: 
- Monitor utilization in Cloud Manager
- Upgrade tier if consistently high utilization
- Optimize content and code for efficiency

### Storage

**Per Environment**:
- **Content Repository**: No hard limit (pay-per-use)
- **Recommended**: Monitor and archive old content
- **Asset storage**: Recommend using Dynamic Media for DAM assets

**Best Practice**:
- Regular content cleanup
- Archive old/unused content
- Use content packages for backup, not long-term storage

### Sling Job Queue

**Queue Depth Targets**:
- **Normal**: < 10 jobs in queue
- **Warning**: 20-50 jobs (may experience delays)
- **Critical**: > 50 jobs (immediate action needed)

**Job Processing Time**:
- **Target**: < 30 seconds per job
- **Warning**: > 60 seconds (investigate cause)

**Best Practice**:
- Monitor queue depth regularly
- Investigate jobs taking > 60 seconds
- Reduce batch size if queue depth grows

## CDN and Caching Guardrails

### Cache TTL Recommendations

**Content Type** | **Recommended TTL** | **Cache-Control Header**
---|---|---
Static pages | 1 hour | `public, max-age=3600`
Frequently updated | 5 minutes | `public, max-age=300`
Personalized | No cache | `private, no-cache`
Static assets (images/CSS/JS) | 1 day | `public, max-age=86400`
Client libraries | 1 year (versioned URLs) | `public, max-age=31536000, immutable`

**Best Practice**:
- Use longer TTLs for rarely changing content
- Version URLs for long-cached assets (clientlibs)
- Use private cache for personalized content

### CDN Purge Limits

**Automatic Purge**:
- Triggered on content publication
- No limit on automatic purges
- Typically completes in < 30 seconds

**Manual Purge** (via Cloud Manager API):
- **Rate limit**: 100 purge requests per hour
- **Paths per request**: < 100 paths
- **Full site purge**: Contact Adobe Support

**Best Practice**:
- Rely on automatic purge (no action needed)
- Use manual purge only for emergencies
- Purge specific paths, not entire site

### CDN Bandwidth

**No explicit limit**: Adobe CDN scales automatically

**Cost Implications**:
- High bandwidth incurs additional costs
- Monitor via Cloud Manager
- Optimize assets to reduce bandwidth

**Best Practice**:
- Use image optimization (WebP, responsive images)
- Enable compression (gzip/brotli)
- Leverage Dynamic Media for assets

## API and Programmatic Publishing Guardrails

### Service User Permissions

**Principle of Least Privilege**:
- Grant minimal required permissions
- Restrict to specific content paths
- Use read-only where possible

**Example Safe Configuration**:
```
set ACL for content-publisher
    allow jcr:read,rep:write on /content/wknd
    deny jcr:all on /content/wknd/sensitive
end
```

**Avoid**:
- Granting admin permissions
- Unrestricted paths (`/`)
- Overly broad permissions

### API Rate Limits

**REST API**:
- **Authenticated**: 100 requests/minute
- **Unauthenticated**: 10 requests/minute
- **Burst**: 200 requests in 10 seconds

**Replication API (JCR-based)**:
- No explicit rate limit
- Practical limit: ~10 publications/second
- Sling job queue is the bottleneck

**Best Practice**:
- Implement retry with exponential backoff
- Batch operations where possible
- Use async publishing for bulk operations

### Workflow Limitations

**Concurrent Workflows**:
- **Recommended**: < 50 active workflows
- **Warning**: > 100 (may cause performance issues)

**Workflow Duration**:
- **Target**: < 5 minutes
- **Timeout**: 60 minutes (hard limit)

**Best Practice**:
- Keep workflows simple and fast
- Use async steps for long-running operations
- Monitor workflow queue depth

## Preview Tier Guardrails

### Access Control

**Authentication Required**:
- All Preview tier access requires authentication
- No public access
- Configure via IMS or SAML

**User Limits**:
- **Recommended**: < 100 concurrent Preview users
- **License-based**: Check contract for limits

**Best Practice**:
- Create read-only accounts for reviewers
- Disable accounts after review period
- Use groups for permission management

### Content Lifetime on Preview

**No automatic expiration**: Content remains until unpublished

**Best Practice**:
- Regularly clean up old Preview content
- Set expiration dates when publishing to Preview
- Monthly Preview content audit

**Example Cleanup Process**:
1. Query content last published > 90 days ago
2. Review for relevance
3. Unpublish old/unused content

## Monitoring and Alerting Thresholds

### Key Metrics to Monitor

**System Health**:
- CPU utilization > 80% (warning)
- Memory utilization > 90% (critical)
- Disk usage > 85% (warning)

**Content Distribution**:
- Sling job queue depth > 20 (warning)
- Job processing time > 60s (investigate)
- Failed jobs > 0 (alert)

**CDN Performance**:
- Cache hit rate < 70% (investigate)
- Origin traffic spike > 2x baseline (alert)
- 5xx error rate > 1% (critical)

### Recommended Alerts

**Configure via Cloud Manager**:
1. High CPU/memory utilization
2. Service unavailability
3. Error rate threshold exceeded
4. Deployment failures

**Custom Alerts** (via log monitoring):
1. Replication errors
2. Permission denied errors
3. Job queue backup
4. CDN purge failures

## Capacity Planning

### Sizing Recommendations

**Author Tier**:
- **5-20 authors**: Baseline tier
- **20-50 authors**: Standard tier
- **50+ authors**: Enhanced tier

**Publish Tier**:
- Automatically scales
- Configure min/max instances based on traffic

**Storage**:
- Plan for 10-20% annual growth
- Consider Dynamic Media for large DAM

### Traffic Estimation

**Publish Tier Capacity** (per instance):
- **Page views**: ~100 requests/second
- **Asset requests**: ~500 requests/second
- **API calls**: ~50 requests/second

**Best Practice**:
- Load test on Stage before Production
- Plan for 2-3x peak traffic
- Use CDN caching to reduce origin load

## Official Documentation

- [AEM as a Cloud Service Service Limits](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/overview/service-limits)
- [Performance Guidelines](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/developing/development-guidelines)
- [Monitoring Best Practices](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/using-cloud-manager/manage-environments)
