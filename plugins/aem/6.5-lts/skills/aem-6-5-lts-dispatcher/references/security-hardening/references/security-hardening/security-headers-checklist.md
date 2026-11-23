# Security Headers Checklist

## Scope

Use this checklist to verify header hardening in Dispatcher/HTTPD configs with the current MCP core tools.

Important contract note:
- `trace_request` does not return full live response headers.
- Use MCP for config/runtime evidence and optional external HTTP probes (for example `curl -I`) for live-header confirmation.

## Essential Headers

### X-Frame-Options
Purpose: clickjacking protection.

Recommended:
```apache
Header always set X-Frame-Options "SAMEORIGIN"
# or DENY for stricter posture
```

MCP checks:
- `validate({"config":"<vhost/header config>","type":"httpd"})`
- `lint({"mode":"directory","target":"/path/to/dispatcher/src","strict_mode":true})`

### X-Content-Type-Options
Purpose: MIME sniffing protection.

Recommended:
```apache
Header always set X-Content-Type-Options "nosniff"
```

MCP checks:
- `validate({"config":"<vhost/header config>","type":"httpd"})`
- `lint({"mode":"directory","target":"/path/to/dispatcher/src","strict_mode":true})`

### Strict-Transport-Security (HTTPS only)
Purpose: enforce HTTPS.

Recommended:
```apache
<VirtualHost *:443>
    Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
</VirtualHost>
```

MCP checks:
- `validate({"config":"<https vhost config>","type":"httpd"})`
- `lint({"mode":"directory","target":"/path/to/dispatcher/src","strict_mode":true})`

Optional live probe:
```bash
curl -sI https://site.com/content/site/en.html | grep Strict-Transport-Security
```

### Content-Security-Policy (CSP)
Purpose: reduce XSS/data injection risk.

Recommended baseline:
```apache
Header always set Content-Security-Policy "default-src 'self'; frame-ancestors 'self';"
```

MCP checks:
- `validate({"config":"<header config>","type":"httpd"})`
- `lint({"mode":"directory","target":"/path/to/dispatcher/src","strict_mode":true})`

### Referrer-Policy
Purpose: control referrer leakage.

Recommended:
```apache
Header always set Referrer-Policy "strict-origin-when-cross-origin"
```

### Permissions-Policy
Purpose: restrict browser features.

Recommended:
```apache
Header always set Permissions-Policy "geolocation=(), microphone=(), camera=()"
```

## Information Disclosure Controls

### Server token minimization
```apache
ServerTokens Prod
ServerSignature Off
Header always unset Server
Header always set Server "WebServer"
```

### Remove framework/version headers
```apache
Header always unset X-Powered-By
Header always unset X-AEM-Version
Header always unset X-Dispatcher-Version
```

MCP checks:
- `validate({"config":"<httpd/vhost config>","type":"httpd"})`
- `lint({"mode":"directory","target":"/path/to/dispatcher/src","strict_mode":true})`

## Cache-Sensitive Header Controls

### Authenticated or no-store content
```apache
<LocationMatch "^/content/site/.*/my-account\.html$">
    Header always set Cache-Control "no-cache, no-store, must-revalidate"
    Header always set Pragma "no-cache"
    Header always set Expires "0"
</LocationMatch>
```

MCP checks:
- `inspect_cache({"url":"/content/site/en/my-account.html","show_metadata":true})`
- Confirm authenticated or no-store pages are not cached (or have expected `.headers` metadata behavior).

## Mode Notes

### AMS (`AEM_DEPLOYMENT_MODE=ams`)
- Runtime checks use host-mounted log and config paths.
- Prefer explicit `log_path` when default log location differs.

## Testing Matrix

| Control | MCP Verification | Expected Result | Severity |
|---------|------------------|-----------------|----------|
| X-Frame-Options configured | `validate` + `lint` on vhost/header config | directive present | Medium |
| HSTS configured on HTTPS vhost | `validate` + `lint` | directive present | High |
| Server disclosure minimized | `validate` + `lint` | `ServerTokens Prod` / header unset or generic | Low-Medium |
| Sensitive content cache-protected | `inspect_cache` + `trace_request` | authenticated or no-store content not cache-exposed | High |

## Automation Pattern

```text
1) static_httpd = validate({"config":"<vhost/header config>","type":"httpd"})
2) static_dir = lint({"mode":"directory","target":"/path/to/dispatcher/src","strict_mode":true})
3) cache_probe = inspect_cache({"url":"/content/site/en/my-account.html","show_metadata":true})
4) request_probe = trace_request({"url":"/content/site/en/my-account.html","method":"GET"})
```

If live header confirmation is required, add external HTTP header probes (for example `curl -sI`) to the same pipeline.

## References

- Dispatcher security checklist: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/getting-started/security-checklist
- Dispatcher SSL guidance: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-ssl
- AMS dispatcher overview: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/overview
