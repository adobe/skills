# Runtime Prompts and Troubleshooting Scenarios

Ready-to-use prompts for the **incident-response** skill and Dispatcher MCP **core-7 tools**: `validate`, `lint`, `sdk`, `trace_request`, `inspect_cache`, `monitor_metrics`, `tail_logs`. Use for incident investigations, triage, and learning the runtime tools.

---

## Troubleshooting scenarios at a glance

| Scenario | What to do | Tools | Where in this doc |
|----------|------------|-------|-------------------|
| **Cache not working / content not cached** | Find why a URL is not cached (filter, cache rules, headers, invalidation). | trace_request, inspect_cache, tail_logs, validate, lint | §5 "Cache not working / stale content" (prompts 5–8), §6 "Cache miss regression" (7, 8). |
| **502 / 5xx errors** | Diagnose backend connectivity, timeouts, or health-check issues. | monitor_metrics, tail_logs (filter 502/503), trace_request, validate, lint | §5 "Errors, latency, health" (9–12), §6 "5xx spike / backend failure" (1, 2). |
| **Redirect loop** | Find why a URL causes an infinite redirect (rewrite, SSL, X-Forwarded-Proto). | trace_request (GET `/` and target path), validate (vhost/rewrite), lint | §5 "Redirects and rewrites" (16–18), §6 "Redirect loop / multi-hop" (5, 6). |
| **URL blocked (403 / 404)** | Identify which filter rule blocks a URL and propose a safe allow. | trace_request, tail_logs, validate, lint (deep) | §5 "404/403" (1–4), §6 "Sudden 403" (3, 4), §6 one-shot (20). |
| **Slow responses** | Diagnose cache miss, backend slowness, or rewrite overhead. | monitor_metrics, trace_request, tail_logs, inspect_cache, lint | §5 "Errors, latency, health" (9–12), §6 "Latency regression" (13, 14). |
| **Full incident runbook** | Emergency triage: quantify impact, capture logs, trace failing URL, check cache, validate config. | monitor_metrics → tail_logs → trace_request → inspect_cache → validate/lint | §6 "One-shot full incident" (19, 20). |

**Other:** Step-by-step request flow → §2 trace_request, § Combo prompts. Analyze logs → §1 tail_logs, §5 "Errors, latency". Vanity URLs → §6 "Vanity URLs" (7a–7f). Security audit → **security-hardening** skill. Pre-deploy validation → **config-authoring** skill.

---

## Available tools

| Tool | Purpose |
|------|---------|
| **validate** | Syntax and structure validation for dispatcher and HTTPD config. |
| **lint** | Best-practice and security analysis (use `analysis_depth=deep` for filter/cache ordering). |
| **sdk** | File integrity, baseline drift, and SDK checks (`check-files`, `diff-baseline`, `validate`). |
| **trace_request** | Trace a request through filter, cache, and render; use URL or `pid`/`tid` from logs. |
| **inspect_cache** | Inspect cache entries by URL or path (path, metadata, headers). |
| **monitor_metrics** | Hit ratio, latency percentiles, error rates; optional breakdown by URL, status, or render. |
| **tail_logs** | Tail dispatcher logs with optional filters (URL, status code, cache HIT/MISS/PASS). |

---

## 1. tail_logs (live log access)

**What it does:** Tail Dispatcher logs with optional filters (URL, status code, cache HIT/MISS/PASS).

| # | Prompt (copy-paste) |
|---|---------------------|
| 1 | **Show the last 100 Dispatcher log lines.** |
| 2 | **Tail Dispatcher logs filtered by URL pattern `/content/wknd/` — show last 80 lines.** |
| 3 | **Show recent Dispatcher log entries only for requests that returned HTTP 404.** |
| 4 | **Show Dispatcher log lines where the response was served from cache (cache HIT).** |
| 5 | **Show Dispatcher log lines for cache MISS in the last 50 lines.** |
| 6 | **Get the 30 most recent log entries for `/content/wknd/us/en.html`.** |

