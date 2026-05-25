---
name: ops-snapshots
description: Snapshot operations for Edge Delivery Services staged releases - create, manage, and publish content bundles. Supports review workflows with lock/approve/reject.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Snapshots (Staged Releases)

Bundle multiple content changes for coordinated publishing.

## API Reference

| Intent | Endpoint | Method | Required Role |
|--------|----------|--------|---------------|
| list snapshots | `/snapshot/{org}/{site}/main` | GET | `basic_author`+ (`snapshot:read`) |
| create/update manifest | `/snapshot/{org}/{site}/main/{id}` | POST | `author`+ (`snapshot:write`) |
| get manifest | `/snapshot/{org}/{site}/main/{id}` | GET | `basic_author`+ (`snapshot:read`) |
| delete snapshot | `/snapshot/{org}/{site}/main/{id}` | DELETE | `author`+ (`snapshot:delete`) |
| add resource | `/snapshot/{org}/{site}/main/{id}/{path}` | POST | `author`+ (`snapshot:write`) |
| bulk add | `/snapshot/{org}/{site}/main/{id}/*` | POST | `author`+ (`snapshot:write`) |
| resource status | `/snapshot/{org}/{site}/main/{id}/{path}` | GET | `basic_author`+ (`snapshot:read`) |
| remove resource | `/snapshot/{org}/{site}/main/{id}/{path}` | DELETE | `author`+ (`snapshot:delete`) |
| publish snapshot | `/snapshot/{org}/{site}/main/{id}?publish=true` | POST | `publish` or `admin` (`live:write`) |
| publish resource | `/snapshot/{org}/{site}/main/{id}/{path}?publish=true` | POST | `publish` or `admin` (`live:write`) |
| request review (lock) | `/snapshot/{org}/{site}/main/{id}?review=request` | POST | `author`+ (`preview:write`) |
| approve (publish + unlock) | `/snapshot/{org}/{site}/main/{id}?review=approve` | POST | `publish` or `admin` (`live:write`) |
| reject (unlock) | `/snapshot/{org}/{site}/main/{id}?review=reject` | POST | `publish` or `admin` (`live:write`) |

## Operations

### List All Snapshots

```bash
curl -s \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main"
```

**Response shape:** `{"snapshots": [...], "links": {...}}`. Empty state returns `{"snapshots": [], "links": {...}}`.

**Present as table:** ID | Title | Status | Created (iterate over `snapshots[]`)

### Create/Update Snapshot Manifest

Creates a new snapshot or updates metadata on an existing one. Also used to lock/unlock: set `"locked": true` to lock for review (requires `preview:write`), `"locked": false` to unlock (requires `live:write`).

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"title": "Q2 Launch", "description": "Product pages for Q2 release"}' \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}"
```

**Success:** `Snapshot "{id}" created`

### Get Snapshot Manifest

```bash
curl -s \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}"
```

### Add Resource to Snapshot

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}${PATH}"
```

**Success:** `Added {path} to snapshot "{id}"`

### Bulk Add Resources

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/products/new-widget", "/products/new-gadget", "/blog/announcement"]}' \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}/*"
```

### Remove Resource from Snapshot

**DESTRUCTIVE OPERATION — CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Tell user: "This will remove {path} from snapshot '{snapshotId}'. The resource will no longer be part of this staged release."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms with "yes"

```bash
curl -s -X DELETE \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}${PATH}"
```

### Delete Entire Snapshot

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

**Prerequisite:** The snapshot must be **empty** (no resources) and **unlocked** before it can be deleted. The API returns 409 Conflict if the snapshot is not empty or is locked.

Before executing, you MUST:
1. Tell user: "This will permanently delete snapshot '{snapshotId}'. The snapshot must be empty and unlocked first."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms with "yes"

```bash
curl -s -X DELETE \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}"
```

### Publish Single Resource

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}${PATH}?publish=true"
```

### Publish Entire Snapshot

**DESTRUCTIVE OPERATION — CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Tell user: "This will publish ALL resources in snapshot '{snapshotId}' to the live site."
2. Explain impact: "All pages in the snapshot will become publicly visible immediately."
3. Ask: "Do you want to proceed? (yes/no)"
4. Only execute if user confirms with "yes"

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}?publish=true"
```

**Success:** `Published snapshot "{id}" - {count} pages now live`

### Request Review (Lock)

Locks the snapshot for review. Requires `preview:write` permission → `author`, `publish`, or `admin` role.

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}?review=request"
```

**HTTP Response:** 204 (no body). **Success:** `Snapshot "{id}" locked for review`

### Approve Snapshot

**DESTRUCTIVE OPERATION — CONFIRMATION REQUIRED**

Publishes all resources, clears the snapshot, and unlocks it. Requires `live:write` permission → `publish` or `admin` role.

Before executing, you MUST:
1. Tell user: "This will approve snapshot '{snapshotId}' — publishing all resources to live AND clearing the snapshot."
2. Explain impact: "All pages go live immediately and the snapshot is emptied. This cannot be undone."
3. Ask: "Do you want to proceed? (yes/no)"
4. Only execute if user confirms with "yes"

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}?review=approve"
```

**HTTP Response:** 204 (no body). **Success:** `Snapshot "{id}" approved and published`

### Reject Snapshot

Unlocks the snapshot without publishing. Requires `live:write` permission → `publish` or `admin` role.

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}?review=reject"
```

**HTTP Response:** 204 (no body). **Success:** `Snapshot "{id}" rejected`

**Optional `message` parameter:** All review operations accept `?review=request&message=Your+message` to attach a message to logs and events.

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
