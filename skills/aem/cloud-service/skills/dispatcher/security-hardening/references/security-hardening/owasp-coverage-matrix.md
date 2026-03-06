# OWASP Top 10 Coverage Matrix for Dispatcher

## OWASP Top 10 2021 - Dispatcher Controls

### A01:2021 - Broken Access Control

**Dispatcher Controls:**
- Filter rules (allow/deny)
- Virtual host restrictions
- Method-based access controls

**Audit Checks:**
- [ ] Deny-by-default filter posture
- [ ] Admin paths blocked (`/crx/*`, `/system/*`)
- [ ] Internal servlets protected (`/bin/querybuilder*`)
- [ ] Method restrictions enforced (POST/PUT/DELETE)
- [ ] No glob wildcard allows

**MCP Validation:**
```text
trace_request({"url":"/crx/de/index.jsp","method":"GET"})          # Should deny
trace_request({"url":"/content/site/en.html","method":"POST"})     # Should deny (read-only)
trace_request({"url":"/bin/querybuilder.json","method":"GET"})     # Should deny
```

**Severity if Failed:** Critical

---

### A02:2021 - Cryptographic Failures

**Dispatcher Controls:**
- SSL/TLS configuration
- HSTS headers
- Secure cookie attributes (forwarded from backend)

**Audit Checks:**
- [ ] TLS 1.2+ only (SSLv2/3, TLS 1.0/1.1 disabled)
- [ ] Strong cipher suites only
- [ ] Valid SSL certificates (not expired, not self-signed)
- [ ] HSTS header present on HTTPS
- [ ] No sensitive data cached unencrypted

**MCP Validation:**
```text
# Check HTTPS config statically (vhost content)
validate({"config":"<vhost.conf content>","type":"httpd"})
lint({"mode":"directory","target":"/path/to/dispatcher/src","strict_mode":true})

# MCP does not directly return live response headers.
# Verify HSTS via config presence and, when available, external HTTP probe:
# curl -sI https://site.com/content/site/en.html | grep Strict-Transport-Security
```

**Severity if Failed:** High to Critical

---

### A03:2021 - Injection

**Dispatcher Controls:**
- Query parameter filtering
- Selector/extension validation
- Path traversal prevention

**Audit Checks:**
- [ ] Query parameters sanitized before caching
- [ ] No SQL/NoSQL injection vectors via dispatcher
- [ ] Path traversal blocked (`../*` patterns)
- [ ] Selector/extension bypass prevented

**MCP Validation:**
```text
trace_request({"url":"/content/site/../../../etc/passwd","method":"GET"})        # Should deny/400
trace_request({"url":"/content/site/en.html?query=<script>","method":"GET"})     # Should sanitize
trace_request({"url":"/content/site/en.json;.css","method":"GET"})                # Should handle safely
```

**Severity if Failed:** High

---

### A04:2021 - Insecure Design

**Dispatcher Controls:**
- Configuration architecture (immutable files, includes)
- Least-privilege defaults

**Audit Checks:**
- [ ] Deny-by-default architecture
- [ ] Immutable files unmodified (cloud)
- [ ] Least-privilege filter rules
- [ ] Security-first cache policy
- [ ] Include structure follows best practices

**MCP Validation:**
```text
lint({"mode":"directory","target":"/path/to/dispatcher/src","strict_mode":true})
sdk({"action":"check-files","config_path":"/path/to/dispatcher/src"})
validate({"config":"<dispatcher.any content>","type":"cloud"})
```

**Severity if Failed:** Medium

---

### A05:2021 - Security Misconfiguration

**Dispatcher Controls:**
- Default deny filters
- Security headers
- Version disclosure prevention
- Error page configuration

**Audit Checks:**
- [ ] No default/example configs left enabled
- [ ] Security headers configured
- [ ] Server version hidden
- [ ] Directory listing disabled
- [ ] Error pages sanitized (no stack traces)

**MCP Validation:**
```text
lint({"mode":"directory","target":"/path/to/dispatcher/src","strict_mode":true})
validate({"config":"<httpd/vhost header config content>","type":"httpd"})
inspect_cache({"url":"/content/site/en.html","show_metadata":true})
# For live header proof, use external HTTP probe in environment:
# curl -sI https://site.com/content/site/en.html
```

**Severity if Failed:** Medium to High

---

### A06:2021 - Vulnerable and Outdated Components

**Dispatcher Controls:**
- Dispatcher version management
- Apache version management

**Audit Checks:**
- [ ] Dispatcher version is latest stable
- [ ] Apache version is patched
- [ ] No known CVEs in deployed versions
- [ ] Regular update schedule documented

**MCP Validation:**
```bash
# Check dispatcher version
# Verify against: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/getting-started/release-notes
```

**Severity if Failed:** High (if CVEs present)

---

### A07:2021 - Identification and Authentication Failures

