---
name: content-distribution
license: Apache-2.0
description: |
  Use for AEM as a Cloud Service content publishing and distribution: publish or unpublish via the
  Replication API, target Preview, check per-agent status, or monitor Sling Distribution events.
  For AEM 6.5 LTS or AMS, use the AEM 6.5 LTS Replication skill.
---

# AEM Cloud Service Content Distribution

> **Beta Skill**: This skill is in beta and under active development.
> Results should be reviewed carefully before use in production.
> Report issues at https://github.com/adobe/skills/issues

## Route by task

- Programmatic publishing, preview targeting, status checks, bulk replication, and permissions: [Replication API guide](./references/replication.md).
- Sling Distribution lifecycle events and monitoring: [Sling Distribution events guide](./references/sling-distribution.md).

## Replication guardrails

- An unfiltered Replicator call uses the enabled-by-default **publish** agent only. Preview requires an explicit `AgentFilter`.
- A preview-only activation can leave aggregate `ReplicationStatus.isActivated()` false; check `getStatusForAgent("preview")` for Preview and `getStatusForAgent("publish")` for live Publish status.
- Prefer fewer than 100 paths per custom call and use Tree Activation for large hierarchies; do not promise automatic splitting.
- In **Tools > Deployment > Distribution**, distinguish the `persisted` queue from `fully published`; a queued or accepted request does not prove content is live. The latter indicates publication across Publish pods and Dispatcher invalidation.
- After a custom call, check the target with `getStatusForAgent(agentId)`. On `ReplicationException`, inspect the agent's queue and logs in the Distribution UI before deciding whether to retry; do not infer delivery from an accepted or queued request.

## Preview example

Given a `Replicator`, valid JCR `Session`, and content path:

```java
import com.day.cq.replication.Replicator;
import com.day.cq.replication.ReplicationActionType;
import com.day.cq.replication.ReplicationException;
import com.day.cq.replication.ReplicationOptions;
import com.day.cq.replication.ReplicationStatus;
import javax.jcr.Session;

public class PreviewPublisher {
    public static boolean publishToPreview(Replicator replicator, Session session, String path)
            throws ReplicationException {
        ReplicationOptions options = new ReplicationOptions();
        options.setSynchronous(true);
        options.setFilter(agent -> "preview".equals(agent.getId()));
        replicator.replicate(session, ReplicationActionType.ACTIVATE, path, options);

        ReplicationStatus aggregate = replicator.getReplicationStatus(session, path);
        ReplicationStatus preview = aggregate == null ? null : aggregate.getStatusForAgent("preview");
        return preview != null && preview.isActivated();
    }
}
```

## Version-sensitive batching note

The Cloud Service operations guide documents a 500-path limit for default calls and describes `ReplicationOptions.setUseAtomicCalls(false)` for larger requests. The AEM SDK 2026.9 Javadoc recommends 100 paths for transactional behavior and marks `setUseAtomicCalls` deprecated as “no longer required.” Treat the difference as unresolved: handle `ReplicationException` and verify target behavior before relying on larger batches.

## Sources

- [Cloud Service replication operations](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/operations/replication)
- [AEM SDK Replication API Javadocs (2026.9.28386.20260923T071724Z-260900)](https://javadoc.io/static/com.adobe.aem/aem-sdk-api/2026.9.28386.20260923T071724Z-260900/com/day/cq/replication/package-summary.html)
