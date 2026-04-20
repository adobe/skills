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
| `live` | Bulk publish operations |
| `index` | Bulk indexing operations |

## Operations

### List Jobs

```bash
# List preview jobs
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/preview"

# List publish jobs
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/live"

# List index jobs
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/index"
```

### Get Job Status

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/${TOPIC}/${JOB_NAME}"
```

Returns job progress: total, completed, failed, pending.

### Get Job Details

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/${TOPIC}/${JOB_NAME}/details"
```

Returns per-path status within the job.

### Stop Job

```bash
curl -s -X DELETE \
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

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "show running jobs" | List jobs (all topics) |
| "list jobs" | List jobs (all topics) |
| "job status preview-123" | Get job status |
| "how is job preview-123 doing" | Get job status |
| "stop job preview-123" | Stop job |
| "cancel job index-456" | Stop job |
| "what jobs are running" | List jobs |
| "check bulk operation status" | List jobs |
