# Security Audit Report Template

## Executive Summary

- Audit Date: `[YYYY-MM-DD]`
- Auditor: `[security-hardening skill]`
- Scope: `[config path / environment]`
- Deployment Mode: `ams`
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
| `trace_request` | url=/crx/de/index.jsp, method=GET | [denied/allowed] | [filter stage evidence] |
| `inspect_cache` | url=/content/site/en/my-account.html | [exists/miss] | [sensitive cache posture] |
| `tail_logs` | lines=200 | [summary] | [security-relevant entries] |
| `monitor_metrics` | window_minutes=60, breakdown_by=status_code | [summary] | [error/deny trend] |

## Detailed Findings

### [C-001] Admin Console Accessible

- Severity: `Critical`
- Category: `OWASP A01 Broken Access Control`
- Status: `Open`

Description:
`[what is exposed and why it matters]`

Evidence:
```text
trace_request({"url":"/crx/de/index.jsp","method":"GET"})
# stage.filter.status = denied (expected) OR passed (finding)
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

### AMS
- runtime evidence relies on host log/config mounts
- prefer explicit `log_path` when non-standard

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
