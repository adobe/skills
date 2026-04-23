---
name: ops-sitemap
description: Sitemap operations for Edge Delivery Services - generate sitemap.xml files at specified paths.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Sitemap

Generate sitemap files for Edge Delivery Services sites.

## When to Use

- Initial site launch — generating the first sitemap.xml for search engine submission
- After a large batch of pages was published and the sitemap needs to reflect new content
- Sitemap is missing pages or contains stale URLs and needs a full regeneration
- Generating a custom sitemap at a non-default path (e.g., `/en/sitemap.xml`)
- After updating sitemap configuration rules and needing to apply them immediately

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

**On success (200):**
```
Sitemap URL: https://{ref}--{site}--{org}.aem.page{path}
```

**▶ Recommended Next Actions:**
1. Verify the sitemap is accessible — `https://{ref}--{site}--{org}.aem.page{path}`
2. Regenerate if new pages have been published since last run
   ```
   generate sitemap
   ```
3. Update sitemap rules if coverage is incomplete
   ```
   show sitemap config
   ```

### Custom Sitemap Path

Generate sitemap at a specific location:

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/sitemap/${ORG}/${SITE}/${REF}${PATH}"
```

**On success (200):**
```
Sitemap URL: https://{ref}--{site}--{org}.aem.page{path}
```

**▶ Recommended Next Actions:**
1. Verify the sitemap is accessible — `https://{ref}--{site}--{org}.aem.page{path}`
2. Update sitemap rules if coverage is incomplete
   ```
   show sitemap config
   ```
3. Regenerate after publishing new pages
   ```
   generate sitemap
   ```

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "generate sitemap" | Generate at `/sitemap.xml` |
| "create sitemap" | Generate at `/sitemap.xml` |
| "create sitemap at /sitemaps/blog.xml" | Generate at custom `${PATH}` |
| "update the sitemap" | Generate at `/sitemap.xml` |
| "refresh sitemap" | Generate at `/sitemap.xml` |

## Success Criteria

- ✅ HTTP 200 received confirming sitemap generation completed
- ✅ Sitemap URL reported to user — `https://{ref}--{site}--{org}.aem.page{path}`
- ✅ Custom sitemap path acknowledged when user specifies a non-default location
- ✅ User reminded to submit the sitemap URL to search engines after generation
