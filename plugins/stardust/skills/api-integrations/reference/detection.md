# Detection reference

Detection has two layers. Both write only under `stardust/api/` and all persisted evidence is redacted.

## Layer 1: static scan

Command forms:

```bash
node scripts/api-static-scan.mjs --urls <url,url,…> [--out stardust/api/static-candidates.json]
node scripts/api-static-scan.mjs --from-dynamics stardust/current/_dynamics.json [--out stardust/api/static-candidates.json]
node scripts/api-static-scan.mjs --from-state stardust/state.json [--out stardust/api/static-candidates.json]
```

The scanner fetches raw HTML and same-site script bundles, then records unconfirmed candidates from:

- `fetch`, `axios`, and `XMLHttpRequest.open` calls.
- `/api/`, `/graphql`, versioned API paths, and API base URL literals.
- GraphQL documents and operation names/types.
- `data-endpoint`, `data-api`, and form `action` attributes.
- JSON settings islands such as application bootstrap data.

Caps: page HTML uses the bundle byte cap; script bundles are capped at 2,000,000 bytes, 20 bundles per page.

## Layer 2: browser detect

Command forms:

```bash
node scripts/api-detect.mjs --urls <url,url,…> [--read-post <regex,…>] [--headed]
node scripts/api-detect.mjs --from-dynamics stardust/current/_dynamics.json [--probe-writes --confirm "POST /api/path"]
node scripts/api-detect.mjs --from-state stardust/state.json [--probe-writes --confirm "POST /api/path"]
```

Playwright loads each page, accepts/settles/scrolls using the Stardust approach, then drives bounded interactions: up to 5 forms, 5 clicks, and 3 selects per page. Trigger types recorded for verification include `load`, `search`, `click`, `select`, and `submit`.

Captured in-scope requests include XHR/fetch plus document POSTs. Persisted request evidence includes method, redacted URL, content type, header names, auth scheme only, redacted request body/schema, GraphQL metadata, field map, and client dependencies. Response bodies and UI text are redacted and capped at 65,536 bytes.

## Write blocking and read POSTs

Writes are POST, PUT, PATCH, DELETE, and GraphQL mutations. They are recorded and aborted before reaching the server. Out-of-scope tag/media vendors pass through so the page keeps working.

Use `--read-post <regex,…>` only when a non-GraphQL POST endpoint is known to be a read API such as search. The regex allow-list makes matching REST POSTs pass through during detection, but it never applies to a GraphQL mutation or a GraphQL batch containing any mutation.

## Redaction and placeholders

Never persist header values, cookie values, real reCAPTCHA tokens, response PII, dataLayer values, or raw UI text. Persist placeholders:

- Synthetic data: `<test:key>`.
- Cookie-derived payload leaves: `<cookie:NAME>`.
- reCAPTCHA/token leaves: `<recaptcha>`.
- Multipart bodies: field names only.

Static candidate endpoints keep query keys but replace query values with placeholders. Dynamic query values, response bodies, dataLayer events, UI text, and top-level error URLs/messages are redacted before persistence. Header names may persist; auth is derived from request headers only.

## Error-shape probe

`--probe-writes` is opt-in. Without `--confirm`, detection still blocks writes, writes `observations.json`, prints each write endpoint as `METHOD path`, and exits 2. Show that list to the user. With `--confirm "METHOD path,…"`, the script sends one invalid-data request per confirmed write endpoint from the source page context, then records the redacted server error shape and UI reaction.
