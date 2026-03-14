---
name: query-opportunities
description: Use when querying Spacecat opportunities or suggestions from PostgREST — filtering by tags, type, status, origin, date range, or site. Use when exporting opportunity data to CSV, analyzing opportunities across sites, querying suggestions linked to opportunities, or answering questions about which opportunities or suggestions exist with certain properties.
---

# Query Spacecat Opportunities via PostgREST

Query the `opportunities` table directly via PostgREST (Adobe Internal, requires Adobe VPN).

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

## Suggestions

Suggestions are actionable items linked to opportunities. Each opportunity can have multiple suggestions representing specific changes to make (code changes, content updates, config updates, etc.).

### Suggestion Fields

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `opportunity_id` | UUID | FK to `opportunities` |
| `type` | enum | `CODE_CHANGE`, `CONFIG_UPDATE`, `CONTENT_UPDATE`, `METADATA_UPDATE`, `REDIRECT_UPDATE`, `AI_INSIGHTS` |
| `rank` | integer | Priority/ordering (lower = higher priority) |
| `data` | jsonb | Type-specific payload (URLs, metrics, issues, etc.) |
| `kpi_deltas` | jsonb | KPI impact data (nullable) |
| `status` | enum | `NEW`, `IN_PROGRESS`, `FIXED`, `SKIPPED`, `OUTDATED`, `PENDING_VALIDATION` |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |
| `updated_by` | string | User or `system` |
| `suggestion_key` | string | Optional dedup key (nullable) |
| `skip_reason` | enum | `ALREADY_IMPLEMENTED` (nullable, set when status=SKIPPED) |
| `skip_detail` | string | Free-text skip detail (nullable) |

### Common Suggestion Queries

#### Select specific fields
```
/suggestions?select=id,opportunity_id,type,rank,status,created_at&limit=100
```

#### Filter by type
```
/suggestions?type=eq.CODE_CHANGE
/suggestions?type=in.(CODE_CHANGE,CONTENT_UPDATE)
```

#### Filter by status
```
/suggestions?status=eq.NEW
/suggestions?status=in.(NEW,IN_PROGRESS)
```

#### Filter by opportunity
```
/suggestions?opportunity_id=eq.<uuid>
```

### Joining Opportunities and Suggestions

PostgREST doesn't support cross-table joins on these tables. Use a two-step query pattern:

#### Step 1: Fetch opportunities matching your criteria
```bash
curl -s "https://d1xldhzwm6wv00.cloudfront.net/opportunities?select=id,site_id,title,type,status,tags&type=eq.broken-backlinks&status=eq.NEW&limit=100"
```

#### Step 2: Fetch suggestions for those opportunity IDs
```bash
curl -s "https://d1xldhzwm6wv00.cloudfront.net/suggestions?select=id,opportunity_id,type,rank,status,data&opportunity_id=in.(uuid1,uuid2,uuid3)&order=rank.asc"
```

Batch opportunity IDs in groups of ~30 to avoid URL length limits (same as site lookups).

### CSV Export with Suggestions

```python
import json, csv, sys, urllib.request

BASE = "https://d1xldhzwm6wv00.cloudfront.net"  # prod

# 1. Fetch opportunities
url = f"{BASE}/opportunities?select=id,site_id,title,type,status,tags"
url += "&type=eq.broken-backlinks&status=eq.NEW&limit=1000"
with urllib.request.urlopen(url, timeout=30) as resp:
    opps = json.load(resp)

opp_ids = [o['id'] for o in opps]
opp_map = {o['id']: o for o in opps}

# 2. Fetch suggestions in batches
suggestions = []
for i in range(0, len(opp_ids), 30):
    batch = ",".join(opp_ids[i:i+30])
    sug_url = f"{BASE}/suggestions?select=id,opportunity_id,type,rank,status,data"
    sug_url += f"&opportunity_id=in.({batch})&order=rank.asc"
    with urllib.request.urlopen(sug_url, timeout=30) as resp2:
        suggestions.extend(json.load(resp2))

# 3. Write CSV
with open("/tmp/opportunities_with_suggestions.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(['opportunity_id', 'opp_title', 'opp_status', 'suggestion_id',
                'suggestion_type', 'suggestion_rank', 'suggestion_status'])
    for s in suggestions:
        opp = opp_map.get(s['opportunity_id'], {})
        w.writerow([
            s['opportunity_id'], opp.get('title', ''), opp.get('status', ''),
            s['id'], s['type'], s['rank'], s['status']
        ])

print(f"Exported {len(suggestions)} suggestions across {len(opp_ids)} opportunities")
```

## Related Tables

| Table | Use |
|-------|-----|
| `sites` | Base URLs, delivery type, org info |
| `suggestions` | Linked to opportunities via `opportunity_id` |
| `entitlements` | Paid tier info (see `export-paid` skill) |
| `site_enrollments` | Links sites to entitlements |
| `organizations` | Org names, IMS org IDs |
