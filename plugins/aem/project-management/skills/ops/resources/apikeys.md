---
name: ops-apikeys
description: API key management for Edge Delivery Services - create, list, and revoke API keys at org and site levels.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - API Key Management

Manage API keys for programmatic access to Edge Delivery Services.

## API Reference

### Organization API Keys

| Intent | Endpoint | Method |
|--------|----------|--------|
| list org API keys | `/config/{org}/apiKeys.json` | GET |
| create org API key | `/config/{org}/apiKeys.json` | POST |
| read org API key | `/config/{org}/apiKeys/{keyId}.json` | GET |
| revoke org API key | `/config/{org}/apiKeys/{keyId}.json` | DELETE |

### Site API Keys

| Intent | Endpoint | Method |
|--------|----------|--------|
| list site API keys | `/config/{org}/sites/{site}/apiKeys.json` | GET |
| create site API key | `/config/{org}/sites/{site}/apiKeys.json` | POST |
| read site API key | `/config/{org}/sites/{site}/apiKeys/{keyId}.json` | GET |
| revoke site API key | `/config/{org}/sites/{site}/apiKeys/{keyId}.json` | DELETE |

## Critical: POST creates a credential

Any POST to an `apiKeys.json` endpoint creates a new API key, **even with an empty body** (`{}`) — the server fills in defaults (`author` role, `{org}/*` subject, ~1 year expiry). The created key's secret `value` is returned **once** and cannot be retrieved later.

Never POST to these endpoints to "probe" the API. Only POST when the user has explicitly asked to create a key, with the intended role/expiration provided.

## Operations

### List Organization API Keys
```bash
curl -s \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/apiKeys.json"
```

**Response shape:** Object keyed by URL-safe key ID. Empty state returns `{}`.
```json
{
  "{url-safe-key-id}": {
    "id": "{raw-key-id}",
    "roles": ["author"],
    "subject": "{org}/*",
    "expiration": "{iso-timestamp}",
    "created": "{iso-timestamp}"
  }
}
```

**Note:** The outer key uses URL-safe base64 (`+` → `-`), but the inner `id` field uses raw base64 (`+`). Use the outer (URL-safe) form when constructing DELETE URLs.

**Present as table:** ID | Roles | Subject | Expiration | Created

### Create Organization API Key

**CAUTION — CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Confirm the user explicitly asked to create a key (not "list" or "check")
2. Tell user: "This will create a new API key with role(s) {roles} for {subject}. The secret value is shown once and cannot be retrieved later."
3. Ask: "Do you want to proceed? (yes/no)"
4. Only execute if user confirms with "yes"

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"roles": ["author"], "subject": "${ORG}/*", "expiration": "2027-12-31T00:00:00.000Z"}' \
  "https://admin.hlx.page/config/${ORG}/apiKeys.json"
```

**Response shape on success:** HTTP 200 with the new key. The `value` field is the JWT — show it to the user **once** and never persist it.
```json
{
  "id": "{raw-key-id}",
  "roles": ["author"],
  "subject": "{org}/*",
  "expiration": "{iso-timestamp}",
  "created": "{iso-timestamp}",
  "value": "{jwt-token}"
}
```

**Important:** The `value` (JWT) is only returned in this response. There is no GET that returns it. Store securely or it must be revoked and recreated.

### Read Organization API Key
```bash
curl -s \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/apiKeys/${KEY_ID}.json"
```

### Revoke Organization API Key
**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Tell user: "This will revoke API key '{keyId}'. Any CI/CD pipelines or automations using this key will stop working immediately."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms with "yes"

```bash
curl -s -X DELETE \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/apiKeys/${KEY_ID}.json"
```

**Success:** `Revoked org API key: {keyId}`

### List Site API Keys
```bash
curl -s \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/apiKeys.json"
```

**Response shape:** Same as org listing — object keyed by URL-safe key ID; empty state returns `{}`.

**Present as table:** ID | Roles | Subject | Expiration | Created

### Create Site API Key

**CAUTION — CONFIRMATION REQUIRED**

Same gate as Create Organization API Key. Confirm explicit user intent and warn that the secret value is shown only once.

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"roles": ["author"], "subject": "${ORG}/${SITE}/*", "expiration": "2027-12-31T00:00:00.000Z"}' \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/apiKeys.json"
```

**Response shape:** Same as org create — `{id, roles, subject, expiration, created, value}`. The `value` is the one-time JWT.

### Read Site API Key
```bash
curl -s \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/apiKeys/${KEY_ID}.json"
```

### Revoke Site API Key
**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Tell user: "This will revoke API key '{keyId}' for site '{site}'. Any CI/CD pipelines or automations using this key will stop working immediately."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms with "yes"

```bash
curl -s -X DELETE \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/apiKeys/${KEY_ID}.json"
```

**Success:** `Revoked site API key: {keyId}`

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "list API keys" | List site API keys |
| "list org API keys" | List org API keys |
| "create API key for CI/CD" | Create API key |
| "generate API key" | Create API key |
| "revoke API key X" | Delete API key |
| "delete API key X" | Delete API key |
| "show API keys" | List API keys |
