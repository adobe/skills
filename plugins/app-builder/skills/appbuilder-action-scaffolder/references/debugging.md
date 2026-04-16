# Debugging Adobe Runtime Actions

Symptom-first guide. Find the error you see, follow the fix.

## Action returns 401 Unauthorized after deploy

Two-layer auth conflict. `require-adobe-auth: true` in the manifest makes the Runtime gateway validate tokens before they reach your code. If your action also checks `params.__ow_headers.authorization`, you have two auth layers — and a mismatch between them causes 401s that survive redeploys.

**Diagnose:**
```bash
# Check manifest annotation
grep -rn 'require-adobe-auth' app.config.yaml src/*/ext.config.yaml

# Check code-level auth
grep -rn '__ow_headers.*authorization\|Authorization.*Bearer' src/*/actions/
```

**Fix — pick one approach:**
- **Annotation only (recommended for ExC Shell apps):** Remove the code-level `Authorization` check. The gateway handles validation; your action receives an already-verified token in `params.__ow_headers`.
- **Code only:** Remove `require-adobe-auth: true` from the manifest. Handle all token validation in your action (useful when you need custom scopes or non-Adobe tokens).
- **Both (rare):** Document why both layers are needed and ensure the code-level check accepts the token format the gateway passes through.

**Local dev note:** `aio app dev` does not enforce `require-adobe-auth`. Your action works locally without a valid token, then fails after deploy. Test with `aio app run` or deploy to a stage workspace.

## Action works locally but returns 500 in production

Three common causes, in order of likelihood:

1. **Missing environment variables.** `.env` values are not deployed. Move secrets to `inputs` in `ext.config.yaml`:
   ```yaml
   actions:
     my-action:
       function: actions/my-action/index.js
       inputs:
         API_KEY: $API_KEY
         LOG_LEVEL: debug
   ```
   Then set `API_KEY` in the Developer Console workspace environment variables.

2. **Node.js version mismatch.** Local is v18; Runtime may be `nodejs:20` or `nodejs:22`. Check the `runtime` field in your manifest. Test locally with the matching version: `nvm use 20`.

3. **Dependencies not bundled.** Runtime deploys a zip of your action folder. If `node_modules` is missing from the build output, requires fail silently. Run `aio app deploy` (which bundles deps) rather than manual zip uploads.

**Diagnose:**
```bash
# Get the latest activation
aio rt activation list --limit 1

# Read its logs
aio rt activation logs <activation-id>

# Get the full result (includes error details)
aio rt activation get <activation-id>
```

## Action times out (504 Gateway Timeout)

Default timeout is 60 seconds. Web actions cap at 600,000 ms (10 min); non-web actions cap at 3,600,000 ms (60 min).

**Common causes:**
- Action waits on an unresponsive external API without a timeout on the fetch/axios call.
- Serial loops making many API calls — parallelize with `Promise.all`.
- Large file processing that exceeds memory, causing the process to thrash.

**Fix:**
```yaml
# ext.config.yaml — increase timeout (milliseconds)
actions:
  my-action:
    function: actions/my-action/index.js
    limits:
      timeout: 300000  # 5 minutes
```

Always set a client-side timeout on external calls:
```javascript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10000);
const resp = await fetch(url, { signal: controller.signal });
clearTimeout(timeout);
```

## Action logs not appearing in aio app logs

Activations are asynchronous. Logs can take 5–10 seconds to appear.

**Step-by-step:**
```bash
# 1. List recent activations
aio rt activation list --limit 5

# 2. Read logs for a specific activation
aio rt activation logs <activation-id>

# 3. If calling a web action over HTTP, add logging header
curl -X GET "https://<namespace>.adobeio-static.net/api/v1/web/<package>/<action>" \
  -H "x-ow-extra-logging: on"
```

**Still empty?**
- Logger level may be too high. Set `LOG_LEVEL: debug` in `ext.config.yaml` inputs.
- Verify you are using `Core.Logger` (from `@adobe/aio-sdk`), not `console.log`. Console output may not be captured in all Runtime environments.
- Successful web action calls do **not** generate logs by default — you must send the `x-ow-extra-logging: on` header.

## Action returns 404 (Not Found) when called from SPA

**Check in order:**

1. **Web action not configured.** The action needs `web: 'yes'` in the manifest:
   ```yaml
   actions:
     my-action:
       function: actions/my-action/index.js
       web: 'yes'
   ```

2. **Action URL mismatch.** The SPA calls `/api/v1/web/<package>/<action>`. Verify the package and action name match exactly. Run `aio rt action list` to see deployed action names.

3. **Action not deployed.** After code changes, run `aio app deploy`. Forgetting to redeploy is the most common cause of "it was working yesterday."

4. **Namespace mismatch.** The SPA is configured for a different workspace. Check `.env` for `AIO_runtime_namespace`.

