---
name: ops-jobs
description: Job management operations for Edge Delivery Services - list running jobs, check job status, stop jobs. For tracking bulk operations.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Job Management

Track and manage bulk operation jobs for Edge Delivery Services.

## When to Use

- A bulk preview or publish was triggered and you need to check its progress
- A job appears to be stuck or taking longer than expected
- Cancelling a bulk operation that was started by mistake
- Auditing recent bulk operations (preview/publish/index) and their outcomes
- Diagnosing why some pages were not included in a bulk operation result

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
| `live-remove` | Bulk unpublish operations |
| `preview-remove` | Bulk delete preview operations |
| `index-remove` | Bulk remove from index operations |

## Operations

### List Jobs

```bash
for TOPIC in preview live index live-remove preview-remove index-remove; do
  curl -s \
    -H "authorization: token ${AUTH_TOKEN}" \
    "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/${TOPIC}"
done
```

**On success:** Merge results across all topics. Display in a table with columns **Job Name**, **Topic**, **State**, **Processed**, **Total**, and **Started**. Report total count. Skip topics that return empty or error.

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

If `TOPIC` is not known from context, probe all topics and use the first that returns HTTP 200:

```bash
for TOPIC in preview live index live-remove preview-remove index-remove; do
  HTTP=$(curl -s -w "%{http_code}" -o /tmp/job_status.json \
    -H "authorization: token ${AUTH_TOKEN}" \
    "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/${TOPIC}/${JOB_NAME}")
  [ "$HTTP" = "200" ] && break
done
cat /tmp/job_status.json
```

**On success (200):** Display a status summary:

| Field | Value |
|-------|-------|
| **Job Name** | `{job.name}` |
| **State** | `{job.state}` (created / running / stopped) |
| **Processed** | `{job.progress.processed}` / `{job.progress.total}` |
| **Failed** | `{job.progress.failed}` |

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

If `TOPIC` is not known from context, probe all topics and use the first that returns HTTP 200:

```bash
for TOPIC in preview live index live-remove preview-remove index-remove; do
  HTTP=$(curl -s -w "%{http_code}" -o /tmp/job_details.json \
    -H "authorization: token ${AUTH_TOKEN}" \
    "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/${TOPIC}/${JOB_NAME}/details")
  [ "$HTTP" = "200" ] && break
done
cat /tmp/job_details.json
```

**On success (200):** Display results in a table with columns **Path**, **Status**, and **Error** (if any). Summarise: total paths, succeeded count, failed count. Highlight any failed paths.

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

If `TOPIC` is not known from context, probe all topics to find the job first (same as Get Job Status), then delete:

```bash
for TOPIC in preview live index live-remove preview-remove index-remove; do
  HTTP=$(curl -s -w "%{http_code}" -o /dev/null \
    -H "authorization: token ${AUTH_TOKEN}" \
    "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/${TOPIC}/${JOB_NAME}")
  [ "$HTTP" = "200" ] && break
done

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
| "job status job-2026-..." | Get job status (probe all topics) |
| "how is job job-2026-... doing" | Get job status (probe all topics) |
| "get job details job-2026-..." | Get job details (probe all topics) |
| "stop job job-2026-..." | Stop job (probe all topics) |
| "cancel job job-2026-..." | Stop job (probe all topics) |
| "what jobs are running" | List jobs |
| "check bulk operation status" | List jobs |

## Success Criteria

- ✅ Job state reported clearly (running / completed / failed / stopped)
- ✅ Job details include processed count, error count, and any failed paths
- ✅ Stop operation confirmed with user before executing
- ✅ User directed to re-run the bulk operation for any failed paths after a job completes
