# Sensitive Paths Catalog

## Critical Paths (Should ALWAYS Be Denied)

### Admin Consoles
```
/crx/de*                    # CRXDE Lite
/crx/explorer*              # CRX Explorer
/system/console*            # Felix/OSGi Console
/etc/replication/agents*    # Replication agents
```

### Development Tools
```
/libs/granite/core/content/login*  # Login pages (should be via CDN/publish)
/apps/*/install/*                  # Package installation
/etc/packages/*                    # Package management
/system/health*                    # Health checks (should be internal only)
```

### Query & Content APIs
```
/bin/querybuilder*          # Query builder (high risk)
/bin/wcm/search*            # WCM search
/jcr:*                      # JCR namespaces
```

## High-Risk Paths (Restrict to Auth Users Only)

### Content APIs
```
/content/*/jcr:content*     # Direct JCR content access
/content/*.json             # JSON exports (check depth)
/content/*.xml              # XML exports
/content/*.infinity.json    # Deep JSON exports
```

### User-Generated Content (if any)
```
/content/usergenerated/*    # UGC (check auth)
/content/forms/af/*         # Adaptive forms data
```

## Medium-Risk Paths (Context-Dependent)

### Client Libraries
```
/etc/designs/*              # Client libraries (usually public)
/etc/clientlibs/*           # Clientlibs (usually public)
/apps/*/clientlibs/*        # App-specific clientlibs
```
**Note:** These are often public, but verify no sensitive code/keys embedded.

### Assets
```
/content/dam/*              # Digital assets (check permissions)
```
**Note:** Public assets OK, but verify no PII/internal docs.

### Servlets
```
/bin/myapp/api/*            # Custom servlets (verify auth)
/services/*                 # Custom services (verify auth)
```

## Bypass Techniques to Test

### Selector/Extension Bypass
```
/system/console.html.jpg    # Append safe extension
/crx/de.css                 # Append CSS extension
/admin.json;.html           # Semicolon bypass
```

### Path Traversal
```
/content/site/../../../etc/passwd
/content/site/%2e%2e/%2e%2e/etc/passwd  # URL encoded
/content/./site/.././../etc/passwd      # Dot traversal
```

### Double Encoding
```
/content/%252e%252e/%252e%252e/etc/passwd
```

### Case Variation (if case-insensitive)
```
/CRX/DE/index.jsp
/System/Console
```

### HTTP Method Bypass
```
POST /system/console HTTP/1.1
X-HTTP-Method-Override: GET
```


## AMS-Specific Paths

### AMS Tooling
```
/etc/acs-commons/*          # ACS Commons tools (check exposure)
/etc/designs/acs-commons/*
```

### Legacy Paths
```
/etc/cloudservices/*        # Cloud service configs
/etc/mobile/*               # Mobile configs
```

## Test Matrix

| Path | Expected Result | Severity if Accessible |
|------|-----------------|------------------------|
| `/crx/de/index.jsp` | 403 Forbidden | Critical |
| `/system/console` | 403 Forbidden | Critical |
| `/bin/querybuilder.json` | 403 Forbidden (POST) | Critical |
| `/content/site/en.infinity.json` | 403 Forbidden or depth-limited | High |
| `/etc/designs/site/clientlib.js` | 200 OK (if public) | N/A |
| `/content/dam/public/image.jpg` | 200 OK (if public) | N/A |
| `/content/site/../../../etc/passwd` | 400/403 | High |
| `/libs/granite/core/content/login.html` | 403 or redirect | Medium |

## MCP Test Commands

### Test Admin Path Blocking
```text
trace_request({"url":"/crx/de/index.jsp","method":"GET"})
# Expected: filter denied

trace_request({"url":"/system/console","method":"GET"})
# Expected: filter denied

trace_request({"url":"/bin/querybuilder.json","method":"POST"})
# Expected: filter denied
```

### Test Bypass Attempts
```text
trace_request({"url":"/system/console.html.jpg","method":"GET"})
# Expected: filter denied (no extension-based bypass)

trace_request({"url":"/content/site/../../../etc/passwd","method":"GET"})
# Expected: 400 or filter denied

trace_request({"url":"/content/site/en.json;.css","method":"GET"})
# Expected: handled safely (no bypass)
```

### Test Sensitive Content
```text
trace_request({"url":"/content/site/en.infinity.json","method":"GET"})
# Expected: filter denied or depth-limited behavior

inspect_cache({"url":"/content/site/en/my-account.html","show_metadata":true})
# Expected: not cached (for auth/private content)
```

## Finding Templates

### Critical Finding: Admin Console Accessible
```
**Finding:** Admin console accessible without authentication
**Path:** /crx/de/index.jsp
**Severity:** Critical
**Evidence:** trace_request shows 200 OK response
**Impact:** Direct system access, full content compromise possible
**Recommendation:** Add filter deny rule for /crx/* with highest priority. Place the deny after any allow that matches the path (last-applied filter wins).
**Verification:** `trace_request({"url":"/crx/de/index.jsp","method":"GET"})` should return filter denied
```

### High Finding: Query Builder Exposed
```
**Finding:** Query Builder endpoint accessible
**Path:** /bin/querybuilder.json
**Severity:** High
**Evidence:** POST request succeeds without authentication
**Impact:** Arbitrary content querying, potential data exfiltration
**Recommendation:** Deny POST method to /bin/querybuilder* or require authentication
**Verification:** `trace_request({"url":"/bin/querybuilder.json","method":"POST"})` should deny
```

### Medium Finding: Deep JSON Export Allowed
```
**Finding:** Deep JSON exports allowed without depth limit
**Path:** /content/*.infinity.json
**Severity:** Medium
**Evidence:** Infinity selector returns full tree
**Impact:** Information disclosure, potential performance impact
**Recommendation:** Block *.infinity.json selector or limit JSON depth
**Verification:** Test with trace_request, verify max depth enforced
```

## References

- AEM Security Checklist: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/getting-started/security-checklist
- Content filter configuration: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-configuration#configuring-access-to-content-filter
