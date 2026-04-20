---
name: ops-snapshots
description: Snapshot operations for Edge Delivery Services staged releases - create, manage, and publish content bundles. Supports review workflows with lock/approve/reject.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Snapshots (Staged Releases)

Bundle multiple content changes for coordinated publishing.

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

### Create/Update Snapshot Manifest

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"title": "Q2 Launch", "description": "Product pages for Q2 release"}' \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}"
```

**Success:** `Snapshot "{id}" created`

### Get Snapshot Manifest

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}"
```

### Add Resource to Snapshot

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}${PATH}"
```

**Success:** `Added {path} to snapshot "{id}"`

### Bulk Add Resources

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/products/new-widget", "/products/new-gadget", "/blog/announcement"]}' \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}/*"
```

### Remove Resource from Snapshot

```bash
curl -s -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}${PATH}"
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

### Publish Single Resource

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}${PATH}?publish=true"
```

### Publish Entire Snapshot

**Requires Admin role.**

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}?publish=true"
```

**Success:** `Published snapshot "{id}" - {count} pages now live`

### Request Review (Lock)

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}?review=request"
```

**Success:** `Snapshot "{id}" locked for review`

### Approve Snapshot

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}?review=approve"
```

**Success:** `Snapshot "{id}" approved`

### Reject Snapshot

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}?review=reject"
```

**Success:** `Snapshot "{id}" rejected`

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
