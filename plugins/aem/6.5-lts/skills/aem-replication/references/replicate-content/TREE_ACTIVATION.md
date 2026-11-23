# Tree Activation — Detailed Reference

Publishes an entire content hierarchy in one operation via Classic UI.

## Steps

1. Navigate to `http://localhost:4502/miscadmin`
2. Click **Replication** in the left sidebar → **Activate Tree**
3. Configure:
   ```
   Start Path:        /content/mysite/en
   Only Modified:     ✓  (publish only pages changed since last activation)
   Only Activated:    ✓  (skip pages never previously published)
   Ignore Deactivated: ✓ (skip pages explicitly deactivated)
   Dry Run:           ✓  (preview without publishing — always run first)
   ```
4. Click **Dry Run** — review the list of pages that would be affected
5. Uncheck **Dry Run** → click **Activate**
6. ✓ Verify: results summary shows success count and zero failures; check `crx-quickstart/logs/replication.log` for errors

## Performance Guidance

- Use **Only Modified** to avoid replicating unchanged pages — reduces queue load significantly
- Schedule large tree activations during off-peak hours
- For very large trees (10k+ pages), consider chunking by sub-path
- Monitor the replication agent queue: Tools → Deployment → Replication → Agents on author → queue depth

## When to Use

- Initial site launch (full tree)
- Large content migration (entire section)
- Bulk re-publication after template or component changes
- Recovery after replication queue failure that left pages un-replicated
