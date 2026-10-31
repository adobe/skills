---
name: replicate-content
description: Use when publishing, unpublishing, replicating, or activating/deactivating content in AEM 6.5 LTS. Covers Quick Publish, Manage Publication, tree activation, bulk content activation, package replication, workflow-based approval, scheduled activation/deactivation (on/off time), dispatcher flush, and the programmatic Replication Java API for AEM publish instances.
license: Apache-2.0
---

# Replicate Content in AEM 6.5 LTS

Use this skill when the user asks to publish, unpublish, replicate, activate, deactivate, or bulk-replicate content on AEM 6.5 LTS publish instances.

## Prerequisites

- AEM 6.5 LTS Author with configured replication agents — see `configure-replication-agent`
- Author permissions to activate/deactivate content

## Replication Method Selector

| Method | When to Use | Scope |
|--------|-------------|-------|
| [Quick Publish](#quick-publish) | Fast single-page activation, no approval | Selected pages only (shallow) |
| [Manage Publication](#manage-publication) | Scheduling, references, or workflow control | Single/multiple pages with options |
| [Tree Activation](#tree-activation) | Entire site section or initial site launch | Page tree (see `references/TREE_ACTIVATION.md`) |
| [Package Replication](#package-replication) | Specific content sets or cross-env deploy | Custom JCR filter (see `references/PACKAGE_REPLICATION.md`) |
| [Workflow Replication](#workflow-replication) | Approval required before going live | Any content with assigned approver |
| [Scheduled Activation](#scheduled-activation) | Time-based publish/unpublish | On Time / Off Time in page properties |
| [Replication API](#replication-api) | Programmatic from Java or scripts | Any JCR path (see `references/REPLICATION_API.md`) |

---

## Quick Publish

Sites console → select page(s) → **Quick Publish** (toolbar or right-click menu)

- Shallow: publishes selected pages only, not children
- Uses all enabled default replication agents immediately
- ✓ Verify: page shows green "Published" checkmark in Sites console

---

## Manage Publication

Sites console → select page(s) → **Manage Publication**

1. Action: Publish / Unpublish / Publish Later / Unpublish Later
2. Date/time: set if using a "Later" option
3. Scope: Selected / Include Children / Modified Only
4. Options: Include References (assets, XFs), Create Version Before Publish
5. ✓ Verify: progress indicator completes with no error notifications; check replication agent queue is idle

---

## Tree Activation

`http://localhost:4502/miscadmin` → Replication → Activate Tree

- Start Path: `/content/mysite/en`
- Always run **Dry Run** first to preview scope
- Options: Only Modified, Only Activated, Ignore Deactivated
- ✓ Verify: results log shows success count with zero failures

For full steps and performance guidance, see [`references/TREE_ACTIVATION.md`](references/TREE_ACTIVATION.md).

---

## Package Replication

`/crx/packmgr` → Create Package → add filters → Build → More → **Replicate**

- ✓ Verify: package appears as Installed in Publish CRX Package Manager (`http://publish:4503/crx/packmgr`)

For full steps, see [`references/PACKAGE_REPLICATION.md`](references/PACKAGE_REPLICATION.md).

---

## Workflow Replication

Select page → Timeline panel → Start Workflow → **Request for Activation** → assign approver

- Approver acts via `http://localhost:4502/aem/inbox`: Approve → content activates; Reject → returns to author
- ✓ Verify: page status updates to "Published" after approval completes

---

## Scheduled Activation

Page Properties → Advanced tab → set **On Time** (activate) and/or **Off Time** (deactivate)

- Requires replication agent trigger "On-/Offtime reached" enabled
- ✓ Verify: agent trigger at `/etc/replication/agents.author/[agent]` → Triggers tab → "On-/Offtime reached" is checked

---

## Replication API

```java
@Reference private Replicator replicator;

replicator.replicate(session, ReplicationActionType.ACTIVATE, "/content/path");
replicator.replicate(session, ReplicationActionType.DEACTIVATE, "/content/path");
```

```bash
curl -u $AEM_USER:$AEM_PASSWORD -X POST http://localhost:4502/bin/replicate.json \
  -F "cmd=Activate" -F "path=/content/mysite/en/page"
# ✓ Verify: HTTP 200 with {"success":true,"path":"/content/mysite/en/page"}
```

For `ReplicationOptions` (synchronous, agent filtering) and full curl error handling, see [`references/REPLICATION_API.md`](references/REPLICATION_API.md).

---

## Deactivation (Unpublishing)

Sites console → select page(s) → **Quick Unpublish** (or Manage Publication → Unpublish)

- Content removed from Publish; URLs return 404; Author content preserved
- Dispatcher cache invalidated if flush agent is configured
- ✓ Verify: page URL on Publish returns 404

---

## Replication Status Indicators

| Indicator | Meaning |
|-----------|---------|
| Green checkmark | Published and up-to-date |
| Orange dot | Modified since last publish — re-publish needed |
| Gray circle | Never published |

Check queue: Tools → Deployment → Replication → Agents on author → [agent] → queue should be idle/empty after processing.

Logs: `crx-quickstart/logs/replication.log`

---

## Troubleshooting

- **Content not appearing on Publish**: confirm replication timestamp is recent; agent queue should be empty
- **Agent blocked**: Agents on author → select agent → Force Retry or Clear failed item
- **Dispatcher serving stale content**: manually flush cache or verify flush agent configuration
- **Permission denied errors**: check Agent User Id has replication privileges on the content path

For deep diagnostics, use the `troubleshoot-replication` skill.

---

## Asset Replication (DAM)

Use the Assets console (`/assets.html/content/dam`) with the same Quick Publish / Manage Publication actions. All renditions and metadata replicate automatically. For shared datastores, enable binary-less replication (Serialization Type: Binary-less) on the agent to transfer only metadata nodes.

---

## Additional Resources

- [AEM 6.5 LTS Replication](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/configuring/replication)
- [Managing Publications](https://experienceleague.adobe.com/docs/experience-manager-65/authoring/authoring/publishing-pages.html)

---

## Related Skills

- `configure-replication-agent` — set up and configure replication agents
- `replication-api` — full programmatic Replication API reference for custom OSGi services and servlets
- `troubleshoot-replication` — diagnose and resolve replication failures
