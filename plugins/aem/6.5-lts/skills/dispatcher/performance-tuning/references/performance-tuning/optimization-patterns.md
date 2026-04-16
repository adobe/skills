# Dispatcher Performance Tuning Patterns

## Cache Optimization Patterns

### Pattern 1: Extend TTL for Stable Content

**Use Case:** Content that rarely changes (legal pages, terms, static content).

**Before:**
```apache
/cache {
    /enableTTL "1"
    /rules {
        /0000 { /glob "*" /type "allow" }
    }
    # Default TTL: short or not set
}
```

**After:**
```apache
/cache {
    /enableTTL "1"
    /rules {
        /0000 { /glob "*" /type "allow" }
        /0001 { /glob "/content/site/en/legal/*" /type "allow" }
        /0002 { /glob "/content/site/en/about/*" /type "allow" }
    }
}

# Apply TTL through response headers (respected by /enableTTL)
<LocationMatch "^/content/site/en/(legal|about)/">
    Header set Cache-Control "public, s-maxage=86400, max-age=43200"
</LocationMatch>
```

**Expected Impact:** +5-10% cache hit ratio, -20-30% backend requests for stable paths.

---

### Pattern 2: Add Cache-Control Headers for Static Assets

**Use Case:** Images, CSS, JS, fonts should be cached aggressively.

**Before:**
```apache
<LocationMatch "\.(js|css|gif|jpg|jpeg|png|svg|woff|woff2)$">
    # No caching headers
</LocationMatch>
```

**After:**
```apache
<LocationMatch "\.(js|css|gif|jpg|jpeg|png|svg|woff|woff2)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
    Header set Expires "1 year"
</LocationMatch>
```

**Expected Impact:** CDN/browser cache offload, -15-25% dispatcher requests for assets.

---

### Pattern 3: Optimize Cache Invalidation (Reduce Over-Flushing)

**Use Case:** Selective invalidation instead of full cache flush.

**Before:**
```apache
/invalidate {
    /0000 { /glob "*" /type "deny" }
    /0001 { /glob "*.html" /type "allow" }  # Invalidates all HTML
}
```

**After:**
```apache
/invalidate {
    /0000 { /glob "*" /type "deny" }
    /0001 { /glob "/content/site/${specific-path}/*" /type "allow" }  # Targeted
}

/cache {
    /statfileslevel "2"  # Folder-level stat files
}
```

**Expected Impact:** +10-15% cache persistence, faster cache recovery after publish.

---

### Pattern 4: Implement Query String Caching (Selectively)

**Use Case:** API endpoints with cacheable query parameters.

**Before:**
```apache
/ignoreUrlParams {
    /0001 { /glob "*" /type "deny" }  # Ignore all query params by default
}
```

**After:**
```apache
/ignoreUrlParams {
    /0001 { /glob "*" /type "deny" }
    /0002 { /glob "page" /type "allow" }  # Allow caching with 'page' param
    /0003 { /glob "lang" /type "allow" }  # Allow caching with 'lang' param
}
```

**Expected Impact:** +20-30% cache hit ratio for API endpoints with common query patterns.

---

## Static Asset Optimization Patterns

### Pattern 5: Enable Compression

**Before:**
```apache
# No compression
```

**After:**
```apache
<IfModule mod_deflate.c>
    AddOutputFilterByType DEFLATE text/html text/plain text/xml text/css text/javascript application/javascript application/json
    DeflateCompressionLevel 6
</IfModule>
```

**Expected Impact:** -60-80% response size for compressible content, faster transfer times.

---

### Pattern 6: Asset Versioning for Cache Busting

**Before:**
```html
<link rel="stylesheet" href="/etc/designs/site/clientlib.css">
```

**After:**
```html
<link rel="stylesheet" href="/etc/designs/site/clientlib.v20260303.css">
<!-- Or use query string: /etc/designs/site/clientlib.css?v=20260303 -->
```

```apache
# Rewrite versioned URLs to actual file
RewriteRule ^(.*)\.(v[0-9]+)\.(css|js)$ $1.$3 [L]
```

**Expected Impact:** Safe long-term caching, no manual cache purging needed for assets.

---

## Request Processing Optimization Patterns

### Pattern 7: Simplify Filter Rules (Order & Specificity)

**Before:**
```apache
/filter {
    /0000 { /glob "*" /type "allow" }  # Overly broad
    /0001 { /glob "/content/*" /type "allow" }
    /0002 { /glob "/content/site/*" /type "allow" }  # Redundant
    # ... 50 more rules ...
}
```

**After:**
```apache
/filter {
    /0000 { /glob "*" /type "deny" }  # Deny by default
    /0001 { /glob "/content/site/*/en/*" /type "allow" /method "GET" }  # Specific allow
    /0002 { /glob "/etc/designs/site/*" /type "allow" /method "GET" }
    # Fewer, more specific rules
}
```

**Expected Impact:** -10-20% filter evaluation time, clearer security posture.

---

### Pattern 8: Optimize Rewrite Rules (Minimize Redirects)

**Before:**
```apache
RewriteRule ^/old-path1/(.*)$ /new-path1/$1 [R=301,L]
RewriteRule ^/old-path2/(.*)$ /new-path2/$1 [R=301,L]
# ... many redirect chains ...
RewriteRule ^/new-path1/(.*)$ /final-path/$1 [R=301,L]  # Redirect chain!
```

