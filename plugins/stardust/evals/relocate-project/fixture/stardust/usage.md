<!-- stardust:provenance
  writtenBy: stardust:stardust token-ledger.mjs
  writtenAt: 2026-09-14T08:32:00Z
  readArtifacts:
    - stardust/status.jsonl
    - <harness transcript directory>
  synthesizedInputs: []
-->

# Usage — larkspur-mutual

Advisory ledger from the harness transcripts (3 main, 2 subagent); requests de-duplicated by requestId; windows from `status.jsonl`. Tokens are counts, not verdicts.

| window | from | to | wall min | turns | prompts | acks | fresh | cache write (1h / 5m) | cache read | output (thinking) | sub req / read / out | pages | tokens/page | est. USD |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| extract per-page extraction | 2026-09-08T09:14:35Z | 2026-09-08T09:38:10Z | 24 | 41 | 2 | 1 | 38.2 k | 1.20 M (1.20 M / 0) | 9.84 M | 61.3 k (4.1 k) | 0 / 0 / 0 | 19 | 585421 | 6.02 |
| replica source-fidelity gate | 2026-09-09T11:50:00Z | 2026-09-09T17:22:00Z | 332 | 118 | 6 | 3 | 71.9 k | 2.31 M (2.31 M / 0) | 41.66 M | 214.7 k (28.9 k) | 2 / 3.10 M / 44.2 k | — | — | 24.63 |
| migrate per-page render | 2026-09-10T15:24:15Z | 2026-09-10T15:39:21Z | 15 | 12 | 1 | 1 | 4.9 k | 0 (0 / 0) | 3.02 M | 18.4 k (1.2 k) | 0 / 0 / 0 | 6 | 507550 | 1.20 |
| unwindowed | — | — | — | 9 | 4 | 2 | 6.1 k | 88.0 k (88.0 k / 0) | 1.41 M | 9.7 k (0.6 k) | 0 / 0 / 0 | — | — | 0.92 |
| **total** | 2026-09-08T09:14:35Z | 2026-09-10T15:39:21Z | — | 180 | 13 | 7 | 121.1 k | 3.60 M (3.60 M / 0) | 55.93 M | 304.1 k (34.8 k) | 2 / 3.10 M / 44.2 k | — | — | 32.77 |

Harness-reported session cost (not per phase): USD 34.10 over 3 session line(s).
