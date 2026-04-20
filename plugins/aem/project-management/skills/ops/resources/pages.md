---
name: ops-pages
description: List all pages from query-index. Fetches indexed content and shows preview/live URLs.
allowed-tools: Read, Bash
---

# Edge Delivery Services Operations - Pages Module

List all indexed pages for a site using the query-index.

## Prerequisites

- Site must have indexing configured (helix-query.yaml or default)
- Query index must be populated (pages have been previewed/published)

## List All Pages

```bash
ORG=$(cat .claude-plugin/project-config.json | grep -o '"org"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"org"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
SITE=$(cat .claude-plugin/project-config.json | grep -o '"site"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"site"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
REF=$(cat .claude-plugin/project-config.json | grep -o '"ref"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"ref"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
REF=${REF:-main}

# Fetch query-index.json
INDEX_URL="https://${REF}--${SITE}--${ORG}.aem.page/query-index.json"
echo "Fetching index from: $INDEX_URL"

RESPONSE=$(curl -s "$INDEX_URL")

# Check if response is valid JSON with data
if echo "$RESPONSE" | grep -q '"data"'; then
  echo ""
  echo "Indexed Pages:"
  echo "=============="
  echo "$RESPONSE" | node -e "
    const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    if (data.data && Array.isArray(data.data)) {
      data.data.forEach((item, i) => {
        const path = item.path || '';
        const title = item.title || '(no title)';
        console.log(\`\${i+1}. \${path}\`);
        console.log(\`   Title: \${title}\`);
        console.log(\`   Preview: https://${REF}--${SITE}--${ORG}.aem.page\${path}\`);
        console.log(\`   Live: https://${REF}--${SITE}--${ORG}.aem.live\${path}\`);
        console.log('');
      });
      console.log(\`Total: \${data.data.length} pages\`);
    } else {
      console.log('No pages found in index.');
    }
  "
else
  echo "Error: Could not fetch query-index.json"
  echo "Response: $RESPONSE"
  echo ""
  echo "Possible causes:"
  echo "- No index configured for this site"
  echo "- No pages have been previewed yet"
  echo "- Index name is different (check helix-query.yaml)"
fi
```

## List Pages with Filter

Filter by path prefix:

```bash
ORG=$(cat .claude-plugin/project-config.json | grep -o '"org"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"org"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
SITE=$(cat .claude-plugin/project-config.json | grep -o '"site"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"site"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
REF=$(cat .claude-plugin/project-config.json | grep -o '"ref"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"ref"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
REF=${REF:-main}

PATH_FILTER="{PATH_PREFIX}"  # e.g., /blog, /products

RESPONSE=$(curl -s "https://${REF}--${SITE}--${ORG}.aem.page/query-index.json")

echo "Pages under ${PATH_FILTER}:"
echo "$RESPONSE" | node -e "
  const filter = '${PATH_FILTER}';
  const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if (data.data && Array.isArray(data.data)) {
    const filtered = data.data.filter(item => item.path && item.path.startsWith(filter));
    filtered.forEach((item, i) => {
      console.log(\`\${i+1}. \${item.path} - \${item.title || '(no title)'}\`);
    });
    console.log(\`\nFound: \${filtered.length} pages\`);
  }
"
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
