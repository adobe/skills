# Alert RCA & observability (dev-only)

Load this when the user asks for alert triage / root-cause analysis.

**Availability:** Splunk and Slack observability tools (`splunk_rw_*`, `get_slack_config`) are
**stdio CLI only** — not on hosted `/mcp`. Alert RCA requires `run-workflow login --dev` with Splunk
(Step 3) and Slack (Step 4) configured, plus the separate `@modelcontextprotocol/server-slack` MCP
server.

**Trigger:** user says "any recent alerts?", "check #run-workflow-service", "what's alerting?",
"give me an RCA", or pastes text containing "Error Breakdown" / "Sample Workflows" / "Severity: HIGH".

## Step 1 — Fetch alerts from Slack

1. Call `get_slack_config` (run-workflow tool) — returns `{ alertsChannelId, configured }`.
   - If `configured: false`: respond "No alerts channel configured. Run `run-workflow login` → Step 4
     to set it up." and stop.
2. Call `slack_get_channel_history` with `channel_id = alertsChannelId` and `limit=20`.
   - If Slack tools are unavailable: respond "I don't have Slack access configured. Please paste the
     alert text and I'll diagnose it."
3. Filter messages that contain "Error Breakdown" or "Sample Workflows" — those are alert payloads.
   **Retain the `ts` field of each matching message** — it is used later to reply in-thread.
4. Process each alert through Steps 2–5 below, starting with the most recent. If multiple alerts
   share the same root cause, group them and keep the `ts` of the last (most recent) one.

**Compute the Splunk time window from the alert `ts`:** The `ts` field is a Unix timestamp in
seconds. Use it to derive an explicit Splunk `timeRange` for all queries in Steps 3–4:

```
alertAgeHours = floor((now_unix_seconds - ts) / 3600)
splunkTimeRange = -(alertAgeHours + 2)h   // add 2h buffer around the incident
```

Example: alert `ts` was 5 hours ago → use `timeRange="-7h"`. All Splunk tool calls in Steps 3–4 MUST
pass this `timeRange` — never rely on the default `-24h` window. If the alert has a "Time Span"
field, also add that duration to the buffer.

## Step 2 — Parse the alert

Extract these fields from the alert text:

| Field | Where to find it |
|---|---|
| **Action type** | Identifier in parentheses after service name — e.g. `upscale` from "FF Image Upscale API (upscale)" |
| **Error category** | Word before "errors" — e.g. "network errors", "timeout errors" |
| **Error count** | Number before the error category |
| **Avg latency** | After "avg latency:" |
| **Sample workflow IDs** | UUIDs listed after "Sample Workflows:" |
| **Environment** | After "Environment:" |
| **Time span** | After "Time Span:" |

## Step 3 — Inspect sample workflows

Call `inspect_run` on **one** sample workflow ID (the first one). From the result:
- Note `diagnostic.errorCategory` — confirm it matches the alert's error type
- Note `diagnostic.failedActions[].logs` — look for specific upstream error messages or HTTP status codes

**If `inspect_run` returns 404** (workflow belongs to another org): **stop** — the rest will also
404. Go directly to Step 4; the Splunk queries there cover the sample workflow IDs too.

## Step 4 — Splunk diagnosis

**Always pass the `timeRange` computed in Step 1 to every tool call below.** Never rely on the
default `-24h`. Do not retry with progressively wider windows — if a query returns zero results with
the correct time range, note "no matching events in that window" and move on.

Run these three queries (all with the computed `timeRange` and parsed `environment`):

1. **`splunk_rw_errors`** with `groupBy: "service_action"`, `actionType` set to the extracted action
   type (e.g. `upscale`), and the computed `timeRange`.
   - Returns: per-service/action error counts and categories
   - If zero results with correct time range: call `list_actions` to find the exact registered
     action type name (catalog may use a hyphenated form like `upscale-image`), then retry once with
     that `actionType`. If still zero, skip.
   - If the alert says "network errors": also inspect the `error_message` distribution from the
     results. If most errors contain "HTTP 429", the root cause is rate limiting.

2. **`splunk_rw_429s`** with the computed `timeRange` — confirms rate limiting scale. If throttled
   count ≈ request count, the action is 100% throttled.
   - If tool errors: fall back to `splunk_rw_search` with:
     ```spl
     data.eventType=RATE_LIMIT_THROTTLED data.action_type=<actionType>
     | stats count by data.throttle_reason, data.downstream_service
     ```

3. **`splunk_rw_errors`** with `groupBy: "identity"` and the computed `timeRange` — blast radius
   (orgs, users, emails).

These three queries are sufficient. Do not run additional retries or wider-window fallbacks unless a
tool explicitly returned a connectivity error (not empty results).

## Step 5 — Synthesize and present RCA

Use **Slack mrkdwn** format — no `##` headers, no markdown tables. Slack renders `*bold*` and
`_italic_` but NOT `**bold**` or `| table |` syntax.

```
*RCA: <Alert Title>*

*<one-sentence root cause>*

*Affected:* N orgs / N users (email1@adobe.com + N others) | *Window:* YYYY-MM-DD HH:MM–HH:MM UTC (~N min) | *Action type:* `upscale`

*Evidence:*
• <key finding 1 — e.g. "62 DOWNSTREAM_API_NETWORK_ERROR events: error_message: 'HTTP 429: Too Many Requests', latency_ms: ~122s">
• <key finding 2 — e.g. "429s came directly from downstream API, bypassing RATE_LIMIT_THROTTLED">
• <key finding 3 — e.g. "93% of errors from org EE9332B3... (ldallinger@adobe.com) running large batch jobs">

*Action:* <one concrete next step — e.g. "Lower configured RPM for FIREFLY/upscale in DownstreamService registry to match actual API limit">
```

