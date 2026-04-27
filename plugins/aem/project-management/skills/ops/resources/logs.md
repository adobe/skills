---
name: ops-logs
description: Log operations for Edge Delivery Services - view audit logs with time filters, add log entries.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Logs

View and manage audit logs for Edge Delivery Services.

## API Reference

| Intent | Endpoint | Method | Required Role |
|--------|----------|--------|---------------|
| view logs | `/log/{org}/{site}/{ref}` | GET | `author`+ (`log:read`) |
| view with filter | `/log/{org}/{site}/{ref}?since={duration}` | GET | `author`+ (`log:read`) |
| view time range | `/log/{org}/{site}/{ref}?from={iso}&to={iso}` | GET | `author`+ (`log:read`) |
| add log entry | `/log/{org}/{site}/{ref}` | POST | `author`+ (`log:write`) |

> **Note:** `basic_author` does NOT have `log:read`. The minimum role for viewing logs is `author`.

## Operations

### View Logs (Default: last 15 minutes)

```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/log/${ORG}/${SITE}/${REF}"
```

**Response format:** Present as table — Timestamp | Operation | Path | User

### View Logs with Duration Filter

```bash
# Last hour
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/log/${ORG}/${SITE}/${REF}?since=1h"

# Last 24 hours
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/log/${ORG}/${SITE}/${REF}?since=24h"

# Last 3 days
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/log/${ORG}/${SITE}/${REF}?since=3d"
```

### View Logs with Time Range

```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/log/${ORG}/${SITE}/${REF}?from=2024-01-01T00:00:00Z&to=2024-01-02T00:00:00Z"
```

### Add Log Entry

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"entries": [{"event": "Manual deployment completed"}]}' \
  "https://admin.hlx.page/log/${ORG}/${SITE}/${REF}"
```

**Note:** Entries are free-form JSON objects. The `event` field is the standard key for the message. Other custom fields can be added as needed.

## Duration Format

| Format | Meaning |
|--------|---------|
| `5m` | Last 5 minutes |
| `1h` | Last 1 hour |
| `24h` | Last 24 hours |
| `3d` | Last 3 days |

**Note:** Units are `s` (seconds), `m` (minutes), `h` (hours), `d` (days). If no `since`/`from` is provided, the API defaults to the last 15 minutes.

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "show logs" | Get logs (last 15 min, default) |
| "show logs from last hour" | Get logs `since=1h` |
| "show logs from last 24 hours" | Get logs `since=24h` |
| "show errors" | Get logs filtered for errors |
| "what happened yesterday" | Get logs `since=24h` |
| "audit log" | Get logs |
| "activity log" | Get logs |

## Pagination

For large log sets, the response includes a `nextToken` and `links.next` URL. To retrieve the next batch:

```bash
NEXT_TOKEN="ABAB=="  # from previous response
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/log/${ORG}/${SITE}/${REF}?nextToken=${NEXT_TOKEN}"
```

Keep following `links.next` until it is absent from the response.
