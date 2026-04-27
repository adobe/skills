---
name: ops-pages
description: List all pages from query-index. Fetches indexed content and shows preview/live URLs.
allowed-tools: Read, Bash
---

# Edge Delivery Services Operations - Pages Module

List all indexed pages for a site using the query-index.

## Prerequisites

- Site must have indexing configured (`query.yaml` managed via the index-config resource, or default)
- Query index must be populated (pages have been previewed/published)

## List All Pages

```bash
# Fetch query-index.json (no auth required)
curl -s --connect-timeout 15 --max-time 120 "https://${REF}--${SITE}--${ORG}.aem.page/query-index.json"
```

**Response format:** Present as table — # | Path | Title | Preview URL | Live URL

If response contains error or no `data` array, inform user:
- No index configured for this site
- No pages have been previewed yet
- Index name may be different (check `query.yaml` via the index-config resource)

## List Pages with Filter

Filter by path prefix (e.g., `/blog`, `/products`):

```bash
curl -s --connect-timeout 15 --max-time 120 "https://${REF}--${SITE}--${ORG}.aem.page/query-index.json"
```

Filter the response data where `path` starts with the requested prefix. Present matching pages in the same table format.

## Custom Index Name

If site uses a named index (defined in `query.yaml`):

```bash
INDEX_NAME="{INDEX_NAME}"  # e.g., "blog", "products"
curl -s --connect-timeout 15 --max-time 120 "https://${REF}--${SITE}--${ORG}.aem.page/${INDEX_NAME}.json"
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
