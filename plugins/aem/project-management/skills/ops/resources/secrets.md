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

**▶ Recommended Next Actions:**
1. Create a new org-level secret for a shared integration
   ```
   create secret {name}
   ```
2. Delete a secret that is no longer in use
   ```
   delete secret {secretId}
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
**▶ Recommended Next Actions:**
1. List org secrets to confirm creation
   ```
   list org secrets
   ```
2. Create a site-level secret if the secret is site-specific
   ```
   create secret {name}
   ```

### Read Organization Secret

**Requires Admin role.**

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/secrets/${SECRET_ID}"
```

**▶ Recommended Next Actions:**
1. Delete this secret if it is no longer needed
   ```
   delete secret {secretId}
   ```
2. List all org secrets to audit what is in use
   ```
   list org secrets
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
**▶ Recommended Next Actions:**
1. List org secrets to confirm removal
   ```
   list org secrets
   ```
2. If any integration broke, create a replacement secret
   ```
   create secret {name}
   ```

### List Site Secrets

**Requires Admin role.**

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/${SITE}/secrets"
```

**▶ Recommended Next Actions:**
1. Create a new site-level secret for an integration
   ```
   create secret {name}
   ```
2. Delete a secret that is no longer in use
   ```
   delete secret {secretId}
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
**▶ Recommended Next Actions:**
1. List site secrets to confirm creation
   ```
   list secrets
   ```
2. Create an org-level secret if the secret applies to all sites
   ```
   list org secrets
   ```

### Read Site Secret

**Requires Admin role.**

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/${SITE}/secrets/${SECRET_ID}"
```

**▶ Recommended Next Actions:**
1. Delete this secret if it is no longer needed
   ```
   delete secret {secretId}
   ```
2. List all site secrets to audit what is in use
   ```
   list secrets
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
**▶ Recommended Next Actions:**
1. List site secrets to confirm removal
   ```
   list secrets
   ```
2. If any integration broke, create a replacement secret
   ```
   create secret {name}
   ```

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "list secrets" | List site secrets |
| "list org secrets" | List org secrets |
| "create secret MY_API_KEY" | Create secret (ask for value) |
| "add secret for site" | Create site secret |
| "delete secret X" | Delete secret |
| "show secrets" | List secrets |
