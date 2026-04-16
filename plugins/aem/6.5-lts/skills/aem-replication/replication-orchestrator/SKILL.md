---
name: replication-orchestrator
description: |
  Orchestrates end-to-end replication workflows spanning multiple concerns: new environment setup,
  production incident response, and performance optimization for AEM 6.5 LTS.
license: Apache-2.0
---

# Replication Orchestrator

Coordinates complex replication workflows that span multiple sub-skills (configure, replicate, troubleshoot).

## When to Use This Skill

Use the orchestrator for multi-step scenarios requiring coordination across sub-skills:
- **New Environment Setup:** Configure agents → Test replication → Troubleshoot issues
- **Production Incidents:** Diagnose problem → Isolate root cause → Fix and verify
- **Performance Optimization:** Monitor metrics → Tune configuration → Validate improvements
- **Migration Preparation:** Audit current setup → Document dependencies → Plan cutover

For single-concern tasks, use the specific sub-skill directly instead of the orchestrator.

## Workflow 1: New Environment Setup

End-to-end workflow for setting up replication in a new AEM 6.5 LTS environment.

### Prerequisites

- Author instance running and accessible
- Publish instance(s) running and accessible
- Dispatcher installed and configured
- Service user accounts created
- Network connectivity verified

### Steps

#### 1. Configure Default Replication Agent

**Delegate to:** [configure-replication-agent](../configure-replication-agent/SKILL.md)

**Actions:**
1. Create default replication agent on Author
2. Configure transport URI: `http://publish-host:4503/bin/receive?sling:authRequestLogin=1`
3. Set service user credentials
4. Enable the agent

**Verification Checkpoint:**
```bash
# Test agent connectivity
curl -u $AEM_USER:$AEM_PASSWORD \
  http://localhost:4502/etc/replication/agents.author/<agent-name>.test.html
```

Expected: "Replication test succeeded"

#### 2. Configure Dispatcher Flush Agent

**Delegate to:** [configure-replication-agent](../configure-replication-agent/SKILL.md)

**Actions:**
1. Create flush agent on each Publish instance
2. Configure transport URI: `http://dispatcher-host:80/dispatcher/invalidate.cache`
3. Set serialization type to "Dispatcher Flush"
4. Enable the agent

**Verification Checkpoint:**
```bash
# Test flush agent connectivity
curl -u $AEM_USER:$AEM_PASSWORD \
  http://publish-host:4503/etc/replication/agents.publish/flush.test.html
```

Expected: "Replication (Dispatcher Flush) test succeeded"

#### 3. Test Content Replication

**Delegate to:** [replicate-content](../replicate-content/SKILL.md)

**Actions:**
1. Create test page: `/content/test/replication-check`
2. Activate via Quick Publish
3. Verify on Publish instance
4. Verify Dispatcher cache invalidation

**Verification Checkpoint:**
```bash
# Check page on Publish
curl http://publish-host:4503/content/test/replication-check.html

# Check page on Dispatcher
curl http://dispatcher-host:80/content/test/replication-check.html

# Verify cache was invalidated (should see fresh content)
```

Expected: Page content identical on all instances

#### 4. Configure Monitoring

**Actions:**
1. Enable JMX monitoring for queue metrics
2. Set up log monitoring for replication errors
3. Configure alerts for queue depth > 20 items
4. Document runbook for common issues

**JMX Bean:**
```
com.day.cq.replication:type=Agent,id=<agent-name>
  - QueueNumEntries
  - QueueBlocked
  - QueueProcessingSince
```

#### 5. Handle Any Issues

**If problems occur, delegate to:** [troubleshoot-replication](../troubleshoot-replication/SKILL.md)

**Common setup issues:**
- Connection refused → Verify target instance running and network connectivity
- 401 Unauthorized → Check service user credentials
- Queue blocked → Review error.log for root cause
- Content not appearing → Check Dispatcher cache invalidation

### Success Criteria

- [ ] Default replication agent enabled and passing test
- [ ] Dispatcher flush agent enabled and passing test
- [ ] Test page successfully replicated to Publish
- [ ] Test page accessible via Dispatcher with correct cache headers
- [ ] JMX monitoring configured and showing metrics
- [ ] Log monitoring configured for replication errors
- [ ] Team runbook updated with agent details

## Workflow 2: Production Incident Response

End-to-end workflow for diagnosing and resolving production replication issues.

### Incident Triage

#### 1. Gather Symptoms

**Questions to answer:**
- Is content replicating at all? (None vs. Some)
- Which agents are affected? (All vs. Specific)
- When did the issue start? (Timestamp)
- What changed recently? (Deployments, config, network)

**Data to collect:**
```bash
# Check agent status
curl -u $AEM_USER:$AEM_PASSWORD \
  http://localhost:4502/etc/replication/agents.author/<agent-name>.html

# Check queue depth
# Navigate to JMX Console: /system/console/jmx
# com.day.cq.replication:type=Agent,id=<agent-name>
# QueueNumEntries value

# Check recent errors
tail -n 100 <aem-install>/crx-quickstart/logs/error.log | grep -i replication
```

