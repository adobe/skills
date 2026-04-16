# Runtime Reference

## Action Structure

Every action is a JavaScript function that receives `params` and returns an object:

```javascript
async function main(params) {
  const name = params.name || 'World';
  return {
    statusCode: 200,
    body: { message: `Hello, ${name}!` }
  };
}
exports.main = main;
```

## Input Parameters (`params`)

The `params` object contains:

- **Default parameters** from `app.config.yaml` inputs (encrypted at rest)
- **Invocation parameters** passed at call time
- **System parameters** prefixed with `__ow_` (for web actions)

```javascript
async function main(params) {
  // Default params from config
  const apiKey = params.API_KEY;
  const logLevel = params.LOG_LEVEL;

  // Invocation params
  const userId = params.userId;

  // System params (web actions only)
  const method = params.__ow_method;   // 'get', 'post', etc.
  const headers = params.__ow_headers; // Request headers
  const path = params.__ow_path;       // URL path suffix
  const body = params.__ow_body;       // Request body (base64 for raw)

  return { statusCode: 200, body: { userId } };
}
```

## Response Formats

### Standard web action response

```javascript
return {
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache'
  },
  body: { data: 'value' }  // Auto-serialized to JSON
};
```

### Raw web action response

For `web: 'raw'` actions — full HTTP control:

```javascript
return {
  statusCode: 200,
  headers: {
    'Content-Type': 'text/html',
    'Set-Cookie': 'session=abc; Secure; HttpOnly'
  },
  body: '<html><body>Hello</body></html>'
};
```

### Error response

```javascript
return {
  statusCode: 500,
  body: { error: 'Something went wrong' }
};
// OR throw an error (results in 502)
throw new Error('Action failed');
```

## File Structure Conventions

```
actions/
├── get-products/
│   ├── index.js            # Action entry point
│   └── utils.js            # Helper modules
├── create-order/
│   └── index.js
└── shared/
    └── auth.js             # Shared utilities across actions
```

Register in `app.config.yaml`:

```yaml
application:
  runtimeManifest:
    packages:
      api:
        actions:
          get-products:
            function: actions/get-products/index.js
            web: 'yes'
            runtime: nodejs:18
          create-order:
            function: actions/create-order/index.js
            web: 'yes'
            runtime: nodejs:18
```

> Guardrail: Nest actions under application.runtimeManifest rather than a root-level runtimeManifest, because the CLI ignores the root-level form and those actions will not deploy.

> **Runtime versions:** Use `nodejs:22` (recommended) for new actions. `nodejs:20` and `nodejs:18` are also supported. `nodejs:24` is available on Stage environments only (since November 2025) for early testing — do not use it in production manifests.

## Limits and Timeouts

| Action type | Hard timeout limit | Default if unspecified |
| --- | --- | --- |
| Web actions (`web: 'yes'` or `web: 'raw'`) | 60,000 ms (1 minute) | 60,000 ms |
| Blocking (non-web, invoked synchronously) | 60,000 ms (1 minute) | 60,000 ms |
| Non-blocking (non-web, invoked asynchronously) | 10,800,000 ms (3 hours) | 60,000 ms |

Set a custom timeout in `app.config.yaml`:

```yaml
actions:
  long-running-job:
    function: actions/long-running-job/index.js
    runtime: nodejs:18
    limits:
      timeout: 3600000   # 1 hour (in milliseconds)
```

> Guardrail: Web and blocking actions are always capped at 60 000 ms regardless of the `timeout` value you set. Only non-blocking actions (invoked with the `"blocking": false` flag or via asynchronous trigger) can use timeouts above 60 000 ms, up to the 10 800 000 ms (3-hour) maximum.

## Using App Builder SDKs

```javascript
const { Core, State, Files, Events } = require('@adobe/aio-sdk');

async function main(params) {
  // Logger
  const logger = Core.Logger('my-action', { level: params.LOG_LEVEL || 'info' });
  logger.info('Action invoked');

  // State SDK (key-value store)
  const state = await State.init();
  await state.put('key', 'value', { ttl: 3600 });
  const { value } = await state.get('key');

  // Files SDK (blob storage)
  const files = await Files.init();
  await files.write('data/output.json', JSON.stringify({ result: 'ok' }));

  return { statusCode: 200, body: { value } };
}
```

## State SDK Storage Details

State SDK v4+ uses Adobe's proprietary storage backend (not CosmosDB). Key facts:

- **Regions:** 4 regions — `amer`, `emea`, `apac`, `aus`. The region is selected automatically based on the workspace configuration.
- **Consistency model:** Strong consistency for CRUD operations (`get`, `put`, `delete`). Eventual consistency for `list` operations (~5 ms propagation lag).
- **Key limits:** Max key size 1 KB, max value size 1 MB.
- **TTL:** Default and maximum TTL is 365 days. Entries expire automatically after TTL.
- **Capacity:** Up to 200,000 key-value pairs per workspace.

```javascript
const state = await State.init();

// CRUD — strongly consistent
await state.put('cart:user123', { items: ['SKU-1'] }, { ttl: 86400 });
const { value } = await state.get('cart:user123');
await state.delete('cart:user123');

// List — eventually consistent (~5 ms lag after writes)
const { keys } = await state.list({ match: 'cart:*' });
```

## CLI Operations

```bash
# Deploy all actions
aio app deploy

# Deploy actions only (skip frontend)
aio app deploy --no-web-assets

# Run locally with hot-reload
aio app dev

# View action logs (real-time)
aio rt logs --tail

# Invoke an action directly
aio rt action invoke my-package/my-action -p name "World"

# Get action URL
aio rt action get my-package/my-action --url

# List all actions
aio rt action list

# Delete an action
aio rt action delete my-package/my-action
```

