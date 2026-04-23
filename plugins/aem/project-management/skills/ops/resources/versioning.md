---
name: ops-versioning
description: Configuration versioning for Edge Delivery Services - list versions, view history, restore previous configurations.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Configuration Versioning

Manage configuration version history and rollback.

## When to Use

- A configuration change broke the site and you need to roll back to a known-good state
- Reviewing the history of config changes to diagnose when an issue was introduced
- Auditing who changed what and when in org-level configuration
- Restoring a previous configuration after an accidental or incorrect update
- Cleaning up obsolete version entries to maintain a tidy history

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

**On success (200):** Display each version with its name, timestamp, and author.

**▶ Recommended Next Actions:**
1. Inspect the full config for a specific version
   ```
   show version {versionName}
   ```
2. Restore a previous version if current config is broken
   ```
   restore version {versionName}
   ```

### Get Version Details

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}.json/versions/${VERSION_NAME}"
```

**On success (200):** Display the full org config snapshot for this version.

**▶ Recommended Next Actions:**
1. Restore this version if it is the correct one
   ```
   restore version {versionName}
   ```
2. Compare with current config before restoring
   ```
   show org config
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

**▶ Recommended Next Actions:**
1. Confirm the version was removed
   ```
   list versions
   ```
2. Restore a different version if needed
   ```
   restore version {versionName}
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

**▶ Recommended Next Actions:**
1. Verify the restored configuration is correct
   ```
   show org config
   ```
2. Preview pages to confirm the config change takes effect
   ```
   preview {path}
   ```

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "list versions" | List versions |
| "show version history" | List versions |
| "restore version X" | Restore version |
| "rollback to version X" | Restore version |
| "delete version X" | Delete version |

## Success Criteria

- ✅ Version list shows all available versions with timestamps and identifiers
- ✅ Restore operation applied with HTTP 200 and the restored version confirmed to user
- ✅ Destructive operations (delete version, restore — which overwrites current) confirmed with user before executing
- ✅ User directed to verify configuration after a restore to confirm the correct state was applied