#### 2. Diagnose Root Cause

**Delegate to:** [troubleshoot-replication](../troubleshoot-replication/SKILL.md)

**Follow diagnostic decision tree:**
1. Is queue blocked? → Network/connectivity issue
2. Are there 401/403 errors? → Authentication issue
3. Are there SSL errors? → Certificate issue
4. Is queue depth growing? → Target instance overloaded
5. Is content missing on Dispatcher? → Cache invalidation issue

**Common root causes:**
- Network partition between Author and Publish
- Service user credentials expired or revoked
- Target instance CPU/memory exhausted
- Dispatcher not accepting flush requests
- Firewall rule change blocking replication traffic

#### 3. Implement Fix

**Based on diagnosis:**

**Network Issue:**
- Verify network connectivity: `ping publish-host`
- Check firewall rules
- Test replication port: `telnet publish-host 4503`

**Authentication Issue:**
- Verify service user exists and is active
- Check user permissions: `/useradmin`
- Regenerate credentials if expired

**Target Capacity Issue:**
- Monitor Publish instance CPU/memory
- Scale horizontally (add publish instances)
- Optimize Publish instance configuration

**Dispatcher Issue:**
- Verify Dispatcher flush agent configuration
- Check Dispatcher allowedClients setting
- Restart Dispatcher if necessary

#### 4. Verify Resolution

**Validation steps:**
1. Clear blocked queue items (if applicable)
2. Retry failed replications
3. Activate test content
4. Monitor queue depth for 15 minutes
5. Verify no new errors in logs

**Verification commands:**
```bash
# Retry queue via JMX
# com.day.cq.replication:type=Agent,id=<agent-name>
# Operation: retryFirst()

# Monitor queue depth
watch -n 5 'curl -s -u $AEM_USER:$AEM_PASSWORD \
  http://localhost:4502/system/console/jmx/com.day.cq.replication%3Atype%3DAgent%2Cid%3D<agent-name> \
  | grep QueueNumEntries'
```

#### 5. Post-Incident Review

**Document:**
- Root cause analysis
- Timeline of incident
- Resolution steps taken
- Preventive measures for future

**Update runbooks with:**
- New diagnostic patterns observed
- Effective resolution procedures
- Monitoring improvements needed

### Success Criteria

- [ ] Root cause identified and documented
- [ ] Fix implemented and verified
- [ ] Queue processing normally (depth decreasing)
- [ ] No errors in replication.log for 15 minutes
- [ ] Test content replicates successfully
- [ ] Monitoring confirms normal operation
- [ ] Post-incident review completed
- [ ] Runbook updated

## Workflow 3: Performance Optimization

End-to-end workflow for improving replication throughput and efficiency.

### Performance Baseline

#### 1. Measure Current Performance

**Metrics to collect:**
- Average replication rate (pages/minute)
- Queue depth over time
- Replication latency (activation to publish)
- Target instance CPU/memory utilization
- Network latency (Author to Publish)

**Measurement period:** 7 days of production traffic

**Tools:**
- JMX metrics for queue depth
- replication.log for timing analysis
- System monitoring for resource utilization

#### 2. Identify Bottlenecks

**Common bottlenecks:**

**High Queue Depth:**
- Cause: Target instance slow to process
- Indicator: Queue depth consistently > 20 items
- Delegate to: Capacity planning

**Slow Network:**
- Cause: High latency or low bandwidth
- Indicator: Large assets take > 5 minutes
- Delegate to: Network team for optimization

**Serialization Overhead:**
- Cause: Large page structures or many components
- Indicator: CPU spikes during activation
- Delegate to: Content architecture review

**Synchronous Replication:**
- Cause: Using synchronous options unnecessarily
- Indicator: UI blocks during activation
- Solution: Switch to asynchronous

#### 3. Implement Optimizations

**Based on bottleneck analysis:**

**Optimization 1: Use Asynchronous Replication**

**Delegate to:** [replication-api](../replication-api/SKILL.md)

```java
ReplicationOptions opts = new ReplicationOptions();
opts.setSynchronous(false); // Don't block
replicator.replicate(session, type, paths, opts);
```

**When to use:** Bulk operations, background jobs, non-critical content

**Optimization 2: Batch Replication**

**Delegate to:** [replication-api](../replication-api/SKILL.md)

```java
String[] paths = contentPaths.toArray(new String[0]);
replicator.replicate(session, type, paths, opts);
```

**Batch size:** 100-500 paths (balance throughput vs. memory)

**Optimization 3: Increase Target Capacity**

**Actions:**
- Add additional Publish instances
- Create agents for each instance
- Load balance across instances

**Expected improvement:** Linear scaling with instance count

**Optimization 4: Tune Timeouts**