---

## 2. trace_request (request tracing)

**What it does:** Trace a request through filter, cache, and render using config + (when available) live logs. Can use URL or `pid`/`tid` from tail_logs.

| # | Prompt (copy-paste) |
|---|---------------------|
| 1 | **Trace what happens for a GET to `/content/wknd/us/en.html` — filter, cache, and render. Use this repo's dispatcher config.** |
| 2 | **Trace a GET request to `/content/wknd/us/en.html` and tell me if it's allowed by filters, and whether it's served from cache or the render.** |
| 3 | **Trace POST to `/content/wknd/us/en.html` and show filter/cache/render outcome.** |
| 4 | **Trace GET `/libs/granite/csrf/token.json` and explain why it's cached or not.** |
| 5 | **Trace GET `/content/wknd/us/en/errors/404.html` and report filter result and cache status.** |

---

## 3. monitor_metrics (runtime metrics)

**What it does:** Compute metrics from logs: hit ratio, latency percentiles, error rates; optional breakdown by URL pattern, status code, or render; optional HTTPD process metrics.

| # | Prompt (copy-paste) |
|---|---------------------|
| 1 | **Run monitor_metrics for the last 5 minutes and show cache hit ratio, latency percentiles, and error rate.** |
| 2 | **Give me Dispatcher metrics for the last 10 minutes, broken down by URL pattern.** |
| 3 | **Show monitor_metrics for the last 15 minutes with breakdown by HTTP status code.** |
| 4 | **Compute Dispatcher metrics (hit ratio, latency, errors) for the last 5 minutes and include HTTPD process metrics (threads, FDs, memory) if available.** |
| 5 | **Summarize Dispatcher performance from logs: last 5 minutes, breakdown by render.** |

---

## 4. inspect_cache (cache inspection)

**What it does:** Inspect cache entries by path or URL (with config for docroot), including stat files and metadata (e.g. cached headers).

| # | Prompt (copy-paste) |
|---|---------------------|
| 1 | **Inspect the cache entry for URL `/content/wknd/us/en.html` using this project's dispatcher config. Show path and metadata.** |
| 2 | **Inspect cache for `/content/wknd/us/en.html` and show file metadata and any cached response headers.** |
| 3 | **What's in the Dispatcher cache for `/content/wknd/us/en/errors/404.html`? Use dispatcher src in this repo.** |
| 4 | **List cache metadata (size, age, headers) for the WKND homepage URL.** |
| 5 | **Inspect the cache file at path `/content/wknd/us/en.html` under the docroot and show stat/metadata.** |

---

## 5. Debugging and troubleshooting prompts

Evidence-first investigation: trace + logs + cache + metrics.

### 404 / 403 / "works on publish, fails via Dispatcher"

| # | Prompt (copy-paste) |
|---|---------------------|
| 1 | **I get 404 for `http://localhost:8080/content/wknd/us/en.html` but it works on the publisher. Trace that URL through filters and cache, and tell me why it might be blocked or missing.** |
| 2 | **A URL returns 403 through Dispatcher but 200 on the publish server. Trace GET for that path, show which filter rule allows or denies it, and suggest a fix.** |
| 3 | **Debug why `/content/wknd/us/en.html` gives 404 via Dispatcher: run trace_request, then tail_logs filtered by that URL and by status 404. Summarize cause and fix.** |
| 4 | **Trace GET `/content/wknd/us/en.html` and list every filter rule that applies. If it's denied, name the rule and the config file so I can change it.** |

### Cache not working / stale content

| # | Prompt (copy-paste) |
|---|---------------------|
| 5 | **I updated a page on publish but Dispatcher still serves old content. Trace that URL, inspect its cache entry (path, age, metadata), and tell me if it's a cache HIT and how to invalidate.** |
| 6 | **Why isn't `/content/wknd/us/en.html` being cached? Trace the request, check cache rules in config, and inspect cache for that URL. Give a short diagnosis.** |
| 7 | **Inspect cache for `/content/wknd/us/en.html` and report file age and size. Then tail_logs for that URL (last 30 lines) and say whether recent requests were HIT or MISS.** |
| 8 | **Trace GET `/content/wknd/us/en.html` and inspect_cache for it. Is it served from cache? If yes, how old is the cached file and which cache rules allow it?** |

