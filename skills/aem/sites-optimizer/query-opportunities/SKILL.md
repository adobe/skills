---
name: query-opportunities
description: Use when querying Spacecat opportunities from PostgREST — filtering by tags, type, status, origin, date range, or site. Use when exporting opportunity data to CSV, analyzing opportunities across sites, or answering questions about which opportunities exist with certain properties.
---

# Query Spacecat Opportunities via PostgREST

Query the `opportunities` table directly via PostgREST (no auth — anon role has read access).

## PostgREST Endpoints

| Env  | URL |
|------|-----|
| Dev  | `https://dql63ofcyt4dr.cloudfront.net` |
| Prod | `https://d1xldhzwm6wv00.cloudfront.net` |

Default to **prod** unless the user specifies otherwise.

## Opportunity Fields

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `site_id` | UUID | FK to `sites` |
| `audit_id` | UUID | FK to audit that created it |
| `type` | string | e.g. `broken-backlinks`, `canonical`, `generic-opportunity` |
| `origin` | enum | `AI`, `AUTOMATION`, `ESS_OPS` (ESS_OPS = manually created) |
| `title` | string | Human-readable title |
| `description` | string | Detailed description (nullable) |
| `status` | enum | `NEW`, `APPROVED`, `SKIPPED`, `FIXED`, `ERROR`, `IN_PROGRESS`, `OUTDATED`, `PENDING_VALIDATION`, `RESOLVED`, `IGNORED` |
| `tags` | text[] | PostgreSQL array of strings |
| `data` | jsonb | Type-specific payload |
| `guidance` | jsonb | Type-specific guidance |
| `runbook` | string | URL to runbook (nullable) |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

## PostgREST Filter Operators

| Operator | Meaning | Example |
|----------|---------|---------|
| `eq` | Equals | `status=eq.NEW` |
| `neq` | Not equals | `status=neq.RESOLVED` |
| `in` | In list | `status=in.(NEW,APPROVED)` |
| `gte` / `lte` | >= / <= | `created_at=gte.2025-11-01` |
| `cs` | Array contains | `tags=cs.%7B%22Paid Traffic%22%7D` |
| `like` / `ilike` | Pattern match | `title=ilike.*consent*` |

### Array contains (`cs`) — URL encoding

PostgREST array contains uses `cs.{"value"}`. The braces and quotes must be URL-encoded:
- `{` = `%7B`, `}` = `%7D`, `"` = `%22`, space = `%20`
- Example: tag "Paid Traffic" becomes `tags=cs.%7B%22Paid%20Traffic%22%7D`

Use `--data-urlencode` with curl to avoid manual encoding:
```bash
curl -s -G "$URL/opportunities" \
  --data-urlencode 'tags=cs.{"Paid Traffic"}' \
  --data-urlencode 'select=id,site_id,title,status,tags,created_at'
```

## Common Query Patterns

### Select specific fields (always do this to reduce payload)
```
/opportunities?select=id,site_id,title,type,status,tags,origin,created_at
```

### Filter by type and date range
```
/opportunities?type=eq.generic-opportunity&created_at=gte.2025-11-01&order=created_at.desc
```

### Filter by tag (case-sensitive)
Tags are case-sensitive in PostgreSQL arrays. Query each variant separately and deduplicate:
```
/opportunities?tags=cs.%7B%22paid%20media%22%7D
/opportunities?tags=cs.%7B%22Paid%20Traffic%22%7D
```

### Filter by origin (manual vs automated)
```
/opportunities?origin=eq.ESS_OPS        # manually created
/opportunities?origin=eq.AUTOMATION     # system-generated
/opportunities?origin=eq.AI            # AI-generated
```

### Filter by status
```
/opportunities?status=eq.NEW
/opportunities?status=in.(NEW,APPROVED,IN_PROGRESS)
```

### Pagination
```
/opportunities?limit=100&offset=200&order=created_at.desc
```

## Joining with Sites

Opportunities are site-scoped via `site_id`. To get site base URLs, query the `sites` table separately:

```
/sites?select=id,base_url&id=in.(uuid1,uuid2,uuid3)
```

Batch site lookups in groups of ~30 to avoid URL length limits.

## CSV Export Template

```python
import json, csv, sys, urllib.request, urllib.parse

BASE = "https://d1xldhzwm6wv00.cloudfront.net"  # prod

# 1. Fetch opportunities
url = f"{BASE}/opportunities?select=id,site_id,title,type,status,tags,origin,created_at"
url += "&type=eq.generic-opportunity"           # adjust filters
url += "&created_at=gte.2025-11-01"             # adjust date
url += "&order=created_at.desc&limit=1000"
with urllib.request.urlopen(url, timeout=30) as resp:
    opps = json.load(resp)

# 2. Fetch site base URLs
site_ids = list(set(o['site_id'] for o in opps))
sites = {}
for i in range(0, len(site_ids), 30):
    batch = ",".join(site_ids[i:i+30])
    site_url = f"{BASE}/sites?select=id,base_url&id=in.({batch})"
    with urllib.request.urlopen(site_url, timeout=30) as resp2:
        for s in json.load(resp2):
            sites[s['id']] = s['base_url']

# 3. Write CSV
with open("/tmp/opportunities.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(['opportunity_id', 'site_id', 'site_base_url', 'title',
                'type', 'status', 'origin', 'tags', 'created_at'])
    for o in opps:
        w.writerow([
            o['id'], o['site_id'], sites.get(o['site_id'], ''),
            o['title'], o['type'], o['status'], o['origin'],
            '; '.join(o['tags']) if o['tags'] else '',
            o['created_at']
        ])

print(f"Exported {len(opps)} opportunities across {len(sites)} sites")
```

## Related Tables

| Table | Use |
|-------|-----|
| `sites` | Base URLs, delivery type, org info |
| `suggestions` | Linked to opportunities via `opportunity_id` |
| `entitlements` | Paid tier info (see `export-paid` skill) |
| `site_enrollments` | Links sites to entitlements |
| `organizations` | Org names, IMS org IDs |
