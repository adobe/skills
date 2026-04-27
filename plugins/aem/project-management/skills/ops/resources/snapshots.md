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
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main"
```

**Response format:** Present as table — ID | Title | Status | Created

### Create/Update Snapshot Manifest

Creates a new snapshot or updates metadata on an existing one. Also used to lock/unlock: set `"locked": true` to lock for review (requires `preview:write`), `"locked": false` to unlock (requires `live:write`).

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"title": "Q2 Launch", "description": "Product pages for Q2 release"}' \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}"
```

**Success:** `Snapshot "{id}" created`

### Get Snapshot Manifest

```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}"
```

### Add Resource to Snapshot

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}${PATH}"
```

**Success:** `Added {path} to snapshot "{id}"`

### Bulk Add Resources

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/products/new-widget", "/products/new-gadget", "/blog/announcement"]}' \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}/*"
```

### Remove Resource from Snapshot

```bash
curl -s --connect-timeout 15 --max-time 120 -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
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
curl -s --connect-timeout 15 --max-time 120 -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}"
```

### Publish Single Resource

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}${PATH}?publish=true"
```

### Publish Entire Snapshot

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}?publish=true"
```

**Success:** `Published snapshot "{id}" - {count} pages now live`

### Request Review (Lock)

Locks the snapshot for review. Requires `preview:write` permission → `author`, `publish`, or `admin` role.

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}?review=request"
```

**HTTP Response:** 204 (no body). **Success:** `Snapshot "{id}" locked for review`

### Approve Snapshot

Publishes all resources, clears the snapshot, and unlocks it. Requires `live:write` permission → `publish` or `admin` role.

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/snapshot/${ORG}/${SITE}/main/${SNAPSHOT_ID}?review=approve"
```

**HTTP Response:** 204 (no body). **Success:** `Snapshot "{id}" approved and published`

### Reject Snapshot

Unlocks the snapshot without publishing. Requires `live:write` permission → `publish` or `admin` role.

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
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