Keep it under 10 lines. Omit sections that have no data. If emails are available from logs, include
the most-impacted one inline in Affected.

After presenting, offer **one** follow-up line:
> "Want me to post this RCA as a reply to the alert in #run-workflow-service?"

Only call `slack_reply_to_thread` if the user explicitly confirms ("yes", "post it", "share it",
etc.). Use the `channel_id` found in Step 1 and the retained `ts` of the last analyzed alert. Never
post automatically.

## Common patterns

| Alert type | First thing to check | Likely cause |
|---|---|---|
| Network errors + high latency (>100s) | `splunk_rw_429s` | 100% rate throttled — retries are inflating latency |
| Timeout errors | `inspect_run` → `polling_timeout_error` | Upstream job never reached terminal state |
| System errors | `inspect_run` → `setup` phase failures | Action type misspelled or not registered |
| Auth errors | `inspect_run` → `auth_error` | Downstream token expired |
| Downstream errors | `inspect_run` → `execute` phase logs | Upstream API returning 4xx/5xx |

## Downstream + rate-limit event types

These are the Splunk event types emitted by the platform. Understanding which fires when is
essential for diagnosing alerts accurately.

### Downstream API events

| Event type | When fired | Key fields |
|---|---|---|
| `DOWNSTREAM_API_CALL` | Successful 2xx response from downstream API | `downstream_service`, `action_type`, `org_id`, `latency_ms`, `response_status`, `response_body` |
| `DOWNSTREAM_API_ERROR` | Non-2xx HTTP response (4xx, 5xx) received | `downstream_service`, `action_type`, `org_id`, `error_status`, `response_body`, `latency_ms` |
| `DOWNSTREAM_API_NETWORK_ERROR` | `fetch()` threw an exception — network failure, connection reset, **or 429 thrown by the retry policy** | `downstream_service`, `action_type`, `org_id`, `error_kind="fetch_failure"`, `error_message` (may contain "HTTP 429: Too Many Requests"), `error_stack`, `latency_ms` |

**Critical 429 quirk:** The retry policy throws 429s as exceptions after exhausting retries. This
means 429s appear as `DOWNSTREAM_API_NETWORK_ERROR` with `error_message` containing "HTTP 429",
**not** as `DOWNSTREAM_API_ERROR`. This is why `splunk_rw_429s` queries `DOWNSTREAM_API_NETWORK_ERROR`
— not `DOWNSTREAM_API_ERROR`.

`BATCH_ERRORS_REPORTED` / `ERRORS_REPORTED` are rollup events fired once per execution. They contain
`errors[]`, `errorsByActionType[]`, `orgId`, `userId`, `userEmail` — useful for blast radius and
email surfacing.

### Rate limit events

| Event type | Level | When fired | Key fields |
|---|---|---|---|
| `RATE_LIMIT_THROTTLED` | info | (a) request waited in queue, (b) token bucket depleted, (c) downstream returned 429 after all retries | `throttle_reason`, `downstream_service`, `action_type`, `org_id`, `wait_ms`, `configured_rpm`, `max_concurrent`, `running`, `queued` |
| `RATE_LIMIT_REQUEST` | info | Every POST/PUT/PATCH submitted to the rate limiter (before queuing) | `downstream_service`, `action_type`, `org_id`, `endpoint`, `batch_id`, fairness fields (`user_priority`, `age_boost`, etc.) |

**`throttle_reason` values:**
- `queue_wait` — request was delayed because concurrency or RPM ceiling was hit; `wait_ms` = time spent queued
- `reservoir_depleted` — token bucket ran dry; logged at most once per service per 60 s; indicates sustained overload
- `downstream_429` — downstream returned 429 despite our rate limiter; indicates our configured limit is higher than the actual downstream limit

**`RATE_LIMIT_REQUEST` vs `DOWNSTREAM_API_CALL` for throughput:**
- `RATE_LIMIT_REQUEST` = **demand** — requests trying to run (POST/PUT/PATCH only; GETs are not rate-limited and never produce this event)
- `DOWNSTREAM_API_CALL` = **throughput** — requests that succeeded
- The gap between them is queued/throttled/timed-out requests — the most useful signal during a rate-limit incident

### Rate limit observability queries

```spl
# Queue-wait percentiles by service
data.eventType=RATE_LIMIT_THROTTLED data.throttle_reason=queue_wait
| stats avg(data.wait_ms) as avg_ms, median(data.wait_ms) as median_ms, perc99(data.wait_ms) as p99_ms by data.downstream_service
| sort -p99_ms

# Most throttled services (all reasons)
data.eventType=RATE_LIMIT_THROTTLED
| stats count by data.downstream_service, data.throttle_reason
| sort -count

# Demand rate for a service (POST/PUT/PATCH only — GETs excluded automatically)
data.eventType=RATE_LIMIT_REQUEST data.downstream_service=FIREFLY
| timechart span=1m count as demand_per_minute

# Demand vs throughput gap — shows queued/dropped requests
# (run as two overlaid queries in Splunk)
data.eventType=RATE_LIMIT_REQUEST data.downstream_service=FIREFLY | timechart span=1m count as demand
data.eventType=DOWNSTREAM_API_CALL data.downstream_service=FIREFLY | timechart span=1m count as throughput
```

Use `splunk_rw_search` with these patterns when the user asks about queue wait times, most-throttled
services, or current service rates.
