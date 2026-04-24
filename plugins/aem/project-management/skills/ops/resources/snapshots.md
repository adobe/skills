---
name: ops-snapshots
description: Snapshot operations for Edge Delivery Services staged releases - create, manage, and publish content bundles. Supports review workflows with lock/approve/reject.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Snapshots (Staged Releases)

Bundle multiple content changes for coordinated publishing.

## When to Use

- Coordinating a launch where multiple pages must go live at the same time
- Gating a content release behind a review and approval workflow before publishing
- Grouping related content changes (e.g., campaign, product launch) into a named bundle
- Rolling back a release by identifying and unpublishing the pages in a specific snapshot
- Staging content for a scheduled release while keeping the live site unchanged

## API Reference

| Intent | Endpoint | Method |
|--------|----------|--------|
| list snapshots | `/snapshot/{org}/{site}/main` | GET |
| create/update manifest | `/snapshot/{org}/{site}/main/{id}` | POST |
| get manifest | `/snapshot/{org}/{site}/main/{id}` | GET |
| delete snapshot | `/snapshot/{org}/{site}/main/{id}` | DELETE |
| add resource | `/snapshot/{org}/{site}/main/{id}/{path}` | POST |
| bulk add | `/snapshot/{org}/{site}/main/{id}/*` | POST |
| resource status | `/snapshot/{org}/{site}/main/{id}/{path}` | GET |
| remove resource | `/snapshot/{org}/{site}/main/{id}/{path}` | DELETE |
| publish snapshot | `/snapshot/{org}/{site}/main/{id}?publish=true` | POST |
| publish resource | `/snapshot/{org}/{site}/main/{id}/{path}?publish=true` | POST |
| request review | `/snapshot/{org}/{site}/main/{id}?review=request` | POST |
| approve | `/snapshot/{org}/{site}/main/{id}?review=approve` | POST |
| reject | `/snapshot/{org}/{site}/main/{id}?review=reject` | POST |

## Operations

### List All Snapshots

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main"
```

**On success:** Display results in a table with columns **ID**, **Title**, **Status**, and **Created**. Report total count.

**▶ Recommended Next Actions:**
1. View the contents of a specific snapshot
   ```
   show snapshot {id}
   ```
2. Create a new snapshot for an upcoming release
   ```
   create snapshot {id}
   ```

### Create/Update Snapshot Manifest

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"title": "Q2 Launch", "description": "Product pages for Q2 release"}' \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}"
```

**Success:** `Snapshot "{id}" created`
**▶ Recommended Next Actions:**
1. Add pages to the snapshot
   ```
   add {path} to snapshot {id}
   ```
2. View the snapshot manifest to review contents
   ```
   show snapshot {id}
   ```

### Get Snapshot Manifest

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}"
```

**On success:** Show snapshot metadata (ID, title, status, created date), then display the resource list in a table with columns **#**, **Path**, and **Status**. Report total resource count.

**▶ Recommended Next Actions:**
1. Publish the snapshot when all pages are ready
   ```
   publish snapshot {id}
   ```
2. Request a review before publishing
   ```
   lock snapshot {id} for review
   ```
3. Add a page if something is missing from the manifest
   ```
   add {path} to snapshot {id}
   ```
4. *(DA sites only)* View DA source for a resource in the manifest to verify content is ready before publishing
   ```
   get DA source {site}{path}
   ```

### Add Resource to Snapshot

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}${PATH}"
```

**Success:** `Added {path} to snapshot "{id}"`
**▶ Recommended Next Actions:**
1. View the manifest to confirm the addition
   ```
   show snapshot {id}
   ```
2. Add more pages to the snapshot
   ```
   add {path} to snapshot {id}
   ```
3. Publish the snapshot when all pages are ready
   ```
   publish snapshot {id}
   ```
4. Get DA source to verify the page content is correct before the snapshot goes live
   ```
   get DA source {site}{path}
   ```

