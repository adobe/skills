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
| get token | `/config/{org}/sites/{site}/tokens/{tokenId}.json` | GET |
| revoke token | `/config/{org}/sites/{site}/tokens/{tokenId}.json` | DELETE |

## Critical: POST creates a token

Any POST to `tokens.json` creates a new access token, **even with an empty body** (`{}`) — the server fills in defaults. The token's secret `value` (an `hlx_…` string) is returned **once** and cannot be retrieved later.

Never POST to this endpoint to "probe" the API. Only POST when the user has explicitly asked to create a token.

## Operations

### List Tokens
```bash
curl -s \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/tokens.json"
```

**Response shape:** JSON array. Empty state returns `[]`.

**Present as table:** ID | Created (additional fields may be present per token configuration)

### Create Token

**CAUTION — CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Confirm the user explicitly asked to create a token
2. Tell user: "This will create a new access token for site '{site}'. The secret value is shown once and cannot be retrieved later."
3. Ask: "Do you want to proceed? (yes/no)"
4. Only execute if user confirms with "yes"

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/tokens.json"
```

**Response shape on success:** HTTP 200 with the new token. The `value` field is the secret — show it to the user **once** and never persist it.
```json
{
  "id": "{token-id}",
  "value": "hlx_{secret-string}",
  "created": "{iso-timestamp}"
}
```

**Important:** The `value` (`hlx_...`) is only returned in this response. There is no GET that returns it. Store securely or it must be revoked and recreated.

### Get Token
```bash
curl -s \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/tokens/${TOKEN_ID}.json"
```

### Revoke Token
**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Tell user: "This will revoke token '{tokenId}'. Any systems using this token will lose access immediately."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms with "yes"

```bash
curl -s -X DELETE \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
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
