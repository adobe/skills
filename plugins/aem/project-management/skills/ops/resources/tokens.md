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

**▶ Recommended Next Actions:**
1. Create a new token for a service or pipeline
   ```
   create token
   ```
2. Revoke a token that is no longer in use
   ```
   revoke token {tokenId}
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
**▶ Recommended Next Actions:**
1. List tokens to confirm creation
   ```
   list tokens
   ```
2. Revoke immediately if the token value was exposed
   ```
   revoke token {tokenId}
   ```

### Get Token

**Requires Admin role.**

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/${SITE}/tokens/${TOKEN_ID}"
```

**▶ Recommended Next Actions:**
1. Revoke this token if it is no longer needed or was exposed
   ```
   revoke token {tokenId}
   ```
2. List all tokens to audit active access
   ```
   list tokens
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
**▶ Recommended Next Actions:**
1. List tokens to confirm removal
   ```
   list tokens
   ```
2. Create a replacement token for the affected system
   ```
   create token
   ```

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "list tokens" | List tokens |
| "create token" | Create token |
| "revoke token X" | Revoke token |
| "delete token X" | Revoke token |
