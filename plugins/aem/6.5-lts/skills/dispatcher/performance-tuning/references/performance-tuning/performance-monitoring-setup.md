# Performance Monitoring Setup

## Purpose

Guide proactive performance monitoring configuration (not incident-driven alerting).

## Key Performance Indicators (KPIs)

### Tier 1 - Critical Metrics

| Metric | Target | Warning | Critical | Tool |
|--------|--------|---------|----------|------|
| Cache Hit Ratio | > 80% | < 70% | < 60% | `monitor_metrics` |
| P95 Response Time | < 300ms | > 500ms | > 1000ms | `monitor_metrics` |
| Error Rate (5xx) | < 0.1% | > 1% | > 5% | `monitor_metrics` |
| Availability | > 99.9% | < 99.5% | < 99% | `monitor_metrics` |

### Tier 2 - Optimization Metrics

| Metric | Target | Investigation Trigger | Tool |
|--------|--------|----------------------|------|
| Cache Miss Rate | < 20% | > 30% | `inspect_cache` |
| Average Cache TTL | > 5 min | < 1 min | `inspect_cache` |
| Filter Deny Rate | < 1% | > 5% | `trace_request` |
| Rewrite Redirect Rate | < 5% | > 15% | `trace_request` |

### Tier 3 - Capacity Metrics

| Metric | Target | Tool |
|--------|--------|------|
| Requests/Second (Throughput) | Baseline + 20% headroom | `monitor_metrics` |
| Cache Size Growth Rate | < 10% per day | `inspect_cache` |
| Log Volume Growth Rate | < 15% per day | `tail_logs` |


## AMS Mode Monitoring (AEM 6.5/AMS)

### Apache & System Metrics

```bash
# Apache server status
curl http://dispatcher-host.example/server-status?auto

# Key metrics to extract:
# - BusyWorkers / Total Workers
# - Requests per second
# - Bytes per request
# - CPU usage

# System resource monitoring
vmstat 1 60  # CPU, memory, I/O
iostat -x 1 60  # Disk I/O
netstat -s  # Network stats
```

### Log-Based Metrics

```text
# Parse dispatcher.log-driven metrics
monitor_metrics({
  "log_path": "/var/log/httpd/dispatcher.log",
  "window_minutes": 5,
  "breakdown_by": "status_code"
})

# Track dispatcher-specific log entries
tail_logs({
  "log_path": "/var/log/httpd/dispatcher.log",
  "lines": 200
})
```

### Example Traditional Monitoring Integration

```ini
# Example service check for cache hit ratio
define command {
    command_name    check_dispatcher_cache_hit_ratio
    command_line    /usr/local/bin/check_cache_hit_ratio.sh -w 70 -c 60 -l /var/log/httpd/access_log
}

define service {
    use                     generic-service
    host_name               dispatcher-prod
    service_description     Dispatcher Cache Hit Ratio
    check_command           check_dispatcher_cache_hit_ratio
    check_interval          5
}
```

## Dashboard Design

### Essential Dashboard Widgets

1. **Cache Efficiency Panel**
   - Cache hit ratio (line chart, 24h)
   - Cache miss rate by URL pattern (bar chart)
   - Cache size trend (line chart, 7d)

2. **Latency Panel**
   - P50, P95, P99 response time (multi-line chart, 24h)
   - Response time by content type (heatmap)
   - Slow request top 10 (table)

3. **Throughput Panel**
   - Requests/second (line chart, 24h)
   - Status code distribution (stacked area chart)
   - Error rate (line chart with threshold markers)

4. **Capacity Panel**
   - Resource utilization (CPU, memory, disk)
   - Worker/thread saturation (gauge)
   - Traffic forecast vs capacity (dual-axis line chart)

### Example Dashboard Definition

