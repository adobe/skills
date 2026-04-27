---
name: ops-sitemap
description: Sitemap operations for Edge Delivery Services - generate sitemap.xml files at specified paths.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Sitemap

Generate sitemap files for Edge Delivery Services sites.

## API Reference

| Intent | Endpoint | Method | Required Role |
|--------|----------|--------|---------------|
| generate sitemap | `/sitemap/{org}/{site}/{ref}/{path}` | POST | `basic_author`+ |

The `{path}` is the destination path for the sitemap (e.g., `/sitemap.xml`). The API returns the list of generated sitemap paths.

## Operations

### Generate Sitemap

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/sitemap/${ORG}/${SITE}/${REF}${PATH}"
```

**Default path:** `/sitemap.xml`

**Success (HTTP 200):** `{"paths": ["/sitemap.xml"]}` — report generated paths to user.

### Custom Sitemap Path

Generate sitemap at a specific location:

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
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
