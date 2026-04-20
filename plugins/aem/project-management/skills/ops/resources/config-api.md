---
name: ops-config-api
description: Configuration API operations for Edge Delivery Services - read/write org and site configs, manage robots.txt.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Configuration API

Read and manage organization and site configurations.

## API Reference

### Organization Config

| Intent | Endpoint | Method |
|--------|----------|--------|
| read org config | `/config/{org}.json` | GET |
| update org config | `/config/{org}.json` | POST |
| create org config | `/config/{org}.json` | PUT |
| delete org config | `/config/{org}.json` | DELETE |

### Site Config

| Intent | Endpoint | Method |
|--------|----------|--------|
| read site config | `/config/{org}/{site}.json` | GET |
| update site config | `/config/{org}/{site}.json` | POST |
| create site config | `/config/{org}/{site}.json` | PUT |
| delete site config | `/config/{org}/{site}.json` | DELETE |

### Robots.txt

| Intent | Endpoint | Method |
|--------|----------|--------|
| read robots.txt | `/config/{org}/{site}.json/robots.txt` | GET |
| update robots.txt | `/config/{org}/{site}.json/robots.txt` | POST |

## Operations

### Read Organization Config

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}.json"
```

### Update Organization Config

**Requires Admin role.**

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"property": "value"}' \
  "https://admin.hlx.page/config/${ORG}.json"
```

### Create Organization Config

**Requires Admin role. Fails if org already exists.**

```bash
curl -s -X PUT \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"property": "value"}' \
  "https://admin.hlx.page/config/${ORG}.json"
```

### Delete Organization Config

**Requires Admin role.**

**CRITICAL DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. WARN user: "This will DELETE the entire organization configuration for '{org}'. This may break ALL sites under this org."
2. Ask: "Are you absolutely sure? This cannot be undone. Type 'DELETE {org}' to confirm."
3. Only execute if user types the exact confirmation

```bash
curl -s -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}.json"
```

### Read Site Config

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/${SITE}.json"
```

### Update Site Config

**Requires Admin role.**

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"property": "value"}' \
  "https://admin.hlx.page/config/${ORG}/${SITE}.json"
```

### Create Site Config

**Requires Admin role. Fails if site already exists.**

```bash
curl -s -X PUT \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"property": "value"}' \
  "https://admin.hlx.page/config/${ORG}/${SITE}.json"
```

### Delete Site Config

**Requires Admin role.**

**CRITICAL DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. WARN user: "This will DELETE the entire site configuration for '{site}'. The site will stop working."
2. Ask: "Are you absolutely sure? This cannot be undone. Type 'DELETE {site}' to confirm."
3. Only execute if user types the exact confirmation

```bash
curl -s -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/${SITE}.json"
```

### Read Robots.txt

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/${SITE}.json/robots.txt"
```

### Update Robots.txt

**Requires Admin role.**

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: text/plain" \
  -d 'User-agent: *
Disallow: /private/
Allow: /' \
  "https://admin.hlx.page/config/${ORG}/${SITE}.json/robots.txt"
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
