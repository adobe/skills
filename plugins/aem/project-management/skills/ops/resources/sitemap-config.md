---
name: ops-sitemap-config
description: Sitemap configuration for Edge Delivery Services - manage helix-sitemap.yaml settings that define sitemap generation rules.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Sitemap Configuration

Manage sitemap configuration (helix-sitemap.yaml) that defines sitemap generation rules.

## API Reference

| Intent | Endpoint | Method |
|--------|----------|--------|
| read sitemap config | `/config/{org}/{site}/helix-sitemap.yaml` | GET |
| update sitemap config | `/config/{org}/{site}/helix-sitemap.yaml` | POST |

## Operations

### Read Sitemap Configuration

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/${SITE}/helix-sitemap.yaml"
```

**▶ Recommended Next Actions:**
1. Update the sitemap configuration if rules need to change
   ```
   update sitemap config
   ```
2. Regenerate the sitemap to apply current rules
   ```
   generate sitemap
   ```

### Update Sitemap Configuration

**Requires Admin role.**

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/x-yaml" \
  --data-binary @helix-sitemap.yaml \
  "https://admin.hlx.page/config/${ORG}/${SITE}/helix-sitemap.yaml"
```

**▶ Recommended Next Actions:**
1. Verify the config was saved correctly
   ```
   show sitemap config
   ```
2. Regenerate the sitemap to apply the updated rules
   ```
   generate sitemap
   ```

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "show sitemap config" | Read sitemap config |
| "update sitemap config" | Update sitemap config |