### Errors, latency, and health

| # | Prompt (copy-paste) |
|---|---------------------|
| 9 | **Show recent Dispatcher log entries that returned 5xx. Then run monitor_metrics for the last 5 minutes with breakdown by status code. Summarize error rate and top failing paths.** |
| 10 | **We're seeing slow responses. Run monitor_metrics for the last 10 minutes (hit ratio, latency percentiles, errors) and tail_logs for the last 50 lines. Point out high latency or cache MISS patterns.** |
| 11 | **Get monitor_metrics for the last 5 minutes. Then show log lines for cache MISS only. In one paragraph: how's the hit ratio, and what might explain the MISSes?** |
| 12 | **Run monitor_metrics with breakdown by URL pattern for the last 15 minutes. Which paths have the most errors or lowest hit ratio? List top 3 and suggest what to check.** |

### Full request flow (pid:tid from logs)

| # | Prompt (copy-paste) |
|---|---------------------|
| 13 | **Tail the last 80 Dispatcher log lines and pick one request that shows pid and tid. Then trace that request using trace_request with that pid and tid and show the full log sequence for that request.** |
| 14 | **Show the last 50 log lines filtered by URL `/content/wknd/`. If any line has pid/tid, use trace_request with that pid (and tid if present) to get the full request trace.** |
| 15 | **Get recent log entries for status 500. For one entry that includes pid (and tid if available), run trace_request(pid=..., tid=...) and summarize what happened for that request.** |

### Redirects and rewrites

| # | Prompt (copy-paste) |
|---|---------------------|
| 16 | **Trace GET `/` and explain whether it's rewritten or redirected, and to what path. Use this repo's dispatcher config.** |
| 17 | **I get a redirect loop on the homepage. Trace GET `/` and GET `/us/en.html`, show filter and cache result for each, and point out any rewrite/redirect rule that could cause a loop.** |
| 18 | **Trace GET `/content/wknd/us/en.html` and GET `/us/en.html`. For each, report: filter result, cache status, and whether the request would hit the render. Compare the two.** |

### One-line troubleshooting prompts

| # | Prompt (copy-paste) |
|---|---------------------|
| 19 | **Investigate 404 on `/content/wknd/us/en.html`: trace the request, show matching filter rules, and suggest a config change.** |
| 20 | **Diagnose why a page isn't updating: trace the URL, inspect its cache entry and age, and say how to fix stale content.** |
| 21 | **Check Dispatcher health: monitor_metrics last 5 min + tail 404/5xx log lines and summarize.** |
| 22 | **Full debug for `/content/wknd/us/en.html`: trace, inspect cache, tail logs for that URL, then one-paragraph summary.** |

---

## 6. Complex / difficult customer scenarios

Real issues customers struggle to debug. Use the incident-response workflow: metrics → logs → trace → cache → static checks. For implementing config fixes, use the **config-authoring** skill. Return evidence table, test IDs from test-case-catalog, and rollback where applicable.

### 5xx spike / backend failure

| # | Scenario | Prompt (copy-paste) |
|---|----------|---------------------|
| 1 | **5xx spike** | **We're seeing a spike of 5xx errors. Run monitor_metrics for the incident window (e.g. last 10 minutes) with breakdown by status code and by URL pattern. Then tail_logs for 5xx only and pick one failing request; trace that URL and a similar "healthy" URL. Compare filter, cache, and render outcome. Summarize: is this Dispatcher config, cache, or backend?** |
| 2 | **502/503 from Dispatcher** | **After a deploy, users get 502/503 on some pages. Use monitor_metrics (last 15 min, breakdown by status), then tail_logs filtered by 502 and 503. For one failing path, run trace_request; then run validate and lint on the dispatcher config. Give an evidence table and recommend fix or rollback.** |

