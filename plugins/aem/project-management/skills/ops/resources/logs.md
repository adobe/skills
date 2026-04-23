---
name: ops-logs
description: Log operations for Edge Delivery Services - view audit logs with time filters, add log entries.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Logs

View and manage audit logs for Edge Delivery Services.

## When to Use

- Investigating when a content change was made and by whom
- Auditing preview and publish activity over a specific time window
- Diagnosing unexpected content changes by reviewing recent operation history
- Adding a manual log entry to mark a deployment, release, or significant event
- Compliance review — retrieving a time-bounded record of all site operations

## API Reference

| Intent | Endpoint | Method |
|--------|----------|--------|
| view logs | `/log/{org}/{site}/{ref}` | GET |
| view with filter | `/log/{org}/{site}/{ref}?since={duration}` | GET |
| view time range | `/log/{org}/{site}/{ref}?from={iso}&to={iso}` | GET |
| add log entry | `/log/{org}/{site}/{ref}` | POST |

## Operations

### View Logs (Default: 7 days)

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/log/${ORG}/${SITE}/${REF}"
```

**Success:** `Showing {count} log entries from last 7 days`
**▶ Recommended Next Actions:**
1. Narrow results to recent activity only
   ```
   show logs from last hour
   ```
2. Check the status of a path that appears in the logs
   ```
   check status of {path}
   ```

### View Logs with Duration Filter

```bash
# Last hour
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/log/${ORG}/${SITE}/${REF}?since=1h"

# Last 24 hours
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/log/${ORG}/${SITE}/${REF}?since=24h"

# Last 3 days
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/log/${ORG}/${SITE}/${REF}?since=3d"
```

**▶ Recommended Next Actions:**
1. Check the publish status of a path that appears in the logs
   ```
   check status of {path}
   ```
2. Narrow to an exact time window
   ```
   show logs from 2024-01-01T00:00:00Z to 2024-01-01T23:59:59Z
   ```

### View Logs with Time Range

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/log/${ORG}/${SITE}/${REF}?from=2024-01-01T00:00:00Z&to=2024-01-02T00:00:00Z"
```

**▶ Recommended Next Actions:**
1. Check publish status of a path that appeared in the time range
   ```
   check status of {path}
   ```
2. Add a log entry to record a manual deployment action
   ```
   add log entry
   ```

### Add Log Entry

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"entries": [{"message": "Manual deployment completed", "level": "info"}]}' \
  "https://admin.hlx.page/log/${ORG}/${SITE}/${REF}"
```

Log levels: `info`, `warn`, `error`

**Success:** `Log entry recorded`

**▶ Recommended Next Actions:**
1. Verify the entry was recorded
   ```
   show logs from last hour
   ```

## Duration Format

| Format | Meaning |
|--------|---------|
| `1h` | Last 1 hour |
| `24h` | Last 24 hours |
| `3d` | Last 3 days |
| `7d` | Last 7 days (default) |

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "show logs" | Get logs (7 days) |
| "show logs from last hour" | Get logs `since=1h` |
| "show logs from last 24 hours" | Get logs `since=24h` |
| "show errors" | Get logs filtered for errors |
| "what happened yesterday" | Get logs `since=24h` |
| "audit log" | Get logs |
| "activity log" | Get logs |

## Success Criteria

- ✅ Log entries retrieved and displayed with timestamps, operation types, and affected paths
- ✅ Time filter applied correctly — user informed of the date range covered
- ✅ Manual log entry confirmed with HTTP 200 and the recorded message shown to user
- ✅ Empty result set explained — user informed if no activity occurred in the requested window
