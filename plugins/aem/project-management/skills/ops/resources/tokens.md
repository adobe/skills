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
| list tokens | `/config/{org}/sites/{site}/tokens.json` | GET |
| create token | `/config/{org}/sites/{site}/tokens.json` | POST |
| get token | `/config/{org}/sites/{site}/tokens/${tokenId}.json` | GET |
| revoke token | `/config/{org}/sites/{site}/tokens/${tokenId}.json` | DELETE |

## Operations

### List Tokens
```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/tokens.json"
```

**Response format:** Present as table — ID | Name | Scopes | Expiration

### Create Token
```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Preview Token", "scopes": ["preview"]}' \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/tokens.json"
```

**Success:** `Created token: {name} (ID: {tokenId})`

**Important:** Token value is only returned once at creation. Store it securely.

### Get Token
```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/tokens/${TOKEN_ID}.json"
```

### Revoke Token
**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Confirm: "This will revoke token '{tokenId}'. Any systems using this token will lose access. Proceed? (yes/no)"

```bash
curl -s --connect-timeout 15 --max-time 120 -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/tokens/${TOKEN_ID}.json"
```

**Success:** `Revoked token: {tokenId}`

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "list tokens" | List tokens |
| "create token" | Create token |
| "revoke token X" | Revoke token |
| "delete token X" | Revoke token |
