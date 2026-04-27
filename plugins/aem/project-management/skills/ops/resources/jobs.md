---
name: ops-jobs
description: Job management operations for Edge Delivery Services - list running jobs, check job status, stop jobs. For tracking bulk operations.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Job Management

Track and manage bulk operation jobs for Edge Delivery Services.

## API Reference

| Intent | Endpoint | Method |
|--------|----------|--------|
| list jobs | `/job/{org}/{site}/{ref}/{topic}` | GET |
| job status | `/job/{org}/{site}/{ref}/{topic}/{jobName}` | GET |
| job details | `/job/{org}/{site}/{ref}/{topic}/{jobName}/details` | GET |
| stop job | `/job/{org}/{site}/{ref}/{topic}/{jobName}` | DELETE |

## Job Topics

| Topic | Description |
|-------|-------------|
| `preview` | Bulk preview operations |
| `publish` | Bulk publish operations |
| `index` | Bulk indexing operations |
| `preview-remove` | Bulk delete preview operations |
| `live-remove` | Bulk unpublish operations |
| `index-remove` | Bulk remove from index operations |

**Note:** Job Status and Job Details endpoints return HTTP **202** (not 200) when the job exists. Stop Job returns **204**.

## Operations

### List Jobs

```bash
# List preview jobs
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/preview"

# List publish jobs
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/publish"

# List index jobs
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/index"
```

**Response format:** Present as table — Name | State | Started (time) | Link (href). The `topic` is the top-level field of the response; progress details are only available via the Job Status endpoint.

### Get Job Status

If topic is known:
```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/${TOPIC}/${JOB_NAME}"
```

If topic is unknown, probe all topics:
```bash
for TOPIC in preview publish index preview-remove live-remove index-remove; do
  HTTP=$(curl -s --connect-timeout 15 --max-time 120 -w "%{http_code}" -o /tmp/job.json \
    -H "x-auth-token: ${AUTH_TOKEN}" \
    "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/${TOPIC}/${JOB_NAME}")
  ([ "$HTTP" = "200" ] || [ "$HTTP" = "202" ]) && cat /tmp/job.json && break
done
```

Returns job progress: total, completed, failed, pending.

### Get Job Details

```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/${TOPIC}/${JOB_NAME}/details"
```

Returns per-path status within the job.

### Stop Job

```bash
curl -s --connect-timeout 15 --max-time 120 -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/${TOPIC}/${JOB_NAME}"
```

**Success:** `Stopped job {jobName}`

## Rate Limits

| Limit | Value |
|-------|-------|
| Concurrent jobs | ~5 active jobs per org |
| Paths per bulk request | 1000 max |

Monitor job completion before starting new jobs to avoid hitting limits.

## Workflow Shortcuts

### Auto-Track Job Until Completion

When a bulk operation returns HTTP 202, offer to track progress:

> "Job `{jobName}` started. Want me to track progress until completion?"

If user confirms, poll status (max 60 attempts, ~10 minutes):

```bash
MAX_ATTEMPTS=60
ATTEMPT=0
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  RESPONSE=$(curl -s --connect-timeout 15 --max-time 120 -w "\n%{http_code}" \
    -H "x-auth-token: ${AUTH_TOKEN}" \
    "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/${TOPIC}/${JOB_NAME}")
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  STATUS=$(echo "$RESPONSE" | sed '$d')
  
  if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "202" ]; then
    echo "Failed to fetch job status (HTTP $HTTP_CODE)"
    break
  fi
  
  PROCESSED=$(echo "$STATUS" | grep -o '"processed"[[:space:]]*:[[:space:]]*[0-9]*' | grep -o '[0-9]*$')
  TOTAL=$(echo "$STATUS" | grep -o '"total"[[:space:]]*:[[:space:]]*[0-9]*' | grep -o '[0-9]*$')
  FAILED=$(echo "$STATUS" | grep -o '"failed"[[:space:]]*:[[:space:]]*[0-9]*' | grep -o '[0-9]*$')
  STATE=$(echo "$STATUS" | grep -o '"state"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"state"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
  
  echo "Progress: ${PROCESSED:-0}/${TOTAL:-?} processed, ${FAILED:-0} failed - State: ${STATE:-unknown}"
  
  [ "$STATE" = "stopped" ] || [ "$STATE" = "completed" ] && break
  
  ATTEMPT=$((ATTEMPT + 1))
  sleep 10
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
  echo "Tracking timeout. Job may still be running - check manually with: job status ${JOB_NAME}"
fi
```

**On completion:** Report summary with total/completed/failed counts.

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "show running jobs" | List jobs (all topics) |
| "list jobs" | List jobs (all topics) |
| "job status preview-123" | Get job status |
| "how is job preview-123 doing" | Get job status |
| "track job preview-123" | Auto-track until completion |
| "stop job preview-123" | Stop job |
| "cancel job index-456" | Stop job |
| "what jobs are running" | List jobs |
| "check bulk operation status" | List jobs |