### Sudden 403 / URL blocked (filter ordering)

| # | Scenario | Prompt (copy-paste) |
|---|----------|---------------------|
| 3 | **Legitimate URL denied** | **A URL that used to work now returns 403 through Dispatcher (still 200 on publish). Trace that URL with trace_request and list every filter rule that matches, in order; identify which rule denies it. Run lint with deep analysis on the filter section to check for rule ordering or shadowing. Propose a minimal allow without weakening existing denies, and say which test IDs (e.g. FILT-002, INC-003) you're satisfying.** |
| 4 | **Allow vs deny overlap** | **We added an allow for `/content/mysite/*` but a specific path under it still gets 403. Trace that path, show the full filter evaluation order and which rule wins. Run validate on the filter section and lint(deep). Tell me the exact rule number and file that's denying it and the minimal fix.** |

### Redirect loop / multi-hop redirect

| # | Scenario | Prompt (copy-paste) |
|---|----------|---------------------|
| 5 | **Redirect loop on homepage** | **Users hit a redirect loop on the site root. Trace GET `/` and GET `/us/en.html` (and any path your rewrites send to). For each, show filter result, cache result, and the effective redirect/rewrite target. Identify which rewrite or redirect rule could cause a loop. Run validate on the vhost/rewrite block. Propose a fix that preserves probe paths (`/systemready`, `/system/probes/*`) and give rollback steps.** |
| 6 | **Vanity URL loop** | **A campaign vanity URL redirects but then ends up in a loop or wrong destination. Trace the vanity path and the canonical path with trace_request. Confirm single-hop redirect and that query string is preserved or dropped as designed. Check that `/systemready` and `/system/probes/*` are not affected. List rewrite rules involved and suggest correction.** |

### Vanity URLs

| # | Scenario | Prompt (copy-paste) |
|---|----------|---------------------|
| 7a | **Vanity path returns 404** | **A vanity URL (e.g. campaign shortcut like `/promo/summer`) returns 404 through Dispatcher but the canonical page works on publish. Trace the vanity path and the canonical path with trace_request. Check whether the vanity path is denied by a filter rule or never rewritten to the right target. Tail_logs for 404 filtered by that URL. Propose filter or rewrite fix and verify with trace; record rollback for the campaign URL.** |
| 7b | **Vanity redirects to wrong page** | **Our vanity URL should redirect to `/content/mysite/en/landing.html` but users end up on a different page or get a multi-hop redirect. Trace the vanity path with trace_request and show the effective redirect/rewrite target. Validate the vhost/rewrite block. Confirm single-hop and correct destination; fix rewrite rules and ensure `/systemready` and `/system/probes/*` are not matched.** |
| 7c | **Query string lost on vanity URL** | **Campaign links use vanity URLs with UTM params (e.g. `/go/offer?utm_source=email`). The redirect works but query string is dropped (or duplicated). Trace the vanity URL with and without query params. Show how rewrite/redirect handles query string. Recommend rewrite change to preserve or drop params as designed and validate the block.** |
| 7d | **Vanity URLs need filter bypass (/vanity_urls)** | **We use AEM vanity URL feature; Dispatcher should allow requests that match the published vanity list. Trace a known vanity path—is it allowed by filters or denied? Check the farm for `/vanity_urls` (url, file, delay). If missing or wrong, propose the block and ensure filter allows the vanity path (or that /vanity_urls bypass is active). Validate and trace again.** |
| 7e | **Campaign URL broken after deploy** | **After a dispatcher config deploy, a campaign vanity URL started returning 404 or wrong redirect. Run trace_request on the vanity path and the canonical path. Tail_logs for 404/403 for that path. Compare to current rewrite and filter config; identify the change that broke it. Propose minimal fix or rollback and re-verify vanity + one non-vanity URL.** |
| 7f | **"Works on publish, 404 via Dispatcher" (maybe vanity)** | **A URL works on publish but returns 404 through Dispatcher—it might be a vanity path or a path that needs a rewrite. Trace that URL (filter + cache + render). If filter denies it, list the denying rule and suggest an allow or /vanity_urls usage. If filter allows but path isn't rewritten, check rewrite rules and vanity/canonical policy. Tail_logs for that URL. Give root cause (filter vs rewrite vs vanity list) and fix.** |