## State SDK / Files SDK operations fail

These SDKs require a Runtime environment — they do not work with `aio app dev`.

**Use `aio app run` instead:**
```bash
# aio app dev = local mock (State/Files SDK will fail)
# aio app run = deploys to Runtime (State/Files SDK works)
aio app run
```

**Common errors:**
- `"Unauthorized"` — Missing or wrong `AIO_runtime_namespace` and `AIO_runtime_auth`. Regenerate from Developer Console.
- `"Quota exceeded"` — State SDK: 10 MB per key, 1 GB per namespace. Files SDK: storage limits vary by contract.
- `"Module not found"` — Add the dependency:
  ```bash
  npm install @adobe/aio-lib-state   # or @adobe/aio-lib-files
  ```

## Action returns CORS errors when called from browser

**Three rules:**

1. **Must be a web action.** Set `web: 'yes'` in the manifest.

2. **With `require-adobe-auth: true`, CORS is handled for you** — but only for requests from Experience Cloud Shell SPAs. Do not add manual CORS headers on top; they can conflict.

3. **Without `require-adobe-auth`, return CORS headers explicitly:**
   ```javascript
   return {
     statusCode: 200,
     headers: {
       'Access-Control-Allow-Origin': '*',
       'Access-Control-Allow-Headers': 'Authorization, Content-Type',
       'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
     },
     body: result
   };
   ```
   Also handle `OPTIONS` preflight:
   ```javascript
   if (params.__ow_method === 'options') {
     return { statusCode: 204, headers: { /* same CORS headers */ } };
   }
   ```

## Action works but returns wrong data format

Web actions and raw actions have different response contracts.

**Web action (most common):** Must return `{ statusCode, headers, body }`:
```javascript
// Correct — web action
return {
  statusCode: 200,
  headers: { 'Content-Type': 'application/json' },
  body: { users: list }
};
```

**Raw action:** Returns the result object directly — no `statusCode` wrapper:
```javascript
// Correct — raw action (non-web)
return { users: list };
```

**Common mistakes:**
- Returning a plain object from a web action → Runtime wraps it in a 200 response with `application/json`, but the structure may not match what the SPA expects.
- Returning `body` as a string when the client expects JSON → Set `Content-Type: application/json` and pass an object (not `JSON.stringify`).
- Missing `statusCode` → Defaults to 200 but some API gateways require it explicitly.

## S2S token generation fails (getToken error)

OAuth Server-to-Server credentials replaced JWT (deprecated). If token generation fails:

**Check credentials:**
```bash
# Verify these are set in .env or ext.config.yaml inputs
echo $IMS_CLIENT_ID
echo $IMS_CLIENT_SECRET
echo $IMS_SCOPES
```

**Common causes:**
1. **Wrong credential type.** Must be "OAuth Server-to-Server" in Developer Console, not "Service Account (JWT)."
2. **Invalid scopes.** `IMS_SCOPES` must match exactly what is configured in the credential's product profile. Extra or misspelled scopes cause a 400 error.
3. **Missing dependency:**
   ```bash
   npm install @adobe/aio-lib-ims
   ```
4. **Credential not assigned to workspace.** In Developer Console, verify the credential is linked to the workspace you are deploying to.

**Test token generation locally:**
```javascript
const { context, getToken } = require('@adobe/aio-lib-ims');
await context.set('my_profile', {
  client_id: process.env.IMS_CLIENT_ID,
  client_secrets: [process.env.IMS_CLIENT_SECRET],
  scopes: process.env.IMS_SCOPES.split(',')
});
const token = await getToken('my_profile');
console.log('Token received, length:', token.length);
```

## AEM API calls return 403 Forbidden

The action authenticates successfully but AEM rejects the request.

**Diagnose in order:**

1. **Wrong product profile.** The S2S credential needs an AEM product profile (e.g., "AEM Administrators" or a custom profile) assigned in Admin Console. Without it, the token has no AEM permissions.

2. **User token vs. S2S token.** Some AEM APIs require a service-level token. If you are forwarding a user's access token, the user may lack the required AEM permissions. Switch to S2S for backend operations.

3. **Incorrect AEM host URL.** Verify `AEM_HOST` includes `https://` and points to the correct author or publish instance:
   ```bash
   # Correct
   AEM_HOST=https://author-p12345-e67890.adobeaemcloud.com

   # Wrong — missing protocol or wrong tier
   AEM_HOST=author-p12345-e67890.adobeaemcloud.com
   AEM_HOST=https://publish-p12345-e67890.adobeaemcloud.com  # if you need author
   ```

4. **IP allowlisting.** If the AEM Cloud instance has IP allowlists configured, Adobe Runtime egress IPs must be included. Check with your AEM administrator — Runtime IPs vary by region and are not static.
