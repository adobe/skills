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
| list org secrets | `/config/{org}/secrets` | GET |
| create org secret | `/config/{org}/secrets` | POST |
| read org secret | `/config/{org}/secrets/{secretId}` | GET |
| delete org secret | `/config/{org}/secrets/{secretId}` | DELETE |

### Site Secrets

| Intent | Endpoint | Method |
|--------|----------|--------|
| list site secrets | `/config/{org}/{site}/secrets` | GET |
| create site secret | `/config/{org}/{site}/secrets` | POST |
| read site secret | `/config/{org}/{site}/secrets/{secretId}` | GET |
| delete site secret | `/config/{org}/{site}/secrets/{secretId}` | DELETE |

## Operations

### List Organization Secrets

**Requires Admin role.**

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/secrets"
```

### Create Organization Secret

**Requires Admin role.**

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name": "MY_SECRET", "value": "secret-value"}' \
  "https://admin.hlx.page/config/${ORG}/secrets"
```

**Success:** `Created org secret: {name}`

### Read Organization Secret

**Requires Admin role.**

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/secrets/${SECRET_ID}"
```

### Delete Organization Secret

**Requires Admin role.**

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Tell user: "This will delete the secret '{secretId}' from the organization. Any integrations using this secret will break."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms with "yes"

```bash
curl -s -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/secrets/${SECRET_ID}"
```

**Success:** `Deleted org secret: {secretId}`

### List Site Secrets

**Requires Admin role.**

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/${SITE}/secrets"
```

### Create Site Secret

**Requires Admin role.**

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name": "SITE_SECRET", "value": "secret-value"}' \
  "https://admin.hlx.page/config/${ORG}/${SITE}/secrets"
```

**Success:** `Created site secret: {name}`

### Read Site Secret

**Requires Admin role.**

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/${SITE}/secrets/${SECRET_ID}"
```

### Delete Site Secret

**Requires Admin role.**

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Tell user: "This will delete the secret '{secretId}' from site '{site}'. Any integrations using this secret will break."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms with "yes"

```bash
curl -s -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/${SITE}/secrets/${SECRET_ID}"
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