```json
{
  "dashboard": {
    "title": "Dispatcher Performance",
    "panels": [
      {
        "title": "Cache Hit Ratio",
        "targets": [
          {
            "expr": "rate(dispatcher_cache_hits_total[5m]) / rate(dispatcher_requests_total[5m])"
          }
        ],
        "thresholds": [
          { "value": 0.6, "color": "red" },
          { "value": 0.7, "color": "yellow" },
          { "value": 0.8, "color": "green" }
        ]
      },
      {
        "title": "P95 Response Time",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(dispatcher_request_duration_seconds_bucket[5m]))"
          }
        ]
      }
    ]
  }
}
```

## Trend Analysis & Reporting

### Daily Performance Report

```text
Dispatcher Performance Summary - [Date]

1. Cache Efficiency
   - Hit Ratio: 78.5% (target: >80%, [WARN] below target)
   - Miss Rate: 21.5%
   - Top 10 Missed URLs: /api/*, /content/dynamic/*

2. Latency
   - P50: 125ms ([OK] within target)
   - P95: 480ms ([OK] within target)
   - P99: 1,200ms ([WARN] investigate)

3. Availability
   - Uptime: 99.95% ([OK] within target)
   - Error Rate: 0.08% ([OK] within target)

4. Capacity
   - Peak Throughput: 1,250 req/sec (85% of capacity)
   - Headroom: 15% ([WARN] plan for scaling)

5. Recommendations
   - Optimize caching for /api/* paths (potential +8% hit ratio)
   - Investigate P99 latency spikes during 14:00-16:00 UTC
   - Plan capacity increase within 30 days
```

### Weekly Trend Analysis

```text
Week of [Date Range]

1. Performance Trends (vs. previous week)
   - Cache Hit Ratio: 78.5% -> 82.1% ([OK] +3.6pp improvement)
   - P95 Latency: 480ms -> 420ms ([OK] -60ms improvement)
   - Throughput: +12% (traffic growth)

2. Optimization Impact
   - Static asset caching: +5% hit ratio
   - Cache TTL increase: -40ms latency

3. Capacity Forecast
   - Current growth rate: +2.5% weekly
   - Capacity exhaustion: ~12 weeks
   - Recommended action: Plan scaling for week of [Date]
```

## Monitoring Setup Checklist

### Initial Setup
- [ ] Identify a monitoring platform or metrics sink that fits the environment
- [ ] Configure metric collection (MCP tools, log parsing, or custom exporters)
- [ ] Define KPI targets and alert thresholds
- [ ] Create performance dashboard with essential widgets
- [ ] Set up alert routing (for example: email, chat, or incident-management tooling)
- [ ] Document escalation procedures


### AMS Mode Specific
- [ ] Configure Apache server-status endpoint
- [ ] Set up system metrics collection (vmstat, iostat)
- [ ] Configure log rotation for long-term analysis
- [ ] Integrate with your on-prem or self-managed monitoring stack

### Ongoing Maintenance
- [ ] Review dashboard weekly for trends
- [ ] Update alert thresholds based on baseline shifts
- [ ] Archive old metrics data per retention policy
- [ ] Quarterly capacity planning review
- [ ] Monthly performance optimization review

## MCP Tool Integration

### Automated Metrics Collection Pattern

```text
# Poll every N seconds from your scheduler/automation runner:
metrics = monitor_metrics({"window_minutes":1,"breakdown_by":"status_code"})
logs = tail_logs({"lines":100})

# Persist serialized results to your metrics sink/log store.
# Compare current summary.cache_hit_ratio and latency percentiles
# against your alert thresholds.
```

### Daily Performance Check Pattern

```text
daily = monitor_metrics({"window_minutes":1440,"breakdown_by":"status_code"})

# Evaluate thresholds:
# - daily.metrics.summary.cache_hit_ratio
# - daily.metrics.summary.error_rate
# - daily.metrics.latency.p95_ms / p99_ms
```

## References

- Dispatcher caching docs: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-configuration#caching-documents
- AMS common logs: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/common-logs
