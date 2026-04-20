---
name: ops-index-config
description: Search index configuration for Edge Delivery Services - manage helix-index.yaml settings that define indexing rules.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Index Configuration

Manage search index configuration (helix-index.yaml) that defines indexing rules.

## API Reference

| Intent | Endpoint | Method |
|--------|----------|--------|
| read index config | `/config/{org}/{site}/helix-index.yaml` | GET |
| update index config | `/config/{org}/{site}/helix-index.yaml` | POST |

## Operations

### Read Index Configuration

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/${SITE}/helix-index.yaml"
```

### Update Index Configuration

**Requires Admin role.**

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/x-yaml" \
  --data-binary @helix-index.yaml \
  "https://admin.hlx.page/config/${ORG}/${SITE}/helix-index.yaml"
```

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "show index config" | Read index config |
| "update index config" | Update index config |