### Cache miss regression / hit ratio drop

| # | Scenario | Prompt (copy-paste) |
|---|----------|---------------------|
| 7 | **Hit ratio dropped after a change** | **Our cache hit ratio dropped after we changed dispatcher config. Run monitor_metrics for the last 15 minutes (hit ratio, breakdown by URL pattern). Inspect cache for 2–3 key URLs (one that should be cached, one that shouldn't). Trace those URLs and compare to cache rules in config. Run validate and lint(deep) on the cache section. Tell me if the problem is rule ordering, a new deny, or something else, and which test IDs apply (CACHE-001, CACHE-002, INC-004).** |
| 8 | **Query params breaking cache** | **Pages with query params (e.g. `?utm_source=...`) are not being served from cache; each variant creates a new cache entry. Trace a URL with and without query params; inspect_cache for both. Review /ignoreUrlParams and cache rules. Recommend which params to ignore (or not) and what to add to ignoreUrlParams, with minimal change.** |

### Stale content / invalidation too broad or too narrow

| # | Scenario | Prompt (copy-paste) |
|---|----------|---------------------|
| 9 | **Activation doesn't refresh the page** | **When we activate a page, the old version is still served for minutes. Trace the page URL, inspect its cache entry (path, age, stat file location). Check the farm's /invalidate and statfileslevel. Explain whether the invalidation path matches the cached path and what statfileslevel is doing. Suggest a safe change with blast-radius impact (CACHE-003).** |
| 10 | **One activation flushes too much** | **A single page activation is flushing the whole site cache. Inspect cache for a few paths at different tree depths. Review /invalidate and statfileslevel. Explain the blast radius and recommend a statfileslevel (or invalidation rule) that limits flush to the intended subtree. Run validate on the cache section.** |

### Probe / readiness endpoint broken

| # | Scenario | Prompt (copy-paste) |
|---|----------|---------------------|
| 11 | **Health check failing after rewrite change** | **After adding a canonical redirect, `/systemready` or `/system/probes/ready` started failing and our load balancer marks the instance unhealthy. Trace `/systemready` and `/system/probes/ready` with trace_request; trace one normal content URL. Confirm whether a customer rewrite is intercepting the probe paths. Validate the vhost/rewrite block and suggest a fix that keeps probes untouched (RW-004, RW-005).** |
| 12 | **Probe path returns 404 or wrong host** | **Cloud readiness checks fail: probe URL returns 404 or is redirected to wrong host. Trace the probe URL and the main site URL. List every rewrite/redirect that could match. Ensure ServerAlias `*.adobeaemcloud.net` / `*.adobeaemcloud.com` and probe pass-through. Give exact vhost/rewrite change and rollback.** |

### Latency regression / tail latency

| # | Scenario | Prompt (copy-paste) |
|---|----------|---------------------|
| 13 | **Rising P95/P99 after deploy** | **Tail latency increased after our last dispatcher change. Run monitor_metrics for the last 20 minutes (latency percentiles, breakdown by URL pattern and by status). Tail logs for slow or 5xx requests. Trace the slowest URL pattern and a fast one; inspect cache for both. Check if slow path is cache MISS or hitting render. Run lint on recent config. Summarize cause (rewrite chain, cache, or backend) and suggest next step.** |
| 14 | **Rewrite chain overhead** | **We have many rewrite rules; we suspect they add latency. Trace 2–3 representative URLs and note rewrite steps. Run monitor_metrics with breakdown by url_pattern. Recommend which rules could be simplified or merged, and validate the rewritten block after change.** |

### API / GraphQL / CORS

| # | Scenario | Prompt (copy-paste) |
|---|----------|---------------------|
| 15 | **GraphQL or persisted query not cached** | **Our GraphQL persisted-query endpoint should be cached but every request goes to publish. Trace the persisted-query URL and a normal content URL. Inspect cache for the API path. Check filter allow for the endpoint, cache rules, and any rewrite for /graphql/execute.json. Validate and lint. Tell me what's blocking cache (filter, cache rule, or rewrite) and the minimal fix (RW-006, CACHE-001).** |
| 16 | **CORS preflight (OPTIONS) 403** | **Frontend gets 403 on OPTIONS for our API. Trace OPTIONS to that API path with trace_request; trace GET/POST to the same path. Show which filter rules apply to OPTIONS and whether it's allowed. Check vhost for CORS headers and preflight. Propose filter + vhost changes and verify with trace.** |

### Permission-sensitive / auth-aware caching

| # | Scenario | Prompt (copy-paste) |
|---|----------|---------------------|
| 17 | **Logged-in users see other users' content** | **We use /auth_checker for protected pages. Logged-in user A sometimes sees user B's content. Trace a protected URL with and without auth headers. Inspect cache for that URL. Check /auth_checker config, /allowAuthorized, and filter allow for the auth-check endpoint. Confirm whether the issue is cache serving authorized content without recheck or a missing auth_checker call. Reference test IDs HDR-001, CACHE-002.** |
| 18 | **Protected path always goes to publish** | **Our protected path never hits cache even for anonymous; we expect anonymous to get cached and authenticated to bypass. Trace the path with no auth and with auth. Check cache rules and /auth_checker scope. Verify filter allows only the auth-check endpoint. Recommend config so anonymous gets cache and authenticated gets live check.** |

### One-shot "full incident" prompts

| # | Scenario | Prompt (copy-paste) |
|---|----------|---------------------|
| 19 | **Full incident runbook** | **Run a full incident investigation: (1) monitor_metrics last 10 min with breakdown by status and url_pattern, (2) tail_logs for 4xx and 5xx, (3) pick one failing URL and trace it, (4) inspect_cache for that URL, (5) validate and lint the dispatcher config. Produce an evidence table, incident summary (symptom, impact, blast radius), and recommend fix or rollback with test IDs.** |
| 20 | **"Works on publish, fails at Dispatcher"** | **A page works on publish but fails (404/403) through Dispatcher. Trace the URL (filter + cache + render). Tail logs for that URL and status. List matching filter rules in order and the winning rule. Run validate and lint(deep) on filters. Give root cause, exact rule/file to change, minimal fix, and rollback. Cite FILT-002 or FILT-004 and INC-003.** |

---

## Combo prompts (multiple runtime tools)

| # | Prompt (copy-paste) |
|---|---------------------|
| 1 | **For `/content/wknd/us/en.html`: (1) trace the request (filter + cache + render), (2) inspect its cache entry and metadata, (3) show the last 20 log lines for that URL.** |
| 2 | **Run trace_request for GET `/content/wknd/us/en.html`, then inspect_cache for that URL, then tail_logs filtered by that URL (30 lines). Summarize filter, cache, and recent log activity.** |
| 3 | **Get monitor_metrics for the last 5 minutes (hit ratio, latency, errors). Then tail_logs for the last 50 lines filtered by cache MISS. Briefly explain what the MISSes might indicate.** |
| 4 | **Trace GET `/content/wknd/us/en.html`, inspect its cache entry, and run monitor_metrics for the last 5 minutes. In one short paragraph: is the page cached, what does the cache look like, and how is Dispatcher performing?** |

---

## Skill reminder

- Use the **incident-response** skill for investigations (evidence-first: metrics → logs → trace → cache → static checks).
- For **implementing config fixes** after diagnosis, use the **config-authoring** skill.
- For runtime evidence, state whether it came from **static validation**, **local SDK**, or **MCP runtime tools** (tail_logs, trace_request, monitor_metrics, inspect_cache).
