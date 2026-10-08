# Verification reference

Run checks against the migrated origin:

```bash
node scripts/api-check.mjs --origin <url> [--levels 1,2,3,4] [--confirm "METHOD /path,..."] [--confirm-live-write <id>] [--writeback]
```

The script builds `stardust/api/parity.json`, writes `stardust/qa/api-report.{md,json}`, updates contract statuses, and can write safe summaries back to Stardust dynamics.

## Levels

| level | check type | network to backend | asserts |
|---|---|---|---|
| L1 | `api-contract` | none; request intercepted and mocked | method, path and query keys, required header names, payload schema, field map, GraphQL operation/variables/persisted hash, client deps present |
| L2 | `api-mocked-flow` | none; captured success/error responses served | UI reaction: message text, reset behavior, dataLayer events, result counts for reads |
| L3 | `api-live-read` / `api-live-write-invalid` | real | reads return 2xx and match shape; confirmed writes with invalid data render the real server error |
| L4 | `api-live-write-valid` | real, one request | valid write payload matches the contract and succeeds after explicit fresh confirmation |

L1 and L2 support `load`, `search`, `click`, `select`, and `submit` triggers.

## Confirmations

- L3 GET reads need no confirmation.
- L3 invalid writes run only for endpoints listed in `--confirm "METHOD /path,..."`; otherwise they are skipped and status stops at L2.
- L4 runs only with `--confirm-live-write <id>`. Ask the user every time in that run, naming the endpoint and exact test data. Never run L4 automatically or hands-off.

During L3, every page blocks all writes except the single intended invalid-write request. During L4, writes remain blocked while the page opens and fills; the runner arms exactly one live request immediately before submit and aborts it if the captured payload diffs from the contract.

## Environment limits

CORS environment limits are reported only when the live fetch is rejected with `TypeError` and the current origin is recorded blocked in `stardust/api/cors.json`. That status is `blocked-cors`, not a code defect. Other failures remain check failures.
