# Security Baseline Checklist

## Filter Security

- [ ] **Deny-by-default posture**: First filter rule is `{ /glob "*" /type "deny" }`
- [ ] **Explicit allow rules**: All allows are specific (path + method + extension/selector)
- [ ] **Admin paths blocked**: `/crx/*`, `/system/*`, `/bin/*` (except explicitly needed)
- [ ] **Internal servlets blocked**: `/libs/*/servlets/*`, `/apps/*/servlets/*` (unless public)
- [ ] **Method restrictions**: POST/PUT/DELETE denied on read-only content
- [ ] **No glob wildcards in allows**: Avoid `/glob "*/admin"` patterns
- [ ] **Selector/extension controls**: Prevent bypasses like `.json;.css`

## Cache Security

- [ ] **No auth content caching**: Personalized/authenticated pages excluded
- [ ] **PII not cached**: User-specific data explicitly bypassed
- [ ] **Query parameter restrictions**: Only safe params allowed for caching
- [ ] **Cache invalidation configured**: Proper flush rules prevent stale sensitive data
- [ ] **statfileslevel appropriate**: Not too broad to prevent over-invalidation

## Header Security

- [ ] **X-Frame-Options**: Set to `SAMEORIGIN` or `DENY`
- [ ] **X-Content-Type-Options**: Set to `nosniff`
- [ ] **X-XSS-Protection**: Set to `1; mode=block`
- [ ] **Strict-Transport-Security**: HSTS enabled with appropriate max-age
- [ ] **Content-Security-Policy**: Appropriate CSP policy for application
- [ ] **Referrer-Policy**: Set to `strict-origin-when-cross-origin` or stricter
- [ ] **No version disclosure**: `Server` header hidden or genericized
- [ ] **No technology leakage**: No `X-Powered-By`, `X-AEM-Version` headers

## SSL/TLS Configuration (AMS)

- [ ] **TLS 1.2+ only**: SSLv2, SSLv3, TLS 1.0, TLS 1.1 disabled
- [ ] **Strong ciphers**: No MD5, RC4, DES, or export ciphers
- [ ] **Server cipher preference**: `SSLHonorCipherOrder on`
- [ ] **Valid certificate**: Not expired, not self-signed (production)
- [ ] **Certificate chain complete**: Intermediate certs included
- [ ] **OCSP stapling**: Enabled if supported

## Access Control

- [ ] **Virtual host restrictions**: Only expected hosts accepted
- [ ] **IP allowlisting (if required)**: Restricted admin access from trusted IPs
- [ ] **No directory listing**: `Options -Indexes`
- [ ] **No .ht file access**: `.htaccess` and `.htpasswd` blocked
- [ ] **No sensitive file extensions**: `.bak`, `.old`, `.tmp`, `.swp` blocked

## Information Disclosure Prevention

- [ ] **Error pages sanitized**: No stack traces or internal paths in errors
- [ ] **Directory browsing disabled**: `Options -Indexes`
- [ ] **Version info hidden**: Apache/dispatcher versions not disclosed
- [ ] **Internal paths not exposed**: No file system paths in responses
- [ ] **Sensitive data not logged**: No passwords/tokens in access logs

## Logging & Monitoring

- [ ] **Security events logged**: Filter denies, auth failures, errors
- [ ] **Log rotation configured**: Prevent disk exhaustion
- [ ] **Log integrity protected**: Logs not world-writable
- [ ] **Sufficient log retention**: Adequate for incident investigation
- [ ] **No sensitive data in logs**: PII, credentials excluded

## Immutable Files (AMS)

- [ ] **Immutable files unmodified**: No changes to AMS immutable files
- [ ] **Include structure preserved**: Default includes not removed
- [ ] **Baseline drift monitored**: SDK diff-baseline checks pass

## General Configuration

- [ ] **Least privilege principle**: Only necessary modules loaded
- [ ] **No debug mode**: Production configs have debug disabled
- [ ] **Secure defaults**: No insecure fallback configs
- [ ] **Configuration comments minimal**: No sensitive info in comments
- [ ] **File permissions correct**: Configs not world-writable

## Compliance-Specific (if applicable)

### PCI-DSS
- [ ] Strong cryptography (TLS 1.2+)
- [ ] No cardholder data in logs
- [ ] Access controls on payment pages

### GDPR/Privacy
- [ ] No PII caching
- [ ] User consent for tracking cookies
- [ ] Data minimization in logs

### SOC2
- [ ] Audit logging enabled
- [ ] Access controls documented
- [ ] Change management for configs

## Severity Mapping

| Check Failed | Severity | Rationale |
|--------------|----------|-----------|
| Deny-by-default missing | Critical | Fundamental security posture |
| Admin paths accessible | Critical | Direct system compromise |
| Auth content cached | Critical | Data exposure |
| TLS 1.0/SSLv3 enabled | High | Vulnerable to attacks |
| No HSTS on HTTPS | High | MITM vulnerability |
| Method restrictions missing | High | Write operations possible |
| X-Frame-Options missing | Medium | Clickjacking risk |
| Version disclosure | Low | Information leakage |
| Missing CSP | Medium | XSS risk (app-dependent) |

## MCP Tool Mapping

| Check Category | Primary MCP Tool | Command Example |
|----------------|------------------|-----------------|
| Filter rules | `trace_request` | Test sensitive paths |
| Cache security | `inspect_cache` | Verify no PII cached |
| Header directives | `validate` + `lint` | Verify configured security headers in vhost/httpd config |
| Header propagation hints | `inspect_cache` | Inspect cached object metadata for header behavior clues |
| Config validity | `validate` | Syntax and policy checks |
| Anti-patterns | `lint` | Security rule violations |
| Immutable files | `sdk` | Baseline drift check |
| Security events | `tail_logs` | Anomaly detection |
