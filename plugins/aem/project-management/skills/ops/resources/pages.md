---
name: ops-pages
description: List all pages from query-index. Fetches indexed content and shows preview/live URLs.
allowed-tools: Read, Bash
---

# Edge Delivery Services Operations - Pages Module

List all indexed pages for a site using the query-index.

## When to Use

- Getting a full inventory of all published pages on a site
- Finding pages to target for bulk preview, publish, or cache operations
- Auditing which pages are indexed and what metadata they expose
- Checking that newly published pages have been picked up by the query index
- Identifying missing or stale pages before a launch or audit

## Prerequisites

- Site must have indexing configured (helix-query.yaml or default)
- Query index must be populated (pages have been previewed/published)

## List All Pages

```bash
curl -s "https://${REF}--${SITE}--${ORG}.aem.page/query-index.json"
```

**On success:** Response contains a `data[]` array of pages currently in the preview CDN query index. For each item display: path, title, preview URL (`https://{ref}--{site}--{org}.aem.page{path}`), and live URL (`https://{ref}--{site}--{org}.aem.live{path}`). Report total count. If `data` is empty or missing, inform the user that no pages are indexed yet — pages must be previewed before they appear in the index.


**▶ Recommended Next Actions:**
1. Preview pages that appear out of date
   ```
   preview {path}
   ```
2. Publish pages that are behind live
   ```
   publish {path}
   ```
3. Check detailed status across preview and live layers
   ```
   check status of {path}
   ```

## List Pages with Filter

Filter by path prefix:

```bash
curl -s "https://${REF}--${SITE}--${ORG}.aem.page/query-index.json"
```

**On success:** From the `data[]` array, display only entries whose `path` starts with `{PATH_PREFIX}`. Report the filtered count.


**▶ Recommended Next Actions:**
1. Preview the filtered set of pages
   ```
   preview all pages {folder}/
   ```
2. Publish the filtered set of pages
   ```
   publish all pages {folder}/
   ```

## Custom Index Name

If site uses a named index (defined in helix-query.yaml):

```bash
INDEX_NAME="{INDEX_NAME}"  # e.g., "blog", "products"
curl -s "https://${REF}--${SITE}--${ORG}.aem.page/${INDEX_NAME}.json"
```

## Output Format

For each page:
- **Path**: Content path (e.g., `/blog/article-1`)
- **Title**: Page title from index
- **Preview URL**: `https://{ref}--{site}--{org}.aem.page{path}`
- **Live URL**: `https://{ref}--{site}--{org}.aem.live{path}`

## Notes

- Query index is public (no auth required)
- Index updates when pages are previewed/published
- Large sites may have paginated results (check `offset` and `limit` in response)
- Custom indexes may have different fields based on helix-query.yaml config

## Success Criteria

- ✅ Query index fetched and total page count reported to user
- ✅ All page paths listed with their preview and live URLs
- ✅ User informed if index is empty or not yet populated (pages need to be previewed/published first)
- ✅ Paginated results handled — all pages retrieved if total exceeds default limit
