# Package-Based Replication — Detailed Reference

Replicates a specific set of JCR nodes by building a content package and distributing it to Publish instances.

## Steps

1. Navigate to `http://localhost:4502/crx/packmgr/index.jsp` → **Create Package**
   ```
   Name:    content-update-2024-04
   Group:   myproject
   Version: 1.0.0
   ```

2. Click **Edit** → **Filters** tab → add one or more filters:
   ```
   /content/mysite/en/products   (Include)
   /content/dam/mysite/images    (Include)
   ```

3. Click **Build** — wait for the `.zip` to be created

4. Click **More** → **Replicate** — package is sent to the replication queue and distributed to all enabled Publish instances

5. ✓ Verify: navigate to `http://publish:4503/crx/packmgr/index.jsp` — package should appear with status **Installed**

## When to Use

- Complex content sets with multiple paths and JCR dependencies
- Cross-environment deployments (Author → Publish with specific node structures)
- Configuration replication (OSGi configs, workflow models)
- Backup/restore of content subtrees
- When standard page activation misses linked nodes

## Notes

- Package replication bypasses workflow approval — use with care on governed content
- For assets with shared datastore (binary-less replication), no binary transfer occurs — only metadata nodes replicate
