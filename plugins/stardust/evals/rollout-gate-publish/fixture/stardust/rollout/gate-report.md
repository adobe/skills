# gate-report — published-origin page gate

Generated 2026-09-20T10:51:51.214Z. Regime published-origin. Bars: pixel = record pass · |Δh| ≤ 8 px · chrome crops = crop-compare pass (none restated here).

**published-gated 4 of 6 · PASS 2 · FAIL 1 · unmeasured 1 · ungated 1 · published-failing 1**

| template | pages | PASS | FAIL | unmeasured | ungated | at the bar |
|---|---|---|---|---|---|---|
| article | 2 | 0 | 1 | 1 | 0 | no — not published |
| landing | 2 | 2 | 0 | 0 | 0 | yes |
| program | 2 | 0 | 1 | 0 | 1 | no — not published |

| page | status | 1440 | 360 | wasLive | at |
|---|---|---|---|---|---|
| /news/annual-report-2025 | published-failing | FAIL 23.2 % Δh 41 | PASS 8.8 % Δh 4 | yes | 2026-09-18T09:40:00Z |
| /insurance/auto | fail | PASS 7.4 % Δh 3 | FAIL 12.4 % Δh -112 | no | 2026-09-18T09:40:00Z |
| /news/storm-season-checklist | unmeasured | unmeasured (no verdict (exit 124)) | PASS 6.1 % Δh 1 | no | 2026-09-18T09:40:00Z |
| /insurance/home | ungated | ungated | ungated | no | 2026-09-20T07:51:02.060Z |
| / | pass | PASS 6.9 % Δh 0 | PASS 4.2 % Δh 2 | no | 2026-09-18T09:40:00Z |
| /business | pass | PASS 5.1 % Δh 0 | PASS 3.8 % Δh -1 | no | 2026-09-18T09:40:00Z |

## neutralDiff (reporting KPI, not a bar)

| template | bp | n | median | p90 | share < 10 % |
|---|---|---|---|---|---|
| landing | 360 | 2 | 4.8 | 5 | 1 |
| landing | 1440 | 2 | 6.8 | 7.7 | 1 |
| article | 360 | 2 | 8.25 | 9.6 | 1 |
| article | 1440 | 1 | 24 | 24 | 0 |
| program | 360 | 1 | 13.2 | 13.2 | 0 |
| program | 1440 | 1 | 8.2 | 8.2 | 1 |

Rows without a PASS are held from the publish run and re-drive with the same run once this report changes; the escape flags are operator/owner flags, never hands-off (publish-gate.md § Gate 8 — the hold inside deploy-batch --publish is pending the deploy hunk; until then read the held rows here before publishing).
