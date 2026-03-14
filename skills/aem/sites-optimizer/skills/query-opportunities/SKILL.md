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

## CSV Export

Use the bundled export script (Python 3, stdlib only):

```bash
python ${CLAUDE_SKILL_DIR}/scripts/export-opportunities.py [--env dev|prod] [--filters KEY=VALUE ...] [--output FILE]
```

Examples:
```bash
# Export all opportunities (prod, default)
python ${CLAUDE_SKILL_DIR}/scripts/export-opportunities.py

# Export with filters
python ${CLAUDE_SKILL_DIR}/scripts/export-opportunities.py --filters type=eq.broken-backlinks status=eq.NEW

# Export from dev with date filter
python ${CLAUDE_SKILL_DIR}/scripts/export-opportunities.py --env dev --filters 'created_at=gte.2025-11-01' --output /tmp/opps.csv
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

Use the bundled suggestions export script (Python 3, stdlib only):

```bash
python ${CLAUDE_SKILL_DIR}/scripts/export-suggestions.py [--env dev|prod] [--opp-filters KEY=VALUE ...] [--sug-filters KEY=VALUE ...] [--output FILE]
```

Examples:
```bash
# Export all suggestions for all opportunities (prod)
python ${CLAUDE_SKILL_DIR}/scripts/export-suggestions.py

# Filter by opportunity type
python ${CLAUDE_SKILL_DIR}/scripts/export-suggestions.py --opp-filters type=eq.broken-backlinks status=eq.NEW

# Filter suggestions by type and status
python ${CLAUDE_SKILL_DIR}/scripts/export-suggestions.py --sug-filters type=eq.CODE_CHANGE status=eq.NEW

# Export from dev
python ${CLAUDE_SKILL_DIR}/scripts/export-suggestions.py --env dev --output /tmp/suggestions.csv
```

## Related Tables

| Table | Use |
|-------|-----|
| `sites` | Base URLs, delivery type, org info |
| `suggestions` | Linked to opportunities via `opportunity_id` |
| `entitlements` | Paid tier info (see `export-paid` skill) |
| `site_enrollments` | Links sites to entitlements |
| `organizations` | Org names, IMS org IDs |
