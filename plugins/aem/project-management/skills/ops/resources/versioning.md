---
name: ops-versioning
description: Configuration versioning for Edge Delivery Services - list versions, view history, restore previous configurations.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Configuration Versioning

Manage configuration version history and rollback.

## API Reference

| Intent | Endpoint | Method |
|--------|----------|--------|
| list org versions | `/config/{org}.json/versions` | GET |
| get org version | `/config/{org}.json/versions/{versionName}` | GET |
| delete org version | `/config/{org}.json/versions/{versionName}` | DELETE |
| restore org version | `/config/{org}.json/versions/{versionName}` | POST |

## Operations

### List Versions

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}.json/versions"
```

### Get Version Details

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}.json/versions/${VERSION_NAME}"
```

### Delete Version

**Requires Admin role.**

**DESTRUCTIVE - CONFIRMATION REQUIRED**

Confirm: "This will permanently delete version '{versionName}'. Proceed? (yes/no)"

```bash
curl -s -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}.json/versions/${VERSION_NAME}"
```

### Restore Version

**Requires Admin role.**

**CAUTION - CONFIRMATION REQUIRED**

Confirm: "This will restore config to version '{versionName}'. Current config will be replaced. Proceed? (yes/no)"

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}.json/versions/${VERSION_NAME}"
```

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "list versions" | List versions |
| "show version history" | List versions |
| "restore version X" | Restore version |
| "rollback to version X" | Restore version |
| "delete version X" | Delete version |