**For large DAM assets:**
```
Connection Timeout: 30000ms
Socket Timeout: 60000ms
```

**For standard pages:**
```
Connection Timeout: 10000ms (default)
Socket Timeout: 10000ms (default)
```

#### 4. Measure Improvements

**Compare metrics:**
- Replication rate before/after
- Queue depth before/after
- User-reported activation time

**Expected improvements:**
- 2-5x throughput increase with async
- 50% reduction in queue depth with batching
- Linear scaling with additional instances

**If improvements insufficient:**
- Review content architecture for optimization opportunities
- Consider workflow-based approval to reduce replication volume
- Evaluate network infrastructure upgrades

### Success Criteria

- [ ] Baseline performance metrics documented
- [ ] Bottlenecks identified with data
- [ ] Optimizations implemented and tested
- [ ] Performance improvements measured and validated
- [ ] Monitoring updated to track new metrics
- [ ] Documentation updated with optimization patterns

## Workflow 4: Migration Preparation (AEM 6.5 LTS → Cloud Service)

Prepare for migration to AEM as a Cloud Service Sling Distribution API.

### Migration Assessment

#### 1. Audit Current Replication Setup

**Inventory:**
- Number of replication agents
- Custom replication code locations
- Agent configuration dependencies
- Integration points with external systems

**Questions:**
- Which code uses Replication API directly?
- Are there agent ID filters in code? (tight coupling)
- Are there custom replication listeners?
- Are there scheduled/automated replication jobs?

#### 2. Identify Migration Effort

**High-effort areas:**
- Custom `ReplicationListener` implementations → Event listener refactor
- Agent ID filtering → Configuration-driven approach needed
- Direct agent configuration manipulation → Remove or abstract
- Custom serialization types → Standard Cloud Service patterns

**Low-effort areas:**
- Simple `Replicator.replicate()` calls → Map to Distribution API
- Standard workflows → Cloud Service equivalents exist
- Service user patterns → Continue in Cloud Service

#### 3. Plan Migration Strategy

**Phases:**

**Phase 1: Code Audit** (delegate to development team)
- Grep for `com.day.cq.replication` package imports
- Document all usage locations
- Categorize by migration complexity

**Phase 2: Abstraction Layer** (reduce coupling)
- Create interface wrapping replication operations
- Implement with current Replication API
- Update code to use interface instead of direct API

**Phase 3: Cloud Service Implementation**
- Implement interface with Sling Distribution API
- Deploy to Cloud Service dev environment
- Test functional equivalence

**Phase 4: Cutover**
- Deploy to Cloud Service staging
- Run parallel for validation period
- Cut over production traffic

#### 4. Reference Migration Patterns

**Official Adobe Cloud Service Documentation:**

- [Content Distribution in AEM as a Cloud Service](https://experienceleague.adobe.com/docs/experience-manager-cloud-service/content/operations/distribution.html)
- [Migrating to AEM as a Cloud Service](https://experienceleague.adobe.com/docs/experience-manager-cloud-service/content/migration-journey/getting-started.html)

**Key API migration patterns:**
- `Replicator.replicate()` → Sling Distribution API (no direct replacement, use content distribution patterns)
- `ReplicationOptions` → Configuration via OSGi for distribution agents
- `ReplicationActionType.ACTIVATE` → Content publish workflows in Cloud Service
- Agent configuration → Cloud-native distribution managed by Adobe

**Important:** AEM as a Cloud Service uses a fundamentally different architecture. The Replication API does not exist in Cloud Service. Instead, content distribution is handled automatically by the platform. Custom replication code must be refactored to use Cloud Service's content publishing workflows.

### Success Criteria

- [ ] Complete inventory of replication usage
- [ ] Migration effort estimated
- [ ] Abstraction layer designed
- [ ] Proof-of-concept validated on Cloud Service
- [ ] Migration plan documented and approved
- [ ] Team trained on Cloud Service patterns

## Cross-Skill Coordination

The orchestrator coordinates across specialist skills:

- **Configure:** [configure-replication-agent/SKILL.md](../configure-replication-agent/SKILL.md)
- **Replicate:** [replicate-content/SKILL.md](../replicate-content/SKILL.md)
- **API:** [replication-api/SKILL.md](../replication-api/SKILL.md)
- **Troubleshoot:** [troubleshoot-replication/SKILL.md](../troubleshoot-replication/SKILL.md)

## Related Skills

- **AEM Workflow:** Integrate replication with approval workflows
- **Dispatcher:** Configure cache invalidation and flush agents
- **AEM Cloud Service Best Practices:** Migration patterns for Cloud Service

## Foundation References

- [Agent Types](../references/replication-foundation/agent-types.md)
- [Queue Mechanics](../references/replication-foundation/queue-mechanics.md)
- [AEM 6.5 LTS Guardrails](../references/replication-foundation/65-lts-guardrails.md)
- [API Quick Reference](../references/replication-foundation/api-reference.md)