### Local Testing: `aio app dev` vs `aio app run`

| Scenario | Command | Why |
| --- | --- | --- |
| Rapid iteration / debugging action logic | aio app dev | Instant reload, no deploy wait, step-through debugging |
| Actions use State SDK (@adobe/aio-lib-state) | aio app run | State SDK requires Runtime environment; fails locally |
| Actions use Files SDK (@adobe/aio-lib-files) | aio app run | Files SDK requires Runtime environment; fails locally |
| Actions use Database SDK (@adobe/aio-lib-db) | aio app dev | Database SDK works locally (except production workspaces) |
| Testing action sequences | aio app run | Local sequence routing is unreliable with aio app dev |
| Need activation records or log forwarding | aio app run | aio app dev doesn't create activations |
| Front-end development only | aio app dev | Faster, no cloud round-trips |
| CI/smoke testing before deploy | aio app run | Closer to production behavior |

**Default to **`aio app dev` for rapid iteration. Switch to `aio app run` when your action uses State SDK, Files SDK, sequences, or you need activation records.

## Cold Start & Pre-warmed Containers

Adobe I/O Runtime keeps **pre-warmed containers** ready for the default Node.js version at **standard memory sizes: 256 MB, 512 MB, and 1024 MB**. When an action uses one of these sizes, the first invocation after an idle period reuses an already-initialized container, resulting in a fast cold start (typically under 200 ms).

**Non-standard memory values (e.g. 384 MB, 2048 MB) bypass the pre-warmed pool.** Every invocation that cannot reuse a warm container must spin up a new one from scratch, adding several hundred milliseconds to several seconds of latency.

### Recommendations

- **Use 256, 512, or 1024 MB** unless your action genuinely needs more (or a very specific amount of) memory.
- If you set a `memory` annotation in `app.config.yaml`, verify it is one of the three pre-warmed sizes:

  ```yaml
  actions:
    my-action:
      function: actions/my-action/index.js
      runtime: nodejs:18
      limits:
        memory: 256   # pre-warmed ✓
  ```

- Non-standard sizes like `limits.memory: 2048` will work, but expect **cold starts on every invocation** when no warm container is available.

> **Guardrail:** Prefer 256 / 512 / 1024 MB memory settings. Other values disable pre-warmed containers and cause cold starts, which increases latency and may degrade user experience.

## Web Action Logging

By default, **successful** web action activations do not store logs. Only failed activations (non-2xx responses or thrown errors) are logged automatically. This means `console.log`, `logger.info`, and similar output from a successful web action invocation will not appear in `aio rt logs` or the activation record.

### Enabling logs for successful web actions

Send the header `x-ow-extra-logging: on` with your HTTP request to force log capture for that invocation:

```bash
curl -X GET "https://<namespace>.adobeio-static.net/api/v1/web/<package>/<action>" \
  -H "x-ow-extra-logging: on"
```

When this header is present, Runtime stores the full activation record — including all `console.log` output — even when the action returns a 2xx status.

### Throttle limit

Extra logging is throttled to **30 invocations per minute** per action. Invocations beyond this limit within the same minute window will succeed normally but their logs will **not** be stored. Plan debugging sessions accordingly and avoid leaving the header enabled in production traffic.

### When to use

- **Debugging a web action that returns 200 but produces wrong data** — enable extra logging temporarily to inspect `console.log` output.
- **Verifying parameter values reach the action** — log `params` with the header enabled, then check `aio rt activation logs <id>`.
- **Do not leave enabled in production** — the 30 inv/min cap means you will lose log data under real traffic, and the extra storage adds latency.

## Common Auth Issues

Adobe App Builder actions can have **two independent auth layers** that are easy to confuse:

| Layer | Where it lives | What it does |
| --- | --- | --- |
| Manifest annotation | annotations.require-adobe-auth: true in app.config.yaml or ext.config.yaml | Runtime gateway rejects requests that lack a valid Adobe IMS token before your code runs |
| Code-level header check | params.__ow_headers.authorization inspection inside the action | Your action code validates or extracts the bearer token after the gateway lets the request through |

### Why this matters

When both layers are active, removing or changing one does not disable the other. This causes confusing failures during local development:

- `require-adobe-auth: true`** is set, but you removed the code-level check:** The gateway still blocks unauthenticated requests. Your code changes have no visible effect.
- **You removed **`require-adobe-auth`** from the manifest, but the code still checks **`__ow_headers.authorization`**:** The gateway lets the request through, but the action itself returns 401 because no token was forwarded.
- **Both layers expect a token, but **`aio app dev`** does not inject one:** Local calls fail at the first layer that checks and the error message may not clarify which layer rejected the request.

### Debugging checklist

1. **Check the manifest annotation** — Run `grep -n 'require-adobe-auth' app.config.yaml src/*/ext.config.yaml` to see which actions require gateway auth.
2. **Check the action code** — Search for `__ow_headers.authorization`, `__ow_headers?.authorization`, or `Bearer` in the action source to find code-level token checks.
3. **Disable one layer at a time** — To isolate the problem, temporarily set `require-adobe-auth: false` in the manifest while keeping the code check, or vice versa. Redeploy between changes.
4. **For local dev without tokens** — Set `require-adobe-auth: false` *and* skip or stub the code-level check. Remember to re-enable both before deploying to production.

### Common error messages

| Error | Likely cause |
| --- | --- |
| 401 Unauthorized before action logs appear | Gateway rejected the call — require-adobe-auth: true is active and no valid token was sent |
| 401 or 403 with action logs showing execution | Code-level auth check rejected the token (missing, expired, or wrong audience) |
| Works locally with aio app dev but fails after deploy | require-adobe-auth: true is ignored locally but enforced in deployed Runtime |