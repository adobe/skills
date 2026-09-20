# gate-report — published-origin page gate

Generated 2026-09-18T10:25:00Z. Regime published-origin. Bars: pixel = record pass · |Δh| ≤ 8 px · chrome crops = crop-compare pass (none restated here).

**published-gated 8 of 9 · PASS 6 · FAIL 2 · unmeasured 1 · ungated 0**

Sample: seed 11 · n 2 per template · excluded news__annual-report-2025

| template | pages | PASS | FAIL | unmeasured | ungated | at the bar |
|---|---|---|---|---|---|---|
| article | 3 | 2 | 0 | 1 | 0 | no — not published |
| landing | 3 | 3 | 0 | 0 | 0 | yes |
| program | 3 | 1 | 2 | 0 | 0 | no — not published |

| page | status | 1440 | 360 | wasLive | at |
|---|---|---|---|---|---|
| /insurance/flood | fail | PASS 6.9 % Δh 3 | FAIL 14.1 % Δh -96 | no | 2026-09-18T10:20:00Z |
| /insurance/life | fail | FAIL 7.8 % Δh 22 | PASS 6.3 % Δh 1 | no | 2026-09-18T10:20:00Z |
| /news/storm-season-checklist | unmeasured | unmeasured (no verdict (exit 124)) | PASS 6.1 % Δh 1 | no | 2026-09-18T09:40:00Z |
| /news/rate-notice-2026 | pass | PASS 6.2 % Δh 2 | PASS 7.1 % Δh -4 | no | 2026-09-18T10:20:00Z |
| /news/member-meeting | pass | PASS 6.2 % Δh 2 | PASS 7.1 % Δh -4 | no | 2026-09-18T10:20:00Z |
| / | pass | PASS 6.9 % Δh 0 | PASS 4.2 % Δh 2 | no | 2026-09-18T09:40:00Z |
| /business | pass | PASS 5.1 % Δh 0 | PASS 3.8 % Δh -1 | no | 2026-09-18T09:40:00Z |
| /about | pass | PASS 5.4 % Δh 1 | PASS 4.9 % Δh 3 | no | 2026-09-18T10:20:00Z |
| /insurance/home | pass | PASS 4.4 % Δh 0 | PASS 5.8 % Δh 2 | no | 2026-09-18T10:20:00Z |

## neutralDiff (reporting KPI, not a bar)

| template | bp | n | median | p90 | share < 10 % |
|---|---|---|---|---|---|
| article | 360 | 3 | 7.9 | 7.9 | 1 |
| article | 1440 | 2 | 7 | 7 | 1 |
| landing | 360 | 3 | 5 | 5.7 | 1 |
| landing | 1440 | 3 | 6.2 | 7.7 | 1 |
| program | 360 | 3 | 7.1 | 14.9 | 0.67 |
| program | 1440 | 3 | 7.7 | 8.6 | 1 |

Rows without a PASS are held from the publish run and re-drive with the same run once this report changes; the escape flags are operator/owner flags, never hands-off (publish-gate.md § Gate 8 — `deploy-batch --publish` reads this report's JSON and holds them; `--plan` prints the held reasons offline).
