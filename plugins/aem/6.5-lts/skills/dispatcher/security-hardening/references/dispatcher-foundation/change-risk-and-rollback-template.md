# Change Risk And Rollback Template

Use this template for any dispatcher recommendation that changes behavior.

## 1) Change Summary

- Change scope:
- Target mode: `ams`
- Files impacted:
- User-visible impact expected:

## 2) Risk Assessment

| Risk Area | Assessment | Notes |
|---|---|---|
| Security exposure | Low / Medium / High | |
| Availability impact | Low / Medium / High | |
| Cache correctness | Low / Medium / High | |
| Migration compatibility | Low / Medium / High | |
| Rollback complexity | Low / Medium / High | |

## 3) Blast Radius

- Hostnames/farms affected:
- URL classes affected:
- Dependency assumptions:

## 4) Rollback Plan

- Rollback trigger criteria:
- Immediate rollback action:
- Validation after rollback:
- Owner/escalation path:

## 5) Verification Gate

The change is production-ready only when:

1. Required checks in `mode-specific-verification-matrix.md` are complete.
2. Evidence is attached for each executed check.
3. Open risks are explicitly accepted or remediated.
