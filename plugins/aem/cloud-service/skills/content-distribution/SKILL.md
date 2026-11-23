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

- Programmatic publishing, preview targeting, status checks, bulk replication, and permissions: [Replication API](./replication/SKILL.md).
- Sling Distribution lifecycle events and monitoring: [Sling Distribution Events](./sling-distribution/SKILL.md).

## Replication guardrails

- An unfiltered Replicator call uses the enabled-by-default **publish** agent only. Preview requires an explicit `AgentFilter`.
- A preview-only activation can leave aggregate `ReplicationStatus.isActivated()` false; check `getStatusForAgent("preview")` for Preview and `getStatusForAgent("publish")` for live Publish status.
- Prefer fewer than 100 paths per custom call and use Tree Activation for large hierarchies. Product documentation states that default calls above 500 paths throw `ReplicationException`, while also describing `setUseAtomicCalls(false)` as an alternative; the AEM SDK 2026.9 Javadoc marks that option deprecated as “no longer required.” Do not promise automatic splitting; handle exceptions and verify target behavior before relying on larger batches.
- In **Tools > Deployment > Distribution**, distinguish the `persisted` queue from `fully published`; a queued or accepted request does not prove content is live. The latter indicates publication across Publish pods and Dispatcher invalidation.

## Sources

- [Cloud Service replication operations](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/operations/replication)
- [AEM SDK Replication API Javadocs (2026.9.28386.20260923T071724Z-260900)](https://javadoc.io/static/com.adobe.aem/aem-sdk-api/2026.9.28386.20260923T071724Z-260900/com/day/cq/replication/package-summary.html)
