# Adobe I/O Runtime Architecture Reference

## Runtime model

Adobe I/O Runtime is built on Apache OpenWhisk. Actions are stateless functions invoked on demand, with the following constraints:

| Constraint | Limit |
| --- | --- |
| Max execution time | 60 seconds (default), 300 seconds (extended) |
| Max memory | 256 MB (default), 1024 MB (configurable) |
| Max payload size | 1 MB (request and response) |
| Max concurrent activations | Varies by namespace quota |
| Cold start | ~200-800ms (Node.js) |

## Supported runtimes

| Runtime | Node.js version | Status |
| --- | --- | --- |
| nodejs:22 | 22.x | Current (recommended) |
| nodejs:20 | 20.x | Supported |
| nodejs:18 | 18.x | Supported |

Use `runtime: nodejs:22` for new actions because it is the current recommended runtime. Prefer `nodejs:20` or `nodejs:18` only when an existing project or compatibility constraint requires them.

> **Note:** `nodejs:24` is available on Stage environments for early testing (since November 2025, Node.js v24.0.1). Do not use it in production manifests — it is not yet deployed to Production.

## Action types

### Standard web action (`web: 'yes'`)

- Receives deserialized JSON params
- `__ow_method`, `__ow_headers`, `__ow_path` available as params
- Response body auto-serialized to JSON
- CORS headers managed by the platform

### Raw web action (`web: 'raw'`)

- Full HTTP control; receives raw request body as base64 in `__ow_body`
- Must set all response headers manually
- Use for file uploads, custom content types, cookie handling

### Non-web action (`web: 'no'`)

- Only invocable via CLI or programmatic API
- Used for background processing, scheduled tasks, event handlers
- Cannot be called via HTTP URL

## SDK services

| SDK | Purpose | Import |
| --- | --- | --- |
| Core (Logger) | Structured logging | require('@adobe/aio-sdk').Core |
| State | Key-value store (TTL-based) | require('@adobe/aio-sdk').State |
| Files | Blob storage | require('@adobe/aio-sdk').Files |
| Events | Adobe I/O Events | require('@adobe/aio-sdk').Events |

## Deployment model

Actions are deployed via `aio app deploy` which:

1. Builds frontend assets (webpack)
2. Deploys actions to I/O Runtime
3. Uploads static assets to CDN
4. Updates the extension registry

For actions-only deployment: `aio app deploy --no-web-assets`

## Namespace structure

```
/<org-namespace>/
  <package-name>/
    <action-name>
```

Actions are grouped into packages. Each extension template creates its own package (e.g., `dx-excshell-1`).

## Authentication patterns

### IMS token pass-through

When `require-adobe-auth: true` is set, the Experience Cloud shell injects the user's IMS token. Access it via:

```javascript
function getBearerToken(params) {
  if (params.__ow_headers &&
      params.__ow_headers.authorization &&
      params.__ow_headers.authorization.startsWith('Bearer ')) {
    return params.__ow_headers.authorization.substring('Bearer '.length)
  }
  return undefined
}

const token = getBearerToken(params)
```

### Service-to-service (OAuth S2S)

For headless actions that call Adobe APIs without a user context, use OAuth Server-to-Server credentials configured in the Adobe Developer Console. Access via `.env` variables:

```javascript
const clientId = params.IMS_OAUTH_S2S_CLIENT_ID;
const clientSecret = params.IMS_OAUTH_S2S_CLIENT_SECRET;
```

## Performance considerations

- **Cold starts:** First invocation after idle period incurs ~200-800ms overhead. Mitigate with periodic keep-alive invocations for latency-sensitive actions.
- **Memory:** Higher memory allocation also allocates more CPU. Set `limits.memory` in the manifest for compute-intensive actions.
- **Concurrency:** Each action invocation runs in isolation. Use the State SDK for coordination between invocations.
- **Payload size:** The 1 MB limit applies to both request and response. For large data, use the Files SDK to store/retrieve from blob storage and pass references.