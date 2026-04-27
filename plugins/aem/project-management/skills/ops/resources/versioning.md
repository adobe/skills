---
name: ops-versioning
description: Configuration versioning for Edge Delivery Services - list versions, view history, restore previous configurations at org, site, and profile level.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Configuration Versioning

Manage configuration version history and rollback for org, site, and profile configurations.

## API Reference

### Org Config Versions
| Intent | Endpoint | Method |
|--------|----------|--------|
| list org versions | `/config/{org}/versions.json` | GET |
| get org version | `/config/{org}/versions/{id}.json` | GET |
| delete org version | `/config/{org}/versions/{id}.json` | DELETE |
| restore org version | `/config/{org}.json?restoreVersion={id}` | POST |

### Site Config Versions
| Intent | Endpoint | Method |
|--------|----------|--------|
| list site versions | `/config/{org}/sites/{site}/versions.json` | GET |
| get site version | `/config/{org}/sites/{site}/versions/{id}.json` | GET |
| delete site version | `/config/{org}/sites/{site}/versions/{id}.json` | DELETE |
| restore site version | `/config/{org}/sites/{site}.json?restoreVersion={id}` | POST |

### Profile Config Versions
| Intent | Endpoint | Method |
|--------|----------|--------|
| list profile versions | `/config/{org}/profiles/{profile}/versions.json` | GET |
| get profile version | `/config/{org}/profiles/{profile}/versions/{id}.json` | GET |
| delete profile version | `/config/{org}/profiles/{profile}/versions/{id}.json` | DELETE |
| restore profile version | `/config/{org}/profiles/{profile}.json?restoreVersion={id}` | POST |

## Operations

### List Versions (Org)

```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/versions.json"
```

**Response format:** Present as table — Version | Created | Name

### List Versions (Site)

```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/versions.json"
```

### List Versions (Profile)

```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/profiles/${PROFILE}/versions.json"
```

### Get Version Details

```bash
# Org config version
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/versions/${VERSION_ID}.json"

# Site config version
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/versions/${VERSION_ID}.json"

# Profile config version
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/profiles/${PROFILE}/versions/${VERSION_ID}.json"
```

### Delete Version
**DESTRUCTIVE - CONFIRMATION REQUIRED**

Confirm: "This will permanently delete version '${VERSION_ID}'. Proceed? (yes/no)"

```bash
# Org config version
curl -s --connect-timeout 15 --max-time 120 -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/versions/${VERSION_ID}.json"

# Site config version
curl -s --connect-timeout 15 --max-time 120 -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/versions/${VERSION_ID}.json"

# Profile config version
curl -s --connect-timeout 15 --max-time 120 -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/profiles/${PROFILE}/versions/${VERSION_ID}.json"
```

### Restore Version
**CAUTION - CONFIRMATION REQUIRED**

Confirm: "This will restore config to version '${VERSION_ID}'. Current config will be replaced. Proceed? (yes/no)"

> Restore uses a `?restoreVersion=` query parameter on the config's own endpoint (POST), not on the versions sub-path.

```bash
# Org config
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}.json?restoreVersion=${VERSION_ID}"

# Site config
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}.json?restoreVersion=${VERSION_ID}"

# Profile config
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/profiles/${PROFILE}.json?restoreVersion=${VERSION_ID}"
```

**Success:** Returns the restored configuration data (HTTP 200)

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "list versions" | List org versions |
| "list site versions" | List site versions |
| "list profile versions for X" | List profile versions |
| "show version history" | List versions |
| "restore version X" | Restore version |
| "rollback to version X" | Restore version |
| "delete version X" | Delete version |
