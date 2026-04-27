---
name: ops-sitemap-config
description: Sitemap configuration for Edge Delivery Services - manage sitemap.yaml settings that define sitemap generation rules.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Sitemap Configuration

Manage sitemap configuration (`sitemap.yaml`) that defines sitemap generation rules for a site.

## API Reference

| Intent | Endpoint | Method |
|--------|----------|--------|
| read sitemap config | `/config/{org}/sites/{site}/content/sitemap.yaml` | GET |
| update sitemap config | `/config/{org}/sites/{site}/content/sitemap.yaml` | POST |
| create sitemap config | `/config/{org}/sites/{site}/content/sitemap.yaml` | PUT |
| delete sitemap config | `/config/{org}/sites/{site}/content/sitemap.yaml` | DELETE |

> Response content type is `text/yaml`. Update (POST) returns HTTP 204 on success.

## Operations

### Read Sitemap Configuration

```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/content/sitemap.yaml"
```

**Example response:**
```yaml
version: 1
sitemaps:
  default:
    source: /sitemap-index.json
    destination: /sitemap.xml
    lastmod: YYYY-MM-DD
```

### Update Sitemap Configuration

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: text/yaml" \
  --data-binary @sitemap.yaml \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/content/sitemap.yaml"
```

**Success:** HTTP 204 (no body)

### Create Sitemap Configuration

Use PUT to create a new sitemap config. Returns 201 on success; returns 409 if a config already exists (use POST to update instead).

```bash
curl -s --connect-timeout 15 --max-time 120 -X PUT \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: text/yaml" \
  --data-binary @sitemap.yaml \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/content/sitemap.yaml"
```

**Success:** HTTP 201

### Delete Sitemap Configuration
**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Tell user: "This will delete the sitemap configuration for site '${SITE}'. Sitemap generation will stop working."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms with "yes"

```bash
curl -s --connect-timeout 15 --max-time 120 -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/content/sitemap.yaml"
```

## Sitemap Config Schema

Each sitemap entry supports:
- `source` — path to the source resource (e.g. `/sitemap-index.json`)
- `origin` — base origin to prepend to paths
- `destination` — where to write the sitemap (e.g. `/sitemap.xml`)
- `lastmod` — date format for last-modified (e.g. `YYYY-MM-DD`)
- `languages` — language alternatives to include
- `extension` — extension to append to each location (default: empty)

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "show sitemap config" | Read sitemap config |
| "read sitemap settings" | Read sitemap config |
| "update sitemap config" | Update sitemap config |
| "create sitemap config" | Create sitemap config |
| "delete sitemap config" | Delete sitemap config |
