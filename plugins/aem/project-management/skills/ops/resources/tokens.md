---
name: ops-tokens
description: Access token management for Edge Delivery Services - create, list, and revoke access tokens at site level.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Access Tokens

Manage access tokens for Edge Delivery Services sites.

## API Reference

| Intent | Endpoint | Method |
|--------|----------|--------|
| list tokens | `/config/{org}/{site}/tokens` | GET |
| create token | `/config/{org}/{site}/tokens` | POST |
| get token | `/config/{org}/{site}/tokens/{tokenId}` | GET |
| revoke token | `/config/{org}/{site}/tokens/{tokenId}` | DELETE |

## Operations

### List Tokens

**Requires Admin role.**

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/${SITE}/tokens"
```

### Create Token

**Requires Admin role.**

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Preview Token", "scopes": ["preview"]}' \
  "https://admin.hlx.page/config/${ORG}/${SITE}/tokens"
```

**Success:** `Created token: {name} (ID: {tokenId})`

**Important:** Token value is only returned once at creation. Store it securely.

### Get Token

**Requires Admin role.**

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/${SITE}/tokens/${TOKEN_ID}"
```

### Revoke Token

**Requires Admin role.**

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Confirm: "This will revoke token '{tokenId}'. Any systems using this token will lose access. Proceed? (yes/no)"

```bash
curl -s -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/${SITE}/tokens/${TOKEN_ID}"
```

**Success:** `Revoked token: {tokenId}`

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "list tokens" | List tokens |
| "create token" | Create token |
| "revoke token X" | Revoke token |
| "delete token X" | Revoke token |