**Dispatcher Controls:**
- Pass-through to AEM (dispatcher doesn't handle auth)
- Session cookie security (forwarded from AEM)
- Protected admin paths

**Audit Checks:**
- [ ] Admin paths require backend auth
- [ ] No auth bypass via dispatcher filters
- [ ] Secure cookie attributes forwarded
- [ ] No credentials in logs

**MCP Validation:**
```text
trace_request({"url":"/system/console","method":"GET"})  # Should deny before reaching AEM
tail_logs({"lines":1000})
# Review returned entries for sensitive tokens/password patterns.
```

**Severity if Failed:** Critical (if bypass possible)

---

### A08:2021 - Software and Data Integrity Failures

**Dispatcher Controls:**
- Immutable file integrity (cloud)
- Configuration baseline monitoring
- Cache integrity

**Audit Checks:**
- [ ] Immutable files match baseline (cloud)
- [ ] Config changes tracked
- [ ] Cache invalidation prevents stale data
- [ ] No unauthorized config modifications

**MCP Validation:**
```text
sdk({"action":"diff-baseline","config_path":"/path/to/dispatcher/src"})
sdk({"action":"check-files","config_path":"/path/to/dispatcher/src"})
```

**Severity if Failed:** Medium

---

### A09:2021 - Security Logging and Monitoring Failures

**Dispatcher Controls:**
- Access logging
- Error logging
- Security event logging (denies, errors)

**Audit Checks:**
- [ ] Filter denies logged
- [ ] 4xx/5xx errors logged
- [ ] Access logs enabled
- [ ] Log rotation configured
- [ ] No sensitive data in logs

**MCP Validation:**
```text
tail_logs({"lines":100})
monitor_metrics({"window_minutes":60,"breakdown_by":"status_code"})
```

**Severity if Failed:** Low to Medium

---

### A10:2021 - Server-Side Request Forgery (SSRF)

**Dispatcher Controls:**
- Filter rules blocking internal paths
- Backend origin validation

**Audit Checks:**
- [ ] Internal service paths blocked
- [ ] No open proxy behavior
- [ ] Localhost requests denied
- [ ] Internal IP ranges blocked (if applicable)

**MCP Validation:**
```text
trace_request({"url":"/content/site/proxy?url=http://localhost","method":"GET"})           # Should deny
trace_request({"url":"/content/site/proxy?url=http://169.254.169.254","method":"GET"})     # Should deny
```

**Severity if Failed:** High

---

## Compliance Mapping

### PCI-DSS Requirements
| Requirement | Dispatcher Control | Check |
|-------------|-------------------|-------|
| 2.2 | Strong crypto (TLS 1.2+) | SSL config audit |
| 6.5.3 | No sensitive data in logs | Log content review |
| 6.6 | Web application firewall | Filter rules audit |
| 8.2.1 | Multi-factor auth | Pass-through to AEM |

### CIS Apache HTTP Server Benchmark
| Control | Dispatcher Mapping | Check |
|---------|-------------------|-------|
| 2.1 | Run as dedicated user | Process ownership |
| 3.1 | Disable directory listing | Options -Indexes |
| 4.1 | Remove unnecessary modules | LoadModule audit |
| 5.1 | Configure TLS 1.2+ minimum | SSLProtocol config |
| 7.1 | Set ServerTokens to Prod | ServerTokens audit |

### NIST CSF
| Function | Dispatcher Control | Implementation |
|----------|-------------------|----------------|
| Identify | Asset inventory | Config management |
| Protect | Access controls | Filter rules |
| Detect | Logging/monitoring | Access logs, metrics |
| Respond | Incident handling | Log analysis |
| Recover | Backup/restore | Config version control |

---

## Finding Template

```markdown
## OWASP A01:2021 - Broken Access Control

**Severity:** Critical
**Status:** Failed

**Finding:**
Admin console accessible without authentication via `/crx/de/index.jsp`.

**Evidence:**
```text
trace_request({"url":"/crx/de/index.jsp","method":"GET"})
status: passed/allowed
```

**Impact:**
- Direct system access
- Full content tree access
- Potential system compromise

**Recommendation:**
Add deny rule for admin paths with highest priority. Place the deny after any allow that matches the path (last-applied filter wins).
```apache
/filter {
    /0000 { /glob "*" /type "deny" }
    /0001 { /glob "/crx/*" /type "deny" }
    /0002 { /glob "/system/*" /type "deny" }
    # ... other allows ...
}
```

**Verification:**
```text
trace_request({"url":"/crx/de/index.jsp","method":"GET"})
# Expected: filter stage status = denied
```

**References:**
- Dispatcher content filter config: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-configuration#configuring-access-to-content-filter
- AEM Security Checklist: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/getting-started/security-checklist
```

---

## Automated OWASP Check Pattern

```text
Use your automation runner to execute MCP calls and score checks:

1) access = trace_request({"url":"/crx/de/index.jsp","method":"GET"})
2) traversal = trace_request({"url":"/content/../../../etc/passwd","method":"GET"})
3) static_check = lint({"mode":"directory","target":"/path/to/dispatcher/src","strict_mode":true})
4) integrity = sdk({"action":"check-files","config_path":"/path/to/dispatcher/src"})
5) drift = sdk({"action":"diff-baseline","config_path":"/path/to/dispatcher/src"})

Then score pass/fail using returned stage statuses and issue severities.
For live response-header checks (HSTS/CSP/etc), add external HTTP probes in the same pipeline.
```

---

## References

- Dispatcher content filter config: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-configuration#configuring-access-to-content-filter
- AEM Security Checklist: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/getting-started/security-checklist
- Dispatcher release notes: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/getting-started/release-notes
