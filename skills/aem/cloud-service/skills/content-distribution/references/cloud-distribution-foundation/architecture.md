# Cloud Service Architecture

Content distribution architecture in AEM as a Cloud Service.

## Three-Tier Architecture

AEM as a Cloud Service uses a three-tier architecture:

```
┌─────────┐      ┌─────────┐      ┌─────────┐
│ Author  │─────>│ Preview │      │ Publish │
│  Tier   │      │  Tier   │      │  Tier   │
└─────────┘      └─────────┘      └─────────┘
     │                │                 │
     │                └─────────────────┘
     │                         │
     └─────────────────────────┘
                    │
              ┌──────────┐
              │ Adobe CDN│
              └──────────┘
```

### Author Tier

**Purpose**: Content authoring and management

**Characteristics**:
- Authenticated access only
- Content creation and editing
- Workflow management
- Asset management
- Administrative functions

**URL Format**: `https://author-p{program}-e{env}.adobeaemcloud.com`

### Preview Tier (Cloud Service Exclusive)

**Purpose**: Content review and testing before production

**Characteristics**:
- Authenticated access (not public)
- Production-like environment
- Separate from Publish tier
- Used for UAT, stakeholder review, content approval
- Same CDN as Publish (different hostname)

**URL Format**: `https://preview-p{program}-e{env}.adobeaemcloud.com`

**Key Differences from 6.5 LTS**: Preview tier doesn't exist in 6.5 LTS

### Publish Tier

**Purpose**: Public content delivery

**Characteristics**:
- Public access (no authentication required)
- Read-only (no content editing)
- High availability
- Auto-scaling
- CDN-backed for global delivery

**URL Format**: `https://publish-p{program}-e{env}.adobeaemcloud.com`

## Content Distribution Flow

### Standard Flow

```
1. Author creates/updates content on Author tier
2. Author publishes content (Manage Publication)
3. Sling Content Distribution automatically replicates content
4. Content appears on target tier (Preview or Publish)
5. CDN caches content for fast delivery
```

### Detailed Flow

```
Author Tier                    Preview/Publish Tier
┌────────────────┐            ┌────────────────────┐
│ Content Change │            │                    │
│       │        │            │                    │
│       v        │            │                    │
│  Set           │            │                    │
│  Replication   │            │                    │
│  Properties    │            │                    │
│       │        │            │                    │
│       v        │            │                    │
│  Save Session  │──────────> │  Sling Content     │
│       │        │   Auto     │  Distribution      │
│       │        │  Detect    │  (Automatic)       │
│       │        │            │       │            │
│       │        │            │       v            │
│       │        │            │  Content           │
│       │        │            │  Synchronized      │
│       │        │            │       │            │
└────────────────┘            │       v            │
                              │  CDN Cache         │
                              │  Invalidated       │
                              └────────────────────┘
```

## Sling Content Distribution

### What is Sling Content Distribution?

Sling Content Distribution is the **automatic** content synchronization mechanism in Cloud Service.

**Key Characteristics**:
- **Automatic**: No manual agent configuration required
- **Managed by Adobe**: Infrastructure fully managed
- **Event-driven**: Triggered by JCR events
- **Reliable**: Built-in retry and error handling
- **Scalable**: Automatically scales with load

### How It Works

1. **Content Change Detection**
   - Author saves content
   - JCR event triggered
   - Distribution agent detects change

2. **Content Packaging**
   - Content serialized into distribution package
   - Includes content nodes, properties, binaries

3. **Transport**
   - Package sent to target tier (Preview or Publish)
   - Secured via internal network
   - Compressed for efficiency

4. **Content Application**
   - Target tier receives package
   - Content deserialized
   - Applied to JCR repository

5. **CDN Invalidation**
   - Automatic CDN cache purge
   - Ensures fresh content served

### Distribution vs. Replication (6.5 LTS)