### Bulk Add Resources

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/products/new-widget", "/products/new-gadget", "/blog/announcement"]}' \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}/*"
```

**▶ Recommended Next Actions:**
1. Verify all paths were added correctly
   ```
   show snapshot {id}
   ```
2. Publish the snapshot when the content is ready
   ```
   publish snapshot {id}
   ```

### Remove Resource from Snapshot

```bash
curl -s -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}${PATH}"
```

**▶ Recommended Next Actions:**
1. Verify the resource was removed from the manifest
   ```
   show snapshot {id}
   ```
2. Add a replacement resource if needed
   ```
   add {path} to snapshot {id}
   ```

### Delete Entire Snapshot

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Tell user: "This will permanently delete snapshot '{snapshotId}' and all its contents."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms with "yes"

```bash
curl -s -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}"
```

**▶ Recommended Next Actions:**
1. Confirm the snapshot no longer exists
   ```
   list snapshots
   ```
2. Create a new snapshot if the deletion was to start fresh
   ```
   create snapshot {id}
   ```

### Publish Single Resource

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}${PATH}?publish=true"
```

**On success (200 / 201):**
```
Live URL: https://main--{site}--{org}.aem.live{path}
```

**▶ Recommended Next Actions:**
1. Open the live URL to confirm — `https://main--{site}--{org}.aem.live{path}` (CDN propagation takes up to 60 seconds)
2. Purge CDN cache if the page appears stale
   ```
   purge cache of {path}
   ```
3. Publish the remaining pages in the snapshot
   ```
   publish snapshot {id}
   ```

### Publish Entire Snapshot

**Requires Admin role.**

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}?publish=true"
```

**On success (200 / 201):**
```
Published snapshot "{id}" — {count} pages now live at https://main--{site}--{org}.aem.live
```

**▶ Recommended Next Actions:**
1. Spot-check key pages — `https://main--{site}--{org}.aem.live{path}` (CDN propagation takes up to 60 seconds)
2. Purge CDN cache if pages appear stale
   ```
   purge cache of {path}
   ```
3. *(DA sites only)* View DA version history of a key page to confirm the correct authored version is now live
   ```
   list DA versions of {site}{path}
   ```

### Request Review (Lock)

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}?review=request"
```

**Success:** `Snapshot "{id}" locked for review`
**▶ Recommended Next Actions:**
1. Approve the snapshot once review is complete
   ```
   approve snapshot {id}
   ```
2. Reject if changes are required
   ```
   reject snapshot {id}
   ```

### Approve Snapshot

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}?review=approve"
```

**Success:** `Snapshot "{id}" approved`
**▶ Recommended Next Actions:**
1. Publish the approved snapshot to live
   ```
   publish snapshot {id}
   ```
2. View the manifest one final time before publishing
   ```
   show snapshot {id}
   ```

### Reject Snapshot

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}?review=reject"
```

**Success:** `Snapshot "{id}" rejected`
**▶ Recommended Next Actions:**
1. Review the manifest and update pages as needed
   ```
   show snapshot {id}
   ```
2. Request a new review after changes are made
   ```
   lock snapshot {id} for review
   ```

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "list snapshots" | List all |
| "create snapshot q2-launch" | Create with ID |
| "add /products/new to snapshot q2-launch" | Add resource |
| "add /a, /b, /c to snapshot q2-launch" | Bulk add |
| "show snapshot q2-launch" | Get manifest |
| "publish snapshot q2-launch" | Publish all |
| "delete snapshot q2-launch" | Delete |
| "lock snapshot q2-launch for review" | Request review |
| "approve snapshot q2-launch" | Approve |
| "reject snapshot q2-launch" | Reject |

## Success Criteria

- ✅ Snapshot created or updated with HTTP 200 and ID confirmed to user
- ✅ Manifest shows correct resource paths after add/remove operations
- ✅ Publish confirmed with page count and live URLs for the released pages
- ✅ Destructive operations (delete snapshot) confirmed with user before executing
- ✅ Review workflow state (locked / approved / rejected) reported clearly after each transition
