---
name: ops-secrets
description: Secrets management for Edge Delivery Services - create, list, and delete secrets at org and site levels.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Secrets Management

Manage secrets for Edge Delivery Services at organization and site levels.

## API Reference

### Organization Secrets

| Intent | Endpoint | Method |
|--------|----------|--------|
| list org secrets | `/config/{org}/secrets.json` | GET |
| create org secret | `/config/{org}/secrets.json` | POST |
| read org secret | `/config/{org}/secrets/${secretId}.json` | GET |
| delete org secret | `/config/{org}/secrets/${secretId}.json` | DELETE |

### Site Secrets

| Intent | Endpoint | Method |
|--------|----------|--------|
| list site secrets | `/config/{org}/sites/{site}/secrets.json` | GET |
| create site secret | `/config/{org}/sites/{site}/secrets.json` | POST |
| read site secret | `/config/{org}/sites/{site}/secrets/${secretId}.json` | GET |
| delete site secret | `/config/{org}/sites/{site}/secrets/${secretId}.json` | DELETE |

## Operations

### List Organization Secrets
```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/secrets.json"
```

**Response format:** Present as table — Name | ID (secret values are never returned by the API)

### Create Organization Secret

The API accepts either a `hashedSecretConfig` (server-generates the value) or `keySecretConfig` (provide your own key). Both use `description` as the label — the `value` is only returned once in the response.

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"description": "My API secret"}' \
  "https://admin.hlx.page/config/${ORG}/secrets.json"
```

**Success:** HTTP 200 — `{"id": "...", "type": "...", "description": "...", "value": "...", "created": "...", "lastModified": "..."}` — store the `value` immediately, it is only shown once.

### Read Organization Secret
```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/secrets/${SECRET_ID}.json"
```

### Delete Organization Secret
**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Tell user: "This will delete the secret '{secretId}' from the organization. Any integrations using this secret will break."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms with "yes"

```bash
curl -s --connect-timeout 15 --max-time 120 -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/secrets/${SECRET_ID}.json"
```

**Success:** `Deleted org secret: {secretId}`

### List Site Secrets
```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/secrets.json"
```

**Response format:** Present as table — Name | ID

### Create Site Secret

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"description": "My site secret"}' \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/secrets.json"
```

**Success:** HTTP 200 — store the returned `value` immediately, it is only shown once.

### Read Site Secret
```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/secrets/${SECRET_ID}.json"
```

### Delete Site Secret
**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Tell user: "This will delete the secret '{secretId}' from site '{site}'. Any integrations using this secret will break."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms with "yes"

```bash
curl -s --connect-timeout 15 --max-time 120 -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/secrets/${SECRET_ID}.json"
```

**Success:** `Deleted site secret: {secretId}`

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "list secrets" | List site secrets |
| "list org secrets" | List org secrets |
| "create secret MY_API_KEY" | Create secret (ask for value) |
| "add secret for site" | Create site secret |
| "delete secret X" | Delete secret |
| "show secrets" | List secrets |
