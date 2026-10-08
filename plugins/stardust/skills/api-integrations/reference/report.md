# Report and write-back reference

## Inventory

`stardust/api/inventory.json` contains:

- `_provenance`.
- `integrations`: summary rows with `id`, `kind`, `method`, `endpoint`, `origin`, `pages`, `status`, `confirmed`, `auth`, `trigger`, `blockParty`, `contract`, `inspect`, and CORS/status updates when present.
- `errors`: redacted detection/static-scan errors.
- `ownerActions`: decisions or backend changes needed.
- Block Party availability metadata when relevant.

Use `confirmed: false` to keep static-only candidates visible. Unknown third-party data hosts should carry `inspect` so reviewers make an explicit decision.

## Human reports

`stardust/api/report.md` is the Phase 3 gate document. Show it and stop before implementation. It should summarize integrations by kind/host, list each endpoint with trigger, pages, auth, Block Party match, status, and owner actions.

`stardust/api/report.html` is the same content as a self-contained shareable HTML report. Escape all untrusted content, including paths, examples, and response text.

## Parity reports

`api-check` writes:

- `stardust/api/parity.json`: replayable API checks and results.
- `stardust/qa/api-report.md`: concise QA summary.
- `stardust/qa/api-report.json`: machine-readable QA result.

## Implementation artefacts

`api-codegen` writes generated EDS client modules under `scripts/api/<id>.js` and creates `scripts/api-config.js` once when absent. Treat `api-config.js` as owner-editable deployment and credential configuration; it is intentionally not overwritten by regeneration.

## Dynamics write-back

With `--writeback`, `api-check` updates Stardust artefacts without inventing new dynamics check types:

- `stardust/dynamic-features.md`: API summary rows.
- `stardust/dynamics/parity.json`: only `no-page-errors`, `dom-count`, and first-party GET `fetch-json` checks.

Never emit `form-flow`; it performs a real filled submission. Never emit `fetch-json` for third-party hosts or write endpoints.
