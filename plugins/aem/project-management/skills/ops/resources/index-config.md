---
name: ops-index-config
description: Search index configuration for Edge Delivery Services - manage query.yaml settings that define indexing rules and properties.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Index Configuration

Manage search index configuration (`query.yaml`) that defines indexing rules and properties for a site.

## API Reference

| Intent | Endpoint | Method |
|--------|----------|--------|
| read index config | `/config/{org}/sites/{site}/content/query.yaml` | GET |
| update index config | `/config/{org}/sites/{site}/content/query.yaml` | POST |
| create index config | `/config/{org}/sites/{site}/content/query.yaml` | PUT |
| delete index config | `/config/{org}/sites/{site}/content/query.yaml` | DELETE |

> Response content type is `text/yaml`. Update (POST) returns HTTP 204 on success.

## Operations

### Read Index Configuration

```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/content/query.yaml"
```

**Example response:**
```yaml
version: 1
indices:
  default:
    include:
      - '/**'
    target: /query-index.json
    properties:
      lastModified:
        select: none
        value: parseTimestamp(headers["last-modified"], "ddd, DD MMM YYYY hh:mm:ss GMT")
```

### Update Index Configuration

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: text/yaml" \
  --data-binary @query.yaml \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/content/query.yaml"
```

**Success:** HTTP 204 (no body)

### Create Index Configuration

Use PUT to create a new index config. Returns 201 on success; returns 409 if a config already exists (use POST to update instead).

```bash
curl -s --connect-timeout 15 --max-time 120 -X PUT \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: text/yaml" \
  --data-binary @query.yaml \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/content/query.yaml"
```

**Success:** HTTP 201

### Delete Index Configuration
**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Tell user: "This will delete the index configuration for site '${SITE}'. Search indexing will stop working."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms with "yes"

```bash
curl -s --connect-timeout 15 --max-time 120 -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}/content/query.yaml"
```

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "show index config" | Read index config |
| "read query config" | Read index config |
| "update index config" | Update index config |
| "create index config" | Create index config |
| "delete index config" | Delete index config |
