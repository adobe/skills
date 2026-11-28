# Security Audit Report Template

## Executive Summary

- Audit Date: `[YYYY-MM-DD]`
- Auditor: `[security-hardening skill]`
- Scope: `[config path / environment]`
- Deployment Mode: `cloud`
- Compliance Lens: `OWASP` / `CIS` / `PCI-DSS` / custom
- Overall Posture: `PASS` / `PASS WITH RECOMMENDATIONS` / `FAIL`

Summary:
`[1-3 sentence risk summary]`

## Risk Distribution

| Severity | Count | Status |
|----------|-------|--------|
| Critical | [N] | [Open/Closed] |
| High | [N] | [Open/Closed] |
| Medium | [N] | [Open/Closed] |
| Low | [N] | [Open/Closed] |

## Evidence Log

Record only executed evidence.

| Tool | Input Summary | Result | Notes |
|------|---------------|--------|-------|
| `lint` | mode=directory, target=/path/to/dispatcher/src | [pass/fail] | [key findings] |
| `sdk` | action=check-files, config_path=/path/to/dispatcher/src | [pass/fail] | [immutable/include result] |
| `trace_request` | url=/crx/de/index.jsp, method=GET | [denied/allowed] | [filter stage evidence, plus environment assumption] |
| `inspect_cache` | url=/content/site/en/my-account.html | [exists/miss] | [sensitive cache posture] |
| `tail_logs` | lines=200 | [summary] | [security-relevant entries] |
| `monitor_metrics` | window_minutes=60, breakdown_by=status_code | [summary] | [error/deny trend] |

## Detailed Findings

### [C-001] Unexpected Admin Console Exposure

- Severity: `Critical`
- Category: `OWASP A01 Broken Access Control`
- Status: `Open`

Description:
`[what is exposed and why it matters]`

Evidence:
```text
trace_request({"url":"/crx/de/index.jsp","method":"GET"})
# denied is expected outside approved dev-only usage; otherwise record the environment assumption explicitly
```

Impact:
- `[impact bullet]`
- `[impact bullet]`

Remediation:
```apache
/filter {
    /0000 { /glob "*" /type "deny" }
    /0001 { /glob "/crx/*" /type "deny" }
    /0002 { /glob "/system/*" /type "deny" }
    # explicit allows follow
}
```

If dev-only cloud passthrough is intentional, document the environment guard instead of treating the mere existence of the path as a finding.

Verification Steps:
```text
trace_request({"url":"/crx/de/index.jsp","method":"GET"})
trace_request({"url":"/system/console","method":"GET"})
# both should report filter denied
```

Rollback:
`[safe rollback action if remediation causes regressions]`

References:
- Security checklist: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/getting-started/security-checklist
- Content filter configuration: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-configuration#configuring-access-to-content-filter

### [H-001] Missing Security Header Controls

- Severity: `High`
- Category: `OWASP A05 Security Misconfiguration`
- Status: `Open`

Description:
`[missing/weak header policy]`

Evidence:
```text
validate({"config":"<vhost/header config>","type":"httpd"})
lint({"mode":"directory","target":"/path/to/dispatcher/src","strict_mode":true})
```

Optional live proof (outside MCP):
```bash
curl -sI https://dispatcher.site.com/content/site/en.html
```

Remediation:
```apache
Header always set X-Frame-Options "SAMEORIGIN"
Header always set X-Content-Type-Options "nosniff"
Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
```

Verification:
- rerun `validate`/`lint`
- optional external HTTP header probe (for example `curl -sI`) for live response headers

## Compliance Summary

| Control Family | Status | Notes |
|----------------|--------|-------|
| OWASP A01 | [pass/fail] | [notes] |
| OWASP A05 | [pass/fail] | [notes] |
| CIS Server Hardening | [pass/fail] | [notes] |

## Mode-Specific Notes

### Cloud
- runtime evidence may rely on local Dispatcher runtime access
- if auto-discovery fails, record the container name used for manual checks

## Remediation Plan

1. P0: `[critical/high remediation]`
2. P1: `[medium remediation]`
3. P2: `[low/defense-in-depth remediation]`

## Risk And Rollback

- Risk assumptions: `[list]`
- Rollback command/process: `[list]`
- Residual risks after remediation: `[list]`

## Appendix

- Raw `validate` output: `[attach/reference]`
- Raw `lint` output: `[attach/reference]`
- Raw `sdk` output: `[attach/reference]`
- Raw runtime outputs: `[attach/reference]`

---

Skill Version: `security-hardening v1.0.0`
MCP Contract: `core-7-tools`
