# Load Testing Guidance

## Purpose

Provide executable load testing strategies for dispatcher performance validation.

## Load Testing Modes


### AMS Mode (AEM 6.5/AMS)

**Prerequisites:**
- Accessible AMS dispatcher host
- Load testing tool with network access
- Permission to monitor host metrics

**Approach:**
```text
# 1. Establish baseline
# Run load test against AMS dispatcher

# 2. Monitor host resources (outside MCP)
# CPU, memory, disk I/O, network I/O, Apache worker saturation

# 3. Analyze dispatcher behavior
monitor_metrics({
  "log_path": "/var/log/httpd/dispatcher.log",
  "window_minutes": 30,
  "breakdown_by": "status_code"
})
tail_logs({"log_path":"/var/log/httpd/dispatcher.log","lines":500})
```

**Key Metrics:**
- Throughput (requests/sec)
- Response time (p50, p95, p99)
- Apache worker utilization
- System resource usage
- Cache hit ratio during load

## Load Test Scenarios

### Scenario 1: Cache Warming
**Goal:** Validate cache efficiency after initial population.

```text
1. Clear cache
2. Run synthetic traffic across key URLs
3. Measure cache hit ratio progression
4. Validate steady-state performance
```

### Scenario 2: Traffic Spike Simulation
**Goal:** Verify behavior under sudden load increase.

```text
1. Start with baseline load (e.g., 10 users)
2. Ramp to 10x load over 2 minutes
3. Sustain peak for 10 minutes
4. Measure response time degradation
5. Check error rate increase
```

### Scenario 3: Cache Invalidation Under Load
**Goal:** Validate invalidation behavior doesn't cause cascade failures.

```text
1. Establish steady-state load
2. Trigger cache invalidation (via flush)
3. Measure cache miss spike
4. Measure backend request surge
5. Validate recovery time
```

### Scenario 4: Mixed Content Type Load
**Goal:** Validate performance across HTML, JSON, assets.

```text
1. Generate mixed traffic: 60% HTML, 30% images, 10% JSON
2. Measure cache hit ratio per content type
3. Identify content type bottlenecks
4. Validate content-type-specific optimizations
```

## Load Testing Tools

### Apache JMeter
```xml
<!-- Example thread group for dispatcher load test -->
<ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Dispatcher Load">
  <intProp name="ThreadGroup.num_threads">100</intProp>
  <intProp name="ThreadGroup.ramp_time">300</intProp>
  <longProp name="ThreadGroup.duration">1800</longProp>
</ThreadGroup>
```

### k6 (Recommended for CI/CD)
```javascript
import http from 'k6/http';
import { check } from 'k6';

export let options = {
  stages: [
    { duration: '5m', target: 100 },  // Ramp-up
    { duration: '30m', target: 100 }, // Sustained
    { duration: '2m', target: 0 },    // Ramp-down
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500'],  // 95% under 500ms
    'http_req_failed': ['rate<0.01'],    // <1% errors
  },
};

export default function () {
  let res = http.get('http://dispatcher:8080/content/site/en.html');
  check(res, { 'status 200': (r) => r.status === 200 });
}
```

### Gatling (for complex scenarios)
```scala
val scn = scenario("Dispatcher Load Test")
  .exec(http("Homepage").get("/content/site/en.html"))
  .pause(1)
  .exec(http("Product Page").get("/content/site/en/products.html"))
  .pause(2)

setUp(scn.inject(rampUsers(100) during (5 minutes)))
  .protocols(http.baseUrl("http://dispatcher:8080"))
```

## Capacity Planning Calculations

### Formula: Max Concurrent Users
```text
Max Users = (Throughput @ Target Latency) / (Requests per User Session)

Example:
- Dispatcher handles 1000 req/sec at p95 < 300ms
- Average user session: 10 requests
- Max Users = 1000 / 10 = 100 concurrent users/sec turnover
```

### Formula: Cache Hit Ratio Impact
```text
Backend Load = Total Requests x (1 - Cache Hit Ratio)

Example:
- 1000 req/sec to dispatcher
- Cache hit ratio: 80%
- Backend load: 1000 x (1 - 0.80) = 200 req/sec to AEM
```

### Bottleneck Identification

| Symptom | Likely Bottleneck | Investigation |
|---------|-------------------|---------------|
| High CPU on dispatcher | Filter/rewrite complexity | Simplify rules, profile Apache |
| High memory on dispatcher | Cache size too large | Reduce cache scope, add eviction |
| High disk I/O | Cache read/write thrashing | Add cache levels, optimize invalidation |
| Backend saturation | Low cache hit ratio | Improve cacheability, extend TTLs |
| Network saturation | Large uncached assets | Add compression, optimize assets |

## Pre-Production Load Test Checklist

- [ ] Load test environment mirrors production topology
- [ ] Dispatcher config is production-identical
- [ ] Cache is warmed before sustained load phase
- [ ] Backend (AEM) can handle expected cache miss load
- [ ] Monitoring is active (metrics, logs)
- [ ] Success criteria defined (latency, error rate, throughput)
- [ ] Rollback plan ready if performance degrades
- [ ] Load ramp is gradual (avoid thundering herd)
- [ ] Multiple content types represented in load mix
- [ ] Peak load sustained for meaningful duration (>15 min)

## References

- Dispatcher caching docs: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-configuration#caching-documents
- AMS dispatcher overview: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/overview