**After:**
```apache
# Eliminate redirect chains - go directly to final destination
RewriteRule ^/old-path1/(.*)$ /final-path/$1 [R=301,L]
RewriteRule ^/old-path2/(.*)$ /new-path2/$1 [R=301,L]

# Use RewriteMap for many redirects
RewriteMap redirects txt:/etc/httpd/conf.d/redirects.txt
RewriteCond ${redirects:$1} !=""
RewriteRule ^/(.*)$ ${redirects:$1} [R=301,L]
```

**Expected Impact:** -100-300ms latency per eliminated redirect, better UX.

---

### Pattern 9: Reduce Header Processing Overhead

**Before:**
```apache
# Setting many headers on every request
Header always set X-Custom-Header-1 "value1"
Header always set X-Custom-Header-2 "value2"
Header always set X-Custom-Header-3 "value3"
# ... 10 more headers ...
```

**After:**
```apache
# Only set necessary headers, conditionally
<LocationMatch "^/content/site/">
    Header set X-Frame-Options "SAMEORIGIN"
    Header set X-Content-Type-Options "nosniff"
    # Only essential security headers
</LocationMatch>
```

**Expected Impact:** -5-10ms per request, reduced processing overhead.

---

## AMS-Specific Patterns (AEM 6.5/AMS)

### Pattern 10: Apache MPM Tuning

**Before:**
```apache
<IfModule mpm_worker_module>
    StartServers         2
    MaxRequestWorkers  150
    MinSpareThreads     25
    MaxSpareThreads     75
    ThreadsPerChild     25
    MaxRequestsPerChild  0
</IfModule>
```

**After:**
```apache
<IfModule mpm_worker_module>
    StartServers         4
    ServerLimit         16
    MaxRequestWorkers  400
    MinSpareThreads     50
    MaxSpareThreads    150
    ThreadsPerChild     25
    MaxRequestsPerChild 1000
</IfModule>
```

**Expected Impact:** +30-50% concurrent request capacity, better resource utilization.

---

### Pattern 11: KeepAlive Optimization

**Before:**
```apache
KeepAlive On
MaxKeepAliveRequests 100
KeepAliveTimeout 5
```

**After:**
```apache
KeepAlive On
MaxKeepAliveRequests 200  # Higher for more reuse
KeepAliveTimeout 2        # Lower to free up workers faster
```

**Expected Impact:** Better connection reuse, faster worker turnover under high load.

---

## Verification Pattern

For every optimization applied:

```text
# 1. Measure baseline BEFORE
baseline_metrics = monitor_metrics({
  "window_minutes": 10,
  "breakdown_by": "url_pattern"
})

# 2. Apply optimization
# (edit config files)

# 3. Validate config
lint({"mode":"directory","target":"/path/to/dispatcher/src","strict_mode":true})
sdk({"action":"check-files","config_path":"/path/to/dispatcher/src"})
validate({"config":"<updated dispatcher.any content>","type":"ams"})

# 4. Reload dispatcher (environment-specific)

# 5. Measure impact AFTER
post_metrics = monitor_metrics({
  "window_minutes": 10,
  "breakdown_by": "url_pattern"
})

# 6. Verify specific improvements
inspect_cache({"url":"/sample/page.html","config_path":"/path/to/dispatcher/src"})
trace_request({"url":"/sample/page.html","method":"GET","config_path":"/path/to/dispatcher/src"})
```

## Anti-Patterns (Avoid These)

### Anti-Pattern 1: Overly Aggressive Caching
```apache
# BAD: Apply 1-year TTL headers to all HTML pages
<LocationMatch "^/content/.*\\.html$">
    Header set Cache-Control "public, s-maxage=31536000, max-age=31536000"
</LocationMatch>
```
**Problem:** Personalized/dynamic content cached incorrectly, stale content issues.

---

### Anti-Pattern 2: No Cache Invalidation Strategy
```apache
# BAD: No invalidation rules
/invalidate {
    /0000 { /glob "*" /type "deny" }
}
```
**Problem:** Manual cache clearing required, stale content persists indefinitely.

---

### Anti-Pattern 3: Allowing All Query Parameters
```apache
# BAD: Cache with all query params
/ignoreUrlParams {
    /0001 { /glob "*" /type "allow" }
}
```
**Problem:** Cache fragmentation, low hit ratio, potential cache pollution attacks.

---

### Anti-Pattern 4: Excessive Redirect Chains
```apache
# BAD: Multiple redirects
RewriteRule ^/a$ /b [R=301,L]
RewriteRule ^/b$ /c [R=301,L]
RewriteRule ^/c$ /d [R=301,L]
```
**Problem:** 300-900ms added latency, poor user experience.

---

## Pattern Selection Guide

| Optimization Goal | Recommended Patterns | Expected Impact |
|-------------------|---------------------|-----------------|
| Improve cache hit ratio | #1, #3, #4 | +10-25% hit ratio |
| Reduce latency | #2, #6, #8, #9 | -50-200ms |
| Reduce backend load | #1, #2, #3 | -20-40% backend requests |
| Increase capacity | #5, #7, #10, #11 | +30-50% throughput |
| Optimize static assets | #2, #5, #6 | -30-60% asset load time |

## References

- Dispatcher Configuration: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-configuration
- AMS Dispatcher overview: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/overview