| Aspect | 6.5 LTS Replication | Cloud Service Distribution |
|--------|---------------------|---------------------------|
| **Configuration** | Manual agent setup required | Automatic (no configuration) |
| **Agent Management** | Admin maintains agents | Adobe manages |
| **Queues** | Visible, manually manageable | Hidden (managed by platform) |
| **Retry Logic** | Configurable | Built-in (automatic) |
| **Dispatcher Flush** | Separate flush agents | Automatic CDN purge |
| **API** | `com.day.cq.replication.*` | JCR-based + OSGi events |

## Adobe CDN Integration

### CDN Architecture

```
┌──────────────────────────────────────────┐
│          Adobe CDN (Fastly)              │
│                                          │
│  ┌──────────┐  ┌──────────┐  ┌────────┐│
│  │ Edge EU  │  │ Edge US  │  │Edge APAC││
│  └──────────┘  └──────────┘  └────────┘│
│       │              │            │     │
└───────┼──────────────┼────────────┼─────┘
        │              │            │
        └──────────────┼────────────┘
                       │
              ┌────────────────┐
              │  Publish Tier  │
              │  (Origin)      │
              └────────────────┘
```

### CDN Features

**Automatic Cache Management**:
- Cache-Control header respected
- Automatic cache invalidation on content updates
- No manual Dispatcher Flush agents needed

**Global Distribution**:
- Edge servers in multiple regions
- Low latency for global users
- Automatic failover

**Security**:
- DDoS protection
- WAF (Web Application Firewall)
- SSL/TLS termination

**Performance**:
- HTTP/2 and HTTP/3 support
- Compression (gzip, brotli)
- Image optimization

### Cache Invalidation

**Automatic Purge on Publication**:
1. Content published on Author
2. Sling Distribution replicates to Publish
3. CDN automatically purges cached version
4. Next request fetches fresh content from origin
5. CDN caches new version

**Manual Purge** (if needed):
- Use Cloud Manager API
- Purge specific paths or entire site
- Emergency cache clear

## Environment Types

### Development Environment

**Purpose**: Development and testing

**Characteristics**:
- Author, Preview, Publish tiers
- Lower capacity than Production
- Used for feature development
- Frequent deployments

### Stage Environment

**Purpose**: Pre-production testing

**Characteristics**:
- Mirrors Production architecture
- Similar capacity to Production
- UAT and performance testing
- Stakeholder review

### Production Environment

**Purpose**: Live site serving end users

**Characteristics**:
- Full capacity
- High availability
- Monitored 24/7
- Controlled deployments

## Scaling and High Availability

### Auto-Scaling

**Publish Tier**:
- Automatically scales based on traffic
- Adds/removes instances as needed
- No manual intervention required

**Author Tier**:
- Fixed capacity (per environment tier)
- Can be upgraded via Cloud Manager

### High Availability

**Multi-AZ Deployment**:
- Instances across multiple availability zones
- Automatic failover
- 99.9% uptime SLA

**CDN Failover**:
- Multiple CDN edge servers
- Automatic routing to healthy edges
- Origin failover to backup

## Monitoring and Observability

### Cloud Manager Monitoring

- CPU and memory utilization
- Request rates and latency
- Error rates
- CDN cache hit rates

### Logs

- `error.log`: Application errors
- `access.log`: Request logs
- `replication.log`: Distribution events
- `audit.log`: Security and admin actions

### Metrics

- Page load times
- Content distribution latency
- System health metrics
- Custom application metrics

## Security Architecture

### Authentication and Authorization

**Author Tier**:
- IMS (Identity Management System) authentication
- SAML/SSO support
- Fine-grained ACLs

**Preview Tier**:
- Same authentication as Author
- Read-only for reviewers
- Configurable access control

**Publish Tier**:
- Public access (no authentication by default)
- Optional authentication for protected content
- Closed User Groups (CUGs) for restricted areas

### Network Security

**Internal Communication**:
- TLS encryption between tiers
- Private network (not public internet)
- Adobe-managed infrastructure

**External Access**:
- TLS/SSL required
- DDoS protection via CDN
- WAF for threat prevention

## Official Documentation

- [AEM as a Cloud Service Architecture](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/overview/architecture)
- [Content Replication](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/operations/replication)
- [CDN in AEM as a Cloud Service](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/cdn)
