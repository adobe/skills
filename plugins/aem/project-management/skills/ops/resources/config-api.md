---
name: ops-config-api
description: Configuration API operations for Edge Delivery Services - read/write org and site configs, manage robots.txt.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Configuration API

Read and manage organization and site configurations.

## API Reference

> **Role requirement:** All config read operations require `config:read-redacted` (`config` role or higher). Write operations (update/create/delete) require `config:write` — only `config_admin` or `admin` roles have this permission. If a user gets 403 on config operations, they need the `config_admin` role.

### Organization Config

| Intent | Endpoint | Method | Required Role |
|--------|----------|--------|---------------|
| read org config | `/config/{org}.json` | GET | `config` or `config_admin` or `admin` |
| update org config | `/config/{org}.json` | POST | `config_admin` or `admin` |
| create org config | `/config/{org}.json` | PUT | `config_admin` or `admin` |
| delete org config | `/config/{org}.json` | DELETE | `admin` only |

### Site Config

| Intent | Endpoint | Method | Required Role |
|--------|----------|--------|---------------|
| read site config | `/config/{org}/sites/{site}.json` | GET | `config` or `config_admin` or `admin` |
| update site config | `/config/{org}/sites/{site}.json` | POST | `config_admin` or `admin` |
| create site config | `/config/{org}/sites/{site}.json` | PUT | `config_admin` or `admin` |
| delete site config | `/config/{org}/sites/{site}.json` | DELETE | `admin` only |

### Robots.txt

| Intent | Endpoint | Method | Required Role |
|--------|----------|--------|---------------|
| read robots.txt | `/config/{org}/sites/{site}/robots.txt` | GET | `config` or `config_admin` or `admin` |
| update robots.txt | `/config/{org}/sites/{site}/robots.txt` | POST | `config_admin` or `admin` |

## Operations

### Read Organization Config

```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}.json"
```

### Update Organization Config
```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"property": "value"}' \
  "https://admin.hlx.page/config/${ORG}.json"
```

### Create Organization Config

**Fails if org already exists.

```bash
curl -s --connect-timeout 15 --max-time 120 -X PUT \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"property": "value"}' \
  "https://admin.hlx.page/config/${ORG}.json"
```

### Delete Organization Config
**CRITICAL DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. WARN user: "This will DELETE the entire organization configuration for '{org}'. This may break ALL sites under this org."
2. Ask: "Are you absolutely sure? This cannot be undone. Type 'DELETE {org}' to confirm."
3. Only execute if user types the exact confirmation

```bash
curl -s --connect-timeout 15 --max-time 120 -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}.json"
```

### Read Site Config

```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}.json"
```

**Optional query parameters:**
- `?migrate=true` — Aggregates config from legacy sources (fstab, `.helix/config.xlsx`, etc.)
- `?migrate=true&validate=true` — Also validates the migrated configuration

### Update Site Config
```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"property": "value"}' \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}.json"
```

### Create Site Config

**Fails if site already exists.

```bash
curl -s --connect-timeout 15 --max-time 120 -X PUT \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"property": "value"}' \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}.json"
```

### Delete Site Config
**CRITICAL DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. WARN user: "This will DELETE the entire site configuration for '{site}'. The site will stop working."
2. Ask: "Are you absolutely sure? This cannot be undone. Type 'DELETE {site}' to confirm."
3. Only execute if user types the exact confirmation

```bash
curl -s --connect-timeout 15 --max-time 120 -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}.json"
```

### Read Robots.txt

```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/robots.txt"
```

### Update Robots.txt
```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: text/plain" \
  -d 'User-agent: *
Disallow: /private/
Allow: /' \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/robots.txt"
```

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "show org config" | Read org config |
| "show site config" | Read site config |
| "update org config" | Update org config |
| "update site config" | Update site config |
| "show robots.txt" | Read robots.txt |
| "update robots.txt" | Update robots.txt |
| "block crawlers from /private" | Update robots.txt |
| "show aggregated site config" | Read site config with `?migrate=true` |
