---
name: ops-sitemap
description: Sitemap operations for Edge Delivery Services - generate sitemap.xml files at specified paths.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Sitemap

Generate sitemap files for Edge Delivery Services sites.

## API Reference

| Intent | Endpoint | Method |
|--------|----------|--------|
| generate sitemap | `/sitemap/{org}/{site}/{ref}/{path}` | POST |

The `{path}` is where the sitemap will be created (e.g., `/sitemap.xml`).

## Operations

### Generate Sitemap

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/sitemap/${ORG}/${SITE}/${REF}${PATH}"
```

**Default path:** `/sitemap.xml`

**Success:** `Sitemap generated at {path}`

### Custom Sitemap Path

Generate sitemap at a specific location:

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/sitemap/${ORG}/${SITE}/${REF}/sitemaps/blog.xml"
```

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "generate sitemap" | Generate at `/sitemap.xml` |
| "create sitemap" | Generate at `/sitemap.xml` |
| "create sitemap at /sitemaps/blog.xml" | Generate at custom path |
| "update the sitemap" | Generate at `/sitemap.xml` |
| "refresh sitemap" | Generate at `/sitemap.xml` |
