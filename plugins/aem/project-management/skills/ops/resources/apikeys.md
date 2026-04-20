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
| list org API keys | `/config/{org}/apikeys` | GET |
| create org API key | `/config/{org}/apikeys` | POST |
| read org API key | `/config/{org}/apikeys/{keyId}` | GET |
| revoke org API key | `/config/{org}/apikeys/{keyId}` | DELETE |

### Site API Keys

| Intent | Endpoint | Method |
|--------|----------|--------|
| list site API keys | `/config/{org}/{site}/apikeys` | GET |
| create site API key | `/config/{org}/{site}/apikeys` | POST |
| read site API key | `/config/{org}/{site}/apikeys/{keyId}` | GET |
| revoke site API key | `/config/{org}/{site}/apikeys/{keyId}` | DELETE |

## Operations

### List Organization API Keys

**Requires Admin role.**

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/apikeys"
```

### Create Organization API Key

**Requires Admin role.**

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name": "CI/CD Key", "scopes": ["preview", "live"]}' \
  "https://admin.hlx.page/config/${ORG}/apikeys"
```

**Success:** `Created org API key: {name} (ID: {keyId})`

**Important:** The API key value is only returned once at creation. Store it securely.

### Read Organization API Key

**Requires Admin role.**

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/apikeys/${KEY_ID}"
```

### Revoke Organization API Key

**Requires Admin role.**

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Tell user: "This will revoke API key '{keyId}'. Any CI/CD pipelines or automations using this key will stop working immediately."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms with "yes"

```bash
curl -s -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/apikeys/${KEY_ID}"
```

**Success:** `Revoked org API key: {keyId}`

### List Site API Keys

**Requires Admin role.**

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/${SITE}/apikeys"
```

### Create Site API Key

**Requires Admin role.**

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Site Deploy Key", "scopes": ["preview", "live", "code"]}' \
  "https://admin.hlx.page/config/${ORG}/${SITE}/apikeys"
```

**Success:** `Created site API key: {name} (ID: {keyId})`

### Read Site API Key

**Requires Admin role.**

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/${SITE}/apikeys/${KEY_ID}"
```

### Revoke Site API Key

**Requires Admin role.**

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Tell user: "This will revoke API key '{keyId}' for site '{site}'. Any CI/CD pipelines or automations using this key will stop working immediately."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms with "yes"

```bash
curl -s -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/${SITE}/apikeys/${KEY_ID}"
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
