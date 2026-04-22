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
  -H "authorization: token ${AUTH_TOKEN}" \
  "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/preview"

# List publish jobs
curl -s \
  -H "authorization: token ${AUTH_TOKEN}" \
  "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/live"

# List index jobs
curl -s \
  -H "authorization: token ${AUTH_TOKEN}" \
  "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/index"
```

**▶ Recommended Next Actions:**
1. Check progress of a specific job
   ```
   check job status {jobName}
   ```
2. See per-path results of a completed job
   ```
   get job details {jobName}
   ```
3. Cancel a stuck or unwanted job
   ```
   stop job {jobName}
   ```

### Get Job Status

```bash
curl -s \
  -H "authorization: token ${AUTH_TOKEN}" \
  "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/${TOPIC}/${JOB_NAME}"
```

Returns job progress: total, completed, failed, pending.

| Field | Meaning |
|-------|---------|
| `state: created / running` | Job still in progress |
| `state: stopped` | Job completed or cancelled |
| `progress.processed` | Paths completed so far |
| `progress.total` | Total paths in job |

**▶ Recommended Next Actions:**
1. If job is still running, poll for updated progress
   ```
   check job status {jobName}
   ```
2. If job has stopped, review per-path results
   ```
   get job details {jobName}
   ```
3. If job is taking too long, cancel it
   ```
   stop job {jobName}
   ```

### Get Job Details

```bash
curl -s \
  -H "authorization: token ${AUTH_TOKEN}" \
  "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/${TOPIC}/${JOB_NAME}/details"
```

Returns per-path status within the job.

**▶ Recommended Next Actions:**
1. If individual paths failed, retry them separately
   ```
   preview {failedPath}
   ```
2. If preview job completed successfully, promote to live
   ```
   publish all pages {folder}/
   ```
3. If publish job completed, clear CDN cache for the affected folder
   ```
   purge cache of {folder}/
   ```

### Stop Job

```bash
curl -s -X DELETE \
  -H "authorization: token ${AUTH_TOKEN}" \
  "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/${TOPIC}/${JOB_NAME}"
```

**Success:** `Stopped job {jobName}`

**▶ Recommended Next Actions:**
1. Review which paths completed before cancellation
   ```
   get job details {jobName}
   ```
2. Re-trigger for a single path to verify the operation
   ```
   preview {path}
   ```
3. Re-trigger with a reduced path scope
   ```
   preview all pages {folder}/
   ```

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
